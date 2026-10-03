const test = require("node:test");
const assert = require("node:assert/strict");
const { createMemoryRateLimiter } = require("../lib/rate-limit");

function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => { current += ms; },
  };
}

test("rate limiter allows exactly max hits and blocks the next request", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 3, now: clock.now });

  assert.equal(limiter.consume("ip").allowed, true);
  assert.equal(limiter.consume("ip").allowed, true);
  const third = limiter.consume("ip");
  assert.equal(third.allowed, true);
  assert.equal(third.count, 3);
  assert.equal(third.remaining, 0);

  const blocked = limiter.consume("ip");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.count, 3);
  assert.equal(blocked.retryAfterMs, 60_000);
});

test("blocked key becomes available after the window expires", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 10_000, max: 1, now: clock.now });

  assert.equal(limiter.consume("user").allowed, true);
  assert.equal(limiter.status("user").allowed, false);

  clock.advance(9_999);
  assert.equal(limiter.status("user").allowed, false);
  assert.equal(limiter.status("user").retryAfterMs, 1);

  clock.advance(1);
  const reset = limiter.status("user");
  assert.equal(reset.allowed, true);
  assert.equal(reset.count, 0);
  assert.equal(reset.remaining, 1);
});

test("successful authentication can explicitly reset a credential bucket", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });

  limiter.hit("ip:user");
  limiter.hit("ip:user");
  assert.equal(limiter.status("ip:user").allowed, false);

  limiter.reset("ip:user");
  const reset = limiter.status("ip:user");
  assert.equal(reset.allowed, true);
  assert.equal(reset.count, 0);
});

test("different keys have independent limits", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 1, now: clock.now });

  limiter.consume("ip:a");
  assert.equal(limiter.status("ip:a").allowed, false);
  assert.equal(limiter.status("ip:b").allowed, true);
});

test("status inspection does not increment attempts", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });

  assert.equal(limiter.status("ip").count, 0);
  assert.equal(limiter.status("ip").count, 0);
  assert.equal(limiter.hit("ip").count, 1);
  assert.equal(limiter.status("ip").count, 1);
});

test("expired buckets are cleaned up and do not grow forever", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 1_000, max: 1, now: clock.now, maxKeys: 10 });

  for (let i = 0; i < 30; i += 1) limiter.consume(`key-${i}`);
  assert.ok(limiter.size() <= 10);

  clock.advance(1_001);
  assert.equal(limiter.size(), 0);
});

test("keys are normalized and capped", () => {
  const clock = fakeClock();
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 1, now: clock.now });

  assert.equal(limiter.consume("  same-key  ").allowed, true);
  assert.equal(limiter.status("same-key").allowed, false);
});
