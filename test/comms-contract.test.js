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
    assert.match(read(file), /app\.js\?v=20261003-recovery5/);
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
  assert.match(server, /source: "hybrid-stun-cloudflare-turn"/);
  assert.match(server, /source: "static-fallback"/);
});


test("video call can collapse to opponent-only mini window and restore on click", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");
  assert.match(client, /lesson-comms-minimize/);
  assert.match(client, /lesson-comms-close/);
  assert.match(client, /panel\.classList\.add\("mini-video"\)/);
  assert.match(client, /panel\.classList\.remove\("mini-video"\)/);
  assert.match(client, /remoteVideo\.addEventListener\("click"/);
  assert.match(css, /lesson-comms-panel\.mini-video/);
  assert.match(css, /mini-video \.lesson-comms-local/);
  assert.match(css, /mini-video \.lesson-comms-controls/);
  assert.match(css, /left: 16px/);
});


test("Cloudflare TURN remains available while direct ICE fallback is allowed", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");
  assert.match(server, /source: "hybrid-stun-cloudflare-turn",[\s\S]{0,120}iceTransportPolicy: "all"/);
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


test("Cloudflare TURN keeps transport fallbacks without relay-only ICE", () => {
  const server = read("server.js");
  assert.match(server, /return payload\.iceServers/);
  assert.doesNotMatch(server, /tlsOnly\.length \? tlsOnly : payload\.iceServers/);
  assert.doesNotMatch(server, /\^turns:\.\*:443\\\?transport=tcp\$\/i/);
  assert.match(server, /source: "hybrid-stun-cloudflare-turn",[\s\S]{0,120}iceTransportPolicy: "all"/);
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

  const leaveStart = server.indexOf('socket.on("rtc:leave"');
  const chatStart = server.indexOf('socket.on("chat:history"', leaveStart);
  const leaveBlock = server.slice(leaveStart, chatStart);

  assert.match(leaveBlock, /rtc:ended/);
  assert.doesNotMatch(leaveBlock, /rtc:peer-left/);
  assert.match(server, /socket\.on\("disconnect"[\s\S]{0,500}rtc:peer-left/);

  assert.match(client, /socket\.on\("rtc:ended"/);
  assert.match(client, /Собеседник завершил звонок/);
  assert.match(client, /socket\.on\("rtc:peer-left"[\s\S]{0,400}Ждём переподключения/);
  assert.match(client, /finalState/);
});


test("kid-friendly call controls stay minimal and hide hangup before a call", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");

  assert.match(client, /lesson-comms-start primary/);
  assert.match(client, /lesson-comms-hangup danger call-control/);
  assert.match(client, /button\.hidden = !callIsActive/);
  assert.match(client, /startButton\.hidden = callIsActive/);
  assert.match(client, /Свернуть/);
  assert.match(client, /lesson-comms-close/);
  assert.match(client, /Закрыть/);
  assert.match(css, /grid-template-columns: repeat\(3/);
  assert.match(css, /call-control\[hidden\]/);
});

test("incoming ringtone is clearly audible but remains soft", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /exponentialRampToValueAtTime\(0\.16/);
  assert.match(client, /oscillator\.type = "sine"/);
});


test("window actions clearly separate minimize close and hangup", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");

  assert.match(client, /lesson-comms-window-actions/);
  assert.match(client, /lesson-comms-minimize/);
  assert.match(client, /lesson-comms-close/);
  assert.match(client, /Свернуть/);
  assert.match(client, /Закрыть/);
  assert.match(client, /closeButton\.addEventListener\("click", closePanel\)/);
  assert.match(client, /lesson-comms-hangup danger call-control/);
  assert.match(css, /lesson-comms-window-actions/);
});


test("incoming call hides the outgoing call action until the incoming state ends", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /const incomingCallPending = Boolean\(pendingCallerId\)/);
  assert.match(client, /startButton\.hidden = callIsActive \|\| incomingCallPending/);
  assert.match(client, /function resetIncomingCall\(\)[\s\S]{0,220}pendingCallerId = null/);
});


