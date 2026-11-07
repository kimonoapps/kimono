import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as oauth from '../src/lib/notes/mcp-oauth.ts';
import * as mcp from '../src/lib/notes/mcp-protocol.ts';
import { notesSite } from '../src/lib/notes/mcp-site.ts';

function fresh() {
  const db = new DatabaseSync(':memory:');
  oauth.migrateOAuth(db);
  return db;
}
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const resource = 'https://notes.example.com/mcp';
const redirect = 'https://claude.ai/api/mcp/auth_callback';

function connect(db, now = 1_000_000) {
  const client = oauth.registerClient(db, { client_name: 'Claude', redirect_uris: [redirect] }, now);
  const { verifier, challenge } = pkce();
  const code = oauth.issueCode(db, { clientId: client.client_id, username: 'Akram', redirectUri: redirect, challenge, resource }, now);
  return { client, verifier, code, tokens: () => oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: redirect, verifier, resource }, now + 1000) };
}

test('redirect URIs: https, loopback, or an app scheme; nothing that runs', () => {
  for (const ok of [redirect, 'http://localhost:6274/oauth/callback', 'http://127.0.0.1/cb', 'cursor://anysphere.cursor-retrieval/oauth/callback', 'com.example.app:/cb']) assert.ok(oauth.validRedirectUri(ok), ok);
  for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,hi', 'https://a.example/cb#x', 'https://u:p@a.example/', 'not a url', 'file:///etc/passwd']) assert.ok(!oauth.validRedirectUri(bad), bad);
});

test('a loopback redirect matches on any port; others match exactly', () => {
  assert.ok(oauth.redirectMatches(['http://127.0.0.1:1234/cb'], 'http://127.0.0.1:9999/cb'));
  assert.ok(!oauth.redirectMatches(['http://127.0.0.1:1234/cb'], 'http://127.0.0.1:9999/other'));
  assert.ok(!oauth.redirectMatches([redirect], `${redirect}/more`));
  assert.ok(!oauth.redirectMatches(['https://a.example:1/cb'], 'https://a.example:2/cb'));
});

test('registration: public clients only, names cleaned, bad metadata refused', () => {
  const db = fresh();
  const client = oauth.registerClient(db, { client_name: ' Claude‮\n  Desktop ', redirect_uris: [redirect], token_endpoint_auth_method: 'client_secret_basic' });
  assert.equal(client.client_name, 'Claude Desktop');
  assert.equal(client.token_endpoint_auth_method, 'none');
  assert.equal(client.client_secret, undefined);
  assert.deepEqual(oauth.clientFor(db, client.client_id).redirectUris, [redirect]);
  assert.throws(() => oauth.registerClient(db, { redirect_uris: [] }), { code: 'invalid_redirect_uri' });
  assert.throws(() => oauth.registerClient(db, { redirect_uris: ['http://evil.example/'] }), { code: 'invalid_redirect_uri' });
  assert.throws(() => oauth.registerClient(db, { redirect_uris: [redirect], grant_types: ['client_credentials'] }), { code: 'invalid_client_metadata' });
});

test('clients nobody allowed are forgotten after a day', () => {
  const db = fresh();
  const idle = oauth.registerClient(db, { redirect_uris: [redirect] }, 0);
  const { client, tokens } = connect(db, 0);
  tokens();
  oauth.registerClient(db, { redirect_uris: [redirect] }, 2 * 24 * 3600 * 1000);
  assert.equal(oauth.clientFor(db, idle.client_id), null);
  assert.ok(oauth.clientFor(db, client.client_id));
});

test('PKCE is S256 and must match', () => {
  const { verifier, challenge } = pkce();
  assert.ok(oauth.pkceMatches(verifier, challenge));
  assert.ok(!oauth.pkceMatches(pkce().verifier, challenge));
  assert.ok(!oauth.pkceMatches('short', challenge));
  assert.ok(oauth.validChallenge(challenge));
  assert.ok(!oauth.validChallenge('plain-text-verifier'));
});

test('scope: Notes, whatever OpenID extras a client tacks on', () => {
  assert.equal(oauth.scopeFrom(undefined), 'notes');
  assert.equal(oauth.scopeFrom('openid profile notes offline_access'), 'notes');
  assert.equal(oauth.scopeFrom('drive'), null);
});

