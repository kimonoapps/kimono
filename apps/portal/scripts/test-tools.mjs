import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
const cache = new Map();
const require = createRequire(import.meta.url);
function load(path) {
  path = resolve(path);
  if (cache.has(path)) return cache.get(path).exports;
  const loaded = { exports: {} }; cache.set(path, loaded);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.') ? load(resolve(dirname(path), name + '.ts')) : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const catalog = load('src/lib/tool-apis/catalog.ts');
const access = load('src/lib/tool-apis/access.ts');
const mawaqit = load('src/lib/tool-apis/mawaqit.ts');
const openapi = load('src/lib/tool-apis/openapi.ts');
const api = JSON.parse(readFileSync('app-definitions/tools/app.json')).spec.apiCollection[0];
function instance(mode = 'public') { return { enabled: true, environment: { API_MAWAQIT_ENABLED: { value: 'on' }, API_MAWAQIT_SEARCH_ACCESS: { value: mode }, API_MAWAQIT_CALLER_KEY: { value: 'a'.repeat(32), secret: true } } }; }
test('registration and generated fields include every endpoint without invalid field names', () => {
  catalog.validateApiCollection([api]);
  assert.ok(catalog.apiConfiguration([api]).every(f => /^[A-Z0-9_]+$/.test(f.key)));
  assert.throws(() => catalog.validateApiCollection([api, api]));
});
test('all access gates and bearer key failures fail closed', () => {
  assert.throws(() => access.authorizeApi(undefined, api, 'search', null), e => e.status === 404);
  assert.throws(() => access.authorizeApi(instance('disabled'), api, 'search', null), e => e.status === 404);
  assert.deepEqual(access.authorizeApi(instance(), api, 'search', null), { upstreamKey: undefined });
  assert.throws(() => access.authorizeApi(instance('api-key'), api, 'search', 'Bearer wrong'), e => e.status === 401);
  access.authorizeApi(instance('api-key'), api, 'search', 'Bearer ' + 'a'.repeat(32));
  const missing = instance('api-key'); delete missing.environment.API_MAWAQIT_CALLER_KEY;
  assert.throws(() => catalog.validateApiSettings([api], missing.environment));
});
test('OpenAPI documents protection and never includes saved keys', () => {
  const document = openapi.openApiDocument([api], instance('api-key'));
  assert.deepEqual(document.paths['/api/tools/mawaqit/search'].get.security, [{ apiKey: [] }]);
  assert.ok(!JSON.stringify(document).includes('a'.repeat(32)));
});
test('OpenAPI hides disabled APIs and endpoints while retaining active protected endpoints', () => {
  const active = instance('api-key');
  assert.deepEqual(Object.keys(openapi.openApiDocument([api], active).paths), ['/api/tools/mawaqit/search']);
  assert.deepEqual(openapi.openApiDocument([api], instance('disabled')).paths, {});
  active.environment.API_MAWAQIT_ENABLED.value = 'off';
  assert.deepEqual(openapi.openApiDocument([api], active).paths, {});
  active.environment.API_MAWAQIT_ENABLED.value = 'on';
  active.enabled = false;
  assert.deepEqual(openapi.openApiDocument([api], active).paths, {});
});
test('Mawaqit input rejects arbitrary URLs and conflicting or invalid coordinates', () => {
  assert.throws(() => mawaqit.mosqueSlug('https://localhost/private'));
  assert.equal(mawaqit.mosqueSlug('https://mawaqit.net/en/m/paris'), 'paris');
  for (const q of ['q=Paris&lat=1&lon=2', 'lat=91&lon=2', 'lat=&lon=2']) assert.throws(() => mawaqit.searchParameters(new URLSearchParams(q)));
});
test('calendar parser handles quoted braces and date follows mosque timezone', () => {
  const calendar = Array.from({ length: 12 }, () => ({ '1': ['05:00','06:00','12:00','15:00','18:00','20:00'] }));
  const parsed = mawaqit.parseCalendar('var confData = ' + JSON.stringify({ timezone: 'Asia/Tokyo', calendar, ignored: 'brace } and "quotes"' }) + ';');
  const daily = mawaqit.dailyTimes(parsed, null, new Date('2025-12-31T23:00:00Z'));
  assert.equal(daily.date, '2026-01-01'); assert.equal(daily.times.length, 6);
  assert.throws(() => mawaqit.dailyTimes(parsed, '2026-02-30', new Date('2026-01-01')));
  assert.throws(() => mawaqit.parseCalendar('var confData = {bad};'));
});
test('adapter normalizes search responses and sanitizes upstream failure', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json([{slug:'paris',name:'Paris',localisation:'France'}, {slug:'closed',name:'Closed',closed:true}]);
    assert.deepEqual(await mawaqit.executeMawaqit('search', new URLSearchParams('q=Paris')), {mosques:[{slug:'paris',name:'Paris',location:'France'}]});
    globalThis.fetch = async () => { throw new Error('secret upstream detail'); };
    await assert.rejects(mawaqit.executeMawaqit('search', new URLSearchParams('q=Paris')), e => e.status === 502 && !e.message.includes('secret'));
  } finally { globalThis.fetch = old; }
});
test('HTTP dispatch rejects unauthorized calls before fetching and executes public requests', async () => {
  const path = resolve('src/app/api/tools/[api]/[operation]/route.ts');
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let current = instance('api-key'); let calls = 0;
  const route = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/lib/settings') return { getPlatformSettings: async () => ({ apps: { 'kimono-tools': current } }) };
    if (name === '@/lib/definitions') return { getAppDefinition: async () => ({ spec: { apiCollection: [api] } }) };
    return load('src/' + name.slice(2) + '.ts');
  }, route, route.exports);
  const old = globalThis.fetch;
  const request = (query, headers) => route.exports.GET(new Request('http://localhost/api/tools/mawaqit/search?' + query, {headers}), {params: Promise.resolve({api:'mawaqit',operation:'search'})});
  try {
    globalThis.fetch = async () => { calls++; return Response.json([{slug:'paris',name:'Paris'}]); };
    assert.equal((await request('q=Paris')).status, 401); assert.equal(calls, 0);
    current = instance('public');
    assert.equal((await request('q=Paris&q=Lyon')).status, 400); assert.equal(calls, 0);
    assert.equal((await request('q=Paris')).status, 200); assert.equal(calls, 1);
    current.enabled = false; assert.equal((await request('q=Paris')).status, 404); assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});
