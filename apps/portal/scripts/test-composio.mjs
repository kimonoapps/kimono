import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/code/model.ts';
import { register } from 'node:module';
import { composioUser, connectLink, connections, disconnect, findApps, toolSession } from '../src/lib/code/composio.ts';

/* The Portal's modules import each other without extensions, as Next does; this lets node find them. */
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[cm]?[jt]s$/.test(s)) return next(s + '.ts', c); throw e; } }`));
const media = await import('../src/lib/code/media.ts');

/* A stand-in for Composio's Tool Router: sessions it knows, and every call it got. */
async function fakeComposio() {
  const sessions = new Map();
  const connected = new Set();
  /* Execution logs, as Composio keeps them: who, when, which account paid, what it cost. */
  const logs = [];
  const state = { logsDown: false };
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
      const kits = /^\/tool_router\/session\/([^/]+)\/toolkits\?(.*)$/.exec(req.url);
      if (req.method === 'GET' && kits) {
        const q = new URLSearchParams(kits[2]);
        const all = [
          { slug: 'gmail', name: 'Gmail', meta: { logo: 'https://logos.example/gmail.svg', description: 'Email' }, connected_account: connected.has(`${kits[1]}:gmail`) ? { id: `ca_${kits[1]}_gmail`, status: 'ACTIVE', created_at: '2026-11-01T00:00:00Z' } : null },
          { slug: 'notion', name: 'Notion', meta: { logo: 'javascript:alert(1)', description: 'Notes' }, connected_account: null },
        ];
        const items = all.filter((t) => (q.get('is_connected') !== 'true' || t.connected_account) && (!q.get('search') || t.name.toLowerCase().includes(q.get('search').toLowerCase())));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ items, total_pages: 1, current_page: 1, total_items: items.length }));
      }
      const link = /^\/tool_router\/session\/([^/]+)\/link$/.exec(req.url);
      if (req.method === 'POST' && link) {
        connected.add(`${link[1]}:${calls.at(-1).body.toolkit}`);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ link_token: 't', redirect_url: `https://connect.example/${calls.at(-1).body.toolkit}`, connected_account_id: 'x' }));
      }
      const gone = /^\/connected_accounts\/([^/]+)$/.exec(req.url);
      if (req.method === 'DELETE' && gone) {
        for (const k of connected) if (`ca_${k.replace(':', '_')}` === gone[1]) connected.delete(k);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"success":true}');
      }
      /* As the real one: a toolkit asked for alone has no Instant information; only the list says, a page at a time. */
      const kit = /^\/toolkits\/([^/?]+)$/.exec(req.url);
      if (req.method === 'GET' && kit) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ slug: kit[1], name: kit[1], instant: null }));
      }
      if (req.method === 'GET' && req.url.startsWith('/toolkits?')) {
        const second = new URL(req.url, 'http://x').searchParams.get('cursor') === 'p2';
        const items = second
          ? [{ slug: 'exa', instant: { supported: true } }, { slug: 'gmail', instant: { supported: true } }]
          : [{ slug: 'elevenlabs', instant: { supported: true } }, { slug: 'notion', instant: null }];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        /* a raw control character in a description, as Composio's list has */
        return res.end(JSON.stringify({ items, next_cursor: second ? null : 'p2' }).replace('"notion"', '"notion","meta":{"description":"Notes\u0001"}'));
      }
      if (req.method === 'POST' && req.url === '/logs/tool_execution') {
        if (state.logsDown) { res.writeHead(503); return res.end(); }
        if (state.logsForbidden) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":{"slug":"APIKey_InsufficientPermissions"}}'); }
        const { filters, time_range: range, cursor, limit } = calls.at(-1).body;
        const user = filters.find((f) => f.field === 'user_id').value;
        const found = logs.filter((l) => l.user === user && l.at >= range.from && l.at <= range.to);
        const start = Number(cursor || 0);
        const page = found.slice(start, start + Math.min(limit, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ logs: page.map((l) => ({ id: String(l.at), timestamp: new Date(l.at).toISOString(), status: 'success', metadata: l.metadata })), next_cursor: start + page.length < found.length ? String(start + page.length) : null }));
      }
      const patched = /^\/tool_router\/session\/([^/]+)$/.exec(req.url);
      if (req.method === 'PATCH' && patched) {
        if (!sessions.has(patched[1])) { res.writeHead(404); return res.end(); }
        sessions.set(patched[1], { instant: calls.at(-1).body.instant });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ session_id: patched[1], mcp: { type: 'http', url: `https://mcp.example/${patched[1]}/mcp` } }));
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
  return { sessions, calls, logs, state, close: () => server.close() };
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
    assert.equal(made.body.manage_connections.callback_url, 'https://home.example.com/code?connections=1');
    assert.deepEqual(made.body.workbench, { enable: false }, 'no remote workbench: it would reach the web');
    assert.deepEqual(made.body.instant, {}, 'every Instant tool is allowed');
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

