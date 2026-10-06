import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/tunnel-settings.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };new Function('module', 'exports', code)(module,module.exports);
const { renameTunnelSettings, deleteTunnelSettings } = module.exports;
const state = () => ({
  tunnels: { main: { id:'main',name:'Main',enabled:true,provider:'cloudflare',configuration:{ TUNNEL_TOKEN:{value:'synthetic-token',secret:true} } }, other:{id:'other',name:'Other'} },
  apps: { portal:{tunnelId:'main',enabled:true,domain:'portal.example',environment:{}}, photos:{tunnelId:'main',enabled:true}, notes:{tunnelId:'other',enabled:true} },
  routes: { portal:{tunnelId:'main',appId:'portal'}, photos:{tunnelId:'main',appId:'photos'}, notes:{tunnelId:'other',appId:'notes'} },
});
test('rename only changes the label, preserving secrets, state and assignments', () => {
  const settings=state(),expected=structuredClone(settings);expected.tunnels.main.name='Home';
  renameTunnelSettings(settings,'main',' Home ');assert.deepEqual(settings,expected);
});
test('invalid renames leave settings untouched', () => {
  for(const name of ['', '   ', 'x'.repeat(121)]) {const settings=state(),before=structuredClone(settings);assert.throws(()=>renameTunnelSettings(settings,'main',name));assert.deepEqual(settings,before);}
  for (const id of ['missing', '__proto__', 'constructor']) assert.throws(()=>renameTunnelSettings(state(),id,'Name'));
});
test('delete detaches apps and removes only the deleted tunnel routes', () => {
  const settings=state();deleteTunnelSettings(settings,'main');
  assert.equal(settings.tunnels.main,undefined);assert.equal(settings.apps.portal.tunnelId,null);assert.equal(settings.apps.photos.tunnelId,null);
  assert.equal(settings.apps.portal.enabled,true);assert.equal(settings.apps.portal.domain,'portal.example');
  assert.equal(settings.apps.notes.tunnelId,'other');assert.deepEqual(Object.keys(settings.routes),['notes']);assert(settings.tunnels.other);
});
test('unknown deletion leaves settings untouched', () => {
  const settings=state(),before=structuredClone(settings);for (const id of ['missing', '__proto__', 'constructor']) assert.throws(()=>deleteTunnelSettings(settings,id));assert.deepEqual(settings,before);
});
