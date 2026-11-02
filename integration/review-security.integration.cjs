const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { MongoClient, GridFSBucket } = require('mongodb');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { io } = require('socket.io-client');
const { hashPassword, createSessionToken, createGuestToken } = require('../lib/auth');

const secret = 'integration-only-session-secret';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let replica, client, db, child, base, output = '', sequence = 0;

before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  client = await new MongoClient(replica.getUri()).connect();
  db = client.db('review_security');
  const password = await hashPassword('integration-password-unique');
  await db.collection('users').insertMany([
    ['reviewadmin', 'admin'], ['teacher', 'teacher'], ['alice', 'student'], ['bob', 'student'],
  ].map(([_id, role]) => ({ _id, username: _id, displayName: _id, role, active: true,
    approvalStatus: 'approved', profileComplete: true, passwordSalt: password.salt, passwordHash: password.hash })));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, MONGODB_URI: replica.getUri(), MONGODB_DB_NAME: 'review_security', DATA_NAMESPACE: '',
      AUTH_SECRET: secret, PORT: String(port), NODE_ENV: 'test',
      BOOTSTRAP_ADMIN_USERNAME: '', BOOTSTRAP_ADMIN_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('Server exited during startup: ' + output);
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await delay(50);
  }
  throw new Error('Server failed to start: ' + output);
}, { timeout: 180000 });

after(async () => {
  if (child && child.exitCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
  await client?.close();
  await replica?.stop();
});

async function accountCookie(id, ttl = 60) {
  const user = await db.collection('users').findOne({ _id: id });
  return 'school_session=' + createSessionToken(user, secret, ttl);
}
async function request(url, cookie, method = 'GET', body) {
  return fetch(base + url, { method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function fixture(t) {
  const lessonId = 'review_' + (++sequence);
  const materialId = 'material_' + sequence;
  const bucket = new GridFSBucket(db, { bucketName: 'pdfs' });
  const stream = bucket.openUploadStream('review.pdf');
  stream.end(Buffer.from('%PDF-1.4\n%%EOF'));
  await once(stream, 'finish');
  const documentId = String(stream.id);
  await db.collection('lessons').insertOne({ _id: lessonId, title: 'Review lesson', active: true,
    ownerId: 'teacher', teacherIds: ['teacher'], studentIds: ['alice', 'bob'], materialId });
  await db.collection('materials').insertOne({ _id: materialId, ownerId: 'teacher', fileId: stream.id, name: 'review.pdf' });
  await db.collection('settings').insertOne({ _id: 'currentDocument:' + lessonId, lessonId, fileId: stream.id, materialId, name: 'review.pdf' });
  async function connect(id = 'alice', cookie) {
    const socket = io(base, { transports: ['websocket'], reconnection: false, timeout: 3000,
      auth: { role: id === 'teacher' ? 'teacher' : 'student', lessonId, clientId: 'review-client-' + id },
      extraHeaders: { Cookie: cookie || await accountCookie(id) } });
    t.after(() => socket.disconnect());
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]);
    return socket;
  }
  async function stroke(id, userId, createdAt = new Date()) {
    const row = { _id: id, lessonId, documentId, userId, role: userId === 'teacher' ? 'teacher' : 'student',
      page: 1, color: '#000', width: 2, points: [{ x: 0.49, y: 0.5 }, { x: 0.51, y: 0.5 }], createdAt };
    await db.collection('annotations').insertOne(row);
    return row;
  }
  return { lessonId, materialId, documentId, connect, stroke };
}
function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(2500).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
  });
}
async function assertDisconnectDuring(socket, action) {
  const disconnected = once(socket, 'disconnect');
  await action();
  await Promise.race([disconnected, delay(3000).then(() => { throw new Error('Revoked socket stayed connected'); })]);
  assert.equal(socket.connected, false);
}

test('student cannot delete another student annotation', async t => {
  const f = await fixture(t), s = await f.connect();
  await f.stroke('delete-bob', 'bob');
  s.emit('stroke:delete', { id: 'delete-bob', documentId: f.documentId });
  await delay(150);
  assert.ok(await db.collection('annotations').findOne({ _id: 'delete-bob' }));
});

test('student undo removes own annotation while retaining a newer peer annotation', async t => {
  const f = await fixture(t), s = await f.connect();
  await f.stroke('undo-alice', 'alice', new Date(1000));
  await f.stroke('undo-bob', 'bob', new Date(2000));
  const result = await ack(s, 'stroke:undo', { page: 1, documentId: f.documentId });
  assert.equal(result.id, 'undo-alice');
  assert.ok(await db.collection('annotations').findOne({ _id: 'undo-bob' }));
});

