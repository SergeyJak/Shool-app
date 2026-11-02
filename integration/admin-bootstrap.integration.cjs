const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { MongoClient } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { ensureAdminBootstrap } = require("../lib/admin-bootstrap");
const { verifyPassword, createSessionToken } = require("../lib/auth");
const { resolveIdentityFromCookies } = require("../lib/session-context");
const runFile = promisify(execFile);
let mongo;
let client;
let db;
const env = {
  BOOTSTRAP_ADMIN_USERNAME: "test-owner",
  BOOTSTRAP_ADMIN_PASSWORD: "disposable-integration-initial-password",
};
const legacy = {
  _id: "admin", username: "admin", role: "admin", active: true,
  passwordSalt: "56b0ac2f387a5b8e573a5b2cda979970",
  passwordHash: "0e1aa2aa06e8184dc7a68de87875959300aefe29192c617fe9dafe59dd1a7d6fb3c63488d9bf74e140de555aee9a278784d1dd6d463730d8a566c9d2585e3f4d",
};

before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("bootstrap_integration");
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});

async function identity(users, token) {
  return resolveIdentityFromCookies({
    cookieHeader: `school_session=${token}`, secret: "integration-secret",
    findActiveUserById: id => users.findOne({ _id: id, active: { $ne: false } }),
  });
}

test("real Mongo bootstrap requires explicit credentials, creates one admin and preserves it on restart", async () => {
  const users = db.collection("fresh_users");
  await assert.rejects(() => ensureAdminBootstrap(users, {}), /BOOTSTRAP_ADMIN/);
  assert.equal(await users.countDocuments(), 0);
  await ensureAdminBootstrap(users, env);
  const admin = await users.findOne({ _id: "test-owner" });
  assert.equal(admin.role, "admin");
  assert.equal(await verifyPassword(env.BOOTSTRAP_ADMIN_PASSWORD, admin.passwordSalt, admin.passwordHash), true);
  assert.equal(await users.countDocuments(), 1);
  await ensureAdminBootstrap(users, { ...env, BOOTSTRAP_ADMIN_PASSWORD: "different-password-must-not-reset-the-real-admin" });
  assert.deepEqual(await users.findOne({ _id: admin._id }), admin);
});

test("real Mongo legacy migration rotates only the recognized shared admin and invalidates its old cookie", async () => {
  const users = db.collection("legacy_users");
  const student = { _id: "alisa", role: "student", active: true, lessonIds: ["real-lesson"] };
  await users.insertMany([legacy, student]);
  const oldToken = createSessionToken(legacy, "integration-secret");
  assert.equal((await identity(users, oldToken)).role, "admin");
  await assert.rejects(() => ensureAdminBootstrap(users, {}), /legacy/);
  await ensureAdminBootstrap(users, { ...env, BOOTSTRAP_ADMIN_USERNAME: "admin" });
  assert.equal(await identity(users, oldToken), null);
  const admin = await users.findOne({ _id: "admin" });
  assert.equal(admin.sessionVersion, 1);
  assert.equal(await verifyPassword(env.BOOTSTRAP_ADMIN_PASSWORD, admin.passwordSalt, admin.passwordHash), true);
  assert.equal((await identity(users, createSessionToken(admin, "integration-secret")))._id, "admin");
  assert.deepEqual(await users.findOne({ _id: "alisa" }), student);
});

test("environment-only CLI rotates a namespaced admin in its chosen database and revokes old sessions", async () => {
  const users = db.collection("integration_users");
  await ensureAdminBootstrap(users, env);
  const oldAdmin = await users.findOne({ _id: "test-owner" });
  const token = createSessionToken(oldAdmin, "integration-secret");
  const password = "disposable-cli-replacement-password-982617";
  const output = await runFile(process.execPath, ["scripts/admin-password.cjs"], {
    cwd: require("node:path").join(__dirname, ".."),
    env: {
      ...process.env,
      MONGODB_URI: mongo.getUri(), MONGODB_DB_NAME: "bootstrap_integration", DATA_NAMESPACE: "integration",
      ADMIN_ROTATE_USERNAME: " TEST-OWNER ", ADMIN_ROTATE_PASSWORD: password,
    },
    timeout: 15000,
  });
  assert.match(output.stdout, /rotated/);
  assert.equal(output.stderr, "");
  assert.equal((output.stdout + output.stderr).includes(password), false);
  assert.equal((output.stdout + output.stderr).includes(mongo.getUri()), false);
  const admin = await users.findOne({ _id: "test-owner" });
  assert.equal(admin.sessionVersion, 1);
  assert.equal(await identity(users, token), null);
  assert.equal(await verifyPassword(password, admin.passwordSalt, admin.passwordHash), true);
  assert.equal(await verifyPassword(env.BOOTSTRAP_ADMIN_PASSWORD, admin.passwordSalt, admin.passwordHash), false);
});
