const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SESSION_COOKIE,
  GUEST_COOKIE,
  createSessionToken,
  createGuestToken,
} = require("../lib/auth");
const { resolveIdentityFromCookies } = require("../lib/session-context");
const { canAccessLesson } = require("../lib/lesson-access");

const SECRET = "session-flow-secret";
const teacher = {
  _id: "teacher1",
  username: "teacher1",
  displayName: "Teacher",
  role: "teacher",
  active: true,
};
const lessonA = {
  _id: "lesson_a",
  active: true,
  ownerId: "teacher1",
  teacherIds: ["teacher1"],
  studentIds: [],
};
const lessonB = {
  _id: "lesson_b",
  active: true,
  ownerId: "teacher2",
  teacherIds: ["teacher2"],
  studentIds: [],
};

function header(session, guest) {
  return [
    session && `${SESSION_COOKIE}=${encodeURIComponent(session)}`,
    guest && `${GUEST_COOKIE}=${encodeURIComponent(guest)}`,
  ].filter(Boolean).join("; ");
}

const findTeacher = async (id) => id === teacher._id ? teacher : null;

test("regression: logged-in teacher browser can open child invite and read that lesson", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: lessonA._id, name: "Alisa", guestId: "g1" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: header(session, guest),
    preferredLessonId: lessonA._id,
    secret: SECRET,
    findActiveUserById: findTeacher,
  });

  assert.equal(identity.guest, true);
  assert.equal(canAccessLesson(identity, lessonA), true);
});

test("regression: invited guest cannot use its cookie to enter another lesson", async () => {
  const guest = createGuestToken(
    { lessonId: lessonA._id, name: "Alisa", guestId: "g1" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: header(null, guest),
    preferredLessonId: lessonB._id,
    secret: SECRET,
    findActiveUserById: async () => null,
  });

  assert.equal(identity.guest, true);
  assert.equal(canAccessLesson(identity, lessonB), false);
});

test("regression: archived invited lesson is denied to child even with valid guest cookie", async () => {
  const guest = createGuestToken(
    { lessonId: lessonA._id, name: "Alisa", guestId: "g1" },
    SECRET,
    60
  );
  const archived = { ...lessonA, active: false };

  const identity = await resolveIdentityFromCookies({
    cookieHeader: header(null, guest),
    preferredLessonId: lessonA._id,
    secret: SECRET,
    findActiveUserById: async () => null,
  });

  assert.equal(canAccessLesson(identity, archived), false);
});

test("teacher session still accesses its own lesson when guest cookie belongs elsewhere", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "lesson_other", name: "Alisa", guestId: "g1" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: header(session, guest),
    preferredLessonId: lessonA._id,
    secret: SECRET,
    findActiveUserById: findTeacher,
  });

  assert.equal(identity.role, "teacher");
  assert.equal(identity.guest, undefined);
  assert.equal(canAccessLesson(identity, lessonA), true);
});

test("teacher cannot gain access to another teacher lesson through unrelated guest cookie", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: lessonA._id, name: "Alisa", guestId: "g1" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: header(session, guest),
    preferredLessonId: lessonB._id,
    secret: SECRET,
    findActiveUserById: findTeacher,
  });

  assert.equal(identity.role, "teacher");
  assert.equal(canAccessLesson(identity, lessonB), false);
});
