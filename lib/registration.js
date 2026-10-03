const { normalizeUsername } = require("./auth");

function normalizeManagedUsername(value) {
  const username = normalizeUsername(value);
  return /^[\p{L}\p{N}._-]{3,50}$/u.test(username) ? username : null;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

function normalizeBirthDate(value, now = new Date()) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== raw) return null;
  if (date > now) return null;
  return raw;
}

function validateRegistrationCredentials({ username, password, passwordConfirm }) {
  const normalizedUsername = normalizeManagedUsername(username);
  if (!normalizedUsername) return { ok: false, error: "INVALID_USERNAME" };
  const value = String(password || "");
  if (value.length < 8 || value.length > 128) return { ok: false, error: "INVALID_PASSWORD" };
  if (value !== String(passwordConfirm || "")) return { ok: false, error: "PASSWORD_MISMATCH" };
  return { ok: true, username: normalizedUsername, password: value };
}

function normalizeRegistrationProfile(input = {}, now = new Date()) {
  const firstName = String(input.firstName || "").trim().slice(0, 80);
  const lastName = String(input.lastName || "").trim().slice(0, 80);
  const email = normalizeEmail(input.email);
  const birthDate = normalizeBirthDate(input.birthDate, now);
  const phone = String(input.phone || "").trim().slice(0, 40);
  const subjects = String(input.subjects || "").trim().slice(0, 240);
  const bio = String(input.bio || "").trim().slice(0, 1000);

  if (!firstName) return { ok: false, error: "FIRST_NAME_REQUIRED" };
  if (!email) return { ok: false, error: "INVALID_EMAIL" };
  if (!birthDate) return { ok: false, error: "INVALID_BIRTH_DATE" };

  return {
    ok: true,
    profile: {
      firstName,
      lastName,
      displayName: [firstName, lastName].filter(Boolean).join(" "),
      email,
      birthDate,
      phone,
      subjects,
      bio,
    },
  };
}

module.exports = {
  normalizeManagedUsername,
  normalizeEmail,
  normalizeBirthDate,
  validateRegistrationCredentials,
  normalizeRegistrationProfile,
};
