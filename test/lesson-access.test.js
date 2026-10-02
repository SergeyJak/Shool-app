const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessLesson } = require("../lib/lesson-access");

const active = {
  _id: "lesson_a",
  active: true,
  ownerId: "teacher1",
  teacherIds: ["teacher1", "teacher2"],
  studentIds: ["student1"],
};
const archived = { ...active, active: false };

test("guest can access only its own active lesson", () => {
  const guest = { _id: "guest:g1", role: "student", guest: true, lessonId: "lesson_a" };
  assert.equal(canAccessLesson(guest, active), true);
  assert.equal(canAccessLesson(guest, { ...active, _id: "lesson_b" }), false);
  assert.equal(canAccessLesson(guest, archived), false);
});

test("teacher owner and assigned teacher can access active and archived lessons", () => {
  const owner = { _id: "teacher1", role: "teacher" };
  const assigned = { _id: "teacher2", role: "teacher" };

  assert.equal(canAccessLesson(owner, active), true);
  assert.equal(canAccessLesson(owner, archived), true);
  assert.equal(canAccessLesson(assigned, active), true);
  assert.equal(canAccessLesson(assigned, archived), true);
});

test("unrelated teacher cannot access another teacher lesson", () => {
  const other = { _id: "teacher9", role: "teacher" };
  assert.equal(canAccessLesson(other, active), false);
  assert.equal(canAccessLesson(other, archived), false);
});

test("legacy student membership can access active but not archived lesson", () => {
  const student = { _id: "student1", role: "student" };
  assert.equal(canAccessLesson(student, active), true);
  assert.equal(canAccessLesson(student, archived), false);
});

test("unassigned student cannot access lesson", () => {
  const student = { _id: "student9", role: "student" };
  assert.equal(canAccessLesson(student, active), false);
});

test("admin can access active and archived lessons", () => {
  const admin = { _id: "admin", role: "admin" };
  assert.equal(canAccessLesson(admin, active), true);
  assert.equal(canAccessLesson(admin, archived), true);
});

test("missing identity or lesson always denies access", () => {
  assert.equal(canAccessLesson(null, active), false);
  assert.equal(canAccessLesson({ _id: "teacher1", role: "teacher" }, null), false);
});