test('a code is redeemed once, by its client, with its verifier and redirect', () => {
  const db = fresh();
  const { client, verifier, code } = connect(db);
  const other = oauth.registerClient(db, { redirect_uris: [redirect] });
  assert.throws(() => oauth.redeemCode(db, { code, clientId: other.client_id, redirectUri: redirect, verifier }, 1_000_500), { code: 'invalid_grant' });
  assert.throws(() => oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: 'https://claude.ai/other', verifier }, 1_000_500), { code: 'invalid_grant' });
  assert.throws(() => oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: redirect, verifier: pkce().verifier }, 1_000_500), { code: 'invalid_grant' });
  assert.throws(() => oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: redirect, verifier, resource: 'https://elsewhere/mcp' }, 1_000_500), { code: 'invalid_target' });
  const tokens = oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: redirect, verifier, resource }, 1_000_500);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.match(tokens.access_token, /^kn_at_/);
  assert.equal(oauth.verifyAccess(db, tokens.access_token, resource, 1_001_000).username, 'akram');
  /* A second redemption is a stolen code: it fails, and the grant it made ends. */
  assert.throws(() => oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: redirect, verifier }, 1_002_000), { code: 'invalid_grant' });
  assert.equal(oauth.verifyAccess(db, tokens.access_token, resource, 1_002_000), null);
});

test('codes expire in a minute', () => {
  const db = fresh();
  const { client, verifier, code } = connect(db);
  assert.throws(() => oauth.redeemCode(db, { code, clientId: client.client_id, redirectUri: redirect, verifier }, 1_000_000 + 61_000), { message: /expired/ });
});

test('access tokens last an hour and only for their resource', () => {
  const db = fresh();
  const { access_token } = connect(db).tokens();
  assert.ok(oauth.verifyAccess(db, access_token, resource, 1_001_000 + 3599_000));
  assert.equal(oauth.verifyAccess(db, access_token, resource, 1_001_000 + 3601_000), null);
  assert.equal(oauth.verifyAccess(db, access_token, 'https://kimono.example.com/mcp', 1_002_000), null);
  assert.equal(oauth.verifyAccess(db, 'kn_at_made-up', resource, 1_002_000), null);
});

test('refresh tokens rotate; a replay ends the grant', () => {
  const db = fresh();
  const { client, tokens } = connect(db);
  const first = tokens();
  const second = oauth.refreshTokens(db, { refreshToken: first.refresh_token, clientId: client.client_id }, 2_000_000);
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.ok(oauth.verifyAccess(db, second.access_token, resource, 2_000_001));
  assert.throws(() => oauth.refreshTokens(db, { refreshToken: second.refresh_token, clientId: 'kn_client_other' }, 2_000_002), { code: 'invalid_grant' });
  assert.throws(() => oauth.refreshTokens(db, { refreshToken: first.refresh_token, clientId: client.client_id }, 2_000_003), { message: /already used/ });
  assert.equal(oauth.verifyAccess(db, second.access_token, resource, 2_000_004), null);
  assert.throws(() => oauth.refreshTokens(db, { refreshToken: second.refresh_token, clientId: client.client_id }, 2_000_005), { code: 'invalid_grant' });
});

test('refresh tokens lapse after 30 days unused', () => {
  const db = fresh();
  const { client, tokens } = connect(db);
  const { refresh_token } = tokens();
  assert.throws(() => oauth.refreshTokens(db, { refreshToken: refresh_token, clientId: client.client_id }, 1_001_000 + 31 * 24 * 3600 * 1000), { message: /expired/ });
});

test('revoking either token, or the person revoking the app, ends access', () => {
  const db = fresh();
  const { client, tokens } = connect(db);
  const pair = tokens();
  assert.equal(oauth.grantsOf(db, 'AKRAM')[0].app, 'Claude');
  assert.throws(() => oauth.revokeToken(db, pair.refresh_token, 'kn_client_other'), { code: 'invalid_client' });
  oauth.revokeToken(db, pair.refresh_token, client.client_id);
  assert.equal(oauth.verifyAccess(db, pair.access_token, resource), null);
  assert.deepEqual(oauth.grantsOf(db, 'akram'), []);
  oauth.revokeToken(db, 'kn_at_unknown', client.client_id);

  const again = connect(db).tokens();
  oauth.revokeGrantsOf(db, 'akram');
  assert.equal(oauth.verifyAccess(db, again.access_token, resource, 1_001_500), null);
});

test('metadata points the client at the right places', () => {
  const resourceDoc = oauth.resourceMetadata('https://notes.example.com');
  assert.equal(resourceDoc.resource, resource);
  assert.deepEqual(resourceDoc.authorization_servers, ['https://notes.example.com']);
  const server = oauth.serverMetadata('https://notes.example.com', 'https://kimono.example.com');
  assert.equal(server.issuer, 'https://notes.example.com');
  assert.equal(server.authorization_endpoint, 'https://kimono.example.com/mcp/authorize');
  assert.equal(server.token_endpoint, 'https://notes.example.com/mcp/token');
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
  assert.equal(oauth.redirectWith('https://a.example/cb?x=1', { code: 'c', state: undefined, iss: 'https://n' }), 'https://a.example/cb?x=1&code=c&iss=https%3A%2F%2Fn');
});

