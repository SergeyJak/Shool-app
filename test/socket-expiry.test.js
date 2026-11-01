const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual coupled server function without starting MongoDB or HTTP.
// Only its clock, credentials and Socket.IO lifecycle boundary are simulated.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('function trackSocketAccess(socket) {');
assert.ok(start >= 0, 'socket lifecycle function must exist');
const end = source.indexOf('\n}\n', start) + 2;
assert.ok(end > start, 'socket lifecycle function must have a closing brace');

function fixture({ guest = false, remaining = 0 } = {}) {
  let now = 1_800_000_000_000;
  let lookups = 0;
  const timeouts = new Set(), intervals = new Set();
  const schedule = timers => callback => {
    const timer = { callback, unref() {} };
    timers.add(timer);
    return timer;
  };
  const parseCredential = () => remaining > 0 ? { exp: (now + remaining) / 1000 } : null;
  const context = {
    Date: { now: () => now },
    parseCookies: () => ({ school_session: 'account-token', school_guest: 'guest-token' }),
    SESSION_COOKIE: 'school_session', GUEST_COOKIE: 'school_guest', AUTH_SECRET: 'test-only-secret',
    parseSessionToken: parseCredential, parseGuestToken: parseCredential,
    setTimeout: schedule(timeouts), setInterval: schedule(intervals),
    clearTimeout: timer => timeouts.delete(timer),
    clearInterval: timer => intervals.delete(timer),
    refreshSocketAccess: async () => { lookups++; return false; },
  };
  vm.createContext(context);
  const track = vm.runInContext(`(${source.slice(start, end)})`, context);
  const socket = new EventEmitter();
  Object.assign(socket, {
    connected: true, handshake: { headers: { cookie: 'test-cookie' } },
    data: { user: { _id: guest ? 'guest:child' : 'child', guest } },
    use() {},
    disconnect() { this.connected = false; this.emit('disconnect'); },
  });
  return {
    socket, timeouts, intervals, track,
    advance(milliseconds) { now += milliseconds; },
    get lookups() { return lookups; },
  };
}

for (const guest of [false, true]) {
  test(`${guest ? 'guest' : 'account'} expiring during handshake cannot retain a polling interval`, () => {
    const f = fixture({ guest });
    const connected = f.track(f.socket);
    assert.equal(f.socket.connected, false);
    assert.equal(f.timeouts.size, 0);
    assert.equal(f.intervals.size, 0, 'disconnect cleanup must exist before synchronous expiry');
    assert.equal(connected, false, 'caller must stop connection setup after expiry');
    for (const timer of f.intervals) timer.callback();
    assert.equal(f.lookups, 0, 'expired peers must not keep polling the database');
  });
}

test('a credential expiring after connection clears both lifecycle timers', () => {
  const f = fixture({ remaining: 1000 });
  f.track(f.socket);
  assert.equal(f.socket.connected, true);
  assert.equal(f.timeouts.size, 1);
  assert.equal(f.intervals.size, 1);
  f.advance(1000);
  [...f.timeouts][0].callback();
  assert.equal(f.socket.connected, false);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.intervals.size, 0);
});
