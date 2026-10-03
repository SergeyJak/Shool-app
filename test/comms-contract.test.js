const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("WebRTC signaling is scoped to the authenticated lesson room", () => {
  const server = read("server.js");
  const connectionStart = server.indexOf('io.on("connection"');
  const connection = server.slice(connectionStart);

  assert.match(connection, /socket\.on\("rtc:ready"/);
  assert.match(connection, /socket\.on\("rtc:signal"/);
  assert.match(connection, /target\.data\.lessonId !== lessonId/);
  assert.match(connection, /target\.data\.rtcReady !== true/);
  assert.match(connection, /socket\.to\(room\)\.emit\("rtc:peer-ready"/);
  assert.match(connection, /socket\.to\(room\)\.emit\("rtc:peer-left"/);
});

test("observer cannot participate in calls or chat", () => {
  const server = read("server.js");
  assert.match(server, /socket\.on\("rtc:ready"[\s\S]*role === "observer"/);
  assert.match(server, /socket\.on\("chat:history"[\s\S]*role === "observer"/);
  assert.match(server, /socket\.on\("chat:send"[\s\S]*role === "observer"/);
});

test("chat messages are persisted per lesson and indexed", () => {
  const server = read("server.js");
  assert.match(server, /lessonMessages = db\.collection\(collectionName\("lesson_messages"\)\)/);
  assert.match(server, /lessonMessages[\s\S]*\.find\(\{ lessonId \}\)/);
  assert.match(server, /lessonId,[\s\S]*userId: socket\.data\.user\._id/);
  assert.match(server, /lessonMessages\.createIndex\(\{ lessonId: 1, createdAt: -1 \}\)/);
});

test("ICE config is protected and supports TURN environment variables", () => {
  const server = read("server.js");
  assert.match(
    server,
    /app\.get\("\/api\/webrtc\/config", requireApiRole\("teacher", "student"\), requireLessonAccess/
  );
  assert.match(server, /WEBRTC_TURN_URL/);
  assert.match(server, /WEBRTC_TURN_USERNAME/);
  assert.match(server, /WEBRTC_TURN_CREDENTIAL/);
});

test("lesson client requests media only after explicit start and supports reconnect", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /startButton\.addEventListener\("click", startCall\)/);
  assert.match(client, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(client, /new RTCPeerConnection/);
  assert.match(client, /socket\.on\("connect"[\s\S]*announceReady/);
  assert.match(client, /socket\.on\("rtc:signal"/);
  assert.match(client, /socket\.on\("chat:message"/);
});

test("teacher and student lesson pages load communication styles and module bootstrap", () => {
  for (const file of ["public/teacher.html", "public/student.html"]) {
    assert.match(read(file), /lesson-comms\.css/);
    assert.match(read(file), /app\.js\?v=20261003-video1/);
  }
  assert.match(read("public/app.js"), /lesson-comms\.mjs/);
});
