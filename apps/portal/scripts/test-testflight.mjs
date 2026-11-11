import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, verify } from 'node:crypto';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file) {
  const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
  return loaded.exports;
}
const { planSync, planAlso, nameParts } = load('testflight-plan.ts');
const { appStoreToken, isApiKey } = load('testflight-token.ts');

const account = (username, email, active = true, name = username) => ({ username, name, email, active });
const base = { users: [], invitations: [], testers: [], invited: {} };

test('new people are invited; accepted ones are added; testers are left be', () => {
  const plan = planSync({
    ...base,
    accounts: [account('mina', 'Mina@Kimono.test', true, 'Mina Sato'), account('ren', 'ren@kimono.test'), account('sora', 'sora@kimono.test'), account('hana', 'hana@kimono.test')],
    users: [{ id: 'u-ren', email: 'ren@kimono.test', roles: ['CUSTOMER_SUPPORT'] }, { id: 'u-sora', email: 'sora@kimono.test', roles: ['CUSTOMER_SUPPORT'] }],
    invitations: [{ id: 'i-hana', email: 'hana@kimono.test' }],
    testers: [{ id: 't-sora', email: 'SORA@kimono.test' }],
  });
  assert.deepEqual(plan.steps, [
    { kind: 'invite', email: 'mina@kimono.test', firstName: 'Mina', lastName: 'Sato' },
    { kind: 'add', email: 'ren@kimono.test', firstName: 'ren', lastName: 'Kimono' },
  ]);
  assert.deepEqual(plan.statuses.map((s) => [s.username, s.status]), [['mina', 'invited (waiting to accept)'], ['ren', 'added'], ['sora', 'tester'], ['hana', 'invited (waiting to accept)']]);
});

test('no email: nothing to send, and said so', () => {
  const plan = planSync({ ...base, accounts: [account('kai', null)] });
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.statuses[0].status, 'no email');
});

test('only people the Portal invited are ever taken off', () => {
  const plan = planSync({
    accounts: [account('mina', 'mina@kimono.test', false), account('ren', 'ren@kimono.test', false), account('jun', 'jun@kimono.test', false)],
    users: [{ id: 'u-ren', email: 'ren@kimono.test', roles: ['CUSTOMER_SUPPORT'] }, { id: 'u-jun', email: 'jun@kimono.test', roles: ['ADMIN'] }, { id: 'u-owner', email: 'owner@kimono.test', roles: ['ADMIN'] }],
    invitations: [{ id: 'i-mina', email: 'mina@kimono.test' }],
    testers: [],
    invited: { 'mina@kimono.test': { at: 1 }, 'ren@kimono.test': { at: 1 } },
  });
  assert.deepEqual(plan.steps, [
    { kind: 'removeInvitation', email: 'mina@kimono.test', invitationId: 'i-mina' },
    { kind: 'removeUser', email: 'ren@kimono.test', userId: 'u-ren' },
  ], 'jun was never invited by the Portal, and the owner is never touched');
});

test('someone whose role was raised on the team is forgotten, not removed', () => {
  const plan = planSync({ ...base, accounts: [], users: [{ id: 'u-mina', email: 'mina@kimono.test', roles: ['CUSTOMER_SUPPORT', 'DEVELOPER'] }], invited: { 'mina@kimono.test': { at: 1 } } });
  assert.deepEqual(plan.steps, [{ kind: 'forget', email: 'mina@kimono.test' }]);
});

test("when the directory can't say, nobody is removed", () => {
  const plan = planSync({ ...base, accounts: [account('mina', 'mina@kimono.test', null)], users: [{ id: 'u-mina', email: 'mina@kimono.test', roles: ['CUSTOMER_SUPPORT'] }], testers: [{ id: 't', email: 'mina@kimono.test' }], invited: { 'mina@kimono.test': { at: 1 } } });
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.statuses[0].status, 'tester');
});

test("another app's group gets the same people, without inviting or removing anyone", () => {
  const also = planAlso({
    accounts: [account('mina', 'mina@kimono.test', true, 'Mina Sato'), account('ren', 'ren@kimono.test'), account('sora', 'sora@kimono.test'), account('kai', null), account('jun', 'jun@kimono.test', false)],
    users: [{ id: 'u-mina', email: 'mina@kimono.test', roles: ['CUSTOMER_SUPPORT'] }, { id: 'u-sora', email: 'sora@kimono.test', roles: ['CUSTOMER_SUPPORT'] }, { id: 'u-jun', email: 'jun@kimono.test', roles: ['CUSTOMER_SUPPORT'] }],
    testers: [{ id: 't-sora', email: 'sora@kimono.test' }],
  });
  assert.deepEqual(also.steps, [{ kind: 'add', email: 'mina@kimono.test', firstName: 'Mina', lastName: 'Sato' }]);
  assert.deepEqual([...also.statuses], [['mina', 'added'], ['ren', 'invited (waiting to accept)'], ['sora', 'tester']], 'nobody without an email or Kimono access');
});