const echo = async (name, args) => ({ name, args });

test('initialize answers with a version both sides speak', async () => {
  const reply = await mcp.answer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, echo);
  assert.equal(reply.result.protocolVersion, '2025-06-18');
  assert.deepEqual(reply.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await mcp.answer({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, echo)).result.protocolVersion, mcp.latestProtocol);
  assert.ok(mcp.knownProtocolHeader(null) && mcp.knownProtocolHeader('2025-03-26') && !mcp.knownProtocolHeader('2024-11-05'));
});

test('notifications and responses get no answer; unknown methods an error', async () => {
  assert.equal(await mcp.answer({ jsonrpc: '2.0', method: 'notifications/initialized' }, echo), null);
  assert.equal(await mcp.answer({ jsonrpc: '2.0', id: 5, result: {} }, echo), null);
  assert.equal((await mcp.answer({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, echo)).error.code, -32601);
  assert.equal((await mcp.answer({ id: 3, method: 'ping' }, echo)).error.code, -32600);
  assert.deepEqual((await mcp.answer({ jsonrpc: '2.0', id: 'p', method: 'ping' }, echo)).result, {});
  assert.equal(await mcp.answerAll([{ jsonrpc: '2.0', method: 'notifications/initialized' }], echo), null);
  assert.equal((await mcp.answerAll([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'x' }], echo)).length, 1);
});

test('tools are listed with schemas, and their arguments are checked', async () => {
  const listed = (await mcp.answer({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, echo)).result.tools;
  assert.deepEqual(listed.map((tool) => tool.name), ['list_notebooks', 'search_notes', 'read_note', 'create_note', 'update_note', 'move_note', 'delete_note']);
  for (const tool of listed) assert.equal(tool.inputSchema.type, 'object');
  const call = (name, args) => mcp.answer({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }, echo);
  const ok = await call('update_note', { id: 'n1', version: 3, text: '# hi' });
  assert.deepEqual(ok.result.structuredContent, { name: 'update_note', args: { id: 'n1', version: 3, text: '# hi' } });
  assert.equal(JSON.parse(ok.result.content[0].text).name, 'update_note');
  assert.match((await call('update_note', { id: 'n1', text: 'x' })).result.content[0].text, /version/);
  assert.equal((await call('update_note', { id: 'n1', version: '3' })).result.isError, true);
  assert.equal((await call('read_note', { id: 'n1', extra: 1 })).result.isError, true);
  assert.equal((await call('nope', {})).error.code, -32602);
  const refusing = async () => { throw new mcp.ToolProblem("That isn't a note."); };
  const refused = await mcp.answer({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { id: 'x' } } }, refusing);
  assert.deepEqual(refused.result, { content: [{ type: 'text', text: "That isn't a note." }], isError: true });
});

test('search wants every word, ranks titles first, then the newest', () => {
  const notes = [
    { id: 'a', title: 'Groceries', text: 'milk, eggs, and café beans', updatedAt: 1 },
    { id: 'b', title: 'Cafe list', text: 'places to try', updatedAt: 2 },
    { id: 'c', title: 'Trip', text: 'a café in Lisbon, another café in Porto', updatedAt: 3 },
    { id: 'd', title: 'Café', text: '', updatedAt: 0 },
  ];
  assert.deepEqual(mcp.rank(notes, 'cafe', 10).map((hit) => hit.note.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(mcp.rank(notes, 'café lisbon', 10).map((hit) => hit.note.id), ['c']);
  assert.deepEqual(mcp.rank(notes, '', 2).map((hit) => hit.note.id), ['c', 'b']);
  assert.deepEqual(mcp.rank(notes, 'nothing here', 10), []);
  assert.match(mcp.rank(notes, 'lisbon', 1)[0].snippet, /Lisbon/);
});

test('snippets are a line of text around the match', () => {
  const text = `${'word '.repeat(100)}needle${' after'.repeat(100)}`;
  const snippet = mcp.snippetOf(text, text.indexOf('needle'));
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…') && snippet.includes('needle'));
  assert.equal(mcp.snippetOf('short\n\ntext', 0), 'short text');
});

test('the Notes address sends MCP to the Portal and the rest to its Notes page', () => {
  const site = notesSite('notes.example.com', 'kimono.example.com');
  assert.match(site, /^notes\.example\.com \{$/m);
  assert.match(site, /@mcp path \/mcp \/mcp\/\* \/\.well-known\/oauth-protected-resource/);
  assert.match(site, /handle @mcp \{\n\t\treverse_proxy portal:3000/);
  assert.match(site, /redir https:\/\/kimono\.example\.com\/notes 302/);
});
