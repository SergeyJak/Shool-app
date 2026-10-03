function normalizeKey(value) {
  const key = String(value || "").trim();
  return key ? key.slice(0, 300) : "unknown";
}

function createMemoryRateLimiter({
  windowMs,
  max,
  now = () => Date.now(),
  maxKeys = 5000,
} = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("windowMs must be positive");
  if (!Number.isInteger(max) || max <= 0) throw new Error("max must be positive");
  const buckets = new Map();
  let operations = 0;

  function cleanup() {
    const current = now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key);
    }
    if (buckets.size <= maxKeys) return;
    const overflow = buckets.size - maxKeys;
    const oldest = [...buckets.entries()]
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
      .slice(0, overflow);
    for (const [key] of oldest) buckets.delete(key);
  }

  function bucketFor(rawKey) {
    const key = normalizeKey(rawKey);
    const current = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs, lastSeenAt: current };
      buckets.set(key, bucket);
    }
    bucket.lastSeenAt = current;
    operations += 1;
    if (operations % 100 === 0) cleanup();
    return { key, bucket, current };
  }

  function status(rawKey) {
    const { bucket, current } = bucketFor(rawKey);
    const blocked = bucket.count >= max;
    return {
      allowed: !blocked,
      count: bucket.count,
      remaining: Math.max(0, max - bucket.count),
      retryAfterMs: blocked ? Math.max(1, bucket.resetAt - current) : 0,
      resetAt: bucket.resetAt,
    };
  }

  function hit(rawKey) {
    const { bucket, current } = bucketFor(rawKey);
    bucket.count += 1;
    const blocked = bucket.count > max;
    return {
      allowed: !blocked,
      count: bucket.count,
      remaining: Math.max(0, max - bucket.count),
      retryAfterMs: blocked ? Math.max(1, bucket.resetAt - current) : 0,
      resetAt: bucket.resetAt,
    };
  }

  function consume(rawKey) {
    const before = status(rawKey);
    if (!before.allowed) return before;
    return hit(rawKey);
  }

  function reset(rawKey) {
    buckets.delete(normalizeKey(rawKey));
  }

  function size() {
    cleanup();
    return buckets.size;
  }

  return { status, hit, consume, reset, size };
}

module.exports = { createMemoryRateLimiter };
