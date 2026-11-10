import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { finish, translate } from '../src/lib/code/events.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Set before any test brings in what reads it (lib/state.ts), so kept files go here and not to the dev state. */
process.env.KIMONO_STATE_DIR = mkdtempSync(join(tmpdir(), 'kimono-test-code-'));

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
  assert.equal(finish(null, null).error, 'Kimono AI stopped answering.');
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

const call = (name, input) => translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name, input }] } }).events[0];

test("a person's own apps: the call names the toolkit, whatever tool it is", () => {
  const used = call('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL', arguments: { to: 'x' } }], thought: 'send it' });
  assert.equal(used.app, 'gmail');
  assert.equal(used.label, 'Used');
  assert.equal(used.detail, 'send email');
  /* Finding tools and starting a connection are plumbing: no row (a connection gets its own Connect card). */
  assert.equal(call('mcp__composio__COMPOSIO_MANAGE_CONNECTIONS', { toolkits: ['GoogleCalendar'] }), undefined);
  assert.equal(call('mcp__composio__COMPOSIO_SEARCH_TOOLS', { queries: [{ use_case: 'find tomorrow’s meetings' }] }), undefined);
  const direct = call('mcp__composio__NOTION_CREATE_PAGE', { title: 'x' });
  assert.equal(direct.app, 'notion');
});

test('a call that touches /files names the Drive space', () => {
  assert.equal(call('Read', { file_path: '/files/Photos/2026/a.jpg' }).space, 'Photos');
  assert.equal(call('Bash', { command: 'ls /workspace/.kimono/files/Family/' }).space, 'Family');
  assert.equal(call('Bash', { command: 'ls /workspace/src' }).space, undefined);
  assert.equal(call('Read', { file_path: '/files/Preview test/Kyoto trip.md' }).space, 'Preview test', 'a name with a space in it');
  assert.equal(call('Bash', { command: 'pandoc "/files/Family Photos/a.md" -o x.pdf' }).space, 'Family Photos');
  assert.equal(call('Read', { file_path: '/workspace/files/notes.md' }).space, undefined, "a project's own files folder is not Drive");
});

test('Auto is Opus; a person’s own choice wins', async () => {
  const { modelFor } = await import('../src/lib/code/models.ts');
  assert.equal(modelFor('auto'), 'opus');
  assert.equal(modelFor(undefined), 'opus');
  assert.equal(modelFor('gpt-9'), 'opus', 'an unknown choice is Auto');
  assert.equal(modelFor('haiku'), 'haiku');
  assert.equal(modelFor('sonnet'), 'sonnet');
});

test('memory: instructions and what it keeps reach every turn, and only their person sees them', async () => {
  const memory = await import('../src/lib/code/memory.ts');
  const db = fresh();
  assert.match(memory.contextFor(db, 'mina'), /kimono-remember/, 'the helper is always explained');
  memory.setInstructions(db, 'mina', '  Call me Mina. Keep it short.  ');
  memory.remember(db, 'mina', 'Mina is   vegetarian.', 'ai');
  assert.equal(memory.remember(db, 'mina', 'mina is vegetarian.', 'person'), null, 'the same thing is kept once');
  memory.remember(db, 'sam', 'Sam runs on Tuesdays.', 'person');
  const context = memory.contextFor(db, 'mina');
  assert.match(context, /Call me Mina\. Keep it short\./);
  assert.match(context, /\] Mina is vegetarian\./);
  assert.doesNotMatch(context, /Sam runs/, "someone else's memories never reach their turns");
  assert.match(memory.contextFor(db, 'mina'), /- \[[0-9a-f]+\] Mina is vegetarian\./, 'each memory goes with its id, so it can be changed');
  assert.match(memory.contextFor(db, 'mina'), /--change <ID>/);
  const [first] = memory.profileOf(db, 'mina').memories;
  assert.equal(memory.changeMemory(db, 'mina', first.id, 'Mina eats fish now.').text, 'Mina eats fish now.');
  assert.throws(() => memory.changeMemory(db, 'sam', first.id, 'hacked'), (e) => e.status === 404, "no one changes someone else's");
  const [kept] = memory.profileOf(db, 'mina').memories;
  assert.throws(() => memory.forget(db, 'sam', kept.id), (e) => e.status === 404);
  memory.forget(db, 'mina', kept.id);
  assert.equal(memory.profileOf(db, 'mina').memories.length, 0);
  assert.throws(() => memory.setInstructions(db, 'mina', 'x'.repeat(20_001)), /20000/);
  assert.throws(() => memory.remember(db, 'mina', 'x'.repeat(8001), 'person'), /8000/);
  /* one the agent keeps is still a sentence; a person's own can be a page, with a title and its line breaks */
  assert.throws(() => memory.remember(db, 'mina', 'x'.repeat(501), 'ai'), /500/);
  const page = memory.remember(db, 'mina', 'Tomatoes on the balcony.\n\nWater every other morning.', 'person', Date.now(), 'Garden');
  assert.equal(page.title, 'Garden');
  assert.equal(page.text, 'Tomatoes on the balcony.\n\nWater every other morning.');
});