test('connections: a person connects an app, sees it, and disconnects it; never anyone else\'s', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    assert.deepEqual(await connections(db, 'key-a', 'mina', origin), []);
    const { apps } = await findApps(db, 'key-a', 'mina', origin, 'gm');
    assert.deepEqual(apps.map((a) => a.app), ['gmail']);
    assert.equal(await connectLink(db, 'key-a', 'mina', origin, 'Gmail'), 'https://connect.example/gmail');
    assert.equal(composio.calls.at(-1).body.callback_url, 'https://home.example.com/code?connections=1');
    const mine = await connections(db, 'key-a', 'mina', origin);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, 'Gmail');
    assert.equal(mine[0].logo, 'https://logos.example/gmail.svg');
    const { apps: all } = await findApps(db, 'key-a', 'mina', origin, '');
    assert.equal(all.find((a) => a.app === 'notion').logo, 'https://logos.composio.dev/api/notion', 'a logo that is not https is replaced');
    assert.equal(all.find((a) => a.app === 'gmail').connected, true);
    await assert.rejects(disconnect(db, 'key-a', 'sam', origin, mine[0].account), (e) => e.status === 404);
    await disconnect(db, 'key-a', 'mina', origin, mine[0].account);
    assert.deepEqual(await connections(db, 'key-a', 'mina', origin), []);
    await assert.rejects(connections(db, '', 'mina', origin), (e) => e.status === 409);
  } finally { composio.close(); }
});

const month = Date.UTC(2026, 10, 1);
const charge = (user, at, amount, source = 'instant_account') => ({ user: `kimono:home.example.com:${user}`, at, metadata: { credential_source: source, instant_charge: amount } });
const settings = (mediaBudget) => ({ composioKey: 'key-a', mediaBudget });

test('media allowance: spending past it switches Instant off, and a new month switches it on', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    const day = 24 * 60 * 60 * 1000;
    await toolSession(db, 'key-a', 'mina', origin, month + day);
    composio.logs.push(
      charge('mina', month + day, '1.20'), charge('mina', month + day + 1, '0.05'), charge('mina', month + day + 2, '0.75'),
      charge('mina', month + day + 3, '9.00', 'connected_account'), charge('sam', month + day, '9.00'), charge('mina', month - day, '9.00'),
    );
    const under = await media.holdMediaBudget(db, settings(5), 'mina', origin, month + 2 * day);
    assert.equal(under.spent, 2, 'only her Instant charges this month count, over every page');
    assert.equal(under.open, true);
    assert.equal(under.resetsAt, Date.UTC(2026, 11, 1));
    assert.ok(!composio.calls.some((c) => c.method === 'PATCH'), 'nothing to change while under');
    assert.match(media.mediaNote(under), /\$3\.00 of \$5\.00 left/);

    composio.logs.push(charge('mina', month + 3 * day, '3.10'));
    const fresh_ = await media.holdMediaBudget(db, settings(5), 'mina', origin, month + 3 * day + 1);
    assert.equal(fresh_.open, false, 'over the allowance');
    assert.deepEqual(composio.calls.at(-1).body, { instant: false }, 'Instant is switched off on her session');
    assert.match(media.mediaNote(fresh_), /used up.*December 1/);
    assert.equal(media.lastAllowance('mina').open, false);

    const raised = await media.holdMediaBudget(db, settings(10), 'mina', origin, month + 3 * day + 2 * 60_000);
    assert.equal(raised.open, true, 'a higher allowance opens it again');
    assert.deepEqual(composio.calls.at(-1).body.instant, {}, 'every Instant tool again');

    await media.holdMediaBudget(db, settings(5), 'mina', origin, month + 3 * day + 4 * 60_000);
    const next = await media.holdMediaBudget(db, settings(5), 'mina', origin, Date.UTC(2026, 11, 1) + 1);
    assert.equal(next.spent, 0);
    assert.equal(next.open, true, 'a new month starts afresh');
  } finally { composio.close(); }
});

test('media allowance: unreadable logs keep it as it was; 0 switches Instant off; no session, no allowance', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    assert.equal(await media.holdMediaBudget(db, settings(5), 'nobody', origin, month), null);
    assert.equal(await media.holdMediaBudget(db, { composioKey: '', mediaBudget: 5 }, 'mina', origin, month), null);
    await toolSession(db, 'key-a', 'sam', origin, month);
    composio.state.logsDown = true;
    const unknown = await media.holdMediaBudget(db, settings(5), 'sam', origin, month + 1);
    assert.equal(unknown.spent, null);
    assert.equal(unknown.open, true, 'still open, as it was');
    assert.match(media.mediaNote(unknown), /some of \$5\.00 left/);
    const off = await media.holdMediaBudget(db, settings(0), 'sam', origin, month + 2);
    assert.equal(off.open, false);
    assert.deepEqual(composio.calls.at(-1).body, { instant: false });
    assert.equal(media.mediaNote(off), '', 'no allowance, nothing to say');
  } finally { composio.close(); }
});

