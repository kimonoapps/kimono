import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/mobile-app.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', code)(loaded, loaded.exports);
const { detectMobileOS, validateMobileApp, mobileAppSteps, openLink } = loaded.exports;

for (const [name, device, expected] of [
  ['iPhone Safari', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }, 'ios'],
  ['iPad mobile mode', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 }, 'ios'],
  ['iPad desktop mode', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 }, 'ios'],
  ['Android phone', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', platform: 'Linux armv8l', maxTouchPoints: 5 }, 'android'],
  ['Android tablet', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Tablet)', platform: 'Linux armv8l', maxTouchPoints: 10 }, 'android'],
  ['Mac desktop', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0 }, null],
  ['Windows touchscreen', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10 }, null],
  ['unknown browser', { userAgent: '', platform: '', maxTouchPoints: 0 }, null],
]) {
  test(`detects ${name}`, () => assert.equal(detectMobileOS(device), expected));
}

const manifest = JSON.parse(readFileSync(new URL('../app-definitions/immich/app.json', import.meta.url))).spec.mobileApp;
test('structured app steps validate and retain their order', () => {
  validateMobileApp(manifest);
  assert.deepEqual(mobileAppSteps(manifest).map(step => step.kind), ['download', 'open', 'instruction']);
});
test('legacy string steps remain supported', () => {
  const legacy = { ...manifest, steps: ['Download', 'Connect', 'Sign in'] };
  validateMobileApp(legacy);
  assert.equal(mobileAppSteps(legacy)[1].kind, 'server');
  validateMobileApp({ ...legacy, iosUrl: undefined, androidUrl: undefined });
});
test('invalid configurations fail before rendering', () => {
  for (const patch of [
    { steps: [] }, { guideUrl: 'https://' }, { iosUrl: 'javascript:alert(1)' },
    { steps: [{ ...manifest.steps[0], kind: 'unknown' }] },
    { steps: [manifest.steps[0], manifest.steps[0]] },
    { steps: [{ ...manifest.steps[0], description: '' }] },
    { iosUrl: undefined, androidUrl: undefined },
    { iosUrl: '//evil.test/get-app' }, { androidUrl: 'http://example.test/app.apk' },
    { steps: [{ ...manifest.steps[1], href: 'javascript:alert(1)' }] },
    { steps: [{ ...manifest.steps[1], href: 'https://example.test/connect' }] },
    { steps: [{ ...manifest.steps[1], label: '' }] },
  ]) assert.throws(() => validateMobileApp({ ...manifest, ...patch }));
});

test('Kimono Photos: its own app, connected only by the Kimono link', () => {
  assert.equal(manifest.name, 'Kimono Photos');
  assert.ok(!/alextran|apps\.apple\.com|play\.google\.com/.test(JSON.stringify(manifest)), 'no store Immich left');
  assert.equal(manifest.iosUrl, '/get-app?for=ios', 'iPhones go through TestFlight like the Kimono app');
  assert.match(manifest.androidUrl, /^https:\/\/github\.com\/kimonoapps\/repatches\/releases\/download\/.+\.apk$/);
});
test('an open step links the phone app to this app address, and only its origin', () => {
  const step = mobileAppSteps(manifest).find(s => s.kind === 'open');
  assert.equal(openLink(step, 'https://photos.home.test/'), 'kimono-photos://connect?server=https%3A%2F%2Fphotos.home.test');
  assert.equal(openLink(step, 'https://photos.home.test/some/page?x=1'), 'kimono-photos://connect?server=https%3A%2F%2Fphotos.home.test');
  assert.equal(new URL(openLink(step, 'https://photos.home.test')).searchParams.get('server'), 'https://photos.home.test');
});
test('a guide link is optional', () => {
  validateMobileApp({ ...manifest, guideUrl: undefined });
  validateMobileApp({ ...manifest, guideUrl: 'https://example.test/guide' });
});
