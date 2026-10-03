const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUsername,
  hashPassword,
  verifyPassword,
  createSessionToken,
  createGuestToken,
  parseSessionToken,
  parseCookies,
  sessionCookie,
} = require("../lib/auth");
const { resolveIdentityFromCookies } = require("../lib/session-context");

test("normalizes usernames case-insensitively", () => {
  assert.equal(normalizeUsername("  Darya "), "darya");
});

test("hashes and verifies passwords without storing plaintext", async () => {
  const credentials = await hashPassword("secret");
  assert.notEqual(credentials.hash, "secret");
  assert.equal(await verifyPassword("secret", credentials.salt, credentials.hash), true);
  assert.equal(await verifyPassword("wrong", credentials.salt, credentials.hash), false);
});

test("signed session tokens reject tampering and expiration", () => {
  const secret = "test-secret";
  const user = { _id: "darya", username: "darya", role: "teacher" };
  const token = createSessionToken(user, secret, 60);
  const parsed = parseSessionToken(token, secret);
  assert.equal(parsed.uid, "darya");
  assert.equal(parsed.role, "teacher");
  assert.equal(parseSessionToken(token + "x", secret), null);
  const expired = createSessionToken(user, secret, -1);
  assert.equal(parseSessionToken(expired, secret), null);
});

test("session cookie is HttpOnly and SameSite strict", () => {
  const value = sessionCookie("abc", { secure: true });
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Strict/);
  assert.match(value, /Secure/);
  assert.equal(parseCookies("a=1; school_session=abc").school_session, "abc");
});


test("authenticated session wins over a matching guest lesson cookie when account is explicitly preferred", async () => {
  const secret = "test-secret";
  const teacher = {
    _id: "teacher1",
    username: "teacher1",
    displayName: "Teacher",
    role: "teacher",
    active: true,
  };
  const session = createSessionToken(teacher, secret, 60);
  const guest = createGuestToken({
    lessonId: "lesson_a",
    name: "Guest student",
    guestId: "guest1",
  }, secret, 60);

  const identity = await resolveIdentityFromCookies({
    cookieHeader: `school_session=${encodeURIComponent(session)}; school_guest=${encodeURIComponent(guest)}`,
    preferredLessonId: "lesson_a",
    preferAccount: true,
    secret,
    findActiveUserById: async (id) => id === teacher._id ? teacher : null,
  });

  assert.equal(identity._id, "teacher1");
  assert.equal(identity.role, "teacher");
  assert.equal(identity.guest, undefined);
});

test("matching guest lesson cookie is still used when no account session exists", async () => {
  const secret = "test-secret";
  const guest = createGuestToken({
    lessonId: "lesson_a",
    name: "Guest student",
    guestId: "guest1",
  }, secret, 60);

  const identity = await resolveIdentityFromCookies({
    cookieHeader: `school_guest=${encodeURIComponent(guest)}`,
    preferredLessonId: "lesson_a",
    secret,
    findActiveUserById: async () => null,
  });

  assert.equal(identity.role, "student");
  assert.equal(identity.guest, true);
  assert.equal(identity.lessonId, "lesson_a");
});
