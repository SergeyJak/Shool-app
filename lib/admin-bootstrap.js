const { normalizeUsername, hashPassword } = require("./auth");

// Fingerprint only: used to identify the old shared credential for migration.
// This credential is never used to create or authenticate a new account.
const LEGACY_ADMIN = {
  _id: "admin",
  role: "admin",
  passwordSalt: "56b0ac2f387a5b8e573a5b2cda979970",
  passwordHash: "0e1aa2aa06e8184dc7a68de87875959300aefe29192c617fe9dafe59dd1a7d6fb3c63488d9bf74e140de555aee9a278784d1dd6d463730d8a566c9d2585e3f4d",
};

class AdminConfigurationError extends Error {}

function validateAdminCredentials(username, password) {
  const id = normalizeUsername(username);
  if (!id || typeof password !== "string" || password.length < 16 || password.length > 1024 || !password.trim()) {
    throw new AdminConfigurationError("Provide an administrator username and a unique password of 16–1024 characters through the documented environment variables.");
  }
  return id;
}

async function writePassword(users, user, password) {
  const { salt, hash } = await hashPassword(password);
  const result = await users.updateOne(
    { _id: user._id, role: "admin", passwordSalt: user.passwordSalt, passwordHash: user.passwordHash },
    { $set: { passwordSalt: salt, passwordHash: hash, updatedAt: new Date() }, $inc: { sessionVersion: 1 } }
  );
  if (result.matchedCount !== 1) {
    throw new AdminConfigurationError("Administrator changed concurrently; inspect the account and retry the password rotation.");
  }
  return { status: "rotated", userId: user._id };
}

async function rotateAdminPassword(users, { username, password }) {
  const id = validateAdminCredentials(username, password);
  const user = await users.findOne({ _id: id, role: "admin" });
  if (!user) throw new AdminConfigurationError("The requested administrator account does not exist; no account was changed.");
  return writePassword(users, user, password);
}

async function ensureAdminBootstrap(users, env = process.env) {
  const legacy = await users.findOne({ ...LEGACY_ADMIN, active: { $ne: false } });
  const username = normalizeUsername(env.BOOTSTRAP_ADMIN_USERNAME);
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (legacy) {
    if (username !== legacy._id || !password) {
      throw new AdminConfigurationError("Active legacy administrator credentials must be rotated before startup: run node scripts/admin-password.cjs with ADMIN_ROTATE_USERNAME and ADMIN_ROTATE_PASSWORD, or set BOOTSTRAP_ADMIN_USERNAME=admin and BOOTSTRAP_ADMIN_PASSWORD to a unique password.");
    }
    validateAdminCredentials(username, password);
    return writePassword(users, legacy, password);
  }

  // Bootstrap is creation-only for installations whose administrators are secure.
  // An environment variable change must never reset a real account's password.
  const administrator = await users.findOne({ role: "admin", active: { $ne: false } });
  if (administrator) return { status: "preserved", userId: administrator._id };
  if (!username || !password) {
    throw new AdminConfigurationError("No active administrator exists. Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD to create the initial administrator.");
  }
  validateAdminCredentials(username, password);
  if (await users.findOne({ _id: username })) {
    throw new AdminConfigurationError("BOOTSTRAP_ADMIN_USERNAME already exists; choose an unused username or explicitly rotate an existing administrator using scripts/admin-password.cjs.");
  }
  const { salt, hash } = await hashPassword(password);
  await users.insertOne({
    _id: username,
    username,
    displayName: String(env.BOOTSTRAP_ADMIN_DISPLAY_NAME || username).trim().slice(0, 80),
    role: "admin",
    active: true,
    approvalStatus: "approved",
    profileComplete: true,
    lessonIds: [],
    passwordSalt: salt,
    passwordHash: hash,
    sessionVersion: 0,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { status: "created", userId: username };
}

module.exports = { ensureAdminBootstrap, rotateAdminPassword, AdminConfigurationError };
