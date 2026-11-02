const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { MongoMemoryReplSet, MongoMemoryServer } = require('mongodb-memory-server');
const { createPaymentLedger, LedgerError } = require('../lib/payment-ledger');

let replicaSet;
before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
}, { timeout: 180000 });
after(async () => { await replicaSet?.stop(); });

async function fixture(t, options = {}) {
  const uri = options.uri || replicaSet.getUri();
  const clients = [new MongoClient(uri), new MongoClient(uri)];
  await Promise.all(clients.map(client => client.connect()));
  t.after(async () => { await Promise.all(clients.map(client => client.close())); });
  const dbName = `ledger_${randomUUID().replaceAll('-', '')}`;
  const db = clients[0].db(dbName);
  const accounts = db.collection('accounts');
  const entries = db.collection('entries');
  await accounts.createIndex({ teacherId: 1, subjectKey: 1 }, { unique: true, partialFilterExpression: { active: true } });
  await entries.createIndex({ accountId: 1, date: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'lesson' } });
  await db.collection('users').insertOne({ _id: 'teacher', role: 'teacher', active: true });
  const ledgers = clients.map(client => {
    const database = client.db(dbName);
    return createPaymentLedger({ client, lockCollection: database.collection('locks'),
      accounts: database.collection('accounts'), entries: database.collection('entries'), users: database.collection('users') });
  });
  await Promise.all(ledgers.map(ledger => ledger.initialize()));
  return { ledgers, accounts, entries, db };
}

const payment = (amount, extra = {}) => ({ amount, date: '2026-11-01', note: 'test', createdBy: 'admin', ...extra });
const accountInput = { teacherId: 'teacher', subject: 'Math', subjectKey: 'math', lessonPrice: 80, createdBy: 'admin' };
function rejectsWith(error, status, body) {
  assert.ok(error instanceof LedgerError);
  assert.equal(error.status, status);
  assert.deepEqual(error.body, body);
  return true;
}
function checkSingleSuccess(results, expectedError) {
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failure = results.find(r => r.status === 'rejected').reason;
  assert.ok(failure instanceof LedgerError);
  assert.equal(failure.status, 409);
  assert.equal(failure.body.error, expectedError);
}

