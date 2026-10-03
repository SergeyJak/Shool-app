require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");
const { Server } = require("socket.io");
const { optimizePdfBuffer } = require("./lib/pdf-compression");
const {
  splitStrokeByErasePath,
  isValidErasePath,
  isValidStroke,
} = require("./lib/annotation-utils");
const { createFollowState } = require("./lib/follow-state");
const { createMemoryRateLimiter } = require("./lib/rate-limit");
const { normalizeChatMessage, normalizeRtcSignal } = require("./lib/realtime-comms");
const { parseSingleByteRange } = require("./lib/http-range");
const {
  normalizeUsername,
  hashPassword,
  verifyPassword,
  createSessionToken,
  createGuestToken,
  REGISTRATION_COOKIE,
  createRegistrationToken,
  parseRegistrationToken,
  parseCookies,
  sessionCookie,
  guestCookie,
  registrationCookie,
  clearSessionCookie,
  clearGuestCookie,
  clearRegistrationCookie,
} = require("./lib/auth");
const { resolveIdentityFromCookies } = require("./lib/session-context");
const { canAccessLesson } = require("./lib/lesson-access");
const {
  normalizeManagedUsername,
  validateRegistrationCredentials,
  normalizeRegistrationProfile,
} = require("./lib/registration");

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = String(process.env.MONGODB_DB_NAME || "school_app").trim();
const DATA_NAMESPACE = String(process.env.DATA_NAMESPACE || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
const collectionName = (base) => DATA_NAMESPACE ? `${DATA_NAMESPACE}_${base}` : base;
const GRIDFS_BUCKET_NAME = collectionName("pdfs");
if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.createHash("sha256").update(`school-app:${MONGODB_URI}`).digest("hex");
const ADMIN_TELEGRAM_BOT_TOKEN = String(process.env.ADMIN_TELEGRAM_BOT_TOKEN || "").trim();
const ADMIN_TELEGRAM_CHAT_ID = String(process.env.ADMIN_TELEGRAM_CHAT_ID || "").trim();
const WEBRTC_STUN_URLS = String(
  process.env.WEBRTC_STUN_URLS ||
    "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const WEBRTC_TURN_URL = String(process.env.WEBRTC_TURN_URL || "").trim();
const WEBRTC_TURN_USERNAME = String(process.env.WEBRTC_TURN_USERNAME || "").trim();
const WEBRTC_TURN_CREDENTIAL = String(process.env.WEBRTC_TURN_CREDENTIAL || "").trim();
const CLOUDFLARE_TURN_KEY_ID = String(process.env.CLOUDFLARE_TURN_KEY_ID || "").trim();
const CLOUDFLARE_TURN_API_TOKEN = String(process.env.CLOUDFLARE_TURN_API_TOKEN || "").trim();
const CLOUDFLARE_TURN_TTL_SECONDS = Math.max(
  600,
  Math.min(86400, Number(process.env.CLOUDFLARE_TURN_TTL_SECONDS || 14400))
);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === "application/pdf");
  },
});

let db;
let bucket;
let annotations;
let settings;
let performanceLogs;
let rtcDiagnostics;
let users;
let lessons;
let materials;
let homeworkSubmissions;
let lessonMessages;
const teacherFollowByLesson = new Map();
const teacherPageByLesson = new Map();
const rtcCallsByLesson = new Map();
const rtc2CallsByLesson = new Map();
const rtcDisconnectedPeers = new Map();
let cloudflareTurnCache = null;
let cloudflareTurnFetchPromise = null;
const RTC_DISCONNECTED_PEER_TTL_MS = 60_000;
const CLOUDFLARE_TURN_CACHE_MS = 5 * 60 * 1000;

const loginIpLimiter = createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const loginCredentialLimiter = createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const registrationIpLimiter = createMemoryRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const joinIpLimiter = createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const joinInviteLimiter = createMemoryRateLimiter({ windowMs: 5 * 60 * 1000, max: 12 });

const DUMMY_PASSWORD_SALT = "school-app-invalid-login";
const DUMMY_PASSWORD_HASH = crypto
  .scryptSync("invalid-login-placeholder", DUMMY_PASSWORD_SALT, 64)
  .toString("hex");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));

function requestIsSecure(req) {
  return req.secure || String(req.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").trim().slice(0, 120);
}

function rejectRateLimited(res, result) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result?.retryAfterMs || 1000) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.setHeader("Cache-Control", "no-store");
  return res.status(429).json({
    error: "TOO_MANY_ATTEMPTS",
    retryAfterSeconds,
  });
}

async function userFromCookieHeader(cookieHeader, preferredLessonId = null, { preferAccount = false } = {}) {
  return resolveIdentityFromCookies({
    cookieHeader,
    preferredLessonId,
    preferAccount,
    secret: AUTH_SECRET,
    findActiveUserById: (id) => users.findOne({ _id: id, active: true }),
  });
}

async function attachUser(req, _res, next) {
  try {
    const preferredLessonId = normalizeLessonId(req.query?.lesson);
    const preferAccount = req.path === "/teacher" || req.path === "/teacher.html";
    req.user = await userFromCookieHeader(req.headers.cookie, preferredLessonId, { preferAccount });
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
  next();
}

function requirePageAuth(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect("/");
    if (roles.length && req.user.role !== "admin" && !roles.includes(req.user.role)) {
      return res.redirect("/cabinet");
    }
    next();
  };
}

function requireApiRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (req.user.role !== "admin" && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    next();
  };
}

function homeForRole(_role) {
  return "/cabinet";
}

function normalizeLessonId(value) {
  const lessonId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(lessonId) ? lessonId : null;
}

function normalizeInviteToken(value) {
  const token = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{24,120}$/.test(token) ? token : null;
}

function newInviteToken() {
  return crypto.randomBytes(24).toString("base64url");
}



async function registrationUserFromRequest(req) {
  const token = parseCookies(req.headers.cookie || "")[REGISTRATION_COOKIE];
  const payload = parseRegistrationToken(token, AUTH_SECRET);
  if (!payload) return null;
  return users.findOne({ _id: payload.uid, role: "teacher" });
}

async function notifyAdminRegistration(user) {
  if (!ADMIN_TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_CHAT_ID) return false;
  const text = [
    "🆕 Новая регистрация учителя",
    `Логин: ${user.username}`,
    `Имя: ${user.displayName || "—"}`,
    `Email: ${user.email || "—"}`,
    "Откройте админку → Регистрации для проверки.",
  ].join("\n");
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${ADMIN_TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_CHAT_ID, text }),
      }
    );
    if (!response.ok) {
      console.error("Telegram registration notification failed", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Telegram registration notification failed", error);
    return false;
  }
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active !== false,
    approvalStatus: user.approvalStatus || (user.active === false ? "inactive" : "approved"),
    profileComplete: user.profileComplete !== false,
    email: user.email || null,
    birthDate: user.birthDate || null,
  };
}

async function validateLessonMembers(teacherIds, studentIds) {
  const teachers = [...new Set((teacherIds || []).map(normalizeUsername).filter(Boolean))];
  const students = [...new Set((studentIds || []).map(normalizeUsername).filter(Boolean))];

  const rows = await users.find({
    _id: { $in: [...teachers, ...students] },
    active: true,
  }).toArray();
  const byId = new Map(rows.map((user) => [user._id, user]));

  if (teachers.some((id) => byId.get(id)?.role !== "teacher")) return null;
  if (students.some((id) => byId.get(id)?.role !== "student")) return null;
  return { teachers, students };
}

function lessonRoom(lessonId) {
  return `lesson:${lessonId}`;
}

function staticWebrtcIceServers() {
  const servers = [];
  if (WEBRTC_STUN_URLS.length) servers.push({ urls: WEBRTC_STUN_URLS });
  if (WEBRTC_TURN_URL) {
    const turn = { urls: WEBRTC_TURN_URL };
    if (WEBRTC_TURN_USERNAME) turn.username = WEBRTC_TURN_USERNAME;
    if (WEBRTC_TURN_CREDENTIAL) turn.credential = WEBRTC_TURN_CREDENTIAL;
    servers.push(turn);
  }
  return servers;
}

