const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSocketEventRegistrar } = require('../lib/socket-events');

function socket() {
  const result = new EventEmitter(); result.connected = true;
  result.disconnect = () => { result.connected = false; };
  return result;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('socket events preserve wire order through asynchronous authorization and writes', async () => {
  const s = socket(), seen = [];
  let releaseAuth, releaseWrite, lookups = 0;
  const firstLookup = new Promise(resolve => { releaseAuth = resolve; });
  const firstWrite = new Promise(resolve => { releaseWrite = resolve; });
  const on = createSocketEventRegistrar({ socket: s, authorize: async () => { if (++lookups === 1) await firstLookup; return true; } });
  on('start', async () => { seen.push('start'); await firstWrite; seen.push('saved'); });
  on('move', () => { seen.push('move'); });
  s.emit('start', {}); s.emit('move', {});
  await tick(); assert.equal(lookups, 1); assert.deepEqual(seen, []);
  releaseAuth(); await tick(); assert.deepEqual(seen, ['start']); assert.equal(lookups, 1);
  releaseWrite(); await tick(); assert.deepEqual(seen, ['start', 'saved', 'move']);
});

test('failed handler does not break later events, revoked peers cannot drain queued writes', async () => {
  const s = socket(), errors = [], seen = [];
  const on = createSocketEventRegistrar({ socket: s, authorize: async () => s.connected, onError: (name, error) => errors.push([name, error.message]) });
  on('bad', async () => { throw new Error('write failed'); });
  on('good', () => { seen.push('good'); });
  on('revoke', () => s.disconnect());
  s.emit('bad', {}); s.emit('good', {}); s.emit('revoke', {}); s.emit('good', {});
  await tick(); assert.deepEqual(errors, [['bad', 'write failed']]); assert.deepEqual(seen, ['good']);
});

test('authorization failure and queue overflow fail closed', async () => {
  const s = socket(); let writes = 0, rejected;
  const on = createSocketEventRegistrar({ socket: s, authorize: async () => false });
  on('write', () => { writes++; });
  s.emit('write', {}, result => { rejected = result; });
  await tick(); assert.equal(writes, 0); assert.equal(rejected.error, 'AUTH_REVOKED');

  const flooded = socket();
  const register = createSocketEventRegistrar({ socket: flooded, authorize: async () => true, maxPending: 1 });
  register('write', () => { writes++; });
  flooded.emit('write', {}); flooded.emit('write', {});
  await tick(); assert.equal(flooded.connected, false); assert.equal(writes, 0);
});
