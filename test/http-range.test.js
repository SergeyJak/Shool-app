const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSingleByteRange } = require("../lib/http-range");

test("parses explicit byte ranges", () => {
  assert.deepEqual(parseSingleByteRange("bytes=0-99", 1000), {
    start: 0,
    end: 99,
    length: 100,
  });
});

test("clamps byte-range end to file size", () => {
  assert.deepEqual(parseSingleByteRange("bytes=900-5000", 1000), {
    start: 900,
    end: 999,
    length: 100,
  });
});

test("supports open-ended byte ranges", () => {
  assert.deepEqual(parseSingleByteRange("bytes=250-", 1000), {
    start: 250,
    end: 999,
    length: 750,
  });
});

test("supports suffix byte ranges", () => {
  assert.deepEqual(parseSingleByteRange("bytes=-128", 1000), {
    start: 872,
    end: 999,
    length: 128,
  });
});

test("rejects invalid and multi-range requests", () => {
  assert.deepEqual(parseSingleByteRange("items=0-10", 1000), { invalid: true });
  assert.deepEqual(parseSingleByteRange("bytes=0-10,20-30", 1000), { invalid: true });
  assert.deepEqual(parseSingleByteRange("bytes=20-10", 1000), { invalid: true });
});

test("marks ranges beyond EOF as unsatisfiable", () => {
  assert.deepEqual(parseSingleByteRange("bytes=1000-", 1000), {
    unsatisfiable: true,
  });
});
