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
const { parseSingleByteRange } = require("./lib/http-range");
const {
  SESSION_COOKIE,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  createSessionToken,
  parseSessionToken,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
} = require("./lib/auth");

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.createHash("sha256").update(`school-app:${MONGODB_URI}`).digest("hex");

const app = express();
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
let users;
let lessons;
const teacherFollowByLesson = new Map();

app.use(express.json({ limit: "1mb" }));

function requestIsSecure(req) {
  return req.secure || String(req.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
}

async function userFromCookieHeader(cookieHeader) {
  const token = parseCookies(cookieHeader || "")[SESSION_COOKIE];
  const payload = parseSessionToken(token, AUTH_SECRET);
  if (!payload || !users) return null;
  return users.findOne({ _id: payload.uid, active: true });
}

async function attachUser(req, _res, next) {
  try {
    req.user = await userFromCookieHeader(req.headers.cookie);
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

function normalizeManagedUsername(value) {
  const username = normalizeUsername(value);
  return /^[a-z0-9._-]{3,50}$/.test(username) ? username : null;
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active !== false,
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

async function lessonForUser(user, lessonId) {
  if (!user || !lessonId) return null;
  const lesson = await lessons.findOne({ _id: lessonId, active: true });
  if (!lesson) return null;
  if (user.role === "admin") return lesson;
  if (user.role === "teacher" && lesson.teacherIds?.includes(user._id)) return lesson;
  if (user.role === "student" && lesson.studentIds?.includes(user._id)) return lesson;
  return null;
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
    teacherFollowByLesson.set(lessonId, createFollowState());
  }
  return teacherFollowByLesson.get(lessonId);
}

app.use(attachUser);

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const user = await users.findOne({ _id: username, active: true });
    const valid = user && await verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

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
  res.setHeader("Set-Cookie", clearSessionCookie({ secure: requestIsSecure(req) }));
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
    const query = { active: true };
    if (req.user.role === "teacher") query.teacherIds = req.user._id;
    if (req.user.role === "student") query.studentIds = req.user._id;

    const rows = await lessons.find(query).sort({ title: 1 }).toArray();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      lessons: rows.map((lesson) => ({
        id: lesson._id,
        title: lesson.title,
        teacherIds: lesson.teacherIds || [],
        studentIds: lesson.studentIds || [],
      })),
    });
  } catch (error) {
    next(error);
  }
});


app.get("/api/admin/users", requireApiRole("admin"), async (_req, res, next) => {
  try {
    const rows = await users.find({ role: { $in: ["teacher", "student"] } }).sort({ role: 1, displayName: 1 }).toArray();
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
    const id = normalizeLessonId(req.body?.id);
    const title = String(req.body?.title || "").trim();
    if (!id || !title) return res.status(400).json({ error: "INVALID_LESSON" });
    if (await lessons.findOne({ _id: id })) return res.status(409).json({ error: "LESSON_EXISTS" });

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
app.get("/teacher.html", requirePageAuth("teacher"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "teacher.html"))
);
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
  if (req.user) return res.redirect(homeForRole(req.user.role));
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/cabinet", requirePageAuth("teacher", "student"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
);
app.get("/teacher", requirePageAuth("teacher"), (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "teacher.html"))
);
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
    const file = await db.collection("pdfs.files").findOne({ _id: fileId });
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

    const current = await getCurrentDocument(req.lessonId);
    const optimized = await optimizePdfBuffer(req.file.buffer);

    const fileId = new ObjectId();
    const stream = bucket.openUploadStreamWithId(fileId, req.file.originalname, {
      contentType: "application/pdf",
      metadata: {
        uploadedAt: new Date(),
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

    await settings.updateOne(
      { _id: `currentDocument:${req.lessonId}` },
      {
        $set: {
          lessonId: req.lessonId,
          fileId,
          name: req.file.originalname,
          uploadedAt: new Date(),
          uploadedBy: req.user._id,
        },
      },
      { upsert: true }
    );

    await annotations.deleteMany(annotationLessonFilter(req.lessonId));

    if (current?.fileId) {
      try {
        await bucket.delete(new ObjectId(current.fileId));
      } catch {
        // Old file cleanup is best effort.
      }
    }

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
    const user = await userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error("AUTH_REQUIRED"));

    const lessonId = normalizeLessonId(socket.handshake.auth?.lessonId);
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
  const lessonId = socket.data.lessonId;
  const room = lessonRoom(lessonId);
  const teacherFollow = followForLesson(lessonId);
  socket.join(room);

  socket.emit("teacher:follow:state", teacherFollow.snapshot());

  socket.on("perf:ping", (_payload, ack) => {
    ack?.({ ok: true });
  });

  socket.on("perf:preview:seen", ({ metricId, originId } = {}) => {
    if (typeof metricId !== "string" || metricId.length > 100) return;
    if (typeof originId !== "string" || originId.length > 100) return;
    io.to(originId).emit("perf:preview:seen", { metricId });
  });

  socket.on("teacher:follow:start", ({ page } = {}, ack) => {
    if (role !== "teacher" || !teacherFollow.start(page)) {
      return ack?.({ ok: false });
    }

    const state = teacherFollow.snapshot();
    io.to(room).emit("teacher:follow:state", state);
    ack?.({ ok: true, ...state });
  });

  socket.on("teacher:page", ({ page } = {}) => {
    if (role !== "teacher" || !teacherFollow.move(page)) return;
    io.to(room).emit("teacher:page", { page: teacherFollow.snapshot().page });
  });

  socket.on("teacher:follow:stop", (_payload, ack) => {
    if (role !== "teacher") return ack?.({ ok: false });
    teacherFollow.stop();
    const state = teacherFollow.snapshot();
    io.to(room).emit("teacher:follow:state", state);
    ack?.({ ok: true, ...state });
  });

  socket.on("disconnect", () => {
    if (role !== "teacher" || !teacherFollow.snapshot().enabled) return;
    teacherFollow.stop();
    io.to(room).emit("teacher:follow:state", teacherFollow.snapshot());
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

  db = client.db("school_app");
  bucket = new GridFSBucket(db, { bucketName: "pdfs" });
  annotations = db.collection("annotations");
  settings = db.collection("settings");
  performanceLogs = db.collection("performance_logs");
  users = db.collection("users");
  lessons = db.collection("lessons");

  await users.createIndex({ role: 1, active: 1 });
  await lessons.createIndex({ teacherIds: 1 });
  await lessons.createIndex({ studentIds: 1 });

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

  await lessons.updateOne(
    { _id: "default" },
    {
      $setOnInsert: {
        title: "Основной урок",
        teacherIds: ["darya"],
        studentIds: ["alisa"],
        bookIds: [],
        active: true,
        createdAt: new Date(),
        schemaVersion: 1,
      },
    },
    { upsert: true }
  );

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