test('projects are folders of chats: make, file, rename, remove (chats stay)', () => {
  const db = fresh();
  const trip = model.createProject(db, 'mina', 'Kyoto trip');
  assert.throws(() => model.createProject(db, 'mina', 'kyoto TRIP'), (e) => e.status === 409);
  const chat = model.createWorkspace(db, 'mina', { prompt: 'Plan day one', folder: trip.id });
  assert.deepEqual(chat.folder, { id: trip.id, name: 'Kyoto trip' });
  assert.throws(() => model.createWorkspace(db, 'sam', { prompt: 'x', folder: trip.id }), (e) => e.status === 404, "no one files a chat in someone else's project");
  const loose = model.createWorkspace(db, 'mina', { prompt: 'Another' });
  assert.equal(model.setWorkspaceProject(db, loose.id, 'mina', trip.id).folder.name, 'Kyoto trip');
  model.renameProject(db, trip.id, 'mina', 'Japan 2027');
  assert.equal(model.workspaceFor(db, chat.id, 'mina').folder.name, 'Japan 2027');
  model.removeProject(db, trip.id, 'mina');
  assert.equal(model.workspaceFor(db, chat.id, 'mina').folder, null, 'its chats stay, in no project');
  assert.equal(model.projectsOf(db, 'mina').length, 0);
});

test('changing a message takes the chat back to just before it, and says where the session was', () => {
  const db = fresh();
  const w = start(db);
  const say = (turn, event) => model.appendEvent(db, w.id, turn, event).seq;
  const t1 = model.startTurn(db, w.id);
  const first = say(t1, { kind: 'ask', by: 'akram', text: 'Remember 41', attachments: [] });
  say(t1, { kind: 'text', text: 'OK' });
  model.endTurn(db, t1, 'done');
  model.noteTurnEnd(db, t1, 'session-1', 'message-1');
  const t2 = model.startTurn(db, w.id);
  const second = say(t2, { kind: 'ask', by: 'akram', text: 'What is 2+2?', attachments: [] });
  say(t2, { kind: 'text', text: 'Four' });
  model.endTurn(db, t2, 'done');
  model.noteTurnEnd(db, t2, 'session-1', 'message-2');

  /* The second message: the chat goes back to the end of the first turn, and carries the session on from there. */
  const back = model.rewindTo(db, w.id, second);
  assert.deepEqual(back.resume, { session: 'session-1', at: 'message-1' });
  assert.equal(back.by, 'akram');
  assert.deepEqual(model.eventsAfter(db, w.id, 0).map((e) => e.seq), [first, first + 1]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM turns WHERE id = ?').get(t2).n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM turns WHERE id = ?').get(t1).n, 1);

  /* The first message: nothing before it, so a fresh session. */
  assert.equal(model.rewindTo(db, w.id, first).resume, null);
  assert.equal(model.eventsAfter(db, w.id, 0).length, 0);
});