test("answering stops the ringtone immediately before media setup", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(
    client,
    /acceptButton\.addEventListener\("click",[\s\S]{0,180}stopRingtone\(\)[\s\S]{0,220}acquireLocalMedia/
  );
  assert.match(
    client,
    /function stopRingtone\(\)[\s\S]{0,260}ringtoneContext\.suspend\(\)/
  );
});


test("chat opening does not summon the mobile keyboard automatically", () => {
  const client = read("public/lesson-comms.mjs");
  const showViewStart = client.indexOf("function showView(view)");
  const closePanelStart = client.indexOf("function closePanel()", showViewStart);
  const showView = client.slice(showViewStart, closePanelStart);

  assert.match(showView, /loadChatHistory\(\)/);
  assert.doesNotMatch(showView, /chatInput\.focus/);
});

test("lesson starts in hand mode instead of drawing mode", () => {
  const app = read("public/app.js");
  assert.match(app, /let tool = "hand"/);

  for (const file of ["public/teacher.html", "public/student.html"]) {
    const html = read(file);
    assert.match(html, /id="handBtn" class="active"/);
    assert.doesNotMatch(html, /id="penBtn" class="active/);
  }
});


test("mobile chat remains scrollable without trapping the page", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");

  assert.match(client, /visualViewport/);
  assert.match(client, /--lesson-viewport-height/);
  assert.match(css, /lesson-comms-messages[\s\S]{0,260}touch-action: pan-y/);
  assert.match(css, /overscroll-behavior: contain/);
  assert.match(css, /max-height: min\(34dvh, 300px\)/);
});


test("chat hides the video-only minimize action", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /minimizeButton\.hidden = !isVideo/);
  assert.match(client, /titleEl\.textContent = isVideo \? "Видеосвязь" : "Чат занятия"/);
});


