import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { progressCardOf, progressOf, translate } from '../src/lib/code/events.ts';
import { ProgressProbe } from '../src/lib/code/progress-probe.ts';
import { cardOf, cardWords } from '../src/lib/code/progress-card.ts';
import { planSync } from '../src/lib/code/sync.ts';
import { applyEdits, artifactByMediaKey, artifactName, artifactOf, Drafts, mediaNames, partialString, saveArtifact, shownName, titleOf } from '../src/lib/code/artifacts.ts';
import { effortFor } from '../src/lib/code/models.ts';

test('artifacts are pages under artifacts/, by a plain name', () => {
  assert.equal(artifactName('/workspace/artifacts/Budget.html'), 'budget');
  assert.equal(artifactName('artifacts/chore-chart_2.html'), 'chore-chart_2');
  assert.equal(artifactName('/workspace/artifacts/../etc/passwd.html'), null);
  assert.equal(artifactName('/workspace/notes.html'), null);
  assert.equal(artifactName('/workspace/artifacts/sub/x.html'), null);
  assert.equal(shownName('kimono-show budget'), 'budget');
  assert.equal(shownName('cd /workspace && kimono-show "budget.html"'), 'budget');
  assert.equal(shownName('echo kimono-show budget > x'), null);
  assert.equal(titleOf('<title>October budget</title><h1>Hi</h1>', 'budget'), 'October budget');
  assert.equal(titleOf('<h1>Hi</h1>', 'chore-chart'), 'Chore chart');
});

test('a string still arriving in JSON reads as far as it has come', () => {
  assert.equal(partialString('{"file_path":"/workspace/artifacts/a.html","content":"<h1>Hi', 'content'), '<h1>Hi');
  assert.equal(partialString('{"content":"line\\none \\"quoted\\" \\u00e9', 'content'), 'line\none "quoted" é');
  assert.equal(partialString('{"content":"half an escape \\', 'content'), 'half an escape ');
  assert.equal(partialString('{"content":"half a \\u00', 'content'), 'half a ');
  assert.equal(partialString('{"content":"done","x":1}', 'content'), 'done');
  assert.equal(partialString('{"file_pa', 'content'), undefined);
});

test('edits are done again on Kimono\'s copy, or not at all', () => {
  assert.equal(applyEdits('a b a', [{ old_string: 'a', new_string: 'c' }]), 'c b a');
  assert.equal(applyEdits('a b a', [{ old_string: 'a', new_string: 'c', replace_all: true }]), 'c b c');
  assert.equal(applyEdits('a b', [{ old_string: 'a', new_string: 'x' }, { old_string: 'b', new_string: 'y' }]), 'x y');
  assert.equal(applyEdits('a b', [{ old_string: 'z', new_string: 'x' }]), null);
  assert.equal(applyEdits('a b', [{ old_string: '', new_string: 'x' }]), null);
});

test('writing, editing and showing an artifact become artifact events, not tool rows', () => {
  const line = { type: 'assistant', message: { content: [
    { type: 'text', text: 'Here it is:' },
    { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/workspace/artifacts/budget.html', content: '<title>Budget</title>' } },
    { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/workspace/artifacts/budget.html', old_string: 'Budget', new_string: 'October' } },
    { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'kimono-show budget' } },
    { type: 'tool_use', id: 't4', name: 'Write', input: { file_path: '/workspace/notes.md', content: 'x' } },
  ] } };
  const out = translate(line);
  assert.deepEqual(out.events.map((e) => e.kind), ['text', 'artifact', 'artifact', 'artifact', 'tool']);
  assert.deepEqual(out.events.filter((e) => e.kind === 'artifact').map((e) => e.action), ['wrote', 'edited', 'shown']);
  assert.equal(out.artifacts[0].content, '<title>Budget</title>');
  assert.deepEqual(out.artifacts[1].edits, [{ file_path: '/workspace/artifacts/budget.html', old_string: 'Budget', new_string: 'October' }]);
});

test('Kimono keeps the latest version of each artifact, per chat', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const w = model.createWorkspace(db, 'akram', { prompt: 'Show me our budget' });
  assert.equal(saveArtifact(db, w.id, 'budget', '<title>Budget</title>').version, 1);
  const second = saveArtifact(db, w.id, 'budget', '<title>October</title>');
  assert.equal(second.version, 2);
  assert.equal(second.title, 'October');
  assert.equal(artifactOf(db, w.id, 'budget').content, '<title>October</title>');
  assert.equal(artifactOf(db, w.id, 'other'), null);
});

