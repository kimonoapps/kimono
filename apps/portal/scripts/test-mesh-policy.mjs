import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMeshPolicy } from '../src/lib/mesh-policy.ts';

const rules = (policy) => [...policy.matchAll(/"src": \[(.*?)\],\n\s*"dst": \[(.*?)\]/g)].map((m) => [m[1], m[2]]);

test('administrators reach the server and its nodes; other members do not', () => {
  const policy = renderMeshPolicy({
    akadmin: { username: 'akadmin', displayName: 'Akram', guests: [], admin: true },
    mina: { username: 'mina', displayName: 'Mina', guests: [] },
  });
  const found = rules(policy);
  assert.deepEqual(found.filter(([src]) => src === '"akadmin@"'), [
    ['"akadmin@"', '"tag:kimono-admin:*", "tag:kimono-node:*"'],
    ['"akadmin@"', '"akadmin@:*"'],
  ]);
  assert.deepEqual(found.filter(([src]) => src === '"mina@"'), [['"mina@"', '"mina@:*"']]);
  /* The appliance still reaches its nodes. */
  assert.ok(found.some(([src, dst]) => src === '"tag:kimono-admin"' && dst === '"tag:kimono-node:*"'));
});

test('with no administrators in the mesh, nobody else gains the server', () => {
  const policy = renderMeshPolicy({ mina: { username: 'mina', displayName: 'Mina', guests: [] } });
  assert.ok(!policy.includes('"tag:kimono-admin:*"'));
});
