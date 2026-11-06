import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as model from '../src/lib/code/model.ts';
import { digestOf } from '../src/lib/code/history.ts';

const helper = new URL('../../../infra/sandbox/bin/kimono-chats', import.meta.url).pathname;

function chatWith(db, prompt, turns) {
  const w = model.createWorkspace(db, 'akram', { prompt });
  for (const [ask, steps] of turns) {
    const turn = model.startTurn(db, w.id);
    model.appendEvent(db, w.id, turn, { kind: 'ask', by: 'akram', text: ask, attachments: [] });
    for (const step of steps) model.appendEvent(db, w.id, turn, step);
    model.appendEvent(db, w.id, turn, { kind: 'done', ok: true });
    model.endTurn(db, turn, 'done');
  }
  return model.workspaceFor(db, w.id, 'akram');
}

test('a digest keeps each question and the answer it ended with, not the work between', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const w = chatWith(db, 'Plan the Kyoto trip', [
    ['Plan a 3 day Kyoto trip in April', [
      { kind: 'text', text: 'Let me look at the dates first.' },
      { kind: 'tool', id: 't1', name: 'Bash', label: 'Ran', detail: 'cat notes.txt' },
      { kind: 'tool-result', id: 't1', ok: true, output: 'x'.repeat(5000) },
      { kind: 'text', text: 'Day 1: Fushimi Inari at dawn. Day 2: Arashiyama. Day 3: Gion.' },
      { kind: 'artifact', id: 'a1', name: 'kyoto-map', action: 'wrote' },
    ]],
    ['Make day 2 shorter', [{ kind: 'text', text: 'Day 2 now ends at Tenryu-ji.' }]],
  ]);
  const digest = digestOf(db, w);
  assert.match(digest, /^# Plan the Kyoto trip/);
  assert.match(digest, /## 1 · .*\nPerson: Plan a 3 day Kyoto trip in April/);
  assert.match(digest, /Kimono AI: Day 1: Fushimi Inari/);
  assert.doesNotMatch(digest, /Let me look at the dates/);
  assert.doesNotMatch(digest, /xxxxx/);
  assert.match(digest, /\[made artifact kyoto-map\]/);
  assert.match(digest, /## 2 · .*\nPerson: Make day 2 shorter\nKimono AI: Day 2 now ends at Tenryu-ji\./);
  assert.ok(digest.length < 700, `a two-turn chat stays small (${digest.length})`);
});

test('kimono-chats finds and reads chats in a few lines', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const kyoto = chatWith(db, 'Plan the Kyoto trip', [['Plan a Kyoto trip', [{ kind: 'text', text: 'Fushimi Inari at dawn, then Arashiyama.' }]]]);
  const bread = chatWith(db, 'Dense sourdough', [['Why is my sourdough dense?', [{ kind: 'text', text: 'Probably underproofed: give it longer.' }]],
    ...Array.from({ length: 30 }, (_, i) => [`Follow-up ${i}`, [{ kind: 'text', text: 'More about proofing. '.repeat(40) }]])]);
  const dir = mkdtempSync(join(tmpdir(), 'chats-'));
  for (const chat of [kyoto, bread]) writeFileSync(join(dir, `${chat.id}.md`), digestOf(db, chat));
  writeFileSync(join(dir, 'index.tsv'), `id\tdate\ttitle\tproject\tbegan with\n${bread.id}\t2026-11-06\tDense sourdough\t\tWhy is my sourdough dense?\n${kyoto.id}\t2026-11-05\tPlan the Kyoto trip\t\tPlan a Kyoto trip\n`);
  const run = (...args) => execFileSync('python3', [helper, ...args], { env: { ...process.env, KIMONO_CHATS_DIR: dir }, encoding: 'utf8' });

  const list = run('list');
  assert.equal(list.trim().split('\n').length, 2);
  const found = run('search', 'arashiyama');
  assert.match(found, new RegExp(`^${kyoto.id}  2026-11-05  Plan the Kyoto trip`));
  assert.match(found, /turn 1: .*Arashiyama/);
  assert.doesNotMatch(found, /sourdough/i);
  /* A long chat comes a part at a time, with where to go on. */
  const part = run('read', bread.id, '--max', '2000');
  assert.ok(part.length < 3000, `one part stays small (${part.length})`);
  assert.match(part, new RegExp(`kimono-chats read ${bread.id} --turn \\d+`));
  assert.match(run('read', bread.id, '--turn', '31'), /Follow-up 29/);
  assert.match(run('search', 'nothing-like-this'), /Nothing matches/);
});