test('only a message can be changed, and not one sent while it was working', () => {
  const db = fresh();
  const w = start(db);
  const t = model.startTurn(db, w.id);
  const text = model.appendEvent(db, w.id, t, { kind: 'text', text: 'Hi' }).seq;
  const queued = model.appendEvent(db, w.id, t, { kind: 'ask', by: 'akram', text: 'and also', attachments: [], queued: true }).seq;
  assert.throws(() => model.rewindTo(db, w.id, text), /isn't here/);
  assert.throws(() => model.rewindTo(db, w.id, queued), /while it was working/);
});

test('a thumbs up keeps the chat up to the rated answer, not after it', async () => {
  const { rate, bank } = await import('../src/lib/code/feedback.ts');
  const db = fresh();
  const w = start(db);
  const turn = (ask, said) => {
    model.appendEvent(db, w.id, null, { kind: 'ask', text: ask, attachments: [] });
    model.appendEvent(db, w.id, null, { kind: 'text', text: said });
    return model.appendEvent(db, w.id, null, { kind: 'done', ok: true });
  };
  turn('first ask', 'first answer');
  const rated = turn('second ask', 'second answer');
  turn('third ask', 'third answer');
  rate(db, w.id, rated.seq, 'akram', 1);
  const [entry] = bank(db);
  assert.equal(entry.answer.asked, 'second ask');
  assert.deepEqual(entry.before.map((a) => a.asked), ['first ask']);
});

test('an admin replies to a thumb: the person sees the thanks and note under that answer, and no one else', async () => {
  const { rate, bank, bankEntry, replyTo, repliesOf } = await import('../src/lib/code/feedback.ts');
  const db = fresh();
  const w = start(db);
  model.appendEvent(db, w.id, null, { kind: 'ask', text: 'shrink my video', attachments: [] });
  const done = model.appendEvent(db, w.id, null, { kind: 'done', ok: true });
  rate(db, w.id, done.seq, 'akram', -1, 'sigh');
  assert.deepEqual(repliesOf(db, w.id, 'akram'), {});
  const [{ ref }] = bank(db, 0, true);
  assert.equal(replyTo(db, 'pnot-a-rating', 'admin', 'hi'), null, 'a report has no one to reply to');
  assert.equal(replyTo(db, 'r999', 'admin', 'hi'), null);
  assert.deepEqual(replyTo(db, ref, 'admin', '  Big videos now go in through Drive.  ', 5), { note: 'Big videos now go in through Drive.', at: 5 });
  assert.deepEqual(repliesOf(db, w.id, 'akram'), { [done.seq]: { note: 'Big videos now go in through Drive.', at: 5 } });
  assert.deepEqual(repliesOf(db, w.id, 'sam'), {}, "not someone else's");
  assert.equal(bankEntry(db, ref).reply.note, 'Big videos now go in through Drive.', 'the admin page shows it');
  assert.equal(bank(db)[0].reply, undefined, 'the export leaves it out');
  /* No note is still a thank-you; changing the thumb keeps it; taking the thumb back takes it away. */
  replyTo(db, ref, 'admin', '', 6);
  assert.deepEqual(repliesOf(db, w.id, 'akram')[done.seq], { note: '', at: 6 });
  rate(db, w.id, done.seq, 'akram', 1);
  assert.equal(repliesOf(db, w.id, 'akram')[done.seq].at, 6);
  rate(db, w.id, done.seq, 'akram', null);
  assert.deepEqual(repliesOf(db, w.id, 'akram'), {});
});

test('feedback is marked done by a reply, or done or ignored by hand, and can be reopened', async () => {
  const { rate, report, bank, bankEntry, replyTo, setStatus } = await import('../src/lib/code/feedback.ts');
  const db = fresh();
  const w = start(db);
  model.appendEvent(db, w.id, null, { kind: 'ask', text: 'a calculator', attachments: [] });
  const done = model.appendEvent(db, w.id, null, { kind: 'done', ok: true });
  rate(db, w.id, done.seq, 'akram', -1, 'wrong order of operations');
  report(db, w.id, 'odd');
  const entries = bank(db, 0, true);
  const rating = entries.find((e) => e.type === 'rating'), reported = entries.find((e) => e.type === 'report');
  assert.equal(rating.status, undefined, 'new feedback is to do');
  replyTo(db, rating.ref, 'admin', 'Fixed');
  assert.equal(bankEntry(db, rating.ref).status, 'done', 'a reply marks it done');
  assert.equal(setStatus(db, rating.ref, 'ignored'), true);
  assert.equal(bankEntry(db, rating.ref).status, 'ignored');
  setStatus(db, rating.ref, null);
  assert.equal(bankEntry(db, rating.ref).status, undefined, 'reopened');
  assert.equal(bankEntry(db, rating.ref).reply.note, 'Fixed', 'reopening keeps the reply');
  assert.equal(setStatus(db, reported.ref, 'done'), true, 'a report can be marked too');
  assert.equal(bankEntry(db, reported.ref).status, 'done');
  assert.equal(setStatus(db, 'r999', 'done'), false);
  assert.equal(setStatus(db, 'nope', 'done'), false);
  assert.ok(bank(db).every((e) => e.status === undefined), 'the export leaves it out');
});

test('ratings kept before the chat came along get the turns before them, once', async () => {
  const { backfillRatings, bank } = await import('../src/lib/code/feedback.ts');
  const db = fresh();
  const w = start(db);
  const turn = (ask) => {
    model.appendEvent(db, w.id, null, { kind: 'ask', text: ask, attachments: [] });
    return model.appendEvent(db, w.id, null, { kind: 'done', ok: true });
  };
  turn('first ask');
  const rated = turn('second ask');
  const old = { asked: 'second ask', attachments: [], steps: [], ok: true };
  db.prepare('INSERT INTO ai_ratings (workspace_id, seq, username, rating, note, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(w.id, rated.seq, 'akram', -1, '', JSON.stringify(old), 1);
  db.prepare('INSERT INTO ai_ratings (workspace_id, seq, username, rating, note, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(w.id, 999, 'akram', 1, '', JSON.stringify({ ...old, asked: 'gone' }), 2);
  assert.equal(backfillRatings(db), 1);
  assert.equal(backfillRatings(db), 0);
  const [filled, gone] = bank(db);
  assert.deepEqual(filled.before.map((a) => a.asked), ['first ask']);
  assert.equal(filled.answer.asked, 'second ask');
  assert.deepEqual(gone.before, []);
});

test('a rating keeps what it thought, where it thought it, and what its tools gave back', async () => {
  const { rate, bank } = await import('../src/lib/code/feedback.ts');
  const db = fresh();
  const w = start(db);
  model.appendEvent(db, w.id, null, { kind: 'ask', text: 'what is 12/8', attachments: [] });
  model.keepThinking(db, w.id, 'I should compute it rather than guess.');
  model.appendEvent(db, w.id, null, { kind: 'tool', id: 't1', name: 'Bash', label: 'Ran', detail: 'python3 -c "print(12/8)"' });
  model.appendEvent(db, w.id, null, { kind: 'tool-result', id: 't1', ok: true, output: '1.5' });
  model.keepToolCall(db, w.id, { id: 't1', input: '{"command":"python3 -c \\"print(12/8)\\"  # and a long comment"}' });
  model.keepToolCall(db, w.id, { id: 't1', output: '1.5\n(full output)' });
  model.keepThinking(db, w.id, 'It is 1.5.');
  model.appendEvent(db, w.id, null, { kind: 'text', text: '1.5' });
  const done = model.appendEvent(db, w.id, null, { kind: 'done', ok: true });
  rate(db, w.id, done.seq, 'akram', -1);
  const steps = bank(db)[0].answer.steps;
  assert.deepEqual(steps.map((s) => s.thought ?? s.tool ?? s.said), ['I should compute it rather than guess.', 'Bash', 'It is 1.5.', '1.5']);
  assert.equal(steps[1].output, '1.5\n(full output)');
  assert.match(steps[1].detail, /a long comment/);
  model.rewindTo(db, w.id, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM thinking').get().n, 0);
});

test('feedback keeps the files a chat names, to open from the bank, and forgets them with the rating', async () => {
  const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const { rate, report, bank, backfillRatingFiles } = await import('../src/lib/code/feedback.ts');
  const { keptFilePath } = await import('../src/lib/code/kept-files.ts');
  const db = fresh();
  const w = start(db);
  const dir = join(process.env.KIMONO_STATE_DIR, 'code', 'attachments', w.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'abc123-brief.pdf'), '%PDF brief');
  writeFileSync(join(dir, 'def456-report.pdf'), '%PDF report');
  const brief = { name: 'brief.pdf', path: '/attachments/abc123-brief.pdf', size: 10, type: 'application/pdf' };
  const sent = { name: 'report.pdf', path: '/attachments/def456-report.pdf', size: 11, type: 'application/pdf' };
  model.appendEvent(db, w.id, null, { kind: 'ask', text: 'make a report', attachments: [brief] });
  model.appendEvent(db, w.id, null, { kind: 'sent', files: [sent] });
  const done = model.appendEvent(db, w.id, null, { kind: 'done', ok: true });
  const opened = (file) => { const [, , id, name] = file.path.split('/'); return readFileSync(keptFilePath(id, name), 'utf8'); };

  rate(db, w.id, done.seq, 'akram', 1);
  const { answer } = bank(db)[0];
  assert.deepEqual(answer.attachments, ['brief.pdf']);
  assert.equal(opened(answer.attached[0]), '%PDF brief');
  assert.equal(opened(answer.steps[0].files[0]), '%PDF report');
  assert.equal(keptFilePath('../x', 'y'), null);

  /* Taken back: its files go with it. A report keeps its own. */
  const [, , id, name] = answer.attached[0].path.split('/');
  rate(db, w.id, done.seq, 'akram', null);
  assert.equal(existsSync(keptFilePath(id, name)), false);
  report(db, w.id, 'odd');
  assert.equal(opened(bank(db)[0].chat[0].steps[0].files[0]), '%PDF report');

  /* A rating kept before files were gets them from the chat, once. */
  const old = { asked: 'make a report', attachments: ['brief.pdf'], steps: [{ sent: ['report.pdf'] }], ok: true, before: [] };
  db.prepare('INSERT INTO ai_ratings (workspace_id, seq, username, rating, note, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(w.id, done.seq, 'akram', -1, '', JSON.stringify(old), 1);
  assert.equal(backfillRatingFiles(db), 1);
  assert.equal(backfillRatingFiles(db), 0);
  const filled = bank(db).find((e) => e.type === 'rating').answer;
  assert.equal(opened(filled.attached[0]), '%PDF brief');
  assert.equal(opened(filled.steps[0].files[0]), '%PDF report');
});

test('kimono-* commands read as words, and anything else stays a command', () => {
  const tool = (command) => translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'k', name: 'Bash', input: { command } }] } }).events[0];
  assert.deepEqual(tool('kimono-quran 6:59 | head -30; echo ----; kimono-quran 6:76-79 | head -40; echo ---; kimono-quran 6:151-153 2>&1'),
    { kind: 'tool', id: 'k', name: 'Bash', label: 'Read the Quran', detail: '6:59 · 6:76–79 · 6:151–153' });
  assert.equal(tool('kimono-quran 2:255 --tafsir ibn-kathir').label, "Read Ibn Kathir's tafsir on");
  assert.equal(tool('kimono-hadith bukhari 1').detail, 'Bukhari 1');
  assert.equal(tool('kimono-chats search "prayer times" --limit 5').detail, 'prayer times');
  assert.equal(tool('ls && kimono-quran 1:1').label, 'Ran');
  assert.equal(tool('kimono-quran $(cat ref)').label, 'Ran');
});
