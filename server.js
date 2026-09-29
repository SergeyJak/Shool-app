require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");
const { Server } = require("socket.io");
const { optimizePdfBuffer } = require("./lib/pdf-compression");

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

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

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => res.redirect("/student"));
app.get("/teacher", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "teacher.html"))
);
app.get("/student", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "student.html"))
);
app.get("/health", (_req, res) => res.json({ ok: true }));

async function getCurrentDocument() {
  return settings.findOne({ _id: "currentDocument" });
}

app.get("/api/document", async (_req, res, next) => {
  try {
    const current = await getCurrentDocument();
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

app.get("/api/document/file", async (_req, res, next) => {
  try {
    const current = await getCurrentDocument();
    if (!current) return res.status(404).end();

    const fileId = new ObjectId(current.fileId);
    const files = await db.collection("pdfs.files").find({ _id: fileId }).toArray();
    if (!files.length) return res.status(404).end();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(current.name)}"`);
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (err) {
    next(err);
  }
});

app.post("/api/document", upload.single("pdf"), async (req, res, next) => {
  try {
    // MVP role gate. Proper auth/PIN can be added later.
    if (req.get("x-role") !== "teacher") {
      return res.status(403).json({ error: "TEACHER_ONLY" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "PDF_REQUIRED" });
    }

    const current = await getCurrentDocument();
    const optimized = await optimizePdfBuffer(req.file.buffer);

    const fileId = new ObjectId();
    const stream = bucket.openUploadStreamWithId(fileId, req.file.originalname, {
      contentType: "application/pdf",
      metadata: {
        uploadedAt: new Date(),
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

    await settings.updateOne(
      { _id: "currentDocument" },
      {
        $set: {
          fileId,
          name: req.file.originalname,
          uploadedAt: new Date(),
        },
      },
      { upsert: true }
    );

    await annotations.deleteMany({});

    if (current?.fileId) {
      try {
        await bucket.delete(new ObjectId(current.fileId));
      } catch {
        // Old file cleanup is best effort.
      }
    }

    io.emit("document:changed", {
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

app.get("/api/annotations/:page", async (req, res, next) => {
  try {
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: "INVALID_PAGE" });
    }

    const rows = await annotations
      .find({ page })
      .sort({ createdAt: 1 })
      .toArray();

    res.json(
      rows.map((row) => ({
        id: row._id,
        page: row.page,
        role: row.role,
        color: row.color,
        width: row.width,
        points: row.points,
        createdAt: row.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

io.on("connection", (socket) => {
  const role = socket.handshake.auth?.role === "teacher" ? "teacher" : "student";
  socket.data.role = role;

  socket.on("stroke:preview", (stroke) => {
    if (!isValidStroke(stroke)) return;
    socket.broadcast.emit("stroke:preview", { ...stroke, role });
  });

  socket.on("stroke:commit", async (stroke, ack) => {
    try {
      if (!isValidStroke(stroke)) {
        return ack?.({ ok: false, error: "INVALID_STROKE" });
      }

      const row = {
        _id: stroke.id || crypto.randomUUID(),
        page: stroke.page,
        role,
        color: stroke.color,
        width: stroke.width,
        points: stroke.points,
        createdAt: new Date(),
      };

      await annotations.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
      socket.broadcast.emit("stroke:committed", row);
      ack?.({ ok: true, id: row._id });
    } catch (err) {
      console.error(err);
      ack?.({ ok: false, error: "SAVE_FAILED" });
    }
  });

  socket.on("stroke:delete", async ({ id }) => {
    const row = await annotations.findOne({ _id: id });
    if (!row) return;

    // Teacher can correct either side. Student can only remove own strokes.
    if (role !== "teacher" && row.role !== role) return;

    await annotations.deleteOne({ _id: id });
    io.emit("stroke:deleted", { id, page: row.page });
  });

  socket.on("erase:path", async (erase) => {
    try {
      if (!isValidErasePath(erase)) return;

      const query = { page: erase.page };
      if (role !== "teacher") query.role = role;

      const pageStrokes = await annotations.find(query).toArray();
      let changed = false;

      for (const stroke of pageStrokes) {
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

      if (changed) io.emit("annotations:refresh", { page: erase.page });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("stroke:undo", async ({ page }, ack) => {
    const query = { page: Number(page) };
    if (role !== "teacher") query.role = role;

    const row = await annotations.find(query).sort({ createdAt: -1 }).limit(1).next();
    if (!row) return ack?.({ ok: false });

    await annotations.deleteOne({ _id: row._id });
    io.emit("stroke:deleted", { id: row._id, page: row.page });
    ack?.({ ok: true, id: row._id });
  });
});

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return distance(point, a);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)
  );
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointHitsErasePath(point, erase) {
  for (let i = 1; i < erase.points.length; i += 1) {
    if (distancePointToSegment(point, erase.points[i - 1], erase.points[i]) <= erase.radius) {
      return true;
    }
  }
  return false;
}

function splitStrokeByErasePath(stroke, erase) {
  const parts = [];
  let current = [];

  for (const point of stroke.points || []) {
    if (pointHitsErasePath(point, erase)) {
      if (current.length >= 2) parts.push({ ...stroke, points: current });
      current = [];
    } else {
      current.push(point);
    }
  }

  if (current.length >= 2) parts.push({ ...stroke, points: current });
  return parts;
}

function isValidErasePath(erase) {
  return (
    erase &&
    Number.isInteger(erase.page) &&
    erase.page > 0 &&
    Number.isFinite(erase.radius) &&
    erase.radius > 0 &&
    erase.radius <= 0.08 &&
    Array.isArray(erase.points) &&
    erase.points.length >= 2 &&
    erase.points.length <= 5000 &&
    erase.points.every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1
    )
  );
}

function isValidStroke(stroke) {
  return (
    stroke &&
    typeof stroke.id === "string" &&
    Number.isInteger(stroke.page) &&
    stroke.page > 0 &&
    typeof stroke.color === "string" &&
    Number.isFinite(stroke.width) &&
    stroke.width > 0 &&
    Array.isArray(stroke.points) &&
    stroke.points.length >= 2 &&
    stroke.points.length <= 10000 &&
    stroke.points.every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1
    )
  );
}

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

  await annotations.createIndex({ page: 1, createdAt: 1 });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Shool-app listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