async function cloudflareTurnIceServers() {
  if (!CLOUDFLARE_TURN_KEY_ID || !CLOUDFLARE_TURN_API_TOKEN) return null;
  const now = Date.now();
  if (cloudflareTurnCache?.expiresAt > now) {
    return cloudflareTurnCache.iceServers;
  }
  if (cloudflareTurnFetchPromise) return cloudflareTurnFetchPromise;

  cloudflareTurnFetchPromise = (async () => {
    const endpoint =
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_TURN_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: CLOUDFLARE_TURN_TTL_SECONDS }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Cloudflare TURN credential request failed: ${response.status} ${body.slice(0, 200)}`
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload.iceServers)) return null;

    cloudflareTurnCache = {
      iceServers: payload.iceServers,
      expiresAt: Date.now() + CLOUDFLARE_TURN_CACHE_MS,
    };
    return cloudflareTurnCache.iceServers;
  })();

  try {
    return await cloudflareTurnFetchPromise;
  } finally {
    cloudflareTurnFetchPromise = null;
  }
}

function publicChatMessage(row) {
  return {
    id: row._id,
    lessonId: row.lessonId,
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    text: row.text,
    createdAt: row.createdAt,
  };
}

function rtcPeer(socket) {
  return {
    id: socket.id,
    role: socket.data.role,
    displayName: socket.data.user?.displayName || socket.data.user?.username || socket.data.role,
    callId: socket.data.rtcCallId || null,
  };
}

function rememberDisconnectedRtcPeer(socket) {
  const clientId = realtimeClientId(socket.handshake.auth?.clientId);
  const callId = socket.data.rtcCallId || null;
  if (!clientId || !callId) return;
  rtcDisconnectedPeers.set(socket.id, {
    clientId,
    lessonId: socket.data.lessonId,
    role: socket.data.role,
    userId: String(socket.data.user?._id || ""),
    callId,
    expiresAt: Date.now() + RTC_DISCONNECTED_PEER_TTL_MS,
  });
}

function findReplacementRtcPeer(staleTargetId, callId) {
  const stale = rtcDisconnectedPeers.get(staleTargetId);
  if (!stale) return null;
  if (stale.expiresAt < Date.now()) {
    rtcDisconnectedPeers.delete(staleTargetId);
    return null;
  }
  if (stale.callId !== callId) return null;

  for (const peer of io.sockets.sockets.values()) {
    if (
      peer.id !== staleTargetId &&
      peer.data.lessonId === stale.lessonId &&
      peer.data.role === stale.role &&
      String(peer.data.user?._id || "") === stale.userId &&
      realtimeClientId(peer.handshake.auth?.clientId) === stale.clientId
    ) {
      return peer;
    }
  }
  return null;
}

function rtc2SocketForClient(lessonId, clientId) {
  if (!clientId) return null;
  let newest = null;
  for (const peer of io.sockets.sockets.values()) {
    if (
      peer.data.lessonId !== lessonId ||
      peer.data.role === "observer" ||
      realtimeClientId(peer.handshake.auth?.clientId) !== clientId
    ) {
      continue;
    }
    if (!newest || Number(peer.data.connectedAt || 0) > Number(newest.data.connectedAt || 0)) {
      newest = peer;
    }
  }
  return newest;
}

function rtc2UniquePeersForLesson(lessonId, excludeClientId = null) {
  const peersByClientId = new Map();
  for (const peer of io.sockets.sockets.values()) {
    if (peer.data.lessonId !== lessonId || peer.data.role === "observer") continue;
    const clientId = realtimeClientId(peer.handshake.auth?.clientId);
    if (!clientId || clientId === excludeClientId) continue;
    const current = peersByClientId.get(clientId);
    if (!current || Number(peer.data.connectedAt || 0) > Number(current.data.connectedAt || 0)) {
      peersByClientId.set(clientId, peer);
    }
  }
  return [...peersByClientId.values()];
}

function rtc2SessionForLesson(lessonId) {
  const session = rtc2CallsByLesson.get(lessonId);
  if (!session) return null;
  if (Date.now() - session.updatedAt > 2 * 60 * 60 * 1000) {
    rtc2CallsByLesson.delete(lessonId);
    return null;
  }
  return session;
}

function rtc2Peer(socket) {
  return {
    clientId: realtimeClientId(socket.handshake.auth?.clientId),
    role: socket.data.role,
    displayName: socket.data.user?.displayName || socket.data.user?.username || socket.data.role,
  };
}

function normalizeRtcCallId(value) {
  const callId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,120}$/.test(callId) ? callId : null;
}

function activeRtcCall(lessonId) {
  const call = rtcCallsByLesson.get(lessonId);
  if (!call) return null;
  const caller = io.sockets.sockets.get(call.callerId);
  if (!caller || caller.data.lessonId !== lessonId) {
    rtcCallsByLesson.delete(lessonId);
    return null;
  }
  return { ...call, caller };
}

async function lessonForUser(user, lessonId) {
  if (!user || !lessonId) return null;
  const lesson = await lessons.findOne({ _id: lessonId });
  return canAccessLesson(user, lesson) ? lesson : null;
}

async function requireLessonAccess(req, res, next) {
  try {
    const lessonId = normalizeLessonId(req.query.lesson);
    if (!lessonId) return res.status(400).json({ error: "LESSON_REQUIRED" });
    const lesson = await lessonForUser(req.user, lessonId);
    if (!lesson) return res.status(403).json({ error: "LESSON_FORBIDDEN" });
    req.lessonId = lessonId;
    req.lesson = lesson;
    next();
  } catch (error) {
    next(error);
  }
}

function annotationLessonFilter(lessonId) {
  if (lessonId === "default") {
    return { $or: [{ lessonId: "default" }, { lessonId: { $exists: false } }] };
  }
  return { lessonId };
}

function followForLesson(lessonId) {
  if (!teacherFollowByLesson.has(lessonId)) {
    teacherFollowByLesson.set(
      lessonId,
      createFollowState({
        disconnectGraceMs: 8000,
        onExpired: (state) => {
          io.to(lessonRoom(lessonId)).emit("teacher:follow:state", state);
        },
      })
    );
  }
  return teacherFollowByLesson.get(lessonId);
}

function realtimeClientId(value) {
  const clientId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,120}$/.test(clientId) ? clientId : null;
}

function followControllerKey(socket) {
  if (socket.data.role !== "teacher") return null;
  const clientId = realtimeClientId(socket.handshake.auth?.clientId);
  if (!clientId) return null;
  return clientId;
}

app.use(attachUser);

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const credentials = validateRegistrationCredentials(req.body || {});
    if (!credentials.ok) return res.status(400).json({ error: credentials.error });
    const { username, password } = credentials;
    const registrationLimit = registrationIpLimiter.consume(clientIp(req));
    if (!registrationLimit.allowed) return rejectRateLimited(res, registrationLimit);

    if (await users.findOne({ _id: username })) {
      return res.status(409).json({ error: "USER_EXISTS" });
    }

    const { salt, hash } = await hashPassword(password);
    const now = new Date();
    const user = {
      _id: username,
      username,
      displayName: "",
      role: "teacher",
      active: false,
      approvalStatus: "onboarding",
      profileComplete: false,
      lessonIds: [],
      passwordSalt: salt,
      passwordHash: hash,
      schemaVersion: 3,
      createdAt: now,
      updatedAt: now,
    };
    await users.insertOne(user);

    const token = createRegistrationToken(user, AUTH_SECRET);
    res.setHeader("Set-Cookie", registrationCookie(token, { secure: requestIsSecure(req) }));
    res.status(201).json({
      ok: true,
      redirect: "/register/profile",
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/registration", async (req, res, next) => {
  try {
    const user = await registrationUserFromRequest(req);
    if (!user) return res.status(401).json({ error: "REGISTRATION_REQUIRED" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register/profile", async (req, res, next) => {
  try {
    const user = await registrationUserFromRequest(req);
    if (!user) return res.status(401).json({ error: "REGISTRATION_REQUIRED" });
    if (!["onboarding", "pending"].includes(user.approvalStatus)) {
      return res.status(409).json({ error: "REGISTRATION_CLOSED" });
    }

    const normalized = normalizeRegistrationProfile(req.body || {});
    if (!normalized.ok) return res.status(400).json({ error: normalized.error });
    const profile = normalized.profile;
    if (await users.findOne({ email: profile.email, _id: { $ne: user._id } })) {
      return res.status(409).json({ error: "EMAIL_EXISTS" });
    }

    const now = new Date();
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          ...profile,
          profileComplete: true,
          approvalStatus: "pending",
          registrationSubmittedAt: now,
          updatedAt: now,
        },
      }
    );
    const updated = await users.findOne({ _id: user._id });
    void notifyAdminRegistration(updated);

    res.setHeader("Set-Cookie", clearRegistrationCookie({ secure: requestIsSecure(req) }));
    res.json({ ok: true, redirect: "/registration-pending" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const ipKey = clientIp(req);
    const credentialKey = `${ipKey}:${username || "empty"}`;

    const ipStatus = loginIpLimiter.status(ipKey);
    if (!ipStatus.allowed) return rejectRateLimited(res, ipStatus);
    const credentialStatus = loginCredentialLimiter.status(credentialKey);
    if (!credentialStatus.allowed) return rejectRateLimited(res, credentialStatus);

    const user = await users.findOne({ _id: username });
    const passwordMatches = await verifyPassword(
      password,
      user?.passwordSalt || DUMMY_PASSWORD_SALT,
      user?.passwordHash || DUMMY_PASSWORD_HASH
    );
    const valid = Boolean(user) && passwordMatches;
    if (!valid) {
      loginIpLimiter.hit(ipKey);
      loginCredentialLimiter.hit(credentialKey);
      res.setHeader("Cache-Control", "no-store");
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }

    loginIpLimiter.reset(ipKey);
    loginCredentialLimiter.reset(credentialKey);

    if (user.approvalStatus === "onboarding" || user.profileComplete === false) {
      const registrationToken = createRegistrationToken(user, AUTH_SECRET);
      res.setHeader("Set-Cookie", registrationCookie(registrationToken, { secure: requestIsSecure(req) }));
      return res.json({ ok: true, redirect: "/register/profile", registration: "onboarding" });
    }
    if (user.approvalStatus === "pending") {
      return res.status(403).json({ error: "ACCOUNT_PENDING" });
    }
    if (user.approvalStatus === "rejected") {
      return res.status(403).json({ error: "ACCOUNT_REJECTED" });
    }
    if (user.active === false) {
      return res.status(403).json({ error: "ACCOUNT_INACTIVE" });
    }

    const token = createSessionToken(user, AUTH_SECRET);
    res.setHeader("Set-Cookie", sessionCookie(token, { secure: requestIsSecure(req) }));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      redirect: homeForRole(user.role),
      user: { username: user.username, displayName: user.displayName, role: user.role },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", [
    clearSessionCookie({ secure: requestIsSecure(req) }),
    clearGuestCookie({ secure: requestIsSecure(req) }),
    clearRegistrationCookie({ secure: requestIsSecure(req) }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    user: {
      username: req.user.username,
      displayName: req.user.displayName,
      role: req.user.role,
      lessonIds: req.user.lessonIds || [],
    },
  });
});

app.get("/api/lessons", requireAuth, async (req, res, next) => {
  try {
    const archived = req.user.role === "teacher" && req.query.archive === "1";
    const query = { active: archived ? false : true, _id: { $ne: "default" } };
    if (req.user.role === "teacher") {
      query.$or = [{ ownerId: req.user._id }, { teacherIds: req.user._id }];
    }
    if (req.user.role === "student") {
      if (req.user.guest) query._id = req.user.lessonId;
      else query.studentIds = req.user._id;
    }

    const rows = await lessons.find(query).sort({ updatedAt: -1, createdAt: -1 }).toArray();
    const lessonIds = rows.map((lesson) => lesson._id);
    const submissionCounts = new Map();
    if (req.user.role === "teacher" && lessonIds.length) {
      const grouped = await homeworkSubmissions.aggregate([
        { $match: { lessonId: { $in: lessonIds }, status: "submitted" } },
        { $group: { _id: "$lessonId", count: { $sum: 1 } } },
      ]).toArray();
      for (const item of grouped) submissionCounts.set(item._id, item.count);
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      lessons: rows.map((lesson) => ({
        id: lesson._id,
        title: lesson.title,
        type: lesson.type || "lesson",
        status: lesson.status || (lesson.active === false ? "completed" : "active"),
        ownerId: lesson.ownerId || lesson.teacherIds?.[0] || null,
        inviteUrl: lesson.inviteToken ? `/join/${lesson.inviteToken}` : null,
        materialId: lesson.materialId || null,
        materialName: lesson.materialName || null,
        submissionCount: submissionCounts.get(lesson._id) || 0,
        lastParticipantName: lesson.lastParticipantName || null,
        lastParticipantAt: lesson.lastParticipantAt || null,
        archivedAt: lesson.archivedAt || null,
        createdAt: lesson.createdAt,
        updatedAt: lesson.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/teacher/lessons", requireApiRole("teacher"), async (req, res, next) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: "FORBIDDEN" });
    const title = String(req.body?.title || "").trim();
    const type = req.body?.type === "homework" ? "homework" : "lesson";
    if (!title || title.length > 120) return res.status(400).json({ error: "INVALID_LESSON" });

    const now = new Date();
    const row = {
      _id: `lesson_${crypto.randomUUID()}`,
      title,
      type,
      status: "active",
      ownerId: req.user._id,
      teacherIds: [req.user._id],
      studentIds: [],
      inviteToken: newInviteToken(),
      active: true,
      bookIds: [],
      materialId: null,
      materialName: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 2,
    };
    await lessons.insertOne(row);
    res.status(201).json({
      lesson: {
        id: row._id,
        title: row.title,
        type: row.type,
        status: row.status,
        inviteUrl: `/join/${row.inviteToken}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/teacher/lessons/:id/invite/rotate", requireApiRole("teacher"), async (req, res, next) => {
  try {
    const id = normalizeLessonId(req.params.id);
    if (!id) return res.status(400).json({ error: "INVALID_LESSON" });
    const lesson = await lessons.findOne({ _id: id, active: true });
    if (!lesson || (req.user.role !== "admin" && lesson.ownerId !== req.user._id && !lesson.teacherIds?.includes(req.user._id))) {
      return res.status(404).json({ error: "LESSON_NOT_FOUND" });
    }
    const inviteToken = newInviteToken();
    await lessons.updateOne({ _id: id }, { $set: { inviteToken, updatedAt: new Date() } });
    res.json({ inviteUrl: `/join/${inviteToken}` });
  } catch (error) {
    next(error);
  }
});

