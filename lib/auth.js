const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "school_session";
const GUEST_COOKIE = "school_guest";
const REGISTRATION_COOKIE = "school_registration";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GUEST_TTL_SECONDS = 60 * 60 * 12;
const REGISTRATION_TTL_SECONDS = 60 * 60 * 24;

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(String(password), salt, 64);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}

async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const derived = await scrypt(String(password), salt, 64);
  const actual = Buffer.from(derived);
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function encodeSignedPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function decodeSignedPayload(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSessionToken(user, secret, ttlSeconds = SESSION_TTL_SECONDS) {
  return encodeSignedPayload({
    purpose: "session",
    uid: String(user._id),
    username: user.username,
    role: user.role,
    sv: user.sessionVersion ?? 0,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }, secret);
}

function parseSessionToken(token, secret) {
  const payload = decodeSignedPayload(token, secret);
  if (!payload || typeof payload.uid !== "string" || !payload.uid ||
      (payload.purpose !== undefined && payload.purpose !== "session") ||
      payload.registration !== undefined || payload.guest !== undefined ||
      (payload.sv !== undefined && (!Number.isSafeInteger(payload.sv) || payload.sv < 0))) return null;
  return { ...payload, sv: payload.sv ?? 0 };
}

function sessionMatchesUser(session, user) {
  if (!session || !user || user.active === false || session.uid !== String(user._id)) return false;
  const version = user.sessionVersion ?? 0;
  return Number.isSafeInteger(version) && version >= 0 && (session.sv ?? 0) === version;
}

function createGuestToken({ lessonId, name, guestId }, secret, ttlSeconds = GUEST_TTL_SECONDS) {
  return encodeSignedPayload({
    purpose: "guest",
    guest: true,
    lessonId: String(lessonId),
    name: String(name || "").trim().slice(0, 80),
    guestId: String(guestId || crypto.randomUUID()),
    role: "student",
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }, secret);
}

function parseGuestToken(token, secret) {
  const payload = decodeSignedPayload(token, secret);
  if (payload?.guest !== true || typeof payload.lessonId !== "string" || !payload.lessonId ||
      typeof payload.guestId !== "string" || !payload.guestId || payload.uid !== undefined ||
      payload.registration !== undefined || (payload.purpose !== undefined && payload.purpose !== "guest")) return null;
  return payload;
}

function createRegistrationToken(user, secret, ttlSeconds = REGISTRATION_TTL_SECONDS) {
  return encodeSignedPayload({
    purpose: "registration",
    registration: true,
    uid: String(user._id),
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }, secret);
}

function parseRegistrationToken(token, secret) {
  const payload = decodeSignedPayload(token, secret);
  return payload?.registration === true && typeof payload.uid === "string" && payload.uid &&
    payload.guest === undefined && (payload.purpose === undefined || payload.purpose === "registration") ? payload : null;
}

function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index < 0) return cookies;
      try {
        const key = decodeURIComponent(part.slice(0, index));
        const value = decodeURIComponent(part.slice(index + 1));
        if (key && key !== "__proto__" && key !== "constructor" && key !== "prototype") cookies[key] = value;
      } catch {
        // Ignore this malformed pair while preserving other valid credentials.
      }
      return cookies;
    }, {});
}

function cookie(name, token, { secure = true, maxAge, sameSite = "Strict" } = {}) {
  const normalizedSameSite = ["Strict", "Lax", "None"].includes(sameSite) ? sameSite : "Strict";
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${normalizedSameSite}`,
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function sessionCookie(token, { secure = true, maxAge = SESSION_TTL_SECONDS } = {}) {
  // Lax sends the account cookie when opening the site from WhatsApp, email or bookmarks.
  // Strict dropped it on cross-site entry, redirecting a logged-in user to login.
  return cookie(SESSION_COOKIE, token, { secure, maxAge, sameSite: "Lax" });
}

function guestCookie(token, { secure = true, maxAge = GUEST_TTL_SECONDS } = {}) {
  // Permanent invite links are commonly opened from WhatsApp/Telegram/email.
  // Lax keeps CSRF protection while allowing the cookie on top-level navigation.
  return cookie(GUEST_COOKIE, token, { secure, maxAge, sameSite: "Lax" });
}

function registrationCookie(token, { secure = true, maxAge = REGISTRATION_TTL_SECONDS } = {}) {
  return cookie(REGISTRATION_COOKIE, token, { secure, maxAge });
}

function clearSessionCookie({ secure = true } = {}) {
  return sessionCookie("", { secure, maxAge: 0 });
}

function clearGuestCookie({ secure = true } = {}) {
  return guestCookie("", { secure, maxAge: 0 });
}

function clearRegistrationCookie({ secure = true } = {}) {
  return registrationCookie("", { secure, maxAge: 0 });
}

module.exports = {
  SESSION_COOKIE,
  GUEST_COOKIE,
  REGISTRATION_COOKIE,
  SESSION_TTL_SECONDS,
  GUEST_TTL_SECONDS,
  REGISTRATION_TTL_SECONDS,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  createSessionToken,
  parseSessionToken,
  sessionMatchesUser,
  createGuestToken,
  parseGuestToken,
  createRegistrationToken,
  parseRegistrationToken,
  parseCookies,
  sessionCookie,
  guestCookie,
  registrationCookie,
  clearSessionCookie,
  clearGuestCookie,
  clearRegistrationCookie,
};
