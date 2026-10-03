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

test("lesson client uses explicit incoming call acceptance before negotiation", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /startButton\.addEventListener\("click", startCall\)/);
  assert.match(client, /socket\.emit\("rtc:call"/);
  assert.match(client, /socket\.on\("rtc:incoming-call"/);
  assert.match(client, /acceptButton\.addEventListener\("click"/);
  assert.match(client, /socket\.emit\("rtc:accept"/);
  assert.match(client, /socket\.on\("rtc:accepted"/);
  assert.match(client, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(client, /new RTCPeerConnection/);
  assert.match(client, /socket\.on\("rtc:signal"/);
  assert.match(client, /socket\.on\("chat:message"/);
});

test("server routes call request accept decline and cancel only inside lesson room", () => {
  const server = read("server.js");
  assert.match(server, /socket\.on\("rtc:call"/);
  assert.match(server, /socket\.to\(room\)\.emit\("rtc:incoming-call"/);
  assert.match(server, /socket\.on\("rtc:accept"/);
  assert.match(server, /call\.caller\.emit\("rtc:accepted"/);
  assert.match(server, /socket\.on\("rtc:decline"/);
  assert.match(server, /socket\.on\("rtc:cancel"/);
});

test("teacher and student lesson pages load communication styles and module bootstrap", () => {
  for (const file of ["public/teacher.html", "public/student.html"]) {
    assert.match(read(file), /lesson-comms\.css/);
    assert.match(read(file), /app\.js\?v=20261003-video9/);
  }
  assert.match(read("public/app.js"), /lesson-comms\.mjs/);
});


test("incoming call has a prominent ringing indicator and explicit actions", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");
  assert.match(client, /lesson-comms-incoming/);
  assert.match(client, /Ответить/);
  assert.match(client, /lesson-comms-decline/);
  assert.match(client, /Не сейчас/);
  assert.match(client, /videoButton\.classList\.add\("ringing"\)/);
  assert.match(css, /lesson-comms-video-button\.ringing/);
});


test("lesson client exposes ICE diagnostics and retries remote playback", () => {
  const client = read("public/lesson-comms.mjs");
  const server = read("server.js");
  assert.match(client, /iceconnectionstatechange/);
  assert.match(client, /icecandidateerror/);
  assert.match(client, /remoteVideo\.play\(\)/);
  assert.match(server, /socket\.on\("rtc:debug"/);
  assert.match(server, /stun:stun\.cloudflare\.com:3478/);
});


test("WebRTC config generates short-lived Cloudflare TURN credentials on the backend", () => {
  const server = read("server.js");
  assert.match(server, /CLOUDFLARE_TURN_KEY_ID/);
  assert.match(server, /CLOUDFLARE_TURN_API_TOKEN/);
  assert.match(server, /credentials\/generate-ice-servers/);
  assert.match(server, /Authorization: `Bearer \$\{CLOUDFLARE_TURN_API_TOKEN\}`/);
  assert.match(server, /body: JSON\.stringify\(\{ ttl: CLOUDFLARE_TURN_TTL_SECONDS \}\)/);
  assert.match(server, /source: "cloudflare-turn"/);
  assert.match(server, /source: "static-fallback"/);
});


test("video call can collapse to opponent-only mini window and restore on click", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");
  assert.match(client, /lesson-comms-minimize/);
  assert.match(client, /panel\.classList\.add\("mini-video"\)/);
  assert.match(client, /panel\.classList\.remove\("mini-video"\)/);
  assert.match(client, /remoteVideo\.addEventListener\("click"/);
  assert.match(css, /lesson-comms-panel\.mini-video/);
  assert.match(css, /mini-video \.lesson-comms-local/);
  assert.match(css, /mini-video \.lesson-comms-controls/);
  assert.match(css, /left: 16px/);
});


test("Cloudflare TURN is forced for reliable remote calls and selected ICE pair is logged", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");
  assert.match(server, /source: "cloudflare-turn",[\s\S]{0,120}iceTransportPolicy: "relay"/);
  assert.match(client, /iceTransportPolicy: iceConfig\.iceTransportPolicy/);
  assert.match(client, /event: "selected-pair"/);
  assert.match(client, /candidateType/);
});


test("video capture and sender bitrate are tuned for lesson calls", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /width: \{ ideal: 640, max: 960 \}/);
  assert.match(client, /height: \{ ideal: 360, max: 540 \}/);
  assert.match(client, /frameRate: \{ ideal: 20, max: 24 \}/);
  assert.match(client, /maxBitrate = 500_000/);
  assert.match(client, /maxFramerate = 20/);
  assert.match(client, /degradationPreference = "maintain-framerate"/);
});


test("RTC quality monitor reports bandwidth jitter and packet loss without affecting calls", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /startRtcQualityMonitor/);
  assert.match(client, /availableOutgoingBitrate/);
  assert.match(client, /report\.jitter/);
  assert.match(client, /report\.packetsLost/);
  assert.match(client, /event: "quality"/);
  assert.match(client, /5000/);
});


test("Cloudflare TURN prefers TLS over TCP 443 for unstable UDP networks", () => {
  const server = read("server.js");
  assert.match(server, /\^turns:\.\*:443\\\?transport=tcp\$/i);
  assert.match(server, /tlsOnly\.length \? tlsOnly : payload\.iceServers/);
  assert.match(server, /iceTransportPolicy: "relay"/);
});


test("selected ICE pair diagnostics include relay transport protocol", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /relayProtocol/);
  assert.match(client, /event: "selected-pair"/);
});


test("incoming call ringtone is soft, repeating and stops with call state", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /new AudioContextClass\(\)/);
  assert.match(client, /oscillator\.type = "sine"/);
  assert.match(client, /window\.setInterval\(playRingtoneBubble, 2400\)/);
  assert.match(client, /function stopRingtone\(\)/);
  assert.match(client, /function resetIncomingCall\(\)[\s\S]{0,120}stopRingtone\(\)/);
  assert.match(client, /rtc:incoming-call[\s\S]{0,500}startRingtone\(\)/);
});

test("lesson video call uses friendly child-oriented visual treatment", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");
  assert.match(client, /lesson-comms-mascot/);
  assert.match(client, /Вы на занятии вместе/);
  assert.match(client, /К вам звонят/);
  assert.match(css, /lesson-comms-brand/);
  assert.match(css, /linear-gradient/);
  assert.match(css, /lesson-comms-controls button\.primary/);
});


test("explicit hangup ends the call for both participants while disconnect stays reconnectable", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");

  assert.match(server, /socket\.on\("rtc:leave"[\s\S]{0,260}rtc:ended/);
  assert.doesNotMatch(server, /socket\.on\("rtc:leave"[\s\S]{0,260}rtc:peer-left/);
  assert.match(server, /socket\.on\("disconnect"[\s\S]{0,500}rtc:peer-left/);

  assert.match(client, /socket\.on\("rtc:ended"/);
  assert.match(client, /Собеседник завершил звонок/);
  assert.match(client, /socket\.on\("rtc:peer-left"[\s\S]{0,400}Ждём переподключения/);
  assert.match(client, /finalState/);
});