if (process.env.KIMONO_MAWAQIT_FIXTURE) {
  test('real published Mawaqit calendar parses into six current daily times', () => {
    const parsed = mawaqit.parseCalendar(readFileSync(process.env.KIMONO_MAWAQIT_FIXTURE, 'utf8'));
    const result = mawaqit.dailyTimes(parsed);
    assert.equal(result.times.length, 6);
    console.log('Verified live calendar:', result.timezone, result.date, result.times);
  });
}
test('key rotation preserves access and revocation closes only protected endpoints', () => {
  const original = instance('public').environment;
  original.API_MAWAQIT_CALENDAR_ACCESS = {value:'api-key',secret:false};
  const rotated = catalog.callerKeyConfiguration(api, original, 'b'.repeat(32));
  assert.equal(rotated.API_MAWAQIT_CALLER_KEY.secret, true);
  assert.equal(rotated.API_MAWAQIT_CALENDAR_ACCESS.value, 'api-key');
  const revoked = catalog.callerKeyConfiguration(api, rotated, null);
  assert.equal(revoked.API_MAWAQIT_CALLER_KEY, undefined);
  assert.equal(revoked.API_MAWAQIT_CALENDAR_ACCESS, undefined);
  assert.equal(revoked.API_MAWAQIT_SEARCH_ACCESS.value, 'public');
  assert.equal(original.API_MAWAQIT_CALLER_KEY.value, 'a'.repeat(32));
  catalog.validateApiSettings([api], revoked);
});
test('key action requires admin, prevents silent replacement, and creates server-generated keys', async () => {
  const source = ts.transpileModule(readFileSync('src/app/tools/actions.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let session = null; let saved = null;
  const current = instance('public');
  const actions = {exports:{}};
  new Function('require','module','exports',source)(name => {
    if (name === '@/auth') return {auth:async()=>session};
    if (name === 'next/cache') return {revalidatePath:()=>{}};
    if (name === '@/lib/definitions') return {getAppDefinition:async()=>({spec:{apiCollection:[api]}})};
    if (name === '@/lib/settings') return {getPlatformSettings:async()=>({apps:{'kimono-tools':current}}), saveToolApiCallerKey:async(_definition,id,key)=>{saved={id,key};}};
    if (name === '@/lib/tool-apis/catalog') return catalog;
    return require(name);
  },actions,actions.exports);
  assert.ok((await actions.exports.manageApiKey('mawaqit','rotate')).error); assert.equal(saved,null);
  session = {user:{role:'member'}};
  assert.ok((await actions.exports.manageApiKey('mawaqit','rotate')).error); assert.equal(saved,null);
  session = {user:{role:'owner'}};
  assert.ok((await actions.exports.manageApiKey('mawaqit','create')).error); assert.equal(saved,null);
  const result = await actions.exports.manageApiKey('mawaqit','rotate');
  assert.equal(saved.id,'mawaqit'); assert.equal(saved.key,result.key); assert.equal(result.key.length,43);
  const revoked = await actions.exports.manageApiKey('mawaqit','revoke');
  assert.equal(saved.key,null); assert.equal(revoked.revoked,true);
});
