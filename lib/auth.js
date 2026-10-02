const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "school_session";
const GUEST_COOKIE = "school_guest";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GUEST_TTL_SECONDS = 60 * 60 * 12;

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
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSessionToken(user, secret, ttlSeconds = SESSION_TTL_SECONDS) {
  return encodeSignedPayload({
    uid: String(user._id),
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }, secret);
}

function parseSessionToken(token, secret) {
  const payload = decodeSignedPayload(token, secret);
  return payload?.uid ? payload : null;
}

function createGuestToken({ lessonId, name, guestId }, secret, ttlSeconds = GUEST_TTL_SECONDS) {
  return encodeSignedPayload({
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
  if (!payload?.guest || !payload.lessonId || !payload.guestId) return null;
  return payload;
}

function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index < 0) return cookies;
      const key = decodeURIComponent(part.slice(0, index));
      const value = decodeURIComponent(part.slice(index + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function cookie(name, token, { secure = true, maxAge } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function sessionCookie(token, { secure = true, maxAge = SESSION_TTL_SECONDS } = {}) {
  return cookie(SESSION_COOKIE, token, { secure, maxAge });
}

function guestCookie(token, { secure = true, maxAge = GUEST_TTL_SECONDS } = {}) {
  return cookie(GUEST_COOKIE, token, { secure, maxAge });
}

function clearSessionCookie({ secure = true } = {}) {
  return sessionCookie("", { secure, maxAge: 0 });
}

function clearGuestCookie({ secure = true } = {}) {
  return guestCookie("", { secure, maxAge: 0 });
}

module.exports = {
  SESSION_COOKIE,
  GUEST_COOKIE,
  SESSION_TTL_SECONDS,
  GUEST_TTL_SECONDS,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  createSessionToken,
  parseSessionToken,
  createGuestToken,
  parseGuestToken,
  parseCookies,
  sessionCookie,
  guestCookie,
  clearSessionCookie,
  clearGuestCookie,
};