test('drafts follow a Write of an artifact as it streams, and nothing else', () => {
  const sent = [];
  const drafts = new Drafts((d) => sent.push(d), { every: 0 });
  const ev = (event) => drafts.take({ type: 'stream_event', event });
  ev({ type: 'message_start' });
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Making it' } });
  ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tw', name: 'Write' } });
  for (const piece of ['{"file_path":"/workspace/arti', 'facts/budget.html","content":"<title>Bu', 'dget</title><k-stat', ' label=\\"Spent\\"', '>"}']) ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: piece } });
  ev({ type: 'content_block_stop', index: 1 });
  ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tn', name: 'Write' } });
  ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/workspace/notes.md","content":"secret' } });
  ev({ type: 'content_block_stop', index: 2 });
  /* What it's doing (phase) is told alongside; the words and the page are what this is about. */
  assert.ok(sent.some((d) => d.kind === 'phase'));
  assert.deepEqual(sent.filter((d) => d.kind !== 'phase')[0], { kind: 'draft', text: 'Making it' });
  const drafts_ = sent.filter((d) => d.kind === 'artifact-draft');
  assert.ok(drafts_.length >= 2);
  assert.ok(drafts_.every((d) => d.name === 'budget' && d.id === 'tw'));
  assert.equal(drafts_.at(-1).content, '<title>Budget</title><k-stat label="Spent">');
  assert.ok(!sent.some((d) => JSON.stringify(d).includes('secret')));
});

test('Auto thinks at medium; Sonnet and Haiku never think past medium', () => {
  assert.equal(effortFor('opus', { choice: 'auto', effort: 'xhigh' }), 'medium');
  assert.equal(effortFor('opus', { choice: 'opus', effort: 'high' }), 'high');
  assert.equal(effortFor('haiku', { choice: 'haiku', effort: 'high' }), 'medium');
  assert.equal(effortFor('sonnet', { choice: 'sonnet', effort: 'low' }), 'low');
});