test("mobile hand mode lets the page scroll vertically while preserving pinch zoom", () => {
  const app = read("public/app.js");
  const pdfCss = read("public/pdf-view.css");
  const styles = read("public/styles.css");

  assert.match(app, /let tool = "hand"/);
  assert.match(app, /setTool\(tool\)[\s\S]{0,120}penBtn\.addEventListener/);
  assert.match(pdfCss, /#stage\.hand-mode[\s\S]{0,260}overflow-y: visible/);
  assert.match(pdfCss, /overscroll-behavior-y: auto/);
  assert.match(pdfCss, /touch-action: pan-y pinch-zoom/);
  assert.match(styles, /#stage\.hand-mode[\s\S]{0,180}touch-action: pan-y pinch-zoom/);
  assert.match(app, /event\.touches\.length !== 2/);
});


test("hand mode pans the page when dragging directly on the PDF", () => {
  const app = read("public/app.js");

  assert.match(app, /let handPanLastTouch = null/);
  assert.match(app, /event\.touches\.length === 1 && handPanLastTouch/);
  assert.match(app, /window\.scrollBy\(0, deltaY\)/);
  assert.match(app, /stage\.scrollLeft \+= deltaX/);
  assert.match(app, /event\.touches\.length !== 2 \|\| !pinchStartDistance/);
  assert.match(app, /touchcancel/);
});


test("pinch zoom keeps the gesture center anchored and defers PDF rendering", () => {
  const app = read("public/app.js");

  assert.match(app, /function touchCenter\(touches\)/);
  assert.match(app, /anchorX: originX \/ rect\.width/);
  assert.match(app, /anchorY: originY \/ rect\.height/);
  assert.match(app, /shell\.style\.transformOrigin/);
  assert.match(app, /shell\.style\.transform =[\s\S]{0,180}translate/);
  assert.match(app, /scale\(\$\{scale\}\)/);
  assert.match(app, /async function finishPinchGesture\(\)/);
  assert.match(app, /await renderPage\(\)/);
  assert.match(app, /stage\.scrollLeft \+= anchorScreenX - targetCenter\.x/);
  assert.match(app, /window\.scrollBy\(0, anchorScreenY - targetCenter\.y\)/);
  assert.doesNotMatch(
    app,
    /event\.touches\.length !== 2[\s\S]{0,500}setZoom\(nextZoom\)/
  );
});


test("sending chat keeps the textarea focused and keyboard stable", () => {
  const client = read("public/lesson-comms.mjs");
  const submitStart = client.indexOf('chatForm.addEventListener("submit"');
  const keydownStart = client.indexOf('chatInput.addEventListener("keydown"', submitStart);
  const submitBlock = client.slice(submitStart, keydownStart);

  assert.match(client, /chatSubmitButton/);
  assert.doesNotMatch(submitBlock, /chatInput\.disabled/);
  assert.doesNotMatch(submitBlock, /chatInput\.focus/);
  assert.match(submitBlock, /chatSubmitButton\.disabled = true/);
  assert.match(submitBlock, /chatSubmitButton\.disabled = false/);
  assert.match(submitBlock, /chatInput\.value = ""/);
});


test("send button does not steal focus from the chat input on touch devices", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /chatSubmitButton\?\.addEventListener\("pointerdown"/);
  assert.match(client, /document\.activeElement === chatInput/);
  assert.match(client, /event\.preventDefault\(\)/);
});


test("mobile chat hides its launcher so the composer stays usable", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");

  assert.match(client, /launcher\.classList\.toggle\("chat-open", !isVideo\)/);
  assert.match(client, /launcher\.classList\.remove\("chat-open"\)/);
  assert.match(css, /lesson-comms-launcher\.chat-open[\s\S]{0,100}display: none/);
  assert.match(css, /--lesson-viewport-height/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});


test("repeated WebRTC calls are isolated by call id and clean old quality monitors", () => {
  const client = read("public/lesson-comms.mjs");
  const server = read("server.js");
  const realtime = read("lib/realtime-comms.js");

  assert.match(client, /let activeCallId = null/);
  assert.match(client, /activeCallId = crypto\.randomUUID\(\)/);
  assert.match(client, /socket\.emit\("rtc:call", \{ callId: activeCallId \}/);
  assert.match(client, /payload\.callId !== activeCallId/);
  assert.match(client, /callId !== activeCallId/);
  assert.match(client, /let rtcQualityTimer = null/);
  assert.match(client, /clearInterval\(rtcQualityTimer\)/);

  assert.match(server, /function normalizeRtcCallId/);
  assert.match(server, /rtcCallId/);
  assert.match(server, /signal\.callId/);
  assert.match(server, /rtc:ended", \{ from: socket\.id, callId \}/);

  assert.match(realtime, /const callId/);
  assert.match(realtime, /return \{ callId, targetId/);
});


test("accepting installs the call id before signaling can race the ack", () => {
  const client = read("public/lesson-comms.mjs");
  const server = read("server.js");

  const acceptStart = client.indexOf('acceptButton.addEventListener("click"');
  const declineStart = client.indexOf('declineButton.addEventListener("click"', acceptStart);
  const acceptBlock = client.slice(acceptStart, declineStart);

  assert.match(
    acceptBlock,
    /activeCallId = callId[\s\S]{0,300}acquireLocalMedia\(\)[\s\S]{0,500}socket\.emit\("rtc:accept"/
  );
  assert.match(
    acceptBlock,
    /if \(!result\?\.ok\)[\s\S]{0,160}activeCallId = null/
  );
  assert.match(
    server,
    /socket\.on\("disconnect"[\s\S]{0,320}rtc:cancelled"[\s\S]{0,120}callId: call\.callId/
  );
});


test("WebRTC protocol changes are cache-busted on lesson pages", () => {
  const app = read("public/app.js");
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");

  assert.match(app, /lesson-comms\.mjs\?v=20261003-recovery5/);
  assert.match(teacher, /app\.js\?v=20261003-recovery5/);
  assert.match(student, /app\.js\?v=20261003-recovery5/);
});


test("failed WebRTC peers are never reused across call generations", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /let peerCallId = null/);
  assert.match(
    client,
    /activePeerId === peerId[\s\S]{0,160}peerCallId === activeCallId[\s\S]{0,180}!\["failed", "closed"\]\.includes/
  );
  assert.match(client, /peerCallId = connectionCallId/);
  assert.match(client, /peerCallId = null/);
});

test("network handover can trigger one ICE restart before watchdog rebuild", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /let iceRestartAttempts = 0/);
  assert.match(client, /iceRestartAttempts >= 1/);
  assert.match(client, /createOffer\(peerId, \{ iceRestart: true \}\)/);
  assert.match(client, /createOffer\(iceRestart \? \{ iceRestart: true \} : undefined\)/);
  assert.match(client, /event: "ice-restart"/);
  assert.match(client, /armRecoveryWatchdog\(peerId\)/);
});

test("network handover WebRTC fix is cache-busted on lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261003-recovery5/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261003-recovery5/);
  assert.match(read("public/student.html"), /app\.js\?v=20261003-recovery5/);
});


test("hybrid ICE config keeps independent STUN alongside Cloudflare TURN", () => {
  const server = read("server.js");

  assert.match(server, /if \(WEBRTC_STUN_URLS\.length\) iceServers\.push\(\{ urls: WEBRTC_STUN_URLS \}\)/);
  assert.match(server, /iceServers\.push\(\.\.\.cloudflareIceServers\)/);
  assert.match(server, /source: "hybrid-stun-cloudflare-turn"/);
  assert.match(server, /iceTransportPolicy: "all"/);
});


test("RTC signaling can rebind a stale socket target to the same stable client", () => {
  const server = read("server.js");

  assert.match(server, /const rtcDisconnectedPeers = new Map\(\)/);
  assert.match(server, /function rememberDisconnectedRtcPeer\(socket\)/);
  assert.match(server, /realtimeClientId\(socket\.handshake\.auth\?\.clientId\)/);
  assert.match(server, /function findReplacementRtcPeer\(staleTargetId, callId\)/);
  assert.match(server, /String\(peer\.data\.user\?\._id \|\| ""\) === stale\.userId/);
  assert.match(server, /realtimeClientId\(peer\.handshake\.auth\?\.clientId\) === stale\.clientId/);
  assert.match(server, /RTC signal rebound/);
  assert.match(server, /target\.data\.rtcReady = true/);
  assert.match(server, /target\.data\.rtcCallId = signal\.callId/);
});

test("RTC stale target rebinding is bounded by call id and expiry", () => {
  const server = read("server.js");

  assert.match(server, /RTC_DISCONNECTED_PEER_TTL_MS = 60_000/);
  assert.match(server, /if \(stale\.expiresAt < Date\.now\(\)\)/);
  assert.match(server, /if \(stale\.callId !== callId\) return null/);
});


test("failed media routes escalate from ICE restart to a fresh peer connection", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /event: "ice-restart"/);
  assert.match(client, /createOffer\(peerId, \{ iceRestart: true \}\)/);
  assert.match(client, /recoveryWatchdogTimer = setTimeout\(\(\) => \{/);
  assert.match(client, /event: "recovery-timeout"/);
  assert.match(client, /rebuildPeerAfterRouteFailure\(peerId\)/);
  assert.match(client, /event: "peer-rebuild"/);
  assert.match(client, /peerConnection = null/);
  assert.match(client, /peerCallId = null/);
  assert.match(client, /pc\.close\(\)/);
  assert.match(client, /await createOffer\(peerId\)/);
});

test("route recovery keeps local media and active call intact", () => {
  const client = read("public/lesson-comms.mjs");
  const rebuildStart = client.indexOf('event: "peer-rebuild"');
  const rebuildEnd = client.indexOf("await createOffer(peerId)", rebuildStart);
  const rebuild = client.slice(rebuildStart, rebuildEnd);

  assert.doesNotMatch(rebuild, /track\.stop\(/);
  assert.doesNotMatch(rebuild, /localStream = null/);
  assert.doesNotMatch(rebuild, /activeCallId = null/);
});

test("peer rebuild recovery is cache-busted on lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261003-recovery5/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261003-recovery5/);
  assert.match(read("public/student.html"), /app\.js\?v=20261003-recovery5/);
});


test("RTC diagnostics are persisted with TTL and call correlation", () => {
  const server = read("server.js");

  assert.match(server, /rtcDiagnostics = db\.collection\(collectionName\("rtc_diagnostics"\)\)/);
  assert.match(server, /rtcDiagnostics\.createIndex\(\{ lessonId: 1, createdAt: -1 \}\)/);
  assert.match(server, /rtcDiagnostics\.createIndex\(\{ callId: 1, createdAt: 1 \}\)/);
  assert.match(server, /rtcDiagnostics\.createIndex\(\{ expiresAt: 1 \}, \{ expireAfterSeconds: 0 \}\)/);
  assert.match(server, /rtcDiagnostics\?\.insertOne\(\{/);
  assert.match(server, /callId: socket\.data\.rtcCallId \|\| null/);
  assert.match(server, /expiresAt: new Date\(now\.getTime\(\) \+ 14 \* 24 \* 60 \* 60 \* 1000\)/);
});

test("RTC diagnostics include network context without SDP or candidate bodies", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /function rtcNetworkSnapshot\(\)/);
  assert.match(client, /function emitRtcDebug\(payload = \{\}\)/);
  assert.match(client, /event: "network-change"/);
  assert.match(server, /effectiveType:/);
  assert.match(server, /downlink:/);
  assert.match(server, /rtt:/);
  assert.doesNotMatch(server, /rtcDiagnostics\?\.insertOne\([\s\S]{0,900}\bsdp\b/);
  assert.doesNotMatch(server, /rtcDiagnostics\?\.insertOne\([\s\S]{0,900}\bcandidate\b/);
});


test("route recovery rebuilds peers stuck connecting after ICE restart", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /\["connected", "closed"\]\.includes\(pc\.connectionState\)/);
  assert.match(client, /event: "recovery-timeout"/);
  assert.match(client, /rebuildPeerAfterRouteFailure\(peerId\)/);
  assert.doesNotMatch(client, /event: "recovery-timeout"[\s\S]{0,300}scheduleIceRestart\(\)/);
  assert.match(client, /event: "peer-rebuild"/);
});

test("stuck-connecting recovery is cache-busted on lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261003-recovery5/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261003-recovery5/);
  assert.match(read("public/student.html"), /app\.js\?v=20261003-recovery5/);
});


