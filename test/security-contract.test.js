const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("public auth surfaces are rate limited and return Retry-After", () => {
  const server = read("server.js");

  assert.match(server, /loginIpLimiter = createMemoryRateLimiter/);
  assert.match(server, /loginCredentialLimiter = createMemoryRateLimiter/);
  assert.match(server, /registrationIpLimiter = createMemoryRateLimiter/);
  assert.match(server, /joinIpLimiter = createMemoryRateLimiter/);
  assert.match(server, /joinInviteLimiter = createMemoryRateLimiter/);
  assert.match(server, /res\.setHeader\("Retry-After"/);
  assert.match(server, /status\(429\)\.json\(\{[\s\S]*TOO_MANY_ATTEMPTS/);
});

test("login rate limit counts failures, resets on success, and hides missing-user timing", () => {
  const server = read("server.js");
  const loginStart = server.indexOf('app.post("/api/auth/login"');
  const loginEnd = server.indexOf('app.post("/api/auth/logout"', loginStart);
  const login = server.slice(loginStart, loginEnd);

  assert.match(login, /loginIpLimiter\.status\(ipKey\)/);
  assert.match(login, /loginCredentialLimiter\.status\(credentialKey\)/);
  assert.match(login, /user\?\.passwordSalt \|\| DUMMY_PASSWORD_SALT/);
  assert.match(login, /user\?\.passwordHash \|\| DUMMY_PASSWORD_HASH/);
  assert.match(login, /if \(!valid\)[\s\S]*loginIpLimiter\.hit\(ipKey\)/);
  assert.match(login, /if \(!valid\)[\s\S]*loginCredentialLimiter\.hit\(credentialKey\)/);
  assert.match(login, /loginIpLimiter\.reset\(ipKey\)/);
  assert.match(login, /loginCredentialLimiter\.reset\(credentialKey\)/);

  assert.ok(
    login.indexOf("loginIpLimiter.hit(ipKey)") > login.indexOf("if (!valid)"),
    "failed-attempt counters must be incremented only after credential verification fails"
  );
  assert.ok(
    login.indexOf("loginIpLimiter.reset(ipKey)") > login.indexOf("if (!valid)"),
    "successful login reset must happen after invalid credentials return"
  );
});

test("registration limiter runs only after credentials pass local validation", () => {
  const server = read("server.js");
  const start = server.indexOf('app.post("/api/auth/register"');
  const end = server.indexOf('app.get("/api/auth/registration"', start);
  const route = server.slice(start, end);

  assert.ok(route.indexOf("validateRegistrationCredentials") >= 0);
  assert.ok(route.indexOf("registrationIpLimiter.consume") > route.indexOf("validateRegistrationCredentials"));
  assert.ok(route.indexOf("registrationIpLimiter.consume") < route.indexOf("users.findOne"));
});

test("join limiter runs after basic request validation and before invite lookup", () => {
  const server = read("server.js");
  const start = server.indexOf('app.post("/api/join/:token"');
  const end = server.indexOf('app.get("/api/admin/registrations"', start);
  const route = server.slice(start, end);

  assert.ok(route.indexOf('error: "INVALID_JOIN"') >= 0);
  assert.ok(route.indexOf("joinIpLimiter.consume") > route.indexOf('error: "INVALID_JOIN"'));
  assert.ok(route.indexOf("joinInviteLimiter.consume") > route.indexOf("joinIpLimiter.consume"));
  assert.ok(route.indexOf("joinInviteLimiter.consume") < route.indexOf("lessons.findOne"));
});

test("security headers and proxy-aware client IP are enabled", () => {
  const server = read("server.js");

  assert.match(server, /app\.disable\("x-powered-by"\)/);
  assert.match(server, /app\.set\("trust proxy", 1\)/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /X-Frame-Options/);
  assert.match(server, /Referrer-Policy/);
  assert.match(server, /Permissions-Policy/);
  assert.match(server, /function clientIp\(req\)/);
});

test("UI explains rate-limit responses on login registration and invite join", () => {
  const login = read("public/login.js");
  const register = read("public/register.js");
  const join = read("public/join.js");

  assert.match(login, /TOO_MANY_ATTEMPTS/);
  assert.match(register, /TOO_MANY_ATTEMPTS/);
  assert.match(join, /TOO_MANY_ATTEMPTS/);
  assert.match(login, /Слишком много попыток входа/);
  assert.match(register, /Слишком много регистраций/);
  assert.match(join, /Слишком много попыток подключения/);
});