test('two clients cannot allocate 80 + 80 from a deposit of 100', async t => {
  const { ledgers: [a, b], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  await a.addDeposit(payment(100));
  checkSingleSuccess(await Promise.allSettled([
    a.addAllocation(payment(80, { accountId: account._id })),
    b.addAllocation(payment(80, { accountId: account._id })),
  ]), 'INSUFFICIENT_BROTHER_BALANCE');
  assert.equal(await entries.countDocuments({ type: 'allocation' }), 1);
  assert.equal((await entries.findOne({ type: 'allocation' })).amount, 80);
});

for (const type of ['deposit', 'allocation']) {
  test(`${type} idempotency deduplicates concurrent requests and successful retries across clients`, async t => {
    const { ledgers: [a, b], entries } = await fixture(t);
    const account = await a.addAccount(accountInput);
    if (type === 'allocation') await a.addDeposit(payment(100));
    const values = payment(80, { idempotencyKey: 'operation-1234',
      ...(type === 'allocation' ? { accountId: account._id } : {}) });
    const method = type === 'deposit' ? 'addDeposit' : 'addAllocation';
    const [first, concurrent] = await Promise.all([a[method](values), b[method](values)]);
    const retry = await b[method](values);
    assert.equal(concurrent._id, first._id);
    assert.equal(retry._id, first._id);
    assert.equal(retry.idempotencyKey, 'operation-1234');
    assert.equal(await entries.countDocuments({ type }), 1);
  });

  test(`${type} idempotency rejects changed payloads and scopes keys to the creator`, async t => {
    const { ledgers: [a, b], entries } = await fixture(t);
    const account = await a.addAccount(accountInput);
    if (type === 'allocation') await a.addDeposit(payment(500));
    const values = payment(80, { idempotencyKey: 'operation-5678',
      ...(type === 'allocation' ? { accountId: account._id } : {}) });
    const method = type === 'deposit' ? 'addDeposit' : 'addAllocation';
    const first = await a[method](values);
    for (const change of [{ amount: 81 }, { date: '2026-11-02' }, { note: 'changed' }]) {
      await assert.rejects(b[method]({ ...values, ...change }),
        e => rejectsWith(e, 409, { error: 'IDEMPOTENCY_CONFLICT' }));
    }
    if (type === 'allocation') {
      const otherAccount = await a.addAccount({ ...accountInput, subject: 'Science', subjectKey: 'science' });
      await assert.rejects(b[method]({ ...values, accountId: otherAccount._id }),
        e => rejectsWith(e, 409, { error: 'IDEMPOTENCY_CONFLICT' }));
    }
    const otherCreator = await b[method]({ ...values, createdBy: 'other-admin' });
    assert.notEqual(otherCreator._id, first._id);
    assert.equal(await entries.countDocuments({ type }), 2);
  });
}

test('different lesson dates still share the same teacher balance', async t => {
  const { ledgers: [a, b], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  await a.addDeposit(payment(100));
  await a.addAllocation(payment(100, { accountId: account._id }));
  checkSingleSuccess(await Promise.allSettled([
    a.addLesson({ accountId: account._id, date: '2026-11-01', createdBy: 'admin' }),
    b.addLesson({ accountId: account._id, date: '2026-11-02', createdBy: 'admin' }),
  ]), 'INSUFFICIENT_TEACHER_BALANCE');
  assert.equal(await entries.countDocuments({ type: 'lesson' }), 1);
});

test('duplicate lesson requests return the established conflict contract', async t => {
  const { ledgers: [a, b], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  await a.addDeposit(payment(200));
  await a.addAllocation(payment(200, { accountId: account._id }));
  const lesson = { accountId: account._id, date: '2026-11-01', createdBy: 'admin' };
  checkSingleSuccess(await Promise.allSettled([a.addLesson(lesson), b.addLesson(lesson)]), 'LESSON_ALREADY_MARKED');
  assert.equal(await entries.countDocuments({ type: 'lesson' }), 1);
});

test('deposit deletion and allocation cannot jointly overdraw the ledger', async t => {
  const { ledgers: [a, b], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  const deposit = await a.addDeposit(payment(100));
  const results = await Promise.allSettled([
    a.deleteDeposit(deposit._id), b.addAllocation(payment(80, { accountId: account._id })),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rows = await entries.find({}).toArray();
  const deposits = rows.filter(r => r.type === 'deposit').reduce((n, r) => n + r.amount, 0);
  const allocations = rows.filter(r => r.type === 'allocation').reduce((n, r) => n + r.amount, 0);
  assert.ok(deposits >= allocations);
});

test('concurrent deposit deletions cannot remove already allocated funds', async t => {
  const { ledgers: [a, b], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  const d1 = await a.addDeposit(payment(100));
  const d2 = await a.addDeposit(payment(100));
  await a.addAllocation(payment(80, { accountId: account._id }));
  checkSingleSuccess(await Promise.allSettled([a.deleteDeposit(d1._id), b.deleteDeposit(d2._id)]), 'DEPOSIT_ALREADY_ALLOCATED');
  assert.equal(await entries.countDocuments({ type: 'deposit' }), 1);
});

test('allocation deletion and lesson marking cannot spend removed funds', async t => {
  const { ledgers: [a, b], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  await a.addDeposit(payment(100));
  const allocation = await a.addAllocation(payment(100, { accountId: account._id }));
  const results = await Promise.allSettled([
    a.deleteAllocation(allocation._id), b.addLesson({ accountId: account._id, date: '2026-11-01', createdBy: 'admin' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rows = await entries.find({ accountId: account._id }).toArray();
  assert.ok(rows.filter(r => r.type === 'allocation').reduce((n, r) => n + r.amount, 0)
    >= rows.filter(r => r.type === 'lesson').reduce((n, r) => n + r.amount, 0));
});

function backup(suffix = 'one') {
  return {
    accounts: [{ _id: `payacc_${suffix}`, teacherId: 'teacher', subject: `Math ${suffix}`, subjectKey: `math-${suffix}`, lessonPrice: 80, active: true }],
    entries: [{ _id: `payment_${suffix}`, type: 'deposit', amount: 100, date: '2026-11-01' }],
  };
}

test('a failed entry insert rolls back accounts and all earlier imported entries', async t => {
  const { ledgers: [a], entries, accounts } = await fixture(t);
  const data = backup();
  data.entries.push({ ...data.entries[0] }); // Real MongoDB duplicate-key failure after the first insert.
  await assert.rejects(a.importBackup(data));
  assert.equal(await accounts.countDocuments({}), 0);
  assert.equal(await entries.countDocuments({}), 0);
  assert.deepEqual(await a.importBackup(backup('retry')), { imported: true, accounts: 1, entries: 1 });
});

test('two clients importing concurrently cannot combine their backups', async t => {
  const { ledgers: [a, b], accounts, entries } = await fixture(t);
  checkSingleSuccess(await Promise.allSettled([a.importBackup(backup('one')), b.importBackup(backup('two'))]), 'TARGET_LEDGER_NOT_EMPTY');
  assert.equal(await accounts.countDocuments({}), 1);
  assert.equal(await entries.countDocuments({}), 1);
  const account = await accounts.findOne({});
  const entry = await entries.findOne({});
  assert.equal(account._id.slice(7), entry._id.slice(8));
});

test('account creation and backup import also serialize', async t => {
  const { ledgers: [a, b], accounts, entries } = await fixture(t);
  const data = backup();
  data.accounts[0].subjectKey = 'math';
  const results = await Promise.allSettled([a.addAccount(accountInput), b.importBackup(data)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await accounts.countDocuments({}), 1);
  assert.ok(await entries.countDocuments({}) <= 1);
});

test('account updates and deletion methods preserve existing response contracts', async t => {
  const { ledgers: [a], accounts } = await fixture(t);
  const account = await a.addAccount(accountInput);
  await assert.rejects(a.addAccount(accountInput), e => rejectsWith(e, 409, { error: 'PAYMENT_ACCOUNT_EXISTS', accountId: account._id }));
  const updated = await a.updateAccount(account._id, { lessonPrice: 50, active: false });
  assert.equal(updated.lessonPrice, 50);
  assert.equal(updated.active, false);
  assert.equal((await accounts.findOne({ _id: account._id })).lessonPrice, 50);
  await assert.rejects(a.addAllocation(payment(100, { accountId: account._id })), e => rejectsWith(e, 404, { error: 'PAYMENT_ACCOUNT_NOT_FOUND' }));
  await assert.rejects(a.deleteDeposit('missing'), e => rejectsWith(e, 404, { error: 'PAYMENT_NOT_FOUND' }));
  await assert.rejects(a.deleteAllocation('missing'), e => rejectsWith(e, 404, { error: 'ALLOCATION_NOT_FOUND' }));
  await assert.rejects(a.deleteLesson({ accountId: account._id, date: '2026-11-01' }), e => rejectsWith(e, 404, { error: 'LESSON_PAYMENT_NOT_FOUND' }));
});

test('deleting lessons refunds funds; spent allocations remain protected until then', async t => {
  const { ledgers: [a], entries } = await fixture(t);
  const account = await a.addAccount(accountInput);
  const deposit = await a.addDeposit(payment(100));
  const allocation = await a.addAllocation(payment(100, { accountId: account._id }));
  const lesson = await a.addLesson({ accountId: account._id, date: '2026-11-01', createdBy: 'admin' });
  assert.equal(lesson.amount, 80);
  await assert.rejects(a.deleteAllocation(allocation._id), e => rejectsWith(e, 409, { error: 'ALLOCATION_ALREADY_SPENT', spent: 80, allocatedAfterDelete: 0 }));
  assert.deepEqual(await a.deleteLesson({ accountId: account._id, date: '2026-11-01' }), { ok: true });
  assert.deepEqual(await a.deleteAllocation(allocation._id), { ok: true });
  assert.deepEqual(await a.deleteDeposit(deposit._id), { ok: true });
  assert.equal(await entries.countDocuments({}), 0);
});

test('standalone MongoDB refuses financial writes without a nontransactional fallback', async t => {
  const standalone = await MongoMemoryServer.create();
  t.after(async () => { await standalone.stop(); });
  const { ledgers: [a], entries } = await fixture(t, { uri: standalone.getUri() });
  await assert.rejects(a.addDeposit(payment(100)), e => {
    assert.equal(e.status, 503);
    assert.equal(e.body.error, 'PAYMENT_TRANSACTIONS_UNAVAILABLE');
    assert.match(e.message, /replica set/i);
    return true;
  });
  assert.equal(await entries.countDocuments({}), 0);
});
