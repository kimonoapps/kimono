import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/app-updates.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', code)(loaded, loaded.exports);
const { updateFor, validRelease } = loaded.exports;

const release = (build, required = false, platform = 'android') => ({ platform, version: `0.${build}.0`, build, required, notes: '', publishedAt: 0, publishedBy: 'akram', size: 10, sha256: 'x' });

test('nothing newer: nothing to do', () => {
  assert.deepEqual(updateFor([release(3)], 'android', 3).available, false);
  assert.deepEqual(updateFor([], 'android', 1).available, false);
});

test('the newest is offered; optional unless something newer than the phone is required', () => {
  const releases = [release(2), release(3, true), release(4)];
  assert.deepEqual([updateFor(releases, 'android', 1).build, updateFor(releases, 'android', 1).required], [4, true], 'a required release cannot be skipped by a later optional one');
  assert.deepEqual([updateFor(releases, 'android', 3).build, updateFor(releases, 'android', 3).required], [4, false]);
});

test('platforms are separate', () => {
  assert.equal(updateFor([release(9, true, 'ios')], 'android', 1).available, false);
  assert.equal(updateFor([release(9, true, 'ios')], 'ios', 1).required, true);
});

test('a published version is checked first', () => {
  assert.throws(() => validRelease({ platform: 'windows', version: '1.0', build: 1 }, []), /Android or iPhone/);
  assert.throws(() => validRelease({ platform: 'android', version: 'latest', build: 1 }, []), /0\.2\.0/);
  assert.throws(() => validRelease({ platform: 'android', version: '1.0', build: 1.5 }, []), /whole number/);
  assert.throws(() => validRelease({ platform: 'android', version: '1.0', build: 3 }, [release(3)]), /newer than 3/);
  assert.deepEqual(validRelease({ platform: 'android', version: ' 0.4.0 ', build: '4', notes: ' Faster ' }, [release(3)]), { platform: 'android', version: '0.4.0', build: 4, notes: 'Faster' });
});
