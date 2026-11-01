const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentSubmitter } = require('../public/payment-requests');

test('duplicate form submissions share one request; an unknown result reuses its key', async () => {
  const calls = []; let finish, ids = 0;
  const submit = createPaymentSubmitter(async (_url, options) => {
    calls.push(options); return new Promise(resolve => { finish = resolve; });
  }, () => 'request-' + (++ids));
  const form = {}, body = { amount: 100, date: '2026-11-01' };
  const a = submit(form, '/deposits', body), b = submit(form, '/deposits', body);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); finish({ ok: true }); await Promise.all([a, b]);

  let fail = true; const keys = [];
  const retry = createPaymentSubmitter(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    if (fail) throw new Error('response lost');
    return { ok: true };
  }, () => 'request-' + (++ids));
  await assert.rejects(retry(form, '/deposits', body), /response lost/);
  fail = false; await retry(form, '/deposits', body);
  assert.equal(keys[0], keys[1]);
  await retry(form, '/deposits', body); assert.notEqual(keys[1], keys[2], 'a new deliberate operation gets a new key');
});

test('edited amounts or definitive rejection do not reuse an earlier operation key', async () => {
  let id = 0; const keys = [];
  const submit = createPaymentSubmitter(async (_url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    const error = new Error('insufficient funds'); error.status = 409; throw error;
  }, () => 'key-' + (++id));
  const form = {};
  await assert.rejects(submit(form, '/allocations', { amount: 80 }));
  await assert.rejects(submit(form, '/allocations', { amount: 80 }));
  await assert.rejects(submit(form, '/allocations', { amount: 70 }));
  assert.equal(new Set(keys).size, 3);
});
