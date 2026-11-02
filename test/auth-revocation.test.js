const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  createSessionToken, createRegistrationToken, createGuestToken,
  parseSessionToken, parseRegistrationToken, parseGuestToken, parseCookies,
} = require("../lib/auth");
const { resolveIdentityFromCookies } = require("../lib/session-context");
const secret = "auth-revocation-test-secret";
function signed(payload) {
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60, ...payload })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function resolve(token, user, options = {}) {
  return resolveIdentityFromCookies({
    cookieHeader: `school_session=${token}`, secret,
    findActiveUserById: async () => user, ...options,
  });
}

test("password reset revokes existing teacher and admin sessions but accepts newly issued sessions", async () => {
  for (const role of ["teacher", "admin"]) {
    const user = { _id: role, role, username: role, active: true };
    const oldToken = createSessionToken(user, secret);
    user.sessionVersion = 1;
    assert.equal(await resolve(oldToken, user, { preferAccount: true }), null);
    assert.equal((await resolve(createSessionToken(user, secret), user))._id, role);
  }
});

test("legacy versionless account sessions work until the account version changes", async () => {
  const user = { _id: "teacher", role: "teacher", active: true };
  const oldToken = signed({ uid: "teacher", role: "teacher" });
  assert.equal((await resolve(oldToken, user))._id, "teacher");
  user.sessionVersion = 1;
  assert.equal(await resolve(oldToken, user), null);
});

test("registration cookies cannot authenticate as account sessions", async () => {
  const user = { _id: "student", role: "student", active: true };
  const token = createRegistrationToken(user, secret);
  assert.equal(parseSessionToken(token, secret), null);
  assert.equal(await resolve(token, user), null);
  assert.equal(parseSessionToken(signed({ uid: "student", registration: true }), secret), null);
});

test("token parsers reject mismatched or contradictory purposes", () => {
  const user = { _id: "teacher", role: "teacher" };
  assert.equal(parseRegistrationToken(createSessionToken(user, secret), secret), null);
  assert.equal(parseGuestToken(createRegistrationToken(user, secret), secret), null);
  assert.equal(parseSessionToken(createGuestToken({ lessonId: "lesson", guestId: "guest" }, secret), secret), null);
  assert.equal(parseSessionToken(signed({ uid: "teacher", purpose: "guest" }), secret), null);
  assert.equal(parseGuestToken(signed({ guest: true, guestId: "g", lessonId: "l", purpose: "session" }), secret), null);
});

test("malformed cookie encodings cannot crash authentication or hide subsequent valid cookies", () => {
  const cookies = parseCookies("bad=%E0%A4%A; %broken=value; school_session=valid; __proto__=pollution");
  assert.equal(cookies.school_session, "valid");
  assert.equal(Object.hasOwn(cookies, "bad"), false);
  assert.equal(Object.hasOwn(cookies, "__proto__"), false);
});

test("signed tokens reject suffixes, nonnumeric expiry and invalid session versions", () => {
  const token = createSessionToken({ _id: "u" }, secret);
  assert.equal(parseSessionToken(`${token}.extra`, secret), null);
  assert.equal(parseSessionToken(signed({ uid: "u", exp: "Infinity" }), secret), null);
  for (const sv of [-1, 0.5, "1", null]) {
    assert.equal(parseSessionToken(signed({ uid: "u", sv }), secret), null);
  }
});

test("revoked admin session falls back to a valid lesson guest without restoring admin privileges", async () => {
  const user = { _id: "admin", role: "admin", active: true, sessionVersion: 2 };
  const token = createSessionToken({ ...user, sessionVersion: 1 }, secret);
  const guest = createGuestToken({ lessonId: "lesson", guestId: "guest" }, secret);
  const identity = await resolve(token, user, {
    cookieHeader: `school_session=${token}; school_guest=${guest}`, preferredLessonId: "lesson",
  });
  assert.equal(identity.guest, true);
});
