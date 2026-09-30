const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUsername,
  hashPassword,
  verifyPassword,
  createSessionToken,
  parseSessionToken,
  parseCookies,
  sessionCookie,
} = require("../lib/auth");

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