app.post("/api/teacher/lessons/:id/archive", requireApiRole("teacher"), async (req, res, next) => {
  try {
    const id = normalizeLessonId(req.params.id);
    if (!id || id === "default") return res.status(400).json({ error: "INVALID_LESSON" });
    const lesson = await lessons.findOne({ _id: id, active: true });
    if (!lesson || (req.user.role !== "admin" && lesson.ownerId !== req.user._id && !lesson.teacherIds?.includes(req.user._id))) {
      return res.status(404).json({ error: "LESSON_NOT_FOUND" });
    }
    const now = new Date();
    await lessons.updateOne(
      { _id: id },
      {
        $set: {
          active: false,
          status: "archived",
          archivedAt: now,
          updatedAt: now,
        },
        $unset: { inviteToken: "" },
      }
    );
    teacherFollowByLesson.delete(id);
    teacherPageByLesson.delete(id);
    res.json({ ok: true, archivedAt: now });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/teacher/lessons/:id", requireApiRole("teacher"), async (req, res, next) => {
  try {
    const id = normalizeLessonId(req.params.id);
    if (!id || id === "default") return res.status(400).json({ error: "INVALID_LESSON" });
    const lesson = await lessons.findOne({ _id: id, active: false });
    if (!lesson || (req.user.role !== "admin" && lesson.ownerId !== req.user._id && !lesson.teacherIds?.includes(req.user._id))) {
      return res.status(404).json({ error: "LESSON_NOT_FOUND" });
    }

    await Promise.all([
      lessons.deleteOne({ _id: id }),
      settings.deleteOne({ _id: `currentDocument:${id}` }),
      annotations.deleteMany(annotationLessonFilter(id)),
      homeworkSubmissions.deleteMany({ lessonId: id }),
    ]);
    teacherFollowByLesson.delete(id);
    teacherPageByLesson.delete(id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/materials", requireApiRole("teacher"), async (req, res, next) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: "FORBIDDEN" });
    const rows = await materials.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).toArray();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      materials: rows.map((item) => ({
        id: item._id,
        name: item.name,
        fileId: String(item.fileId),
        originalSize: item.originalSize,
        storedSize: item.storedSize,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/materials", requireApiRole("teacher"), upload.single("pdf"), async (req, res, next) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: "FORBIDDEN" });
    if (!req.file) return res.status(400).json({ error: "PDF_REQUIRED" });

    const optimized = await optimizePdfBuffer(req.file.buffer);
    const materialId = `material_${crypto.randomUUID()}`;
    const fileId = new ObjectId();
    const now = new Date();
    const stream = bucket.openUploadStreamWithId(fileId, req.file.originalname, {
      contentType: "application/pdf",
      metadata: {
        ownerId: req.user._id,
        materialId,
        library: true,
        uploadedAt: now,
        originalSize: optimized.originalSize,
        storedSize: optimized.finalSize,
        compressed: optimized.compressed,
      },
    });
    stream.end(optimized.buffer);
    await new Promise((resolve, reject) => {
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    const row = {
      _id: materialId,
      ownerId: req.user._id,
      fileId,
      name: req.file.originalname,
      originalSize: optimized.originalSize,
      storedSize: optimized.finalSize,
      compressed: optimized.compressed,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    await materials.insertOne(row);
    res.status(201).json({
      material: {
        id: row._id,
        name: row.name,
        fileId: String(row.fileId),
        originalSize: row.originalSize,
        storedSize: row.storedSize,
        createdAt: row.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/materials/:id", requireApiRole("teacher"), async (req, res, next) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: "FORBIDDEN" });
    const id = String(req.params.id || "");
    const material = await materials.findOne({ _id: id, ownerId: req.user._id });
    if (!material) return res.status(404).json({ error: "MATERIAL_NOT_FOUND" });
    if (await lessons.findOne({ materialId: id, active: true })) {
      return res.status(409).json({ error: "MATERIAL_IN_USE" });
    }
    await materials.deleteOne({ _id: id, ownerId: req.user._id });
    try {
      await bucket.delete(new ObjectId(material.fileId));
    } catch {
      // GridFS cleanup is best effort after metadata is removed.
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/teacher/lessons/:id/material", requireApiRole("teacher"), async (req, res, next) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: "FORBIDDEN" });
    const lessonId = normalizeLessonId(req.params.id);
    const materialId = String(req.body?.materialId || "");
    if (!lessonId || !materialId) return res.status(400).json({ error: "INVALID_MATERIAL" });

    const lesson = await lessons.findOne({ _id: lessonId, active: true });
    if (!lesson || (req.user.role !== "admin" && lesson.ownerId !== req.user._id && !lesson.teacherIds?.includes(req.user._id))) {
      return res.status(404).json({ error: "LESSON_NOT_FOUND" });
    }
    const material = await materials.findOne({ _id: materialId, ownerId: req.user._id });
    if (!material) return res.status(404).json({ error: "MATERIAL_NOT_FOUND" });

    const now = new Date();
    await settings.updateOne(
      { _id: `currentDocument:${lessonId}` },
      {
        $set: {
          lessonId,
          fileId: material.fileId,
          materialId: material._id,
          name: material.name,
          uploadedAt: material.createdAt,
          uploadedBy: req.user._id,
        },
      },
      { upsert: true }
    );
    await lessons.updateOne(
      { _id: lessonId },
      { $set: { materialId: material._id, materialName: material.name, updatedAt: now } }
    );
    await annotations.deleteMany(annotationLessonFilter(lessonId));
    io.to(lessonRoom(lessonId)).emit("document:changed", {
      id: String(material.fileId),
      name: material.name,
    });
    res.json({
      ok: true,
      material: { id: material._id, name: material.name, fileId: String(material.fileId) },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/teacher/lessons/:id/submissions", requireApiRole("teacher"), async (req, res, next) => {
  try {
    const lessonId = normalizeLessonId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: "INVALID_LESSON" });
    const lesson = await lessons.findOne({ _id: lessonId });
    if (!lesson || (req.user.role !== "admin" && lesson.ownerId !== req.user._id && !lesson.teacherIds?.includes(req.user._id))) {
      return res.status(404).json({ error: "LESSON_NOT_FOUND" });
    }
    const rows = await homeworkSubmissions.find({ lessonId }).sort({ submittedAt: -1 }).toArray();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      submissions: rows.map((row) => ({
        id: row._id,
        participantName: row.participantName,
        status: row.status,
        submittedAt: row.submittedAt,
        updatedAt: row.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/homework/submit", requireApiRole("student"), requireLessonAccess, async (req, res, next) => {
  try {
    if (req.lesson.type !== "homework") return res.status(400).json({ error: "NOT_HOMEWORK" });
    const now = new Date();
    const participantKey = req.user._id;
    const rowId = `${req.lessonId}:${participantKey}`;
    await homeworkSubmissions.updateOne(
      { _id: rowId },
      {
        $set: {
          lessonId: req.lessonId,
          participantKey,
          participantName: req.user.displayName || req.user.username || "Ученик",
          status: "submitted",
          submittedAt: now,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now, schemaVersion: 1 },
      },
      { upsert: true }
    );
    res.json({ ok: true, submittedAt: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/join/:token", async (req, res, next) => {
  try {
    const token = normalizeInviteToken(req.params.token);
    if (!token) return res.status(404).json({ error: "INVITE_NOT_FOUND" });
    const lesson = await lessons.findOne({ inviteToken: token, active: true });
    if (!lesson) return res.status(404).json({ error: "INVITE_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      lesson: {
        id: lesson._id,
        title: lesson.title,
        type: lesson.type || "lesson",
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/join/:token", async (req, res, next) => {
  try {
    const token = normalizeInviteToken(req.params.token);
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!token || !name) return res.status(400).json({ error: "INVALID_JOIN" });

    const ipKey = clientIp(req);
    const joinIpLimit = joinIpLimiter.consume(ipKey);
    if (!joinIpLimit.allowed) return rejectRateLimited(res, joinIpLimit);
    const joinInviteLimit = joinInviteLimiter.consume(`${ipKey}:${token}`);
    if (!joinInviteLimit.allowed) return rejectRateLimited(res, joinInviteLimit);

    const lesson = await lessons.findOne({ inviteToken: token, active: true });
    if (!lesson) return res.status(404).json({ error: "INVITE_NOT_FOUND" });

    const guestToken = createGuestToken({ lessonId: lesson._id, name }, AUTH_SECRET);
    const joinedAt = new Date();
    await lessons.updateOne(
      { _id: lesson._id },
      { $set: { lastParticipantName: name, lastParticipantAt: joinedAt, updatedAt: joinedAt } }
    );
    res.setHeader("Set-Cookie", guestCookie(guestToken, { secure: requestIsSecure(req) }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, redirect: `/student?lesson=${encodeURIComponent(lesson._id)}` });
  } catch (error) {
    next(error);
  }
});


app.get("/api/admin/registrations", requireApiRole("admin"), async (_req, res, next) => {
  try {
    const rows = await users.find({
      role: "teacher",
      approvalStatus: "pending",
      profileComplete: true,
    }).sort({ registrationSubmittedAt: -1 }).toArray();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      registrations: rows.map((user) => ({
        ...publicUser(user),
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        phone: user.phone || "",
        subjects: user.subjects || "",
        bio: user.bio || "",
        registrationSubmittedAt: user.registrationSubmittedAt || user.updatedAt || user.createdAt,
      })),
      count: rows.length,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/registrations/:id/approve", requireApiRole("admin"), async (req, res, next) => {
  try {
    const id = normalizeManagedUsername(req.params.id);
    if (!id) return res.status(400).json({ error: "INVALID_USER" });
    const current = await users.findOne({ _id: id, role: "teacher", approvalStatus: "pending" });
    if (!current) return res.status(404).json({ error: "REGISTRATION_NOT_FOUND" });
    const now = new Date();
    await users.updateOne(
      { _id: id },
      {
        $set: {
          active: true,
          approvalStatus: "approved",
          approvedAt: now,
          approvedBy: req.user._id,
          updatedAt: now,
        },
      }
    );
    const updated = await users.findOne({ _id: id });
    res.json({ user: publicUser(updated) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/registrations/:id/reject", requireApiRole("admin"), async (req, res, next) => {
  try {
    const id = normalizeManagedUsername(req.params.id);
    if (!id) return res.status(400).json({ error: "INVALID_USER" });
    const current = await users.findOne({ _id: id, role: "teacher", approvalStatus: "pending" });
    if (!current) return res.status(404).json({ error: "REGISTRATION_NOT_FOUND" });
    const now = new Date();
    await users.updateOne(
      { _id: id },
      {
        $set: {
          active: false,
          approvalStatus: "rejected",
          rejectedAt: now,
          rejectedBy: req.user._id,
          updatedAt: now,
        },
      }
    );
    const updated = await users.findOne({ _id: id });
    res.json({ user: publicUser(updated) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/users", requireApiRole("admin"), async (_req, res, next) => {
  try {
    const rows = await users.find({
      role: { $in: ["teacher", "student"] },
      approvalStatus: { $nin: ["onboarding", "pending"] },
    }).sort({ role: 1, displayName: 1 }).toArray();
    res.setHeader("Cache-Control", "no-store");
    res.json({ users: rows.map(publicUser) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", requireApiRole("admin"), async (req, res, next) => {
  try {
    const username = normalizeManagedUsername(req.body?.username);
    const displayName = String(req.body?.displayName || "").trim();
    const role = req.body?.role === "teacher" || req.body?.role === "student" ? req.body.role : null;
    const password = String(req.body?.password || "");

    if (!username || !displayName || !role || password.length < 8) {
      return res.status(400).json({ error: "INVALID_USER" });
    }
    if (await users.findOne({ _id: username })) {
      return res.status(409).json({ error: "USER_EXISTS" });
    }

    const { salt, hash } = await hashPassword(password);
    const row = {
      _id: username,
      username,
      displayName,
      role,
      active: true,
      lessonIds: [],
      passwordSalt: salt,
      passwordHash: hash,
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await users.insertOne(row);
    res.status(201).json({ user: publicUser(row) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/users/:id", requireApiRole("admin"), async (req, res, next) => {
  try {
    const id = normalizeManagedUsername(req.params.id);
    if (!id) return res.status(400).json({ error: "INVALID_USER" });

    const current = await users.findOne({ _id: id, role: { $in: ["teacher", "student"] } });
    if (!current) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const changes = { updatedAt: new Date() };
    if (typeof req.body?.displayName === "string") {
      const displayName = req.body.displayName.trim();
      if (!displayName) return res.status(400).json({ error: "INVALID_DISPLAY_NAME" });
      changes.displayName = displayName;
    }
    if (typeof req.body?.active === "boolean") changes.active = req.body.active;
    if (typeof req.body?.password === "string" && req.body.password) {
      if (req.body.password.length < 8) return res.status(400).json({ error: "INVALID_PASSWORD" });
      const { salt, hash } = await hashPassword(req.body.password);
      changes.passwordSalt = salt;
      changes.passwordHash = hash;
    }

    await users.updateOne({ _id: id }, { $set: changes });
    const updated = await users.findOne({ _id: id });
    res.json({ user: publicUser(updated) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/lessons", requireApiRole("admin"), async (_req, res, next) => {
  try {
    const rows = await lessons.find({}).sort({ active: -1, title: 1 }).toArray();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      lessons: rows.map((lesson) => ({
        id: lesson._id,
        title: lesson.title,
        teacherIds: lesson.teacherIds || [],
        studentIds: lesson.studentIds || [],
        active: lesson.active !== false,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/lessons", requireApiRole("admin"), async (req, res, next) => {
  try {
    const id = `lesson_${crypto.randomUUID()}`;
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "INVALID_LESSON" });

    const members = await validateLessonMembers(req.body?.teacherIds, req.body?.studentIds);
    if (!members) return res.status(400).json({ error: "INVALID_MEMBERS" });

    const row = {
      _id: id,
      title,
      teacherIds: members.teachers,
      studentIds: members.students,
      bookIds: [],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      schemaVersion: 1,
    };
    await lessons.insertOne(row);
    res.status(201).json({
      lesson: { id, title, teacherIds: row.teacherIds, studentIds: row.studentIds, active: true },
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/lessons/:id", requireApiRole("admin"), async (req, res, next) => {
  try {
    const id = normalizeLessonId(req.params.id);
    if (!id) return res.status(400).json({ error: "INVALID_LESSON" });
    const current = await lessons.findOne({ _id: id });
    if (!current) return res.status(404).json({ error: "LESSON_NOT_FOUND" });

    const changes = { updatedAt: new Date() };
    if (typeof req.body?.title === "string") {
      const title = req.body.title.trim();
      if (!title) return res.status(400).json({ error: "INVALID_TITLE" });
      changes.title = title;
    }
    if (typeof req.body?.active === "boolean") changes.active = req.body.active;

    if (Array.isArray(req.body?.teacherIds) || Array.isArray(req.body?.studentIds)) {
      const members = await validateLessonMembers(
        Array.isArray(req.body?.teacherIds) ? req.body.teacherIds : current.teacherIds,
        Array.isArray(req.body?.studentIds) ? req.body.studentIds : current.studentIds
      );
      if (!members) return res.status(400).json({ error: "INVALID_MEMBERS" });
      changes.teacherIds = members.teachers;
      changes.studentIds = members.students;
    }

    await lessons.updateOne({ _id: id }, { $set: changes });
    const updated = await lessons.findOne({ _id: id });
    res.json({
      lesson: {
        id: updated._id,
        title: updated.title,
        teacherIds: updated.teacherIds || [],
        studentIds: updated.studentIds || [],
        active: updated.active !== false,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Protect direct .html access too, not only friendly routes.
app.get("/dashboard.html", requirePageAuth("teacher", "student"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
);
app.get("/teacher.html", requirePageAuth("teacher"), (req, res) => {
  res.setHeader("Set-Cookie", clearGuestCookie({ secure: requestIsSecure(req) }));
  res.sendFile(path.join(__dirname, "public", "teacher.html"));
});
app.get("/student.html", requirePageAuth("student"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "student.html"))
);
app.get("/monitor.html", requirePageAuth("admin"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "monitor.html"))
);
app.get("/performance.html", requirePageAuth("admin"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "performance.html"))
);

app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.get("/", (req, res) => {
  if (req.user && !req.user.guest) return res.redirect(homeForRole(req.user.role));
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/join/:token", async (req, res, next) => {
  try {
    const token = normalizeInviteToken(req.params.token);
    if (!token || !await lessons.findOne({ inviteToken: token, active: true })) {
      return res.status(404).send("Ссылка на занятие недействительна или занятие завершено.");
    }
    res.sendFile(path.join(__dirname, "public", "join.html"));
  } catch (error) {
    next(error);
  }
});
app.get("/register", (req, res) => {
  if (req.user && !req.user.guest) return res.redirect("/cabinet");
  res.sendFile(path.join(__dirname, "public", "register.html"));
});
app.get("/register/profile", async (req, res, next) => {
  try {
    const user = await registrationUserFromRequest(req);
    if (!user) return res.redirect("/register");
    if (user.approvalStatus === "pending") return res.redirect("/registration-pending");
    if (user.approvalStatus === "approved" && user.active) return res.redirect("/cabinet");
    res.sendFile(path.join(__dirname, "public", "register-profile.html"));
  } catch (error) {
    next(error);
  }
});
app.get("/registration-pending", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "registration-pending.html"))
);
app.get("/cabinet", requirePageAuth("teacher", "student"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
);
app.get("/teacher", requirePageAuth("teacher"), (req, res) => {
  res.setHeader("Set-Cookie", clearGuestCookie({ secure: requestIsSecure(req) }));
  res.sendFile(path.join(__dirname, "public", "teacher.html"));
});
app.get("/student", requirePageAuth("student"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "student.html"))
);
app.get("/monitor", requirePageAuth("admin"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "monitor.html"))
);
app.get("/performance", requirePageAuth("admin"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "performance.html"))
);
app.get("/health", (_req, res) => res.json({ ok: true }));

async function getCurrentDocument(lessonId) {
  const scoped = await settings.findOne({ _id: `currentDocument:${lessonId}` });
  if (scoped) return scoped;
  if (lessonId === "default") return settings.findOne({ _id: "currentDocument" });
  return null;
}

function annotationDocumentFilter(lessonId, documentId) {
  if (lessonId === "default") {
    return {
      $or: [
        { documentId },
        { documentId: { $exists: false } },
        { documentId: null },
      ],
    };
  }
  return { documentId };
}

async function currentDocumentIdForLesson(lessonId) {
  const current = await getCurrentDocument(lessonId);
  return current?.fileId ? String(current.fileId) : null;
}

app.get("/api/document", requireApiRole("teacher", "student"), requireLessonAccess, async (req, res, next) => {
  try {
    const current = await getCurrentDocument(req.lessonId);
    if (!current) return res.status(404).json({ error: "NO_DOCUMENT" });
    res.json({
      id: String(current.fileId),
      name: current.name,
      uploadedAt: current.uploadedAt,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/document/file", requireApiRole("teacher", "student"), requireLessonAccess, async (req, res, next) => {
  try {
    const current = await getCurrentDocument(req.lessonId);
    if (!current) return res.status(404).end();

    const requestedId = String(req.query.id || "");
    const currentId = String(current.fileId);
    if (!requestedId || requestedId !== currentId) {
      return res.status(404).end();
    }

    const fileId = new ObjectId(current.fileId);
    const file = await db.collection(`${GRIDFS_BUCKET_NAME}.files`).findOne({ _id: fileId });
    if (!file) return res.status(404).end();

    const size = Number(file.length);
    const etag = `"${currentId}"`;

    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(current.name)}`
    );
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", etag);
    res.setHeader("Accept-Ranges", "bytes");

    const range = parseSingleByteRange(req.get("range"), size);

    if (range?.invalid || range?.unsatisfiable) {
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.status(416).end();
    }

    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(range.length));

      // GridFS end is exclusive, while HTTP byte ranges are inclusive.
      return bucket
        .openDownloadStream(fileId, { start: range.start, end: range.end + 1 })
        .pipe(res);
    }

    res.setHeader("Content-Length", String(size));
    return bucket.openDownloadStream(fileId).pipe(res);
  } catch (err) {
    next(err);
  }
});

app.post("/api/document", requireApiRole("teacher"), requireLessonAccess, upload.single("pdf"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF_REQUIRED" });
    }

    const optimized = await optimizePdfBuffer(req.file.buffer);
    const materialId = `material_${crypto.randomUUID()}`;
    const now = new Date();

    const fileId = new ObjectId();
    const stream = bucket.openUploadStreamWithId(fileId, req.file.originalname, {
      contentType: "application/pdf",
      metadata: {
        ownerId: req.user._id,
        materialId,
        library: true,
        uploadedAt: now,
        originalSize: optimized.originalSize,
        storedSize: optimized.finalSize,
        compressed: optimized.compressed,
        lessonId: req.lessonId,
      },
    });
    stream.end(optimized.buffer);

    await new Promise((resolve, reject) => {
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    await materials.insertOne({
      _id: materialId,
      ownerId: req.user._id,
      fileId,
      name: req.file.originalname,
      originalSize: optimized.originalSize,
      storedSize: optimized.finalSize,
      compressed: optimized.compressed,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });

    await settings.updateOne(
      { _id: `currentDocument:${req.lessonId}` },
      {
        $set: {
          lessonId: req.lessonId,
          fileId,
          materialId,
          name: req.file.originalname,
          uploadedAt: now,
          uploadedBy: req.user._id,
        },
      },
      { upsert: true }
    );

    await lessons.updateOne(
      { _id: req.lessonId },
      { $set: { materialId, materialName: req.file.originalname, updatedAt: now } }
    );
    await annotations.deleteMany(annotationLessonFilter(req.lessonId));

    io.to(lessonRoom(req.lessonId)).emit("document:changed", {
      id: String(fileId),
      name: req.file.originalname,
    });

    res.status(201).json({
      id: String(fileId),
      name: req.file.originalname,
      originalSize: optimized.originalSize,
      storedSize: optimized.finalSize,
      compressed: optimized.compressed,
      materialId,
    });
  } catch (err) {
    next(err);
  }
});


function finiteMetric(value, max = 60000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

function metricSummary(rows, key) {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  if (!values.length) return { avg: null, p95: null };
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: percentile(values, 0.95),
  };
}

app.post("/api/performance", requireApiRole("teacher", "student"), async (req, res) => {
  try {
    const body = req.body || {};
    const role = req.user.role === "admin"
      ? (body.role === "teacher" ? "teacher" : "student")
      : req.user.role;
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.length <= 100
        ? body.sessionId
        : null;

    if (!sessionId) return res.status(400).json({ error: "INVALID_SESSION" });

    const row = {
      createdAt: new Date(),
      role,
      userId: req.user._id,
      lessonId: normalizeLessonId(body.lessonId),
      sessionId,
      documentId:
        typeof body.documentId === "string" && body.documentId.length <= 100
          ? body.documentId
          : null,
      page: Number.isInteger(Number(body.page)) && Number(body.page) > 0
        ? Number(body.page)
        : null,
      rtt: finiteMetric(body.rtt),
      pageMs: finiteMetric(body.pageMs),
      strokeMs: finiteMetric(body.strokeMs),
      network:
        typeof body.network === "string" && body.network.length <= 40
          ? body.network
          : null,
      downlink: finiteMetric(body.downlink, 10000),
      browserRtt: finiteMetric(body.browserRtt, 60000),
      connected: Boolean(body.connected),
      reconnects:
        Number.isInteger(Number(body.reconnects)) && Number(body.reconnects) >= 0
          ? Math.min(Number(body.reconnects), 10000)
          : 0,
      disconnects:
        Number.isInteger(Number(body.disconnects)) && Number(body.disconnects) >= 0
          ? Math.min(Number(body.disconnects), 10000)
          : 0,
    };

    await performanceLogs.insertOne(row);
    res.status(202).json({ ok: true });
  } catch (err) {
    // Performance logging must never affect the lesson.
    console.error("Performance log write failed:", err);
    res.status(202).json({ ok: false });
  }
});

app.get("/api/performance", requireApiRole("admin"), async (req, res, next) => {
  try {
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
    const role =
      req.query.role === "teacher" || req.query.role === "student"
        ? req.query.role
        : null;

    const query = {
      createdAt: { $gte: new Date(Date.now() - hours * 60 * 60 * 1000) },
    };
    if (role) query.role = role;

    const rows = await performanceLogs
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    res.setHeader("Cache-Control", "no-store");
    res.json({
      summary: {
        rtt: metricSummary(rows, "rtt"),
        page: metricSummary(rows, "pageMs"),
        stroke: metricSummary(rows, "strokeMs"),
        sessions: new Set(rows.map((row) => row.sessionId).filter(Boolean)).size,
        samples: rows.length,
      },
      rows: rows.map((row) => ({
        createdAt: row.createdAt,
        role: row.role,
        sessionId: row.sessionId,
        lessonId: row.lessonId,
        documentId: row.documentId,
        page: row.page,
        rtt: row.rtt,
        pageMs: row.pageMs,
        strokeMs: row.strokeMs,
        network: row.network,
        downlink: row.downlink,
        browserRtt: row.browserRtt,
        connected: row.connected,
        reconnects: row.reconnects,
        disconnects: row.disconnects,
      })),
    });
  } catch (err) {
    next(err);
  }
});


app.get("/api/webrtc/config", requireApiRole("teacher", "student"), requireLessonAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const cloudflareIceServers = await cloudflareTurnIceServers();
    if (cloudflareIceServers?.length) {
      const iceServers = [];
      if (WEBRTC_STUN_URLS.length) iceServers.push({ urls: WEBRTC_STUN_URLS });
      iceServers.push(...cloudflareIceServers);
      return res.json({
        iceServers,
        source: "hybrid-stun-cloudflare-turn",
        iceTransportPolicy: "all",
      });
    }
  } catch (error) {
    console.error("Cloudflare TURN config failed", error);
  }
  res.json({
    iceServers: staticWebrtcIceServers(),
    source: "static-fallback",
    iceTransportPolicy: "all",
  });
});

app.get("/api/annotations/:page", requireApiRole("teacher", "student"), requireLessonAccess, async (req, res, next) => {
  try {
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: "INVALID_PAGE" });
    }

    const documentId = await currentDocumentIdForLesson(req.lessonId);
    if (!documentId) return res.json([]);

    const rows = await annotations
      .find({
        $and: [
          annotationLessonFilter(req.lessonId),
          annotationDocumentFilter(req.lessonId, documentId),
          { page },
        ],
      })
      .sort({ createdAt: 1 })
      .toArray();

    res.json(
      rows.map((row) => ({
        id: row._id,
        type: row.type || "stroke",
        page: row.page,
        role: row.role,
        color: row.color,
        width: row.width,
        points: row.points,
        text: row.text,
        box: row.box,
        fontSize: row.fontSize,
        fontScale: row.fontScale,
        createdAt: row.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

function isValidTextAnnotation(item) {
  if (!item || typeof item.id !== "string") return false;
  if (!Number.isInteger(item.page) || item.page < 1) return false;
  if (typeof item.text !== "string" || item.text.length > 5000) return false;
  const box = item.box;
  if (!box) return false;
  for (const key of ["x", "y", "w", "h"]) {
    if (!Number.isFinite(box[key])) return false;
  }
  return (
    box.x >= 0 && box.x <= 1 &&
    box.y >= 0 && box.y <= 1 &&
    box.w > 0 && box.w <= 1 &&
    box.h > 0 && box.h <= 1 &&
    box.x + box.w <= 1.001 &&
    box.y + box.h <= 1.001
  );
}

function erasePathHitsBox(erase, box) {
  const pad = erase.radius;
  return erase.points.some(
    (p) =>
      p.x >= box.x - pad &&
      p.x <= box.x + box.w + pad &&
      p.y >= box.y - pad &&
      p.y <= box.y + box.h + pad
  );
}

io.use(async (socket, next) => {
  try {
    const lessonId = normalizeLessonId(socket.handshake.auth?.lessonId);
    const user = await userFromCookieHeader(socket.handshake.headers.cookie, lessonId);
    if (!user) return next(new Error("AUTH_REQUIRED"));


    if (!lessonId) return next(new Error("LESSON_REQUIRED"));
    const lesson = await lessonForUser(user, lessonId);
    if (!lesson) return next(new Error("LESSON_FORBIDDEN"));

    socket.data.user = user;
    socket.data.lessonId = lessonId;
    socket.data.lesson = lesson;
    next();
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  const requestedRole =
    socket.handshake.auth?.role === "teacher"
      ? "teacher"
      : socket.handshake.auth?.role === "observer"
        ? "observer"
        : "student";
  const accountRole = socket.data.user.role;
  const role = accountRole === "admin" ? requestedRole : accountRole;
  socket.data.role = role;
  socket.data.connectedAt = Date.now();
  const lessonId = socket.data.lessonId;
  const room = lessonRoom(lessonId);
  const teacherFollow = followForLesson(lessonId);
  const controllerKey = role === "teacher" ? followControllerKey(socket) : null;
  socket.data.followControllerKey = controllerKey;
  socket.join(room);

  const waitingCall = activeRtcCall(lessonId);
  if (waitingCall && waitingCall.callerId !== socket.id && role !== "observer") {
    socket.emit("rtc:incoming-call", {
      from: waitingCall.callerId,
      callId: waitingCall.callId,
      caller: rtcPeer(waitingCall.caller),
    });
  }

  socket.on("rtc2:call", async ({ callId: rawCallId } = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const callId = normalizeRtcCallId(rawCallId);
    const callerClientId = realtimeClientId(socket.handshake.auth?.clientId);
    if (!callId || !callerClientId) return ack?.({ ok: false, error: "INVALID_CALL" });

    const existing = rtc2SessionForLesson(lessonId);
    if (
      existing &&
      existing.callId !== callId &&
      Date.now() - existing.updatedAt < 60_000
    ) {
      return ack?.({
        ok: false,
        error: existing.accepted ? "CALL_IN_PROGRESS" : "CALL_RINGING",
      });
    }

    if (
      existing &&
      existing.callId === callId &&
      existing.callerClientId === callerClientId &&
      !existing.accepted
    ) {
      existing.updatedAt = Date.now();
    } else {
      rtc2CallsByLesson.set(lessonId, {
        callId,
        callerClientId,
        calleeClientId: null,
        accepted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const caller = rtc2Peer(socket);
    const recipientPeers = rtc2UniquePeersForLesson(lessonId, callerClientId);
    const recipients = recipientPeers.length;
    for (const peer of recipientPeers) {
      peer.emit("rtc2:incoming-call", { callId, caller });
    }
    console.info(`RTC2 call requested lesson=${lessonId} role=${role} recipients=${recipients}`);
    ack?.({ ok: true, recipients });
  });

  socket.on("rtc2:accept", ({ callId: rawCallId, callerClientId } = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const callId = normalizeRtcCallId(rawCallId);
    const calleeClientId = realtimeClientId(socket.handshake.auth?.clientId);
    const normalizedCallerClientId = realtimeClientId(callerClientId);
    const session = rtc2SessionForLesson(lessonId);
    if (
      !callId ||
      !calleeClientId ||
      !normalizedCallerClientId ||
      !session ||
      session.callId !== callId ||
      session.callerClientId !== normalizedCallerClientId ||
      session.accepted
    ) {
      return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
    }

    session.calleeClientId = calleeClientId;
    session.accepted = true;
    session.updatedAt = Date.now();

    const callerSocket = rtc2SocketForClient(lessonId, session.callerClientId);
    if (!callerSocket) {
      rtc2CallsByLesson.delete(lessonId);
      return ack?.({ ok: false, error: "CALLER_OFFLINE" });
    }

    callerSocket.emit("rtc2:accepted", {
      callId,
      peer: rtc2Peer(socket),
    });
    console.info(`RTC2 call accepted lesson=${lessonId} callerRole=${callerSocket.data.role} peerRole=${role}`);
    ack?.({ ok: true, callId, caller: rtc2Peer(callerSocket) });
  });

  socket.on("rtc2:decline", ({ callId: rawCallId, callerClientId } = {}) => {
    const callId = normalizeRtcCallId(rawCallId);
    const session = rtc2SessionForLesson(lessonId);
    const normalizedCallerClientId = realtimeClientId(callerClientId);
    if (!callId || !session || session.callId !== callId || session.callerClientId !== normalizedCallerClientId) return;
    rtc2CallsByLesson.delete(lessonId);
    rtc2SocketForClient(lessonId, session.callerClientId)?.emit("rtc2:declined", { callId });
  });

  socket.on("rtc2:cancel", ({ callId: rawCallId } = {}) => {
    const callId = normalizeRtcCallId(rawCallId);
    const clientId = realtimeClientId(socket.handshake.auth?.clientId);
    const session = rtc2SessionForLesson(lessonId);
    if (!callId || !clientId || !session || session.callId !== callId || session.callerClientId !== clientId) return;
    rtc2CallsByLesson.delete(lessonId);
    for (const peer of rtc2UniquePeersForLesson(lessonId, clientId)) {
      peer.emit("rtc2:cancelled", { callId, callerClientId: clientId });
    }
  });

  socket.on("rtc2:signal", (payload = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const clientId = realtimeClientId(socket.handshake.auth?.clientId);
    const targetClientId = realtimeClientId(payload.targetClientId);
    const signal = normalizeRtcSignal({ ...payload, targetId: targetClientId });
    const session = rtc2SessionForLesson(lessonId);

    if (!clientId || !targetClientId || !signal || !session || !session.accepted || session.callId !== signal.callId) {
      return ack?.({ ok: false, error: "INVALID_SIGNAL" });
    }

    const callerToCallee =
      clientId === session.callerClientId &&
      targetClientId === session.calleeClientId;
    const calleeToCaller =
      clientId === session.calleeClientId &&
      targetClientId === session.callerClientId;
    if (!callerToCallee && !calleeToCaller) {
      return ack?.({ ok: false, error: "PEER_MISMATCH" });
    }

    const target = rtc2SocketForClient(lessonId, targetClientId);
    if (!target) return ack?.({ ok: false, error: "PEER_OFFLINE" });

    session.updatedAt = Date.now();
    const signalKind = signal.description?.type || (signal.candidate ? "candidate" : "unknown");
    console.info(
      `RTC2 signal lesson=${lessonId} kind=${signalKind} fromRole=${role} fromClient=${clientId.slice(0, 8)} targetClient=${targetClientId.slice(0, 8)} targetRole=${target.data.role}`
    );
    target.emit("rtc2:signal", {
      callId: signal.callId,
      fromClientId: clientId,
      description: signal.description,
      candidate: signal.candidate,
    });
    ack?.({ ok: true });
  });

  socket.on("rtc2:resume", ({ callId: rawCallId } = {}, ack) => {
    const callId = normalizeRtcCallId(rawCallId);
    const clientId = realtimeClientId(socket.handshake.auth?.clientId);
    const session = rtc2SessionForLesson(lessonId);
    if (!callId || !clientId || !session || !session.accepted || session.callId !== callId) {
      return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
    }

    let peerClientId = null;
    let offerer = false;
    if (clientId === session.callerClientId) {
      peerClientId = session.calleeClientId;
      offerer = true;
    } else if (clientId === session.calleeClientId) {
      peerClientId = session.callerClientId;
    } else {
      return ack?.({ ok: false, error: "NOT_PARTICIPANT" });
    }

    session.updatedAt = Date.now();
    const peerSocket = rtc2SocketForClient(lessonId, peerClientId);
    if (peerSocket) {
      peerSocket.emit("rtc2:restart", {
        callId,
        peerClientId: clientId,
        offerer: peerClientId === session.callerClientId,
      });
    }
    ack?.({
      ok: true,
      peerClientId,
      peerOnline: Boolean(peerSocket),
      offerer,
    });
  });

  socket.on("rtc2:leave", ({ callId: rawCallId } = {}) => {
    const callId = normalizeRtcCallId(rawCallId);
    const clientId = realtimeClientId(socket.handshake.auth?.clientId);
    const session = rtc2SessionForLesson(lessonId);
    if (!callId || !clientId || !session || session.callId !== callId) return;
    if (![session.callerClientId, session.calleeClientId].includes(clientId)) return;

    const peerClientId =
      clientId === session.callerClientId ? session.calleeClientId : session.callerClientId;
    rtc2CallsByLesson.delete(lessonId);
    rtc2SocketForClient(lessonId, peerClientId)?.emit("rtc2:ended", {
      callId,
      fromClientId: clientId,
    });
  });

  socket.on("rtc:call", async ({ callId: rawCallId } = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const callId = normalizeRtcCallId(rawCallId);
    if (!callId) return ack?.({ ok: false, error: "INVALID_CALL_ID" });
    socket.data.rtcReady = true;
    socket.data.rtcCallId = callId;
    rtcCallsByLesson.set(lessonId, {
      callerId: socket.id,
      callId,
      createdAt: Date.now(),
    });

    try {
      const roomSockets = await io.in(room).fetchSockets();
      const recipients = roomSockets
        .filter((peer) => peer.id !== socket.id && peer.data.role !== "observer")
        .map(rtcPeer);

      socket.to(room).emit("rtc:incoming-call", {
        from: socket.id,
        callId,
        caller: rtcPeer(socket),
      });
      console.info(`RTC call requested lesson=${lessonId} role=${role} recipients=${recipients.length}`);
      ack?.({ ok: true, recipients });
    } catch (error) {
      console.error("RTC call request failed", error);
      ack?.({ ok: false, error: "RTC_CALL_FAILED" });
    }
  });

  socket.on("rtc:accept", ({ callerId, callId: rawCallId } = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const callId = normalizeRtcCallId(rawCallId);
    const call = activeRtcCall(lessonId);
    if (!callId || !call || call.callerId !== callerId || call.callId !== callId) {
      return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
    }

    socket.data.rtcReady = true;
    socket.data.rtcCallId = callId;
    call.caller.data.rtcCallId = callId;
    rtcCallsByLesson.delete(lessonId);
    console.info(`RTC call accepted lesson=${lessonId} callerRole=${call.caller.data.role} peerRole=${role}`);
    call.caller.emit("rtc:accepted", {
      callId,
      peer: rtcPeer(socket),
    });
    ack?.({ ok: true, callId, caller: rtcPeer(call.caller) });
  });

  socket.on("rtc:decline", ({ callerId, callId: rawCallId } = {}) => {
    const callId = normalizeRtcCallId(rawCallId);
    const call = activeRtcCall(lessonId);
    if (!callId || !call || call.callerId !== callerId || call.callId !== callId) return;
    rtcCallsByLesson.delete(lessonId);
    call.caller.emit("rtc:declined", { callId, by: rtcPeer(socket) });
  });

  socket.on("rtc:cancel", ({ callId: rawCallId } = {}) => {
    const callId = normalizeRtcCallId(rawCallId);
    const call = activeRtcCall(lessonId);
    if (!callId || !call || call.callerId !== socket.id || call.callId !== callId) return;
    rtcCallsByLesson.delete(lessonId);
    socket.to(room).emit("rtc:cancelled", { from: socket.id, callId });
  });

  socket.on("rtc:ready", async ({ callId: rawCallId } = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const callId = normalizeRtcCallId(rawCallId);
    if (!callId || callId !== socket.data.rtcCallId) {
      return ack?.({ ok: false, error: "CALL_MISMATCH" });
    }
    socket.data.rtcReady = true;
    try {
      const roomSockets = await io.in(room).fetchSockets();
      const peers = roomSockets
        .filter((peer) =>
          peer.id !== socket.id &&
          peer.data.rtcReady === true &&
          peer.data.rtcCallId === callId &&
          peer.data.role !== "observer"
        )
        .map(rtcPeer);
      socket.to(room).emit("rtc:peer-ready", rtcPeer(socket));
      ack?.({ ok: true, peers });
    } catch (error) {
      console.error("RTC presence failed", error);
      ack?.({ ok: false, error: "RTC_PRESENCE_FAILED" });
    }
  });

  socket.on("rtc:debug", (payload = {}) => {
    if (role === "observer") return;
    const event = String(payload.event || "").slice(0, 80);
    const diagnosticCallId = normalizeRtcCallId(payload.callId) || socket.data.rtcCallId || null;
    const state = String(payload.state || "").slice(0, 2000);
    const errorCode = Number.isFinite(Number(payload.errorCode)) ? Number(payload.errorCode) : null;
    const errorText = String(payload.errorText || "").slice(0, 300);
    const url = String(payload.url || "").slice(0, 300);
    const network = payload.network && typeof payload.network === "object"
      ? {
          type: String(payload.network.type || "").slice(0, 30) || null,
          effectiveType: String(payload.network.effectiveType || "").slice(0, 30) || null,
          downlink: Number.isFinite(Number(payload.network.downlink))
            ? Number(payload.network.downlink)
            : null,
          rtt: Number.isFinite(Number(payload.network.rtt))
            ? Number(payload.network.rtt)
            : null,
          saveData: Boolean(payload.network.saveData),
          online: payload.network.online !== false,
        }
      : null;

    console.info(
      `RTC debug lesson=${lessonId} role=${role} event=${event} state=${state.slice(0, 80)} errorCode=${errorCode ?? ""} errorText=${errorText} url=${url}`
    );

    const now = new Date();
    rtcDiagnostics?.insertOne({
      lessonId,
      callId: diagnosticCallId,
      role,
      userId: String(socket.data.user?._id || ""),
      clientId: realtimeClientId(socket.handshake.auth?.clientId),
      socketId: socket.id,
      event,
      state,
      errorCode,
      errorText: errorText || null,
      url: url || null,
      network,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    }).catch((error) => {
      console.warn("RTC diagnostic write failed", error);
    });
  });

  socket.on("rtc:signal", (payload, ack) => {
    if (role === "observer" || socket.data.rtcReady !== true) {
      return ack?.({ ok: false, error: "READ_ONLY" });
    }
    const signal = normalizeRtcSignal(payload);
    if (!signal) return ack?.({ ok: false, error: "INVALID_SIGNAL" });
    if (socket.data.rtcCallId !== signal.callId) {
      return ack?.({ ok: false, error: "CALL_MISMATCH" });
    }

    let target = io.sockets.sockets.get(signal.targetId);
    let rebound = false;
    const targetUnavailable =
      !target ||
      target.data.lessonId !== lessonId ||
      target.data.rtcReady !== true ||
      target.data.rtcCallId !== signal.callId ||
      target.data.role === "observer";

    if (targetUnavailable) {
      const replacement = findReplacementRtcPeer(signal.targetId, signal.callId);
      if (replacement && replacement.data.lessonId === lessonId && replacement.data.role !== "observer") {
        target = replacement;
        target.data.rtcReady = true;
        target.data.rtcCallId = signal.callId;
        rebound = true;
        console.info(
          `RTC signal rebound lesson=${lessonId} role=${role} staleTarget=${signal.targetId} newTarget=${target.id}`
        );
      }
    }

    if (
      !target ||
      target.data.lessonId !== lessonId ||
      target.data.rtcReady !== true ||
      target.data.rtcCallId !== signal.callId ||
      target.data.role === "observer"
    ) {
      console.info(
        `RTC signal unavailable lesson=${lessonId} role=${role} target=${signal.targetId} callId=${signal.callId}`
      );
      return ack?.({ ok: false, error: "PEER_UNAVAILABLE" });
    }

    target.emit("rtc:signal", {
      from: socket.id,
      fromRole: role,
      callId: signal.callId,
      description: signal.description,
      candidate: signal.candidate,
    });
    ack?.({ ok: true, rebound, targetId: target.id });
  });

  socket.on("rtc:leave", ({ callId: rawCallId } = {}) => {
    const callId = normalizeRtcCallId(rawCallId);
    if (!callId || callId !== socket.data.rtcCallId) return;
    const call = activeRtcCall(lessonId);
    if (call?.callerId === socket.id && call.callId === callId) rtcCallsByLesson.delete(lessonId);
    if (socket.data.rtcReady !== true) return;
    socket.data.rtcReady = false;
    socket.data.rtcCallId = null;
    socket.to(room).emit("rtc:ended", { from: socket.id, callId });
  });

  socket.on("chat:history", async (_payload, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    try {
      const rows = await lessonMessages
        .find({ lessonId })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      ack?.({
        ok: true,
        currentUserId: socket.data.user._id,
        messages: rows.reverse().map(publicChatMessage),
      });
    } catch (error) {
      console.error("Chat history failed", error);
      ack?.({ ok: false, error: "CHAT_HISTORY_FAILED" });
    }
  });

  socket.on("chat:send", async ({ text } = {}, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const normalizedText = normalizeChatMessage(text);
    if (!normalizedText) return ack?.({ ok: false, error: "INVALID_MESSAGE" });

    const nowMs = Date.now();
    if (nowMs - Number(socket.data.lastChatAt || 0) < 300) {
      return ack?.({ ok: false, error: "TOO_FAST" });
    }
    socket.data.lastChatAt = nowMs;

    try {
      const row = {
        _id: crypto.randomUUID(),
        lessonId,
        userId: socket.data.user._id,
        displayName:
          socket.data.user.displayName ||
          socket.data.user.username ||
          (role === "teacher" ? "Учитель" : "Ученик"),
        role,
        text: normalizedText,
        createdAt: new Date(),
      };
      await lessonMessages.insertOne(row);
      io.to(room).emit("chat:message", publicChatMessage(row));
      ack?.({ ok: true, id: row._id });
    } catch (error) {
      console.error("Chat send failed", error);
      ack?.({ ok: false, error: "CHAT_SAVE_FAILED" });
    }
  });

  if (controllerKey) teacherFollow.reconnect(controllerKey);
  socket.emit("teacher:follow:state", teacherFollow.snapshot(controllerKey));
  if (teacherPageByLesson.has(lessonId)) {
    socket.emit("teacher:monitor:page", { page: teacherPageByLesson.get(lessonId) });
  }

  socket.on("perf:ping", (_payload, ack) => {
    ack?.({ ok: true });
  });

  socket.on("perf:preview:seen", ({ metricId, originId } = {}) => {
    if (typeof metricId !== "string" || metricId.length > 100) return;
    if (typeof originId !== "string" || originId.length > 100) return;
    io.to(originId).emit("perf:preview:seen", { metricId });
  });

  socket.on("teacher:follow:start", ({ page } = {}, ack) => {
    if (role !== "teacher" || !controllerKey || !teacherFollow.start(page, controllerKey)) {
      return ack?.({ ok: false });
    }

    io.to(room).emit("teacher:follow:state", teacherFollow.snapshot());
    const state = teacherFollow.snapshot(controllerKey);
    socket.emit("teacher:follow:state", state);
    ack?.({ ok: true, ...state });
  });

  socket.on("teacher:monitor:page", ({ page } = {}) => {
    const nextPage = Number(page);
    if (role !== "teacher" || !Number.isInteger(nextPage) || nextPage < 1) return;
    teacherPageByLesson.set(lessonId, nextPage);
    socket.to(room).emit("teacher:monitor:page", { page: nextPage });
  });

  socket.on("teacher:page", ({ page } = {}) => {
    if (role !== "teacher" || !controllerKey || !teacherFollow.move(page, controllerKey)) return;
    const currentPage = teacherFollow.snapshot().page;
    teacherPageByLesson.set(lessonId, currentPage);
    io.to(room).emit("teacher:page", { page: currentPage });
    socket.to(room).emit("teacher:monitor:page", { page: currentPage });
  });

  socket.on("teacher:follow:stop", (_payload, ack) => {
    if (role !== "teacher" || !controllerKey || !teacherFollow.stop(controllerKey)) {
      return ack?.({ ok: false, error: "FOLLOW_NOT_CONTROLLER" });
    }
    const state = teacherFollow.snapshot();
    io.to(room).emit("teacher:follow:state", state);
    ack?.({ ok: true, ...state });
  });

  socket.on("disconnect", () => {
    if (socket.data.rtcReady === true && socket.data.rtcCallId) {
      rememberDisconnectedRtcPeer(socket);
    }
    const call = activeRtcCall(lessonId);
    if (call?.callerId === socket.id) {
      rtcCallsByLesson.delete(lessonId);
      socket.to(room).emit("rtc:cancelled", {
        from: socket.id,
        callId: call.callId,
      });
    }
    if (socket.data.rtcReady === true) {
      socket.to(room).emit("rtc:peer-left", {
        id: socket.id,
        callId: socket.data.rtcCallId || null,
      });
    }
    if (role !== "teacher" || !controllerKey) return;
    teacherFollow.disconnect(controllerKey);
  });

  socket.on("stroke:preview", (stroke) => {
    if (role === "observer" || !isValidStroke(stroke)) return;
    socket.to(room).emit("stroke:preview", {
      ...stroke,
      role,
      perfOriginId: stroke.metricId ? socket.id : undefined,
    });
  });

  socket.on("stroke:commit", async (stroke, ack) => {
    try {
      if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
      if (!isValidStroke(stroke)) {
        return ack?.({ ok: false, error: "INVALID_STROKE" });
      }

      const documentId = await currentDocumentIdForLesson(lessonId);
      if (!documentId || stroke.documentId !== documentId) {
        return ack?.({ ok: false, error: "DOCUMENT_MISMATCH" });
      }

      const row = {
        _id: stroke.id || crypto.randomUUID(),
        lessonId,
        documentId,
        page: stroke.page,
        role,
        userId: socket.data.user._id,
        color: stroke.color,
        width: stroke.width,
        points: stroke.points,
        createdAt: new Date(),
      };

      const existing = await annotations.findOne({ _id: row._id });
      if (
        existing &&
        !(
          (existing.lessonId === lessonId ||
            (lessonId === "default" && existing.lessonId == null)) &&
          (existing.documentId === documentId ||
            (lessonId === "default" && existing.documentId == null))
        )
      ) {
        return ack?.({ ok: false, error: "ANNOTATION_FORBIDDEN" });
      }

      await annotations.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
      socket.to(room).emit("stroke:committed", row);
      ack?.({ ok: true, id: row._id });
    } catch (err) {
      console.error(err);
      ack?.({ ok: false, error: "SAVE_FAILED" });
    }
  });

  socket.on("text:commit", async (item, ack) => {
    try {
      if (role !== "teacher") return ack?.({ ok: false, error: "TEACHER_ONLY" });
      if (!isValidTextAnnotation(item)) {
        return ack?.({ ok: false, error: "INVALID_TEXT" });
      }

      const documentId = await currentDocumentIdForLesson(lessonId);
      if (!documentId || item.documentId !== documentId) {
        return ack?.({ ok: false, error: "DOCUMENT_MISMATCH" });
      }

      const existing = await annotations.findOne({ _id: item.id });
      if (
        existing &&
        !(
          (existing.lessonId === lessonId ||
            (lessonId === "default" && existing.lessonId == null)) &&
          (existing.documentId === documentId ||
            (lessonId === "default" && existing.documentId == null))
        )
      ) {
        return ack?.({ ok: false, error: "ANNOTATION_FORBIDDEN" });
      }

      const row = {
        _id: item.id,
        type: "text",
        lessonId,
        documentId,
        page: item.page,
        role,
        userId: socket.data.user._id,
        color: "#e53935",
        text: item.text,
        box: item.box,
        fontSize: Number.isFinite(item.fontSize) ? Math.min(48, Math.max(10, item.fontSize)) : 18,
        fontScale:
          Number.isFinite(item.fontScale) && item.fontScale > 0 && item.fontScale < 0.25
            ? item.fontScale
            : null,
        createdAt: new Date(),
      };

      await annotations.updateOne({ _id: row._id }, { $set: row }, { upsert: true });
      io.to(room).emit("text:committed", { ...row, id: row._id });
      ack?.({ ok: true, id: row._id });
    } catch (err) {
      console.error(err);
      ack?.({ ok: false, error: "SAVE_FAILED" });
    }
  });

  socket.on("stroke:delete", async ({ id }) => {
    if (role === "observer") return;
    const row = await annotations.findOne({ $and: [{ _id: id }, annotationLessonFilter(lessonId)] });
    if (!row) return;

    // Teacher can correct either side. Student can only remove own strokes.
    if (role !== "teacher" && row.role !== role) return;

    await annotations.deleteOne({ _id: id });
    io.to(room).emit("stroke:deleted", { id, page: row.page });
  });

  socket.on("erase:path", async (erase) => {
    try {
      if (role === "observer" || !isValidErasePath(erase)) return;

      const documentId = await currentDocumentIdForLesson(lessonId);
      if (!documentId || erase.documentId !== documentId) return;

      const query = {
        $and: [
          annotationLessonFilter(lessonId),
          annotationDocumentFilter(lessonId, documentId),
          { page: erase.page },
        ],
      };
      if (role !== "teacher") query.$and.push({ role });

      const pageStrokes = await annotations.find(query).toArray();
      let changed = false;

      for (const stroke of pageStrokes) {
        if (stroke.type === "text") {
          if (!stroke.box || !erasePathHitsBox(erase, stroke.box)) continue;
          changed = true;
          await annotations.deleteOne({ _id: stroke._id });
          continue;
        }

        const parts = splitStrokeByErasePath(stroke, erase);
        const unchanged =
          parts.length === 1 &&
          parts[0].points.length === stroke.points.length;

        if (unchanged) continue;

        changed = true;
        await annotations.deleteOne({ _id: stroke._id });

        const replacements = parts
          .filter((part) => part.points.length >= 2)
          .map((part) => ({
            ...part,
            _id: crypto.randomUUID(),
            createdAt: stroke.createdAt || new Date(),
          }));

        if (replacements.length) {
          await annotations.insertMany(replacements);
        }
      }

      if (changed) io.to(room).emit("annotations:refresh", { page: erase.page });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("stroke:undo", async ({ page, documentId: requestedDocumentId }, ack) => {
    if (role === "observer") return ack?.({ ok: false, error: "READ_ONLY" });
    const documentId = await currentDocumentIdForLesson(lessonId);
    if (!documentId || requestedDocumentId !== documentId) {
      return ack?.({ ok: false, error: "DOCUMENT_MISMATCH" });
    }

    const query = {
      $and: [
        annotationLessonFilter(lessonId),
        annotationDocumentFilter(lessonId, documentId),
        { page: Number(page) },
      ],
    };
    if (role !== "teacher") query.$and.push({ role });

    const row = await annotations.find(query).sort({ createdAt: -1 }).limit(1).next();
    if (!row) return ack?.({ ok: false });

    await annotations.deleteOne({ _id: row._id });
    io.to(room).emit("stroke:deleted", { id: row._id, page: row.page });
    ack?.({ ok: true, id: row._id });
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "PDF_TOO_LARGE" });
  }

  res.status(500).json({ error: "INTERNAL_ERROR" });
});

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  db = client.db(MONGODB_DB_NAME);
  bucket = new GridFSBucket(db, { bucketName: GRIDFS_BUCKET_NAME });
  annotations = db.collection(collectionName("annotations"));
  settings = db.collection(collectionName("settings"));
  performanceLogs = db.collection(collectionName("performance_logs"));
  rtcDiagnostics = db.collection(collectionName("rtc_diagnostics"));
  users = db.collection(collectionName("users"));
  lessons = db.collection(collectionName("lessons"));
  materials = db.collection(collectionName("materials"));
  homeworkSubmissions = db.collection(collectionName("homework_submissions"));
  lessonMessages = db.collection(collectionName("lesson_messages"));

  if (DATA_NAMESPACE && await users.countDocuments({}) === 0) {
    const sourceUsers = await db.collection("users").find({}).toArray();
    const sourceLessons = await db.collection("lessons").find({}).toArray();
    const sourceMaterials = await db.collection("materials").find({}).toArray();
    if (sourceUsers.length) await users.insertMany(sourceUsers);
    if (sourceLessons.length) await lessons.insertMany(sourceLessons);
    if (sourceMaterials.length) await materials.insertMany(sourceMaterials);
    console.log(
      `Bootstrapped namespace "${DATA_NAMESPACE}" with ${sourceUsers.length} users, ${sourceLessons.length} lessons and ${sourceMaterials.length} materials`
    );
  }

  await users.createIndex({ role: 1, active: 1 });
  await users.createIndex({ approvalStatus: 1, registrationSubmittedAt: -1 });
  await users.createIndex({ email: 1 }, { unique: true, sparse: true });
  await lessons.createIndex({ teacherIds: 1 });
  await lessons.createIndex({ studentIds: 1 });
  await lessons.createIndex({ ownerId: 1, updatedAt: -1 });
  await lessons.createIndex({ inviteToken: 1 }, { unique: true, sparse: true });
  await materials.createIndex({ ownerId: 1, createdAt: -1 });
  await homeworkSubmissions.createIndex({ lessonId: 1, submittedAt: -1 });
  await homeworkSubmissions.createIndex({ lessonId: 1, participantKey: 1 }, { unique: true });
  await lessonMessages.createIndex({ lessonId: 1, createdAt: -1 });
  await rtcDiagnostics.createIndex({ lessonId: 1, createdAt: -1 });
  await rtcDiagnostics.createIndex({ callId: 1, createdAt: 1 });
  await rtcDiagnostics.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  async function ensureUser({ username, displayName, role, passwordSalt, passwordHash, lessonIds = [] }) {
    const id = normalizeUsername(username);
    const existing = await users.findOne({ _id: id });
    if (existing) return;
    await users.insertOne({
      _id: id,
      username: id,
      displayName,
      role,
      active: true,
      approvalStatus: "approved",
      profileComplete: true,
      lessonIds,
      passwordSalt,
      passwordHash,
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Bootstrap only creates missing accounts. Passwords themselves are never stored in source or MongoDB.
  await ensureUser({
    username: "admin",
    displayName: "Admin",
    role: "admin",
    passwordSalt: "56b0ac2f387a5b8e573a5b2cda979970",
    passwordHash: "0e1aa2aa06e8184dc7a68de87875959300aefe29192c617fe9dafe59dd1a7d6fb3c63488d9bf74e140de555aee9a278784d1dd6d463730d8a566c9d2585e3f4d",
    lessonIds: ["default"],
  });
  await ensureUser({
    username: "Darya",
    displayName: "Darya",
    role: "teacher",
    passwordSalt: "ffa4b3ab71491f1fba47b0d28782f3fb",
    passwordHash: "84f811e1f7a35bd5e16fc89e19ba196426674eaffac5af56f9ab4fc1319471b64bb0a7506b04f26549b8e6298859351b50af481c4f8b865173ab5963595a28ef",
    lessonIds: ["default"],
  });
  await ensureUser({
    username: "Alisa",
    displayName: "Alisa",
    role: "student",
    passwordSalt: "d09d32e7435b043131fbd2f7a35192f6",
    passwordHash: "cc54ef65f865777e1ec8198b1d4b6e705ec6f2a5e8bcd788e0833d46ac97660be75baa34d705f39bcf33c305984f17a1f7c3f7d331c521eb6b9c4193aa819559",
    lessonIds: ["default"],
  });

  // The old global "default" lesson predates teacher-owned sessions.
  // It is intentionally removed now that children join only by explicit session links.
  const legacyDefaultDocument =
    await settings.findOne({ _id: "currentDocument:default" }) ||
    await settings.findOne({ _id: "currentDocument" });

  await lessons.deleteOne({ _id: "default" });
  await settings.deleteMany({ _id: { $in: ["currentDocument:default", "currentDocument"] } });
  await annotations.deleteMany(annotationLessonFilter("default"));

  if (legacyDefaultDocument?.fileId) {
    const stillInLibrary = await materials.findOne({ fileId: legacyDefaultDocument.fileId });
    if (!stillInLibrary) {
      try {
        await bucket.delete(new ObjectId(legacyDefaultDocument.fileId));
      } catch {
        // Legacy file cleanup is best effort.
      }
    }
  }

  await annotations.createIndex({ lessonId: 1, documentId: 1, page: 1, createdAt: 1 });
  await performanceLogs.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 30 * 24 * 60 * 60 }
  );
  await performanceLogs.createIndex({ role: 1, createdAt: -1 });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`School App listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
