import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { finish, translate } from '../src/lib/code/events.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  return db;
}
const start = (db, owner = 'akram', prompt = 'Fix the login redirect loop on Safari') =>
  model.createWorkspace(db, owner, { repoOwner: 'akram', repoName: 'kimono', base: 'main', prompt });

test('a workspace is named from its first line and gets its own branch', () => {
  const db = fresh();
  const w = start(db, 'Akram', 'Fix the login redirect loop on Safari\n\nIt happens after sign out.');
  assert.equal(w.title, 'Fix the login redirect loop on Safari');
  assert.match(w.branch, /^code\/fix-the-login-redirect-loop-[0-9a-f]{4}$/);
  assert.equal(w.owner, 'akram');
  assert.equal(w.turn, null);
  assert.equal(model.workspacesOf(db, 'akram').length, 1);
});

test('only its owner sees a workspace', () => {
  const db = fresh();
  const w = start(db);
  assert.throws(() => model.workspaceFor(db, w.id, 'mina'), (e) => e.status === 404);
  assert.equal(model.workspacesOf(db, 'mina').length, 0);
  assert.throws(() => model.removeWorkspace(db, w.id, 'mina'), (e) => e.status === 404);
});

test('it refuses a bad repository, branch, or an empty task', () => {
  const db = fresh();
  assert.throws(() => model.createWorkspace(db, 'a', { repoOwner: '../x', repoName: 'k', base: 'main', prompt: 'x' }), /repository/);
  assert.throws(() => model.createWorkspace(db, 'a', { repoOwner: 'a', repoName: 'k', base: 'a..b', prompt: 'x' }), /branch/);
  assert.throws(() => model.createWorkspace(db, 'a', { repoOwner: 'a', repoName: 'k', base: 'main', prompt: '  ' }), /what to do/);
});

test('one turn at a time, and the list shows the latest', () => {
  const db = fresh();
  const w = start(db);
  const turn = model.startTurn(db, w.id, 1000);
  assert.throws(() => model.startTurn(db, w.id), (e) => e.status === 409);
  assert.equal(model.workspaceFor(db, w.id, 'akram').turn.state, 'running');
  model.endTurn(db, turn, 'done', 2000);
  const after = model.workspaceFor(db, w.id, 'akram');
  assert.deepEqual([after.turn.state, after.turn.endedAt], ['done', 2000]);
  model.startTurn(db, w.id, 3000);
});

test('events replay in order from where a reader left off', () => {
  const db = fresh();
  const w = start(db);
  const a = model.appendEvent(db, w.id, null, { kind: 'started' });
  const b = model.appendEvent(db, w.id, null, { kind: 'text', text: 'hi' });
  assert.deepEqual([a.seq, b.seq], [1, 2]);
  assert.deepEqual(model.eventsAfter(db, w.id, 1).map((e) => e.event.kind), ['text']);
  assert.equal(model.workspaceFor(db, w.id, 'akram').lastSeq, 2);
});

test('a restart fails the turns nobody is driving any more', () => {
  const db = fresh();
  const w = start(db);
  model.startTurn(db, w.id);
  assert.equal(model.abandonRunningTurns(db).length, 1);
  assert.equal(model.workspaceFor(db, w.id, 'akram').turn.state, 'failed');
});

test("a write or an edit carries what it changed", () => {
  const { events } = translate({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'w', name: 'Write', input: { file_path: '/workspace/NOTES.md', content: '# Notes\nHello' } },
    { type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: '/workspace/a.ts', old_string: 'let x = 1', new_string: 'const x = 1' } },
  ] } });
  assert.equal(events[0].change, '+ # Notes\n+ Hello');
  assert.equal(events[1].change, '- let x = 1\n+ const x = 1');
});