test("RTC recovery watchdog directly rebuilds a peer instead of re-entering restart scheduling", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /let recoveryWatchdogTimer = null/);
  assert.match(client, /function|const rebuildPeerAfterRouteFailure/);
  assert.match(client, /event: "recovery-timeout"/);
  assert.match(client, /rebuildPeerAfterRouteFailure\(peerId\)/);
  assert.doesNotMatch(client, /event: "recovery-timeout"[\s\S]{0,300}scheduleIceRestart\(\)/);
  assert.match(client, /armRecoveryWatchdog\(peerId\)[\s\S]{0,220}createOffer\(peerId, \{ iceRestart: true \}\)/);
});

test("RTC recovery watchdog is cleared when connection recovers or call closes", () => {
  const client = read("public/lesson-comms.mjs");

  const clears = client.match(/clearTimeout\(recoveryWatchdogTimer\)/g) || [];
  assert.ok(clears.length >= 2);
  assert.match(client, /event: "peer-rebuild"/);
  assert.match(client, /await createOffer\(peerId\)/);
});

test("direct peer rebuild recovery is cache-busted on lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261003-recovery5/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261003-recovery5/);
  assert.match(read("public/student.html"), /app\.js\?v=20261003-recovery5/);
});


test("initial WebRTC connects are rebuilt when they remain stuck connecting", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /let initialConnectWatchdogTimer = null/);
  assert.match(client, /function armInitialConnectWatchdog\(peerId, pc\)/);
  assert.match(client, /event: "initial-connect-timeout"/);
  assert.match(client, /state: "reason=initial-connect-timeout"/);
  assert.match(client, /if \(!iceRestart\) armInitialConnectWatchdog\(peerId, pc\)/);
  assert.match(client, /\}, 12000\)/);
});

test("initial-connect watchdog is cancelled after connection or call close", () => {
  const client = read("public/lesson-comms.mjs");
  const clears = client.match(/clearTimeout\(initialConnectWatchdogTimer\)/g) || [];
  assert.ok(clears.length >= 2);
});

test("initial-connect watchdog recovery is cache-busted on lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261003-recovery5/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261003-recovery5/);
  assert.match(read("public/student.html"), /app\.js\?v=20261003-recovery5/);
});
