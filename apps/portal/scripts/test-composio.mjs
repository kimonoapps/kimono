import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { composioUser, toolSession } from '../src/lib/code/composio.ts';

/* A stand-in for Composio's Tool Router: sessions it knows, and every call it got. */
async function fakeComposio() {
  const sessions = new Map();
  const calls = [];
  let next = 1;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body: body ? JSON.parse(body) : null });
      if (req.headers['x-api-key'] !== 'key-a' && req.headers['x-api-key'] !== 'key-b') { res.writeHead(401); return res.end(); }
      if (req.method === 'POST' && req.url === '/tool_router/session') {
        const id = `trs_${next++}`;
        sessions.set(id, true);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ session_id: id, mcp: { type: 'http', url: `https://mcp.example/${id}/mcp` } }));
      }
      const got = /^\/tool_router\/session\/([^/]+)$/.exec(req.url);
      if (req.method === 'GET' && got) {
        if (!sessions.has(got[1])) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ session_id: got[1], mcp: { type: 'http', url: `https://mcp.example/${got[1]}/mcp` } }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.KIMONO_COMPOSIO_API = `http://127.0.0.1:${server.address().port}`;
  return { sessions, calls, close: () => server.close() };
}

function fresh() { const db = new DatabaseSync(':memory:'); model.migrate(db); return db; }
const origin = 'https://home.example.com';

test('a person gets one session, made once and then reused', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    const first = await toolSession(db, 'key-a', 'mina', origin, 1000);
    assert.deepEqual(first, { url: 'https://mcp.example/trs_1/mcp', headers: { 'x-api-key': 'key-a' } });
    const made = composio.calls[0];
    assert.equal(made.method, 'POST');
    assert.equal(made.body.user_id, 'kimono:home.example.com:mina');
    assert.equal(made.body.manage_connections.enable, true);
    assert.equal(made.body.manage_connections.callback_url, 'https://home.example.com/code?connected=1');
    const again = await toolSession(db, 'key-a', 'mina', origin, 2000);
    assert.equal(again.url, first.url);
    assert.equal(composio.calls.length, 1, 'a fresh stored session is used without asking');
  } finally { composio.close(); }
});

test('an old session is checked, and made again only when Composio forgot it', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    await toolSession(db, 'key-a', 'mina', origin, 0);
    const hour = 60 * 60 * 1000 + 1;
    const kept = await toolSession(db, 'key-a', 'mina', origin, hour);
    assert.equal(kept.url, 'https://mcp.example/trs_1/mcp');
    assert.equal(composio.calls.at(-1).method, 'GET');
    composio.sessions.clear();
    const remade = await toolSession(db, 'key-a', 'mina', origin, 3 * hour);
    assert.equal(remade.url, 'https://mcp.example/trs_2/mcp');
  } finally { composio.close(); }
});

test('people have their own sessions, and a new key starts a new one', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    const mina = await toolSession(db, 'key-a', 'mina', origin, 0);
    const sam = await toolSession(db, 'key-a', 'sam', origin, 0);
    assert.notEqual(mina.url, sam.url);
    const switched = await toolSession(db, 'key-b', 'mina', origin, 1);
    assert.notEqual(switched.url, mina.url);
    assert.deepEqual(switched.headers, { 'x-api-key': 'key-b' });
  } finally { composio.close(); }
});

test('no key, or Composio refusing, means no tools rather than a failed turn', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    assert.equal(await toolSession(db, '', 'mina', origin), null);
    assert.equal(await toolSession(db, 'wrong-key', 'mina', origin), null);
  } finally { composio.close(); }
});

test('Composio user ids are per Kimono server', () => {
  assert.equal(composioUser('mina', 'https://a.example'), 'kimono:a.example:mina');
  assert.notEqual(composioUser('mina', 'https://a.example'), composioUser('mina', 'https://b.example'));
});