test("Claude Code's stream becomes text, tool calls and their results", () => {
  const assistant = translate({ type: 'assistant', session_id: 's1', message: { content: [
    { type: 'text', text: 'Looking at the redirect.' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/workspace/src/auth.ts' } },
    { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'pnpm test' } },
  ] } });
  assert.equal(assistant.session, 's1');
  assert.deepEqual(assistant.events, [
    { kind: 'text', text: 'Looking at the redirect.' },
    { kind: 'tool', id: 't1', name: 'Read', label: 'Read', detail: 'src/auth.ts' },
    { kind: 'tool', id: 't2', name: 'Bash', label: 'Ran', detail: 'pnpm test' },
  ]);
  const result = translate({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: '1 failing' }] }] } });
  assert.deepEqual(result.events, [{ kind: 'tool-result', id: 't2', ok: false, output: '1 failing' }]);
  assert.deepEqual(translate({ type: 'system', subtype: 'init', session_id: 's1' }).events, []);
});

test('a turn ends done, failed, or stopped', () => {
  const ok = translate({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.42, duration_ms: 61000, session_id: 's1' });
  assert.deepEqual(finish(ok.result, { exit: 0 }), { kind: 'done', ok: true, costUsd: 0.42, durationMs: 61000 });
  const bad = translate({ type: 'result', subtype: 'error_max_turns', is_error: true });
  assert.equal(finish(bad.result, { exit: 1 }).ok, false);
  assert.deepEqual(finish(null, { cancelled: true }), { kind: 'done', ok: false, cancelled: true });
  assert.equal(finish(null, null).error, 'The sandbox stopped answering.');
});

test('a workspace remembers the app it is running, and only real links', () => {
  const db = fresh();
  const w = start(db);
  model.setPreview(db, w.id, { url: 'https://notes-a1b2c3.example.dev', port: 3000 });
  assert.deepEqual(model.workspaceFor(db, w.id, 'akram').preview, { url: 'https://notes-a1b2c3.example.dev', port: 3000, kind: null, stopped: false });
  // What kind of app it is, and its owner stopping it while keeping the link.
  model.setPreview(db, w.id, { url: 'https://notes-a1b2c3.example.dev', port: 3000, kind: ' Node API with SQLite ', stopped: true });
  assert.deepEqual(model.workspaceFor(db, w.id, 'akram').preview, { url: 'https://notes-a1b2c3.example.dev', port: 3000, kind: 'Node API with SQLite', stopped: true });
  model.setPreview(db, w.id, { url: 'javascript:alert(1)', port: 3000 });
  assert.equal(model.workspaceFor(db, w.id, 'akram').preview, null);
  model.setPreview(db, w.id, null);
  assert.equal(model.workspaceFor(db, w.id, 'akram').preview, null);
});

import { agentCopyName, planSync } from '../src/lib/code/sync.ts';

const row = (path, sha1 = 'a', nodeId = `n-${path}`, contentVersion = 1) => ({ path, nodeId, sha1, contentVersion });
const here = (path, sha1 = 'a') => ({ path, size: 1, sha1 });
const there = (path, contentVersion = 1, nodeId = `n-${path}`) => ({ path, nodeId, contentVersion });

test('a first sync sends the sandbox to Drive and Drive to the sandbox', () => {
  assert.deepEqual(planSync([], [here('index.html')], [there('photo.jpg')]), [
    { kind: 'upload', path: 'index.html' },
    { kind: 'put', path: 'photo.jpg', nodeId: 'n-photo.jpg' },
  ]);
});

test('nothing moves when nothing changed', () => {
  assert.deepEqual(planSync([row('a.txt')], [here('a.txt')], [there('a.txt')]), []);
});

test("the agent's edits become new versions in Drive, and its deletions go to Drive's trash", () => {
  assert.deepEqual(planSync([row('a.txt'), row('b.txt')], [here('a.txt', 'b')], [there('a.txt'), there('b.txt')]), [
    { kind: 'update', path: 'a.txt', nodeId: 'n-a.txt' },
    { kind: 'trash', path: 'b.txt', nodeId: 'n-b.txt' },
  ]);
});

test("a person's edits and deletions in Drive come into the sandbox", () => {
  assert.deepEqual(planSync([row('a.txt'), row('b.txt')], [here('a.txt'), here('b.txt')], [there('a.txt', 2)]), [
    { kind: 'put', path: 'a.txt', nodeId: 'n-a.txt' },
    { kind: 'delete', path: 'b.txt' },
  ]);
});

