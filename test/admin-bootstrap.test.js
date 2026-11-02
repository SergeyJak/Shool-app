const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { hashPassword, verifyPassword, createSessionToken, parseSessionToken, sessionMatchesUser } = require("../lib/auth");
const legacy = {
  _id: "admin", username: "admin", role: "admin", active: true,
  passwordSalt: "56b0ac2f387a5b8e573a5b2cda979970",
  passwordHash: "0e1aa2aa06e8184dc7a68de87875959300aefe29192c617fe9dafe59dd1a7d6fb3c63488d9bf74e140de555aee9a278784d1dd6d463730d8a566c9d2585e3f4d",
};
const config = { BOOTSTRAP_ADMIN_USERNAME: "owner", BOOTSTRAP_ADMIN_PASSWORD: "test-only-unique-password-829461" };
// The database is the external boundary: keep credential hashing, account policy,
// compare-and-set filters and version revocation real while storing documents locally.
function collection(initial = []) {
  const documents = structuredClone(initial);
  function matches(doc, query) {
    return Object.entries(query).every(([key, value]) => {
      if (value && typeof value === "object" && "$ne" in value) return doc[key] !== value.$ne;
      return doc[key] === value;
    });
  }
  return {
    documents,
    async findOne(query) { return structuredClone(documents.find(doc => matches(doc, query)) || null); },
    async insertOne(doc) {
      assert.equal(documents.some(row => row._id === doc._id), false, "must not overwrite an existing account");
      documents.push(structuredClone(doc));
      return { insertedId: doc._id };
    },
    async updateOne(query, update) {
      const doc = documents.find(row => matches(row, query));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set);
      for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
      return { matchedCount: 1 };
    },
  };
}
function api() { return require("../lib/admin-bootstrap"); }

test("fresh database refuses to start without explicit bootstrap credentials", async () => {
  const users = collection();
  await assert.rejects(() => api().ensureAdminBootstrap(users, {}), /BOOTSTRAP_ADMIN_USERNAME.*BOOTSTRAP_ADMIN_PASSWORD/);
  assert.equal(users.documents.length, 0);
});

test("bootstrap creates only one explicitly configured administrator with freshly salted credentials", async () => {
  const users = collection();
  await api().ensureAdminBootstrap(users, config);
  assert.equal(users.documents.length, 1);
  const user = users.documents[0];
  assert.equal(user._id, "owner");
  assert.equal(user.role, "admin");
  assert.equal(user.active, true);
  assert.equal(user.sessionVersion, 0);
  assert.equal(await verifyPassword(config.BOOTSTRAP_ADMIN_PASSWORD, user.passwordSalt, user.passwordHash), true);
  assert.equal(JSON.stringify(user).includes(config.BOOTSTRAP_ADMIN_PASSWORD), false);
  await api().ensureAdminBootstrap(users, {});
  assert.equal(users.documents.length, 1);
});

test("bootstrap requires a strong complete credential pair before creating users", async () => {
  for (const env of [
    { BOOTSTRAP_ADMIN_USERNAME: "owner" },
    { BOOTSTRAP_ADMIN_PASSWORD: config.BOOTSTRAP_ADMIN_PASSWORD },
    { ...config, BOOTSTRAP_ADMIN_PASSWORD: "short" },
  ]) {
    const users = collection();
    await assert.rejects(() => api().ensureAdminBootstrap(users, env), /BOOTSTRAP_ADMIN|16/);
    assert.equal(users.documents.length, 0);
  }
});

test("bootstrap preserves real administrators even when configured password changes", async () => {
  const credentials = await hashPassword("existing-private-test-password");
  const existing = { ...legacy, _id: "owner", username: "owner", passwordSalt: credentials.salt, passwordHash: credentials.hash, sessionVersion: 3 };
  const users = collection([existing]);
  await api().ensureAdminBootstrap(users, config);
  assert.deepEqual(users.documents, [existing]);
});

test("bootstrap refuses account name collisions without elevating or changing the account", async () => {
  const student = { _id: "owner", username: "owner", role: "student", active: true };
  const users = collection([student]);
  await assert.rejects(() => api().ensureAdminBootstrap(users, config), /already|exists|collision/i);
  assert.deepEqual(users.documents, [student]);
});

