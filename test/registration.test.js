const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeManagedUsername,
  normalizeEmail,
  normalizeBirthDate,
  validateRegistrationCredentials,
  normalizeRegistrationProfile,
} = require("../lib/registration");
const {
  createRegistrationToken,
  parseRegistrationToken,
  registrationCookie,
  REGISTRATION_COOKIE,
} = require("../lib/auth");

test("unicode teacher login and eight-digit password are valid", () => {
  const result = validateRegistrationCredentials({
    username: "Анна",
    password: "12345678",
    passwordConfirm: "12345678",
  });
  assert.equal(result.ok, true);
  assert.equal(result.username, "анна");
  assert.equal(result.password, "12345678");
});

test("registration accepts latin logins and permitted separators", () => {
  for (const username of ["Darya", "sergey.85", "teacher_test", "anna-petrova"]) {
    assert.ok(normalizeManagedUsername(username));
  }
});

test("registration rejects spaces, too short logins, and unsupported punctuation", () => {
  for (const username of ["ab", "anna petrova", "anna@school"]) {
    assert.equal(normalizeManagedUsername(username), null);
  }
});

test("password confirmation mismatch is reported separately", () => {
  assert.deepEqual(
    validateRegistrationCredentials({
      username: "Анна",
      password: "12345678",
      passwordConfirm: "12345679",
    }),
    { ok: false, error: "PASSWORD_MISMATCH" }
  );
});

test("password length boundaries are enforced", () => {
  assert.equal(validateRegistrationCredentials({
    username: "Анна", password: "1234567", passwordConfirm: "1234567",
  }).error, "INVALID_PASSWORD");

  const max = "a".repeat(128);
  assert.equal(validateRegistrationCredentials({
    username: "Анна", password: max, passwordConfirm: max,
  }).ok, true);

  const tooLong = "a".repeat(129);
  assert.equal(validateRegistrationCredentials({
    username: "Анна", password: tooLong, passwordConfirm: tooLong,
  }).error, "INVALID_PASSWORD");
});

test("email normalization is lowercase and rejects malformed values", () => {
  assert.equal(normalizeEmail(" Anna@Example.COM "), "anna@example.com");
  assert.equal(normalizeEmail("anna"), null);
  assert.equal(normalizeEmail("a @example.com"), null);
});

test("birth date must be a real non-future ISO date", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  assert.equal(normalizeBirthDate("1985-01-31", now), "1985-01-31");
  assert.equal(normalizeBirthDate("2026-02-30", now), null);
  assert.equal(normalizeBirthDate("2027-01-01", now), null);
  assert.equal(normalizeBirthDate("31.01.1985", now), null);
});

test("profile requires name, email and birth date while optional fields may be empty", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  assert.equal(normalizeRegistrationProfile({ email: "a@b.com", birthDate: "1990-01-01" }, now).error, "FIRST_NAME_REQUIRED");
  assert.equal(normalizeRegistrationProfile({ firstName: "Anna", birthDate: "1990-01-01" }, now).error, "INVALID_EMAIL");
  assert.equal(normalizeRegistrationProfile({ firstName: "Anna", email: "a@b.com" }, now).error, "INVALID_BIRTH_DATE");

  const result = normalizeRegistrationProfile({
    firstName: " Anna ",
    lastName: " Petrova ",
    email: " ANNA@example.com ",
    birthDate: "1990-01-01",
  }, now);
  assert.equal(result.ok, true);
  assert.equal(result.profile.displayName, "Anna Petrova");
  assert.equal(result.profile.email, "anna@example.com");
  assert.equal(result.profile.phone, "");
  assert.equal(result.profile.subjects, "");
  assert.equal(result.profile.bio, "");
});

test("registration continuation token round-trips and cookie is protected", () => {
  const secret = "registration-test-secret";
  const token = createRegistrationToken({ _id: "анна", username: "анна" }, secret, 60);
  const payload = parseRegistrationToken(token, secret);
  assert.equal(payload.uid, "анна");
  assert.equal(payload.registration, true);

  const cookie = registrationCookie(token);
  assert.match(cookie, new RegExp(`^${REGISTRATION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
});