test('the agent\'s artifact reference names every scene call the kit has', () => {
  const kit = readFileSync(new URL('../../../packages/artifacts/src/engine/kit.js', import.meta.url), 'utf8');
  const reference = readFileSync(new URL('../../../infra/sandbox/artifacts.md', import.meta.url), 'utf8');
  const api = kit.slice(kit.indexOf('const api = {'), kit.indexOf('api.label = api.text;'));
  const calls = [...api.matchAll(/^ {6}([a-zA-Z][a-zA-Z0-9]*)(?:\(|: )/gm)].map((m) => m[1]);
  const helpers = new Set(['PI', 'sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'pow', 'floor', 'round', 'min', 'max', 'range', 'color', 'random', 'field']);
  const missing = calls.filter((c) => !helpers.has(c) && !reference.includes(`${c}(`));
  assert.deepEqual(missing, []);
  assert.ok(calls.length > 30);
});

test('plumbing tools stay out of the chat, and a Composio connection becomes a Connect card', async () => {
  const { connectLinks, hiddenTool } = await import('../src/lib/code/events.ts');
  assert.ok(hiddenTool('ToolSearch'));
  assert.ok(hiddenTool('mcp__composio__COMPOSIO_SEARCH_TOOLS'));
  assert.ok(hiddenTool('mcp__composio__COMPOSIO_MANAGE_CONNECTIONS'));
  assert.ok(!hiddenTool('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL'));
  assert.ok(!hiddenTool('Bash'));
  const out = translate({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'ToolSearch', input: {} }, { type: 'tool_use', id: 'b', name: 'mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', input: { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL' }] } }] } });
  assert.deepEqual(out.events.map((e) => e.name), ['mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL']);
  const result = JSON.stringify({ successful: true, data: { results: { gmail: { toolkit: 'gmail', status: 'initiated', redirect_url: 'https://connect.composio.dev/link/lk_abc' } } } });
  assert.deepEqual(connectLinks(result), [{ app: 'gmail', url: 'https://connect.composio.dev/link/lk_abc' }]);
  const r = translate({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: result }] } });
  assert.deepEqual(r.events.map((e) => e.kind), ['tool-result', 'connect']);
  assert.deepEqual(connectLinks(JSON.stringify({ data: { x: { toolkit: 'gmail', redirect_url: 'https://evil.example/phish' } } })), []);
  assert.deepEqual(connectLinks(JSON.stringify({ data: { x: { toolkit: 'gmail', redirect_url: 'http://connect.composio.dev/x' } } })), []);
});

test('media: an artifact names its files as media/<file>, and gets a key of its own that lasts', () => {
  const page = `<k-scene><script type="text/kimono-scene">
narrate("media/heart-1.mp3", "One", 2.1)
narrate('media/heart-2.mp3', "Two", 3)
</script></k-scene>
<audio src="media/heart-1.mp3"></audio><img src="media/photo.JPG"><video src="media/../../etc/passwd"></video>
<p>see media/notes.txt and https://example.com/media/x.mp3</p>`;
  assert.deepEqual(mediaNames(page), ['heart-1.mp3', 'heart-2.mp3', 'photo.JPG'], 'not a web address that happens to have media/ in it');
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const w1 = model.createWorkspace(db, 'mina', { prompt: 'Explain a heartbeat' }).id;
  const first = saveArtifact(db, w1, 'heart', page);
  assert.match(first.media, /^\/ai\/media\/[0-9a-f]{32}\/$/);
  const again = saveArtifact(db, w1, 'heart', page + ' ');
  assert.equal(again.media, first.media, 'a new version keeps its address');
  assert.equal(artifactOf(db, w1, 'heart').media, first.media);
  const other = saveArtifact(db, w1, 'other', page);
  assert.notEqual(other.media, first.media, 'each artifact has its own');
  const key = first.media.split('/')[3];
  assert.equal(artifactByMediaKey(db, key).name, 'heart');
  assert.equal(artifactByMediaKey(db, 'nope'), null);
  assert.equal(artifactByMediaKey(db, '0'.repeat(32)), null);
});

test('progress: kimono-progress calls become a start, a wait or the end; anything else is left alone', () => {
  assert.deepEqual(progressOf('kimono-progress "Making your video" --about 150', 7), { label: 'Making your video', about: 150, only: true, at: 7 });
  assert.deepEqual(progressOf("kimono-progress 'Rendering' --about 2", 7), { label: 'Rendering', about: 5, only: true, at: 7 }, 'at least 5 s');
  assert.deepEqual(progressOf('kimono-progress --wait 500', 7), { wait: 100, only: true, at: 7 }, 'one wait is at most 100 s');
  assert.deepEqual(progressOf('kimono-progress --done "Video ready"', 7), { done: true, only: true, at: 7 });
  assert.equal(progressOf('sleep 60'), undefined);
  assert.deepEqual(progressOf('kimono-progress "No estimate needed"', 7), { label: 'No estimate needed', only: true, at: 7 }, 'the card guesses nothing from time');
  assert.equal(progressOf('kimono-progress "x" stray'), undefined);
  assert.equal(progressOf('echo kimono-progress --done'), undefined);
});

test('progress: a kimono-progress step anywhere in a chained command still makes the card', () => {
  assert.deepEqual(
    progressOf('cd /workspace/build2; rm -f still_*; kimono-progress "Making the short video on why current changes" --about 330; python3 render.py why-current', 7),
    { label: 'Making the short video on why current changes', about: 330, at: 7 },
    'a start after other steps');
  assert.deepEqual(progressOf('cd build && kimono-progress "Rendering" --about 60 && python3 render.py', 7), { label: 'Rendering', about: 60, at: 7 });
  assert.deepEqual(progressOf('kimono-progress "Drawing" --about 120\npython3 render.py > log.txt 2>&1 &', 7), { label: 'Drawing', about: 120, at: 7 }, 'newlines and a background job');
});

test('progress: --status is read whatever follows it, and a status with a wait keeps both', () => {
  assert.deepEqual(
    progressOf('kimono-progress --status "Drawing the frames" --percent 35 --left 200; kimono-progress --wait 150; tail -1 /workspace/build2/log.txt', 7),
    { status: 'Drawing the frames', percent: 35, left: 200, wait: 100, at: 7 });
  assert.deepEqual(progressOf('kimono-progress --status "Rendering" --percent 40 2>&1 | tail -1', 7), { status: 'Rendering', percent: 40, at: 7 }, 'a redirect and a pipe after it');
  assert.deepEqual(progressOf('kimono-progress --status "In queue"', 7), { status: 'In queue', only: true, at: 7 });
  assert.deepEqual(progressOf('kimono-progress --status "Rendering" --percent 400', 7), { status: 'Rendering', percent: 100, only: true, at: 7 }, 'at most 100%');
  assert.equal(progressOf('kimono-progress --status ""'), undefined, 'an empty status says nothing');
});

test('progress: quotes keep their ; and &&, and only real kimono-progress steps count', () => {
  assert.deepEqual(progressOf('kimono-progress "Mixing; then joining && sending" --about 90 --run "ffmpeg -i a.mp4 b.mp4; echo done"', 7),
    { label: 'Mixing; then joining && sending', about: 90, only: true, at: 7 });
  assert.deepEqual(progressOf(`kimono-progress --status "It said \\"almost\\"; nearly" --percent 90`, 7), { status: 'It said "almost"; nearly', percent: 90, only: true, at: 7 });
  assert.equal(progressOf('echo "kimono-progress --done"; ls'), undefined);
  assert.equal(progressOf('grep kimono-progress log.txt | tail -1'), undefined);
  assert.equal(progressOf('ls; echo kimono-progress "x" --about 30'), undefined);
});

test('progress: a start and its end in one command, and the later step wins', () => {
  assert.deepEqual(progressOf('kimono-progress "Quick render" --about 10; python3 r.py; kimono-progress --done', 7),
    { label: 'Quick render', about: 10, done: true, at: 7 });
  assert.deepEqual(progressOf('kimono-progress --status "A" --percent 10; kimono-progress --status "B" --percent 20', 7), { status: 'B', percent: 20, only: true, at: 7 });
});

test('a sandbox made again from nothing gets its Drive files back, and none of them are trashed', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const w = model.createWorkspace(db, 'mina', { prompt: 'Make a video' }).id;
  db.prepare('INSERT INTO synced (workspace_id, path, node_id, sha1, content_version) VALUES (?, ?, ?, ?, ?)').run(w, 'bunny.mp4', 'n2', 'b', 1);
  db.prepare('INSERT INTO opened_files (workspace_id, path, node_id, sha1, content_version) VALUES (?, ?, ?, ?, ?)').run(w, 'Photos/cat.jpg', 'n9', 'c', 2);
  const drive = [{ path: 'bunny.mp4', nodeId: 'n2', contentVersion: 1 }];
  const rows = () => db.prepare('SELECT path, node_id AS nodeId, sha1, content_version AS contentVersion FROM synced WHERE workspace_id = ?').all(w);
  assert.deepEqual(planSync(rows(), [], drive).map((a) => a.kind), ['trash'], 'without starting over, an empty sandbox reads as a deletion');
  model.sandboxStartedOver(db, w);
  assert.deepEqual(planSync(rows(), [], drive).map((a) => a.kind), ['put'], 'started over: the file goes back in');
  assert.equal(db.prepare('SELECT count(*) AS n FROM opened_files WHERE workspace_id = ?').get(w).n, 0, 'opened files go back in too');
});

test('progress: a start may run or probe its work, and a command that does other work is a step of its own', () => {
  assert.deepEqual(progressOf(`kimono-progress "Drawing" --run "python3 render.py" --probe "echo $(ls f | wc -l)/300"`, 7), { label: 'Drawing', only: true, at: 7 });
  assert.deepEqual(progressOf('kimono-progress "Drawing" --probe "ls" --about 60', 7), { label: 'Drawing', about: 60, only: true, at: 7 }, 'flags in any order');
  assert.equal(progressOf('kimono-progress "Drawing" --run "x"; python3 r.py', 7).only, undefined, 'it did real work too: shown');
  assert.equal(progressOf('kimono-progress --status "Rendering" --percent 40; kimono-progress --wait 60', 7).only, true);
});

test('progress card file: read strictly, clamped, anything odd ignored', () => {
  assert.deepEqual(progressCardOf(JSON.stringify({ job: 'j1', label: 'Drawing', state: 'running', status: ' Frames ', percent: 140, left: -3, watched: true, updated: 1 })),
    { job: 'j1', label: 'Drawing', state: 'running', status: 'Frames', percent: 100, watched: true });
  assert.deepEqual(progressCardOf('{"job":"j","label":"L","state":"done","percent":null,"status":null}'), { job: 'j', label: 'L', state: 'done' });
  for (const bad of ['', 'nope', '[]', '{"label":"L","state":"running"}', '{"job":"j","label":"L","state":"paused"}', '{"job":"","label":"L","state":"running"}'])
    assert.equal(progressCardOf(bad), undefined, bad);
});

/* A fake sandbox: the card file as kimono-progress would leave it, read by the probe. */
function rig() {
  let file;
  const events = [];
  const claimed = new Set();
  const write = (card) => { file = card === undefined ? undefined : JSON.stringify(card); };
  const probe = new ProgressProbe(async () => { if (file === undefined) throw new Error('404'); return file; }, (e) => events.push(e), claimed, { every: 5, findFor: 300 });
  return { probe, events, claimed, write };
}
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
async function until(what, ok, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return; await settle(5); }
  assert.fail(`never: ${what}`);
}

test('probe: follows the card in the sandbox by itself and records only real changes', async () => {
  const { probe, events, write } = rig();
  write({ job: 'j1', label: 'Drawing the frames', state: 'running', watched: true });
  probe.start('t1', 'Drawing the frames');
  await until('first look', () => events.length === 1);
  assert.deepEqual(events[0], { kind: 'progress', id: 't1', state: 'running', watched: true });
  write({ job: 'j1', label: 'Drawing the frames', state: 'running', status: 'Frames', percent: 10.04, watched: true });
  await until('10%', () => events.at(-1).percent === 10);
  write({ job: 'j1', label: 'Drawing the frames', state: 'running', status: 'Frames', percent: 10.6, watched: true });
  await settle();
  assert.equal(events.length, 2, 'under a point: not worth a new event');
  write({ job: 'j1', label: 'Drawing the frames', state: 'running', status: 'Frames', percent: 55, left: 30, watched: true });
  await until('55%', () => events.at(-1).percent === 55);
  assert.equal(events.at(-1).left, 30);
  write({ job: 'j1', label: 'Drawing the frames', state: 'done', status: 'Finished', percent: 100, watched: true });
  await until('done', () => events.at(-1).state === 'done');
  const n = events.length;
  write({ job: 'j1', label: 'Drawing the frames', state: 'running', percent: 1, watched: true });
  await settle();
  assert.equal(events.length, n, 'a finished card is no longer read');
});

test('probe: an old card is never taken for a new one, even with the same words', async () => {
  const { probe, events, claimed, write } = rig();
  claimed.add('old');
  write({ job: 'old', label: 'Rendering', state: 'running', percent: 90 });
  probe.start('t2', 'Rendering');
  await settle();
  assert.equal(events.length, 0, 'the old job is claimed already');
  write({ job: 'new', label: 'Rendering', state: 'running', percent: 5 });
  await until('the new job', () => events.length === 1);
  assert.equal(events[0].percent, 5);
  assert.ok(claimed.has('new'));
  probe.stop();
});

test('probe: a different card in the file takes over; a card never found is given up', async () => {
  const a = rig();
  a.write({ job: 'j1', label: 'First', state: 'running' });
  a.probe.start('t1', 'First');
  await until('first', () => a.events.length === 1);
  a.write({ job: 'j2', label: 'Second', state: 'running', percent: 50 });
  await settle();
  assert.equal(a.events.length, 1, 'another card is not recorded on this one');
  const b = rig();
  b.write({ job: 'x', label: 'Something else', state: 'running' });
  b.probe.start('t9', 'Mine');
  await settle(400);
  b.write({ job: 'y', label: 'Mine', state: 'running', percent: 20 });
  await settle();
  assert.equal(b.events.length, 0, 'not found in time: given up');
});

test('probe: after the turn, only a job the sandbox watches is followed on', async () => {
  const told = rig();
  told.write({ job: 'j', label: 'Making your video', state: 'running', status: 'In queue' });
  told.probe.start('t', 'Making your video');
  await until('first', () => told.events.length === 1);
  await told.probe.turnEnded();
  told.write({ job: 'j', label: 'Making your video', state: 'running', status: 'Rendering' });
  await settle();
  assert.equal(told.events.length, 1, 'nothing follows a card the agent reports itself, once it has stopped');

  const watched = rig();
  watched.write({ job: 'w', label: 'Rendering', state: 'running', percent: 10, watched: true });
  watched.probe.start('t', 'Rendering');
  await until('first', () => watched.events.length === 1);
  await watched.probe.turnEnded();
  watched.write({ job: 'w', label: 'Rendering', state: 'done', percent: 100, watched: true });
  await until('done after the turn', () => watched.events.at(-1).state === 'done');
});

test('probe: a sandbox that stops answering is given up, not read forever', async () => {
  const { probe, events, write } = rig();
  write({ job: 'j', label: 'L', state: 'running' });
  probe.start('t', 'L');
  await until('first', () => events.length === 1);
  write(undefined);
  await settle(200);
  write({ job: 'j', label: 'L', state: 'running', percent: 50 });
  await settle();
  assert.equal(events.length, 1);
});

const start = (extra = {}) => ({ progress: { label: 'Making the video', at: 1 }, ...extra });
test('card: the job\'s own word wins, there is no bar without a percent, and no clock', () => {
  let card = cardOf([start()], true);
  assert.deepEqual({ ...card }, { label: 'Making the video', state: 'running', stopped: false, status: undefined, percent: undefined, left: undefined });
  assert.equal(cardWords(card), 'Working on it');
  card = cardOf([start(), { progress: { status: 'In queue', left: 200, at: 2 } }], true);
  assert.equal(cardWords(card), 'In queue · about 3 min left');
  card = cardOf([start({ probe: { state: 'running', status: 'Drawing frames', percent: 40.4, left: 42 } }), { progress: { status: 'In queue', percent: 5, at: 2 } }], true);
  assert.equal(card.percent, 40.4, 'what Kimono read beats what the agent said');
  assert.equal(cardWords(card), 'Drawing frames · 40% · about 40 s left');
});

test('card: done, failed and stopped say so plainly', () => {
  assert.equal(cardWords(cardOf([start(), { progress: { done: true, at: 3 } }], true)), 'Done');
  assert.equal(cardOf([start(), { progress: { done: true, at: 3 } }], true).percent, 100);
  assert.equal(cardWords(cardOf([start({ probe: { state: 'done', status: 'Video ready' } })], false)), 'Done · Video ready');
  assert.equal(cardWords(cardOf([start({ probe: { state: 'failed', status: 'No such file: a.mp4' } })], false), 2), "Didn't finish · No such file: a.mp4 · 2 steps failed");
  assert.equal(cardWords(cardOf([start({ probe: { state: 'running', percent: 30 } })], false)), 'Stopped · at 30%', 'the turn ended and nothing follows it');
  const watched = cardOf([start({ probe: { state: 'running', percent: 30, watched: true } })], false);
  assert.equal(watched.stopped, false, 'the sandbox still follows it after the turn');
  assert.equal(cardWords(watched), '30%');
});

test('card: a status from before the latest start belongs to the old card', () => {
  const card = cardOf([{ progress: { status: 'Old', percent: 90, at: 1 } }, { progress: { label: 'New', at: 5 } }], true);
  assert.equal(card.label, 'New');
  assert.equal(card.percent, undefined);
});
