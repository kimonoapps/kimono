import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { translate } from '../src/lib/code/events.ts';
import { applyEdits, artifactName, artifactOf, Drafts, partialString, saveArtifact, shownName, titleOf } from '../src/lib/code/artifacts.ts';
import { chooseModel, effortFor } from '../src/lib/code/models.ts';

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
  const drafts = new Drafts((d) => sent.push(d), 0);
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
  assert.deepEqual(sent[0], { kind: 'draft', text: 'Making it' });
  const drafts_ = sent.filter((d) => d.kind === 'artifact-draft');
  assert.ok(drafts_.length >= 2);
  assert.ok(drafts_.every((d) => d.name === 'budget' && d.id === 'tw'));
  assert.equal(drafts_.at(-1).content, '<title>Budget</title><k-stat label="Spent">');
  assert.ok(!sent.some((d) => JSON.stringify(d).includes('secret')));
});

test('animations go to Opus with light thinking; Sonnet and Haiku never think past medium', () => {
  assert.equal(chooseModel({ prompt: 'Animate how a washer makes a volume', attachments: 0, building: false }), 'opus');
  assert.equal(chooseModel({ prompt: 'visualize compound interest', attachments: 0, building: false }), 'opus');
  assert.equal(effortFor('opus', { choice: 'auto', prompt: 'Animate a derivative', effort: 'high' }), 'low');
  assert.equal(effortFor('opus', { choice: 'opus', prompt: 'Animate a derivative', effort: 'high' }), 'high');
  assert.equal(effortFor('opus', { choice: 'auto', prompt: 'Build me a website', effort: 'xhigh' }), 'xhigh');
  assert.equal(effortFor('sonnet', { choice: 'auto', prompt: 'Sort my photos', effort: 'max' }), 'medium');
  assert.equal(effortFor('haiku', { choice: 'haiku', prompt: 'hi', effort: 'high' }), 'medium');
  assert.equal(effortFor('sonnet', { choice: 'sonnet', prompt: 'hi', effort: 'low' }), 'low');
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