test('when both sides changed, Drive wins and the agent keeps a copy', () => {
  assert.deepEqual(planSync([row('a.txt')], [here('a.txt', 'b')], [there('a.txt', 2)]), [{ kind: 'conflict', path: 'a.txt', nodeId: 'n-a.txt' }]);
  assert.deepEqual(planSync([], [here('new.txt')], [there('new.txt')]), [{ kind: 'conflict', path: 'new.txt', nodeId: 'n-new.txt' }]);
  /* Edited by the agent, deleted by a person: the deletion stands, the agent's copy is kept. */
  assert.deepEqual(planSync([row('a.txt')], [here('a.txt', 'b')], []), [{ kind: 'conflict', path: 'a.txt', nodeId: null }]);
  /* Deleted by the agent, edited by a person: the edit comes back. */
  assert.deepEqual(planSync([row('a.txt')], [], [there('a.txt', 2)]), [{ kind: 'put', path: 'a.txt', nodeId: 'n-a.txt' }]);
  assert.deepEqual(planSync([row('a.txt')], [], []), [{ kind: 'forget', path: 'a.txt' }]);
  assert.equal(agentCopyName('site/index.html'), 'site/index (agent).html');
  assert.equal(agentCopyName('Makefile'), 'Makefile (agent)');
});

test("each person's use of the plan adds up across their turns, per window", () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const now = 1_000_000_000_000, fiveReset = now / 1000 + 3600, weekReset = now / 1000 + 86400;
  model.recordUsage(db, 'sara', { five_hour: 0.2, week: 0.03, five_hour_now: 0.4, five_hour_reset: fiveReset, week_now: 0.1, week_reset: weekReset }, now);
  model.recordUsage(db, 'sara', { five_hour: 0.15, week: 0.02, five_hour_now: 0.6, five_hour_reset: fiveReset, week_now: 0.12, week_reset: weekReset }, now + 1);
  model.recordUsage(db, 'yusuf', { five_hour: 0.05, week: 0.01, five_hour_now: 0.65, five_hour_reset: fiveReset, week_now: 0.13, week_reset: weekReset }, now + 2);
  const sara = model.usageOf(db, 'sara', now + 3);
  assert.ok(Math.abs(sara.fiveHour.used - 0.35) < 1e-9 && Math.abs(sara.week.used - 0.05) < 1e-9);
  assert.equal(sara.fiveHour.resetsAt, fiveReset * 1000);
  /* Once the 5-hour window resets, nobody has used any of the new one; the week carries on. */
  const later = model.usageOf(db, 'sara', fiveReset * 1000 + 1);
  assert.equal(later.fiveHour.used, 0);
  assert.ok(Math.abs(later.week.used - 0.05) < 1e-9);
});

test("the agent's context use, its window and compaction come through", () => {
  const assistant = translate({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 2, cache_creation_input_tokens: 1448, cache_read_input_tokens: 94751, output_tokens: 162 } } });
  assert.equal(assistant.context, 96201);
  const result = translate({ type: 'result', subtype: 'success', total_cost_usd: 0.3, duration_ms: 8000, modelUsage: { 'claude-opus-5-5': { contextWindow: 200000 } } });
  assert.equal(result.result.window, 200000);
  assert.deepEqual(finish(result.result, { exit: 0 }, undefined, 96201).context, { used: 96201, window: 200000 });
  const compacted = translate({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 96201 } });
  assert.deepEqual(compacted.events, [{ kind: 'compacted', before: 96201 }]);
});

test('a chat needs no repository; naming one makes a project', () => {
  const db = fresh();
  const chat = model.createWorkspace(db, 'mina', { prompt: 'Sort my photos' });
  assert.equal(chat.kind, 'chat');
  assert.deepEqual(chat.repo, { owner: '', name: '' });
  assert.equal(chat.branch, '');
  const project = model.createWorkspace(db, 'mina', { repoOwner: 'mina', repoName: 'recipes', base: 'main', prompt: 'Add a search box' });
  assert.equal(project.kind, 'project');
  assert.match(project.branch, /^code\//);
  assert.throws(() => model.createWorkspace(db, 'mina', { repoOwner: 'mina', prompt: 'x' }), /Choose a repository/);
});