test('a session made again starts with Instant on, and is closed again if the month is spent', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    await toolSession(db, 'key-a', 'lee', origin, month);
    composio.logs.push(charge('lee', month + 1, '6.00'));
    assert.equal((await media.holdMediaBudget(db, settings(5), 'lee', origin, month + 2)).open, false);
    await toolSession(db, 'key-b', 'lee', origin, month + 3);
    assert.equal(db.prepare('SELECT instant FROM tool_sessions WHERE username = ?').get('lee').instant, 1);
    const again = await media.holdMediaBudget(db, { composioKey: 'key-b', mediaBudget: 5 }, 'lee', origin, month + 2 * 60_000);
    assert.equal(again.open, false);
    assert.deepEqual(composio.calls.at(-1).body, { instant: false });
  } finally { composio.close(); }
});

test('what a chat spent: the charges made while its own turns ran', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    const day = 24 * 60 * 60 * 1000;
    const a = model.createWorkspace(db, 'mina', { prompt: 'Make a voiceover' }, month + day);
    const b = model.createWorkspace(db, 'mina', { prompt: 'Find flights' }, month + day);
    const turn = (workspace, start, end) => db.prepare('INSERT INTO turns (id, workspace_id, state, started_at, ended_at) VALUES (?, ?, ?, ?, ?)').run(`t${start}`, workspace.id, end ? 'done' : 'running', start, end);
    turn(a, month + day, month + day + 10 * 60_000);
    turn(b, month + 2 * day, null);
    composio.logs.push(
      charge('mina', month + day + 60_000, '0.40'), charge('mina', month + day + 5 * 60_000, '0.10'),
      charge('mina', month + 2 * day + 60_000, '0.008'), charge('mina', month + day + 3 * 60 * 60_000, '1.00'),
    );
    await toolSession(db, 'key-a', 'mina', origin, month + 2 * day);
    assert.equal(media.chatSpent(db, a.id, 'mina', month + 2 * day + 2 * 60_000), 0, 'nothing read yet, nothing to count');
    await media.holdMediaBudget(db, settings(10), 'mina', origin, month + 2 * day + 2 * 60_000);
    assert.equal(media.chatSpent(db, a.id, 'mina', month + 2 * day + 2 * 60_000), 0.5, 'only what ran during its turn');
    assert.equal(media.chatSpent(db, b.id, 'mina', month + 2 * day + 2 * 60_000), 0.008, 'a turn still running counts too');
    assert.equal(media.chatSpent(db, 'nope', 'mina', month + 2 * day + 2 * 60_000), 0);
  } finally { composio.close(); }
});

test('a call ran as a Pro Tool when the app has Instant, the person never connected it, and Pro Tools are open', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    const dec = Date.UTC(2026, 11, 3);
    await toolSession(db, 'key-a', 'mina', origin, dec);
    await connectLink(db, 'key-a', 'mina', origin, 'gmail');
    const at = dec + 60_000;
    assert.equal(await media.ranAsPro(db, settings(10), 'mina', origin, 'elevenlabs', at), true);
    assert.equal(await media.ranAsPro(db, settings(10), 'mina', origin, 'gmail', at), false, 'her own Gmail runs on her account');
    assert.equal(await media.ranAsPro(db, settings(10), 'mina', origin, 'notion', at), false, 'no Instant tools: it would need connecting');
    assert.equal(await media.ranAsPro(db, settings(0), 'mina', origin, 'elevenlabs', at), false, 'no allowance, no Pro Tools');
    composio.logs.push(charge('mina', dec + 1, '11.00'));
    await media.holdMediaBudget(db, settings(10), 'mina', origin, dec + 2 * 60_000);
    assert.equal(await media.ranAsPro(db, settings(10), 'mina', origin, 'elevenlabs', dec + 3 * 60_000), false, 'spent: Instant is off');
    assert.equal(await media.ranAsPro(db, settings(10), 'sam', origin, 'elevenlabs', at), false, 'no session, nothing to tell');
  } finally { composio.close(); }
});

test('media allowance: a key that may not read the logs closes Pro Tools, rather than leaving them uncapped', async () => {
  const composio = await fakeComposio();
  try {
    const db = fresh();
    await toolSession(db, 'key-a', 'kai', origin, month);
    composio.state.logsForbidden = true;
    const closed = await media.holdMediaBudget(db, settings(10), 'kai', origin, month + 1);
    assert.equal(closed.open, false);
    assert.equal(closed.unreadable, true);
    assert.deepEqual(composio.calls.at(-1).body, { instant: false }, 'Instant switched off on the session');
    assert.match(media.mediaNote(closed), /aren't available right now/);
    composio.state.logsForbidden = false;
    const back = await media.holdMediaBudget(db, settings(10), 'kai', origin, month + 2 * 60_000);
    assert.equal(back.open, true, 'once the key may read them, Pro Tools open again');
  } finally { composio.close(); }
});
