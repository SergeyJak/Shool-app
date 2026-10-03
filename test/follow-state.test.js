const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeFollowPage,
  normalizeControllerKey,
  createFollowState,
} = require("../lib/follow-state");

function fakeClock() {
  const tasks = [];
  return {
    schedule(fn, ms) {
      const task = { fn, ms, cancelled: false };
      tasks.push(task);
      return task;
    },
    cancel(task) {
      if (task) task.cancelled = true;
    },
    runAll() {
      for (const task of tasks.splice(0)) {
        if (!task.cancelled) task.fn();
      }
    },
    pending() {
      return tasks.filter((task) => !task.cancelled).length;
    },
  };
}

test("follow page accepts only positive integer pages", () => {
  assert.equal(normalizeFollowPage(5), 5);
  assert.equal(normalizeFollowPage("12"), 12);
  assert.equal(normalizeFollowPage(0), null);
  assert.equal(normalizeFollowPage(-1), null);
  assert.equal(normalizeFollowPage(2.5), null);
  assert.equal(normalizeFollowPage("abc"), null);
});

test("controller key accepts stable per-tab identifiers only", () => {
  assert.equal(normalizeControllerKey("teacher1:tab_abc123"), "teacher1:tab_abc123");
  assert.equal(normalizeControllerKey("x"), null);
  assert.equal(normalizeControllerKey("bad key with spaces"), null);
});

test("follow starts with one controller and only that controller can move pages", () => {
  const follow = createFollowState();
  const owner = "teacher1:tab_one";
  const other = "teacher1:tab_two";

  assert.deepEqual(follow.snapshot(owner), { enabled: false, page: 1, controlling: false });
  assert.equal(follow.move(2, owner), false);

  assert.equal(follow.start(7, owner), true);
  assert.deepEqual(follow.snapshot(owner), { enabled: true, page: 7, controlling: true });
  assert.deepEqual(follow.snapshot(other), { enabled: true, page: 7, controlling: false });

  assert.equal(follow.move(8, other), false);
  assert.equal(follow.snapshot(owner).page, 7);

  assert.equal(follow.move(8, owner), true);
  assert.equal(follow.snapshot(owner).page, 8);
});

test("second teacher tab can explicitly take over and old tab immediately loses control", () => {
  const follow = createFollowState();
  const first = "teacher1:tab_first";
  const second = "teacher1:tab_second";

  assert.equal(follow.start(3, first), true);
  assert.equal(follow.start(5, second), true);

  assert.deepEqual(follow.snapshot(first), { enabled: true, page: 5, controlling: false });
  assert.deepEqual(follow.snapshot(second), { enabled: true, page: 5, controlling: true });

  assert.equal(follow.move(6, first), false);
  assert.equal(follow.stop(first), false);
  assert.equal(follow.move(6, second), true);
  assert.equal(follow.stop(second), true);
  assert.deepEqual(follow.snapshot(second), { enabled: false, page: 6, controlling: false });
});

test("brief controller disconnect keeps follow alive and reconnect cancels expiration", () => {
  const clock = fakeClock();
  const expired = [];
  const follow = createFollowState({
    disconnectGraceMs: 8000,
    schedule: clock.schedule,
    cancel: clock.cancel,
    onExpired: (state) => expired.push(state),
  });
  const owner = "teacher1:tab_one";

  follow.start(12, owner);
  assert.equal(follow.disconnect(owner), true);
  assert.equal(clock.pending(), 1);
  assert.deepEqual(follow.snapshot(owner), { enabled: true, page: 12, controlling: true });

  assert.equal(follow.reconnect(owner), true);
  assert.equal(clock.pending(), 0);

  clock.runAll();
  assert.deepEqual(expired, []);
  assert.deepEqual(follow.snapshot(owner), { enabled: true, page: 12, controlling: true });
});

test("controller that does not reconnect expires follow after grace period", () => {
  const clock = fakeClock();
  const expired = [];
  const follow = createFollowState({
    disconnectGraceMs: 8000,
    schedule: clock.schedule,
    cancel: clock.cancel,
    onExpired: (state) => expired.push(state),
  });
  const owner = "teacher1:tab_one";

  follow.start(9, owner);
  assert.equal(follow.disconnect(owner), true);
  assert.equal(clock.pending(), 1);

  clock.runAll();

  assert.deepEqual(follow.snapshot(owner), { enabled: false, page: 9, controlling: false });
  assert.deepEqual(expired, [{ enabled: false, page: 9, controllerKey: null }]);
});

test("disconnecting a non-controller tab cannot disturb active follow", () => {
  const clock = fakeClock();
  const follow = createFollowState({
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  const owner = "teacher1:tab_owner";
  const other = "teacher1:tab_other";

  follow.start(4, owner);
  assert.equal(follow.disconnect(other), false);
  assert.equal(clock.pending(), 0);
  assert.deepEqual(follow.snapshot(owner), { enabled: true, page: 4, controlling: true });
});

test("takeover during old controller grace period cancels old expiration", () => {
  const clock = fakeClock();
  const expired = [];
  const follow = createFollowState({
    schedule: clock.schedule,
    cancel: clock.cancel,
    onExpired: (state) => expired.push(state),
  });
  const first = "teacher1:tab_first";
  const second = "teacher1:tab_second";

  follow.start(2, first);
  follow.disconnect(first);
  assert.equal(clock.pending(), 1);

  follow.start(7, second);
  assert.equal(clock.pending(), 0);
  clock.runAll();

  assert.deepEqual(expired, []);
  assert.deepEqual(follow.snapshot(second), { enabled: true, page: 7, controlling: true });
});

test("invalid page or controller cannot acquire follow control", () => {
  const follow = createFollowState();
  assert.equal(follow.start(0, "teacher1:tab_one"), false);
  assert.equal(follow.start(1, "x"), false);
  assert.deepEqual(follow.snapshot(), { enabled: false, page: 1, controlling: false });
});
