const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SESSION_COOKIE,
  GUEST_COOKIE,
  createSessionToken,
  createGuestToken,
  parseSessionToken,
  parseGuestToken,
  parseCookies,
  sessionCookie,
  guestCookie,
} = require("../lib/auth");
const { resolveIdentityFromCookies } = require("../lib/session-context");

const SECRET = "regression-test-secret";
const teacher = {
  _id: "teacher1",
  username: "teacher1",
  displayName: "Teacher One",
  role: "teacher",
  active: true,
};

const admin = {
  _id: "admin",
  username: "admin",
  displayName: "Admin",
  role: "admin",
  active: true,
};

function cookieHeader(sessionToken, guestToken) {
  return [
    sessionToken && `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
    guestToken && `${GUEST_COOKIE}=${encodeURIComponent(guestToken)}`,
  ].filter(Boolean).join("; ");
}

function userFinder(users = [teacher], calls = []) {
  return async (id) => {
    calls.push(id);
    return users.find((user) => user._id === id && user.active !== false) || null;
  };
}

test("signed session and guest tokens round-trip and reject tampering", () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );

  assert.equal(parseSessionToken(session, SECRET).uid, "teacher1");
  assert.equal(parseGuestToken(guest, SECRET).lessonId, "lesson_a");
  assert.equal(parseGuestToken(guest, SECRET).name, "Alisa");

  assert.equal(parseSessionToken(session + "x", SECRET), null);
  assert.equal(parseGuestToken(guest.slice(0, -1) + "x", SECRET), null);
  assert.equal(parseSessionToken(session, "wrong-secret"), null);
  assert.equal(parseGuestToken(guest, "wrong-secret"), null);
});

test("expired session and guest tokens are rejected", () => {
  const session = createSessionToken(teacher, SECRET, -1);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    -1
  );

  assert.equal(parseSessionToken(session, SECRET), null);
  assert.equal(parseGuestToken(guest, SECRET), null);
});

test("cookies are HttpOnly, root-scoped, secure, with strict account and lax guest policy", () => {
  const session = sessionCookie("token");
  const guest = guestCookie("token");

  for (const value of [session, guest]) {
    assert.match(value, /Path=\//);
    assert.match(value, /HttpOnly/);
    assert.match(value, /Secure/);
    assert.match(value, /Max-Age=/);
  }
  assert.match(session, /SameSite=Strict/);
  assert.match(guest, /SameSite=Lax/);
});

test("cookie parser handles encoded signed tokens", () => {
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alice Smith", guestId: "guest-a" },
    SECRET,
    60
  );
  const parsed = parseCookies(cookieHeader(null, guest));
  assert.equal(parsed[GUEST_COOKIE], guest);
});

test("matching guest invite wins over an existing teacher session for lesson-scoped request", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );
  const calls = [];

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, guest),
    preferredLessonId: "lesson_a",
    secret: SECRET,
    findActiveUserById: userFinder([teacher], calls),
  });

  assert.equal(identity.guest, true);
  assert.equal(identity.lessonId, "lesson_a");
  assert.equal(identity.displayName, "Alisa");
  assert.deepEqual(calls, [], "matching guest must be selected before DB session lookup");
});

test("teacher session wins when guest invite belongs to a different lesson", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, guest),
    preferredLessonId: "lesson_b",
    secret: SECRET,
    findActiveUserById: userFinder(),
  });

  assert.equal(identity._id, "teacher1");
  assert.equal(identity.role, "teacher");
  assert.equal(identity.guest, undefined);
});

test("guest-only browser resolves guest identity", async () => {
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(null, guest),
    preferredLessonId: "lesson_a",
    secret: SECRET,
    findActiveUserById: userFinder([]),
  });

  assert.equal(identity._id, "guest:guest-a");
  assert.equal(identity.role, "student");
  assert.equal(identity.lessonId, "lesson_a");
});

test("invalid guest cookie never overrides a valid teacher session", async () => {
  const session = createSessionToken(teacher, SECRET, 60);

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, "garbage.token"),
    preferredLessonId: "lesson_a",
    secret: SECRET,
    findActiveUserById: userFinder(),
  });

  assert.equal(identity._id, "teacher1");
});

test("expired guest cookie never overrides a valid teacher session", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    -1
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, guest),
    preferredLessonId: "lesson_a",
    secret: SECRET,
    findActiveUserById: userFinder(),
  });

  assert.equal(identity._id, "teacher1");
});

test("expired teacher session falls back to valid guest", async () => {
  const session = createSessionToken(teacher, SECRET, -1);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, guest),
    preferredLessonId: null,
    secret: SECRET,
    findActiveUserById: userFinder(),
  });

  assert.equal(identity.guest, true);
  assert.equal(identity.lessonId, "lesson_a");
});

test("inactive/missing teacher session falls back to valid guest", async () => {
  const session = createSessionToken(teacher, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "lesson_a", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, guest),
    preferredLessonId: null,
    secret: SECRET,
    findActiveUserById: userFinder([]),
  });

  assert.equal(identity.guest, true);
});

test("no valid cookies resolves no identity", async () => {
  const identity = await resolveIdentityFromCookies({
    cookieHeader: "school_session=nope; school_guest=nope",
    preferredLessonId: "lesson_a",
    secret: SECRET,
    findActiveUserById: userFinder([]),
  });

  assert.equal(identity, null);
});


test("admin session always wins over matching guest room cookie", async () => {
  const session = createSessionToken(admin, SECRET, 60);
  const guest = createGuestToken(
    { lessonId: "connection_room", name: "Alisa", guestId: "guest-a" },
    SECRET,
    60
  );

  const identity = await resolveIdentityFromCookies({
    cookieHeader: cookieHeader(session, guest),
    preferredLessonId: "connection_room",
    secret: SECRET,
    findActiveUserById: userFinder([admin]),
  });

  assert.equal(identity._id, "admin");
  assert.equal(identity.role, "admin");
  assert.equal(identity.guest, undefined);
});


test("guest cookie is Lax so permanent links work from messaging apps", () => {
  const { guestCookie, sessionCookie } = require("../lib/auth");
  const guest = guestCookie("token", { secure: true, maxAge: 3600 });
  const session = sessionCookie("token", { secure: true, maxAge: 3600 });

  assert.match(guest, /SameSite=Lax/);
  assert.match(guest, /HttpOnly/);
  assert.match(guest, /Secure/);
  assert.match(session, /SameSite=Strict/);
});
