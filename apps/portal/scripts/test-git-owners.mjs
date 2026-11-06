/*
 * Projects are their person's own in Kimono Git (lib/code/forgejo.ts). These run against
 * a real, throwaway Forgejo, and are skipped without one:
 *
 *   docker run -d --name kimono-git-probe -p 127.0.0.1:3399:3000 \
 *     -e FORGEJO__security__INSTALL_LOCK=true -e FORGEJO__database__DB_TYPE=sqlite3 \
 *     codeberg.org/forgejo/forgejo:16.0.3
 *   docker exec -u git kimono-git-probe forgejo admin user create --admin --username kimono-ai \
 *     --email ai@example.test --password <password> --must-change-password=false
 *   docker exec -u git kimono-git-probe forgejo admin user create --username akram \
 *     --email akram@example.test --password <another> --must-change-password=false
 *   KIMONO_TEST_GIT=http://127.0.0.1:3399 KIMONO_TEST_GIT_PASSWORD=<password> pnpm test:git-owners
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const address = process.env.KIMONO_TEST_GIT;
const password = process.env.KIMONO_TEST_GIT_PASSWORD;
const skip = !address || !password ? 'needs KIMONO_TEST_GIT and KIMONO_TEST_GIT_PASSWORD' : false;

/* Kimono's own Kimono Git, as the Portal keeps it: its administrator's password among the secrets. */
const state = mkdtempSync(join(tmpdir(), 'kimono-git-owners-'));
process.env.KIMONO_STATE_DIR = state;
writeFileSync(join(state, 'secrets.json'), JSON.stringify({ KIMONO_SECRET_GITPROBE_ADMIN_PASSWORD: password ?? 'x' }));
const config = { gitAddress: address, gitToken: '', gitApp: 'gitprobe' };
const run = Date.now().toString(36);

const forgejo = skip ? null : await import('../src/lib/code/forgejo.ts');
const model = skip ? null : await import('../src/lib/code/model.ts');
const asAdmin = (path, init = {}) => fetch(`${address}/api/v1${path}`, {
  ...init, headers: { Authorization: `Basic ${Buffer.from(`kimono-ai:${password}`).toString('base64')}`, 'Content-Type': 'application/json', ...init.headers },
});

test('a new project is made in the person\'s own account', { skip }, async () => {
  const made = await forgejo.createRepository(config, { username: 'akram' }, `Recipes ${run}`);
  assert.equal(made.owner, 'akram');
  const listed = await forgejo.repositories(config, { username: 'akram' });
  assert.ok(listed.some((r) => r.owner === 'akram' && r.name === made.name));
});

test('someone who never opened Kimono Git gets an account, then the project', { skip }, async () => {
  const username = `mina${run}`;
  assert.equal(await forgejo.gitAccountOf(config, { username }, false), null);
  await assert.rejects(forgejo.createRepository(config, { username }, 'No email'), /Sign in to Kimono Git once/);
  const made = await forgejo.createRepository(config, { username, name: 'Mina', email: `${username}@example.test` }, `Garden ${run}`);
  assert.equal(made.owner, username);
  /* Its account is an ordinary one, not an administrator's. */
  const account = await (await asAdmin(`/users/${username}`)).json();
  assert.equal(account.is_admin, false);
});

test('a project kept in Kimono AI\'s account moves to its person, with every chat on it', { skip }, async () => {
  const name = `legacy-${run}`;
  assert.equal((await asAdmin('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: true, auto_init: true, default_branch: 'main' }) })).status, 201);
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const first = model.createWorkspace(db, 'akram', { repoOwner: 'kimono-ai', repoName: name, base: 'main', prompt: 'Fix the header' });
  const second = model.createWorkspace(db, 'akram', { repoOwner: 'kimono-ai', repoName: name, base: 'main', prompt: 'Add a footer' });
  const moved = await forgejo.ownProject(db, config, first, { username: 'akram' });
  assert.deepEqual(moved.repo, { owner: 'akram', name });
  assert.equal(model.workspaceFor(db, second.id, 'akram').repo.owner, 'akram');
  assert.equal((await asAdmin(`/repos/akram/${name}`)).status, 200);
  /* The second chat, still holding the old owner, finds it already moved. */
  assert.deepEqual((await forgejo.ownProject(db, config, second, { username: 'akram' })).repo, { owner: 'akram', name });
});

test('a project stays where it is while its person has no account to move it to', { skip }, async () => {
  const name = `waiting-${run}`;
  await asAdmin('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: true, auto_init: true, default_branch: 'main' }) });
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const w = model.createWorkspace(db, `ghost${run}`, { repoOwner: 'kimono-ai', repoName: name, base: 'main', prompt: 'Hi' });
  assert.equal((await forgejo.ownProject(db, config, w, { username: `ghost${run}` })).repo.owner, 'kimono-ai');
});

test('someone whose Kimono Git account has another username is found by their email', { skip }, async () => {
  const login = `other${run}`, email = `${login}@example.test`;
  const made = await asAdmin('/admin/users', { method: 'POST', body: JSON.stringify({ username: login, email, password: `Pw-${run}-${run}-long`, must_change_password: false }) });
  assert.equal(made.status, 201);
  assert.equal(await forgejo.gitAccountOf(config, { username: `kimono${run}`, email }), login);
  const repo = await forgejo.createRepository(config, { username: `kimono${run}`, email }, `Their ${run}`);
  assert.equal(repo.owner, login);
});
