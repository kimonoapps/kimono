import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import ts from 'typescript';

function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}
const { sanitizePicturePng, pictureMaxBytes } = load('../src/lib/picture-png.ts');
const { parseProfileInput, initialOf, parsePasswordChange, passwordRules } = load('../src/lib/account-input.ts');

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function png(size = 512, extra = []) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const types = (bytes) => { const out = []; let o = 8; const b = Buffer.from(bytes); while (o < b.length) { const len = b.readUInt32BE(o); out.push(b.toString('ascii', o + 4, o + 8)); o += 12 + len; } return out; };

test('a cropped 512 PNG keeps only the chunks that draw pixels', () => {
  const dirty = png(512, [chunk('tEXt', Buffer.from('Comment\0taken at home')), chunk('eXIf', Buffer.from('MM\0*GPS'))]);
  const clean = sanitizePicturePng(dirty);
  assert.deepEqual(types(clean), ['IHDR', 'IDAT', 'IEND']);
  assert.ok(!Buffer.from(clean).includes(Buffer.from('GPS')));
});
test('anything but a 512×512 PNG is refused', () => {
  assert.throws(() => sanitizePicturePng(png(256)), /512×512/);
  assert.throws(() => sanitizePicturePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0])), /PNG/);
  assert.throws(() => sanitizePicturePng(png(512).subarray(0, 60)), /damaged/);
  assert.throws(() => sanitizePicturePng(new Uint8Array(pictureMaxBytes + 1)), /2 MB/);
});
test('profile edits are trimmed, bounded and need at least one field', () => {
  assert.deepEqual(parseProfileInput({ name: '  Akram   K  ', email: ' Akram@Example.COM ' }), { name: 'Akram K', email: 'akram@example.com' });
  assert.deepEqual(parseProfileInput({ name: 'Mina' }), { name: 'Mina' });
  for (const bad of [{}, null, [], { name: '   ' }, { name: 'x'.repeat(81) }, { name: 'a\u0007b' }, { email: 'not-an-email' }, { email: 3 }]) assert.throws(() => parseProfileInput(bad));
});
test('the initial comes from the name, then the username', () => {
  assert.equal(initialOf('kai', 'kai'), 'K');
  assert.equal(initialOf('', 'sora'), 'S');
  assert.equal(initialOf('  ', ''), '?');
  assert.equal(initialOf('桜子', 'sakurako'), '桜');
});

test('a new password must be long, not the person, typed twice, and new', () => {
  const me = { username: 'kimono-test', name: 'Mina Sato' };
  assert.deepEqual(parsePasswordChange({ current: 'old-password-1', next: 'paper-lantern-river-77', confirm: 'paper-lantern-river-77' }, me), { current: 'old-password-1', next: 'paper-lantern-river-77', signOutOthers: true });
  assert.equal(parsePasswordChange({ current: 'a', next: 'paper-lantern-river-77', signOutOthers: false }, me).signOutOthers, false);
  assert.throws(() => parsePasswordChange({ current: '', next: 'paper-lantern-river-77' }, me), /current password/);
  assert.throws(() => parsePasswordChange({ current: 'a', next: 'short' }, me), /12 characters/);
  assert.throws(() => parsePasswordChange({ current: 'a', next: 'i-am-kimono-test-ok' }, me), /name or username/);
  assert.throws(() => parsePasswordChange({ current: 'a', next: 'hello-mina-from-here' }, me), /name or username/);
  assert.throws(() => parsePasswordChange({ current: 'a', next: 'paper-lantern-river-77', confirm: 'paper-lantern-river-7' }, me), /don't match/);
  assert.throws(() => parsePasswordChange({ current: 'same-password-123', next: 'same-password-123' }, me), /haven't been using/);
  assert.deepEqual(passwordRules('', me), { long: false, notName: true });
});