test('student eraser retains peer annotations, teacher can still correct them', async t => {
  const f = await fixture(t), s = await f.connect();
  await f.stroke('erase-alice', 'alice'); await f.stroke('erase-bob', 'bob');
  const erase = { page: 1, documentId: f.documentId, radius: 0.05, points: [{ x: 0.5, y: 0.4 }, { x: 0.5, y: 0.6 }] };
  s.emit('erase:path', erase); await delay(150);
  assert.ok(await db.collection('annotations').findOne({ _id: 'erase-bob' }));
  assert.equal(await db.collection('annotations').findOne({ _id: 'erase-alice' }), null);
  const teacher = await f.connect('teacher'); teacher.emit('erase:path', erase); await delay(150);
  assert.equal(await db.collection('annotations').findOne({ _id: 'erase-bob' }), null);
});

test('annotation deletion cannot use MongoDB operators or another document', async t => {
  const f = await fixture(t), s = await f.connect('teacher');
  await f.stroke('old-document', 'alice');
  await db.collection('annotations').updateOne({ _id: 'old-document' }, { $set: { documentId: 'old-pdf' } });
  s.emit('stroke:delete', { id: 'old-document', documentId: f.documentId });
  s.emit('stroke:delete', { id: { $ne: null }, documentId: f.documentId });
  await delay(150);
  assert.ok(await db.collection('annotations').findOne({ _id: 'old-document' }));
});

test('archiving a lesson disconnects a connected student immediately', async t => {
  const f = await fixture(t), s = await f.connect();
  await assertDisconnectDuring(s, async () => assert.equal((await request('/api/teacher/lessons/' + f.lessonId + '/archive', await accountCookie('teacher'), 'POST')).status, 200));
});

test('removing a lesson member disconnects their existing socket', async t => {
  const f = await fixture(t), s = await f.connect();
  await assertDisconnectDuring(s, async () => assert.equal((await request('/api/admin/lessons/' + f.lessonId, await accountCookie('reviewadmin'), 'PATCH', { studentIds: ['bob'] })).status, 200));
});

test('password reset revokes an existing socket and old HTTP session', async t => {
  const f = await fixture(t), cookie = await accountCookie('alice'), s = await f.connect('alice', cookie);
  await assertDisconnectDuring(s, async () => assert.equal((await request('/api/admin/users/alice', await accountCookie('reviewadmin'), 'PATCH', { password: 'new-integration-password' })).status, 200));
  assert.equal((await request('/api/auth/me', cookie)).status, 401);
});

test('deactivation revokes an existing socket', async t => {
  const f = await fixture(t), s = await f.connect();
  try {
    await assertDisconnectDuring(s, async () => assert.equal((await request('/api/admin/users/alice', await accountCookie('reviewadmin'), 'PATCH', { active: false })).status, 200));
  } finally { await db.collection('users').updateOne({ _id: 'alice' }, { $set: { active: true } }); }
});

test('expired account and guest credentials disconnect silent recipients', async t => {
  const f = await fixture(t);
  const sockets = [await f.connect('alice', await accountCookie('alice', 1)),
    await f.connect('guest', 'school_guest=' + createGuestToken({ lessonId: f.lessonId, name: 'Guest', guestId: 'expiry-review' }, secret, 1))];
  await Promise.all(sockets.map(s => assertDisconnectDuring(s, async () => {})));
});

test('logout revokes account and guest sockets and replayed cookies', async t => {
  const f = await fixture(t), cookie = await accountCookie('alice'), s = await f.connect('alice', cookie);
  await assertDisconnectDuring(s, async () => assert.equal((await request('/api/auth/logout', cookie, 'POST')).status, 200));
  assert.equal((await request('/api/auth/me', cookie)).status, 401);
  const guestCookie = 'school_guest=' + createGuestToken({ lessonId: f.lessonId, name: 'Guest', guestId: 'logout-review' }, secret, 60);
  const guest = await f.connect('guest', guestCookie);
  await assertDisconnectDuring(guest, async () => assert.equal((await request('/api/auth/logout', guestCookie, 'POST')).status, 200));
  assert.equal((await request('/api/auth/me', guestCookie)).status, 401);
});

