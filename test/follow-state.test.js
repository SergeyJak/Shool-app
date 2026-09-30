const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFollowPage, createFollowState } = require("../lib/follow-state");

test("follow page accepts only positive integer pages", () => {
  assert.equal(normalizeFollowPage(5), 5);
  assert.equal(normalizeFollowPage("12"), 12);
  assert.equal(normalizeFollowPage(0), null);
  assert.equal(normalizeFollowPage(-1), null);
  assert.equal(normalizeFollowPage(2.5), null);
  assert.equal(normalizeFollowPage("abc"), null);
});

test("teacher follow mode starts, moves and stops explicitly", () => {
  const follow = createFollowState();
  assert.deepEqual(follow.snapshot(), { enabled: false, page: 1 });

  assert.equal(follow.move(2), false);
  assert.equal(follow.start(7), true);
  assert.deepEqual(follow.snapshot(), { enabled: true, page: 7 });

  assert.equal(follow.move(8), true);
  assert.deepEqual(follow.snapshot(), { enabled: true, page: 8 });

  follow.stop();
  assert.deepEqual(follow.snapshot(), { enabled: false, page: 8 });
  assert.equal(follow.move(9), false);
});