test("legacy fixed administrator blocks startup until an explicit rotation is configured", async () => {
  const users = collection([legacy]);
  await assert.rejects(() => api().ensureAdminBootstrap(users, {}), /legacy.*admin-password|admin-password.*legacy/i);
  await assert.rejects(() => api().ensureAdminBootstrap(users, config), /admin-password|legacy/i);
  assert.deepEqual(users.documents, [legacy]);
});

test("explicit matching bootstrap rotates only the recognized legacy admin and revokes its sessions", async () => {
  const realUser = { _id: "alisa", role: "student", active: true, lessonIds: ["lesson"] };
  const users = collection([legacy, realUser]);
  const old = parseSessionToken(createSessionToken(legacy, "secret"), "secret");
  await api().ensureAdminBootstrap(users, { ...config, BOOTSTRAP_ADMIN_USERNAME: "admin" });
  const rotated = users.documents[0];
  assert.equal(await verifyPassword(config.BOOTSTRAP_ADMIN_PASSWORD, rotated.passwordSalt, rotated.passwordHash), true);
  assert.equal(rotated.sessionVersion, 1);
  assert.equal(sessionMatchesUser(old, rotated), false);
  assert.deepEqual(users.documents[1], realUser);
  const stable = structuredClone(users.documents);
  await api().ensureAdminBootstrap(users, { ...config, BOOTSTRAP_ADMIN_USERNAME: "admin" });
  assert.deepEqual(users.documents, stable, "restart must not rotate an already secured account");
});

test("a secure second admin does not hide an active legacy fixed admin", async () => {
  const users = collection([{ _id: "owner", role: "admin", active: true }, legacy]);
  await assert.rejects(() => api().ensureAdminBootstrap(users, {}), /legacy|admin-password/i);
});

test("explicit password rotation updates an administrator without changing other users", async () => {
  const users = collection([{ ...legacy, sessionVersion: 4 }, { _id: "student", role: "student" }]);
  await api().rotateAdminPassword(users, { username: " ADMIN ", password: config.BOOTSTRAP_ADMIN_PASSWORD });
  assert.equal(users.documents[0].sessionVersion, 5);
  assert.equal(await verifyPassword(config.BOOTSTRAP_ADMIN_PASSWORD, users.documents[0].passwordSalt, users.documents[0].passwordHash), true);
  assert.deepEqual(users.documents[1], { _id: "student", role: "student" });
  await assert.rejects(() => api().rotateAdminPassword(users, { username: "student", password: config.BOOTSTRAP_ADMIN_PASSWORD }), /administrator/i);
});

test("admin CLI rejects command arguments and missing credentials before connecting without echoing secrets", () => {
  const secret = "must-never-appear-in-command-output";
  const result = spawnSync(process.execPath, ["scripts/admin-password.cjs", secret], {
    cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /environment|ADMIN_ROTATE/);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
  const missing = spawnSync(process.execPath, ["scripts/admin-password.cjs"], {
    cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ADMIN_ROTATE/);
});

test("rotation uses compare-and-set so a concurrent password change cannot be overwritten", async () => {
  const users = collection([legacy]);
  const lookup = users.findOne.bind(users);
  users.findOne = async query => {
    const snapshot = await lookup(query);
    users.documents[0].passwordHash = "concurrently-updated-hash";
    return snapshot;
  };
  await assert.rejects(() => api().rotateAdminPassword(users, { username: "admin", password: config.BOOTSTRAP_ADMIN_PASSWORD }), /concurrently/);
  assert.equal(users.documents[0].passwordHash, "concurrently-updated-hash");
  assert.equal(users.documents[0].sessionVersion, undefined);
});

test("CLI database failures never expose supplied credentials or the connection URI", () => {
  const password = "disposable-never-log-this-password";
  const uri = "invalid-mongodb-uri-containing-private-placeholder";
  const result = spawnSync(process.execPath, ["scripts/admin-password.cjs"], {
    cwd: process.cwd(), encoding: "utf8", env: {
      PATH: process.env.PATH, ADMIN_ROTATE_USERNAME: "admin", ADMIN_ROTATE_PASSWORD: password, MONGODB_URI: uri,
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rotation failed/);
  assert.equal((result.stdout + result.stderr).includes(password), false);
  assert.equal((result.stdout + result.stderr).includes(uri), false);
});