test('an expired invite, or a TestFlight invite never accepted, shows as stuck and is not re-sent on its own', () => {
  const { isStuck } = load('testflight-plan.ts');
  const plan = planSync({
    ...base,
    accounts: [account('hana', 'hana@kimono.test'), account('ren', 'ren@kimono.test'), account('sora', 'sora@kimono.test'), account('mina', 'mina@kimono.test')],
    invitations: [{ id: 'i-hana', email: 'hana@kimono.test', expired: true }, { id: 'i-mina', email: 'mina@kimono.test', expired: false }],
    users: [{ id: 'u-ren', email: 'ren@kimono.test', roles: ['CUSTOMER_SUPPORT'] }, { id: 'u-sora', email: 'sora@kimono.test', roles: ['CUSTOMER_SUPPORT'] }],
    testers: [{ id: 't-ren', email: 'ren@kimono.test', state: 'INVITED' }, { id: 't-sora', email: 'sora@kimono.test', state: 'INSTALLED' }],
  });
  assert.deepEqual(plan.steps, [], 'the hourly sync sends nobody a second email');
  assert.deepEqual(plan.statuses.map((s) => [s.username, s.status, isStuck(s.status)]), [
    ['hana', 'invite expired', true], ['ren', 'tester (not accepted)', true], ['sora', 'tester', false], ['mina', 'invited (waiting to accept)', true],
  ]);
});

test('moving someone to their Apple Account email cancels the old invite and sends a new one', () => {
  const plan = planSync({
    ...base,
    accounts: [account('mina', 'mina@icloud.test', true, 'Mina Sato')],
    invitations: [{ id: 'i-old', email: 'mina@kimono.test' }],
    invited: { 'mina@kimono.test': { at: 1 } },
  });
  assert.deepEqual(plan.steps, [
    { kind: 'invite', email: 'mina@icloud.test', firstName: 'Mina', lastName: 'Sato' },
    { kind: 'removeInvitation', email: 'mina@kimono.test', invitationId: 'i-old' },
  ]);
});

test('someone on the team but not approved for this app is not put in its group; anyone already there stays', () => {
  const plan = planSync({
    ...base,
    accounts: [{ ...account('mina', 'mina@kimono.test'), wants: false }, { ...account('ren', 'ren@kimono.test'), wants: false }, { ...account('sora', 'sora@kimono.test'), wants: false }],
    users: [{ id: 'u-mina', email: 'mina@kimono.test', roles: ['CUSTOMER_SUPPORT'] }, { id: 'u-ren', email: 'ren@kimono.test', roles: ['CUSTOMER_SUPPORT'] }],
    testers: [{ id: 't-ren', email: 'ren@kimono.test', state: 'INSTALLED' }],
  });
  assert.deepEqual(plan.steps, [{ kind: 'invite', email: 'sora@kimono.test', firstName: 'sora', lastName: 'Kimono' }], 'sora still joins the team, for an app they were approved for');
  assert.deepEqual(plan.statuses.map((s) => [s.username, s.status]), [['mina', 'not requested'], ['ren', 'tester'], ['sora', 'invited (waiting to accept)']]);
});

test('someone kept from an earlier invite who never asked is not invited again', () => {
  const plan = planSync({
    ...base,
    accounts: [{ ...account('kai', 'kai@kimono.test'), wants: false, asked: false }, { ...account('yui', 'yui@kimono.test'), wants: false, asked: false }],
    invitations: [{ id: 'i-yui', email: 'yui@kimono.test', expired: true }],
    invited: { 'kai@kimono.test': { at: 1 }, 'yui@kimono.test': { at: 1 } },
  });
  assert.deepEqual(plan.steps, [], 'nothing sent, nothing taken away');
  assert.deepEqual(plan.statuses.map((s) => [s.username, s.status]), [['kai', 'not requested'], ['yui', 'invite expired']]);
});

test("another app's group only gets people approved for it", () => {
  const also = planAlso({
    accounts: [{ ...account('mina', 'mina@kimono.test'), wants: true }, { ...account('ren', 'ren@kimono.test'), wants: false }, { ...account('sora', 'sora@kimono.test'), wants: false }],
    users: [{ id: 'u-mina', email: 'mina@kimono.test', roles: [] }, { id: 'u-ren', email: 'ren@kimono.test', roles: [] }, { id: 'u-sora', email: 'sora@kimono.test', roles: [] }],
    testers: [{ id: 't-sora', email: 'sora@kimono.test' }],
  });
  assert.deepEqual(also.steps.map((s) => s.email), ['mina@kimono.test']);
  assert.deepEqual([...also.statuses], [['mina', 'added'], ['sora', 'tester']], 'ren never asked; sora was already in and stays');
});

test('names split for Apple', () => {
  assert.deepEqual(nameParts('Mina Sato', 'mina'), { firstName: 'Mina', lastName: 'Sato' });
  assert.deepEqual(nameParts('Hana', 'hana.m'), { firstName: 'Hana', lastName: 'hana.m' });
  assert.deepEqual(nameParts('', 'kai'), { firstName: 'kai', lastName: 'Kimono' });
});

test('the API token is an ES256 JWT App Store Connect accepts in shape, signed by the key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.ok(isApiKey(pem));
  assert.ok(!isApiKey('not a key'));
  const token = appStoreToken('57246542-96fe-1a63-e053-0824d011072a', '2X9R4HXF34', pem, 1_700_000_000_000);
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: '2X9R4HXF34', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: '57246542-96fe-1a63-e053-0824d011072a', iat: 1_700_000_000, exp: 1_700_000_900, aud: 'appstoreconnect-v1' });
  assert.equal(Buffer.from(signature, 'base64url').length, 64, 'raw r||s, as JWT wants, not DER');
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});
