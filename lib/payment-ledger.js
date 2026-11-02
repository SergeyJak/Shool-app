const { randomUUID } = require('node:crypto');

class LedgerError extends Error {
  constructor(status, body, options) {
    super(body.message || body.error, options);
    this.name = 'LedgerError';
    this.status = status;
    this.body = body;
  }
}

function fail(status, error, details = {}) {
  throw new LedgerError(status, { error, ...details });
}

/**
 * All ledger writers, including account metadata and imports, must use this
 * service. MongoDB must be a replica set or sharded cluster: standalone servers
 * cannot safely perform these writes and deliberately receive no fallback.
 * Use one shared lock collection per ledger, across every application instance.
 */
function createPaymentLedger({ client, lockCollection, accounts, entries, users }) {
  const lockId = 'payment-ledger';

  async function initialize() {
    try {
      await lockCollection.updateOne({ _id: lockId }, { $setOnInsert: { version: 0 } }, { upsert: true });
    } catch (error) {
      // Another instance may have initialized the same unique lock concurrently.
      if (error?.code !== 11000) throw error;
    }
  }

  async function transact(operation) {
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        // FIRST database operation. A real write makes concurrent transactions
        // conflict before their snapshot reads, preventing aggregate write skew.
        const lock = await lockCollection.updateOne({ _id: lockId }, { $inc: { version: 1 } }, { session });
        if (lock.matchedCount !== 1) {
          fail(503, 'PAYMENT_LEDGER_NOT_INITIALIZED');
        }
        return operation(session);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) {
      if (error?.code === 20 || error?.codeName === 'IllegalOperation'
          || /Transaction numbers are only allowed|does not support (?:retryable writes|sessions)|transactions are not supported/i.test(error?.message || '')) {
        throw new LedgerError(503, {
          error: 'PAYMENT_TRANSACTIONS_UNAVAILABLE',
          message: 'Payment writes require a MongoDB replica set or sharded cluster with transaction support.',
        }, { cause: error });
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function totals(match, session) {
    const rows = await entries.aggregate([
      { $match: match },
      { $group: { _id: '$type', amount: { $sum: '$amount' } } },
    ], { session }).toArray();
    return Object.fromEntries(rows.map(row => [row._id, Number(row.amount || 0)]));
  }

  async function activeAccount(accountId, session) {
    const account = await accounts.findOne({ _id: accountId, active: { $ne: false } }, { session });
    if (!account) fail(404, 'PAYMENT_ACCOUNT_NOT_FOUND');
    return account;
  }

  function entry(type, values) {
    return { _id: `payment_${randomUUID()}`, type, ...values, createdAt: new Date() };
  }

  async function replayEntry(type, values, idempotencyKey, session) {
    if (!idempotencyKey) return null;
    const existing = await entries.findOne({ type, createdBy: values.createdBy, idempotencyKey }, { session });
    if (!existing) return null;
    if (existing.amount !== values.amount || existing.date !== values.date
        || (existing.note || '') !== (values.note || '')
        || (type === 'allocation' && existing.accountId !== values.accountId)) {
      fail(409, 'IDEMPOTENCY_CONFLICT');
    }
    return existing;
  }

  return {
    initialize,

    addDeposit({ amount, date, note, createdBy, idempotencyKey }) {
      return transact(async session => {
        const values = { amount, date, note, createdBy };
        const existing = await replayEntry('deposit', values, idempotencyKey, session);
        if (existing) return existing;
        const row = entry('deposit', { ...values, ...(idempotencyKey ? { idempotencyKey } : {}) });
        await entries.insertOne(row, { session });
        return row;
      });
    },

    deleteDeposit(id) {
      return transact(async session => {
        const deposit = await entries.findOne({ _id: id, type: 'deposit' }, { session });
        if (!deposit) fail(404, 'PAYMENT_NOT_FOUND');
        const byType = await totals({ type: { $in: ['deposit', 'allocation'] } }, session);
        if ((byType.deposit || 0) - deposit.amount < (byType.allocation || 0)) {
          fail(409, 'DEPOSIT_ALREADY_ALLOCATED');
        }
        await entries.deleteOne({ _id: id, type: 'deposit' }, { session });
        return { ok: true };
      });
    },

    addAllocation({ accountId, amount, date, note, createdBy, idempotencyKey }) {
      return transact(async session => {
        const values = { accountId, amount, date, note, createdBy };
        const existing = await replayEntry('allocation', values, idempotencyKey, session);
        if (existing) return existing;
        await activeAccount(accountId, session);
        const byType = await totals({ type: { $in: ['deposit', 'allocation'] } }, session);
        const available = (byType.deposit || 0) - (byType.allocation || 0);
        if (amount > available) fail(409, 'INSUFFICIENT_BROTHER_BALANCE', { available });
        const row = entry('allocation', { ...values, ...(idempotencyKey ? { idempotencyKey } : {}) });
        await entries.insertOne(row, { session });
        return row;
      });
    },

    deleteAllocation(id) {
      return transact(async session => {
        const allocation = await entries.findOne({ _id: id, type: 'allocation' }, { session });
        if (!allocation) fail(404, 'ALLOCATION_NOT_FOUND');
        const byType = await totals({ accountId: allocation.accountId, type: { $in: ['allocation', 'lesson'] } }, session);
        const allocatedAfterDelete = (byType.allocation || 0) - allocation.amount;
        const spent = byType.lesson || 0;
        if (allocatedAfterDelete < spent) fail(409, 'ALLOCATION_ALREADY_SPENT', { spent, allocatedAfterDelete });
        await entries.deleteOne({ _id: id, type: 'allocation' }, { session });
        return { ok: true };
      });
    },

    async addLesson({ accountId, date, createdBy }) {
      try {
        return await transact(async session => {
          const account = await activeAccount(accountId, session);
          if (await entries.findOne({ type: 'lesson', accountId, date }, { session })) {
            fail(409, 'LESSON_ALREADY_MARKED');
          }
          const byType = await totals({ accountId, type: { $in: ['allocation', 'lesson'] } }, session);
          const balance = (byType.allocation || 0) - (byType.lesson || 0);
          if (account.lessonPrice > balance) fail(409, 'INSUFFICIENT_TEACHER_BALANCE', { balance });
          const row = entry('lesson', { accountId, amount: account.lessonPrice, date, createdBy });
          await entries.insertOne(row, { session });
          return row;
        });
      } catch (error) {
        if (error?.code === 11000) fail(409, 'LESSON_ALREADY_MARKED');
        throw error;
      }
    },

    deleteLesson({ accountId, date }) {
      return transact(async session => {
        const result = await entries.deleteOne({ type: 'lesson', accountId, date }, { session });
        if (!result.deletedCount) fail(404, 'LESSON_PAYMENT_NOT_FOUND');
        return { ok: true };
      });
    },

    async addAccount({ teacherId, subject, subjectKey, lessonPrice }) {
      try {
        return await transact(async session => {
          const teacher = await users.findOne({ _id: teacherId, role: 'teacher', active: true }, { session });
          if (!teacher) fail(400, 'INVALID_TEACHER');
          const existing = await accounts.findOne({ teacherId, subjectKey, active: true }, { session });
          if (existing) fail(409, 'PAYMENT_ACCOUNT_EXISTS', { accountId: existing._id });
          const now = new Date();
          const row = { _id: `payacc_${randomUUID()}`, teacherId, subject, subjectKey, lessonPrice,
            active: true, createdAt: now, updatedAt: now };
          await accounts.insertOne(row, { session });
          return row;
        });
      } catch (error) {
        if (error?.code === 11000) fail(409, 'PAYMENT_ACCOUNT_EXISTS');
        throw error;
      }
    },

    async updateAccount(id, changes) {
      try {
        return await transact(async session => {
          const current = await accounts.findOne({ _id: id }, { session });
          if (!current) fail(404, 'PAYMENT_ACCOUNT_NOT_FOUND');
          if (changes.subjectKey !== undefined) {
            const duplicate = await accounts.findOne({ _id: { $ne: id }, teacherId: current.teacherId,
              subjectKey: changes.subjectKey, active: true }, { session });
            if (duplicate) fail(409, 'PAYMENT_ACCOUNT_EXISTS');
          }
          // Only metadata normalized by the route belongs in an account update.
          const update = { updatedAt: new Date() };
          for (const key of ['subject', 'subjectKey', 'lessonPrice', 'active']) {
            if (changes[key] !== undefined) update[key] = changes[key];
          }
          await accounts.updateOne({ _id: id }, { $set: update }, { session });
          return accounts.findOne({ _id: id }, { session });
        });
      } catch (error) {
        if (error?.code === 11000) fail(409, 'PAYMENT_ACCOUNT_EXISTS');
        throw error;
      }
    },

    importBackup({ accounts: importedAccounts, entries: importedEntries }) {
      return transact(async session => {
        const existingAccounts = await accounts.countDocuments({}, { session });
        const existingEntries = await entries.countDocuments({}, { session });
        if (existingAccounts || existingEntries) {
          fail(409, 'TARGET_LEDGER_NOT_EMPTY', { existingAccounts, existingEntries });
        }
        const teacherIds = [...new Set(importedAccounts.map(account => account.teacherId))];
        if (teacherIds.length) {
          const teachers = await users.find({ _id: { $in: teacherIds }, role: 'teacher' }, { session }).toArray();
          const missing = teacherIds.filter(id => !teachers.some(teacher => teacher._id === id));
          if (missing.length) fail(409, 'TEACHER_MAPPING_MISSING', { missing });
        }
        if (importedAccounts.length) await accounts.insertMany(importedAccounts, { ordered: true, session });
        if (importedEntries.length) await entries.insertMany(importedEntries, { ordered: true, session });
        return { imported: true, accounts: importedAccounts.length, entries: importedEntries.length };
      });
    },
  };
}

module.exports = { createPaymentLedger, LedgerError };