test('administrator can rotate own password but cannot deactivate self through this route', async () => {
  const oldCookie = await accountCookie('reviewadmin');
  assert.equal((await request('/api/admin/users/reviewadmin', oldCookie, 'PATCH', { active: false })).status, 403);
  assert.equal((await request('/api/admin/users/reviewadmin', oldCookie, 'PATCH', { password: 'unique-replacement-admin-password' })).status, 200);
  assert.equal((await request('/api/auth/me', oldCookie)).status, 401);
});

test('private PDF bytes including ranges and downloads are never publicly cached', async t => {
  const f = await fixture(t), cookie = await accountCookie('alice');
  for (const suffix of ['', '&download=1']) {
    const response = await request('/api/document/file?lesson=' + f.lessonId + '&id=' + f.documentId + suffix, cookie);
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private.*no-store/);
    await response.arrayBuffer();
  }
  const range = await fetch(base + '/api/document/file?lesson=' + f.lessonId + '&id=' + f.documentId,
    { headers: { Cookie: cookie, Range: 'bytes=0-4' } });
  assert.equal(range.status, 206); assert.match(range.headers.get('cache-control'), /no-store/);
  assert.equal(await range.text(), '%PDF-');
});

test('material deletion preserves archived document references', async t => {
  const f = await fixture(t), cookie = await accountCookie('teacher');
  await db.collection('lessons').updateOne({ _id: f.lessonId }, { $set: { active: false } });
  const deleted = await request('/api/materials/' + f.materialId, cookie, 'DELETE');
  assert.equal(deleted.status, 409); assert.equal((await deleted.json()).error, 'MATERIAL_IN_USE');
  assert.ok(await db.collection('pdfs.files').findOne({ _id: (await db.collection('materials').findOne({ _id: f.materialId })).fileId }));
  assert.equal((await request('/api/document/file?lesson=' + f.lessonId + '&id=' + f.documentId, cookie)).status, 200);
});

test('concurrent HTTP financial requests use the transactional ledger', async () => {
  const cookie = await accountCookie('reviewadmin');
  const accountResponse = await request('/api/admin/payments/accounts', cookie, 'POST', { teacherId: 'teacher', subject: 'Math', lessonPrice: 80 });
  assert.equal(accountResponse.status, 201); const accountId = (await accountResponse.json()).account.id;
  assert.equal((await request('/api/admin/payments/deposits', cookie, 'POST', { amount: 100, date: '2026-11-01' })).status, 201);
  const responses = await Promise.all([1, 2].map(() => request('/api/admin/payments/allocations', cookie, 'POST', { accountId, amount: 80, date: '2026-11-01' })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const ledger = await (await request('/api/admin/payments', cookie)).json();
  assert.equal(ledger.summary.brotherBalance, 20);
});

test('adventure saves cannot write one account result into another account', async () => {
  await db.collection('math_attempts').insertMany(['alice', 'bob'].map(studentId => ({ studentId, mode: 'diagnostic', correct: 0, total: 12, createdAt: new Date() })));
  const body = { userId: 'alice', level: 0, correct: 10, total: 10 };
  const rejected = await request('/api/math/adventure', await accountCookie('bob'), 'POST', body);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, 'ACCOUNT_MISMATCH');
  assert.equal(await db.collection('math_adventure_progress').findOne({ studentId: 'bob' }), null);
  const accepted = await request('/api/math/adventure', await accountCookie('alice'), 'POST', body);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).userId, 'alice');
});

test('replayed financial HTTP requests do not create another deposit', async () => {
  const cookie = await accountCookie('reviewadmin');
  const send = amount => fetch(base + '/api/admin/payments/deposits', { method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'review-retry-key' },
    body: JSON.stringify({ amount, date: '2026-11-01', note: 'retry-deposit' }) });
  const replies = await Promise.all([send(30), send(30)]);
  assert.ok(replies.every(r => r.status === 201));
  const rows = await Promise.all(replies.map(r => r.json()));
  assert.equal(rows[0].payment.id, rows[1].payment.id);
  assert.equal(await db.collection('payment_entries').countDocuments({ note: 'retry-deposit' }), 1);
  assert.equal((await send(31)).status, 409);
});

test('malformed preview and null socket events cannot terminate the server', async t => {
  const f = await fixture(t), s = await f.connect();
  s.emit('stroke:preview', { id: 'bad', page: 1, color: '#000', width: 2, points: [null, null] });
  for (const event of ['chat:send', 'stroke:delete', 'stroke:undo', 'rtc2:call']) s.emit(event, null);
  await delay(200);
  assert.equal(child.exitCode, null, 'Untrusted JSON terminated the server: ' + output);
  assert.equal((await fetch(base + '/health')).status, 200);
});
