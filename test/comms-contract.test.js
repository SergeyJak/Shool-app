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

test("server routes call request accept decline and cancel only inside lesson room", () => {
  const server = read("server.js");
  assert.match(server, /socket\.on\("rtc:call"/);
  assert.match(server, /socket\.to\(room\)\.emit\("rtc:incoming-call"/);
  assert.match(server, /socket\.on\("rtc:accept"/);
  assert.match(server, /call\.caller\.emit\("rtc:accepted"/);
  assert.match(server, /socket\.on\("rtc:decline"/);
  assert.match(server, /socket\.on\("rtc:cancel"/);
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
  assert.match(server, /cloudflareTurnCache = \{[\s\S]{0,180}iceServers: payload\.iceServers/);
  assert.match(server, /return cloudflareTurnCache\.iceServers/);
  assert.doesNotMatch(server, /tlsOnly\.length \? tlsOnly : payload\.iceServers/);
  assert.doesNotMatch(server, /\^turns:\.\*:443\\\?transport=tcp\$\/i/);
  assert.match(server, /source: "hybrid-stun-cloudflare-turn",[\s\S]{0,120}iceTransportPolicy: "all"/);
});


test("selected ICE pair diagnostics include relay transport protocol", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /relayProtocol/);
  assert.match(client, /event: "selected-pair"/);
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


test("mobile chat keeps its switcher embedded so the composer stays usable", () => {
  const client = read("public/lesson-comms.mjs");
  const connectionCss = read("public/connections.css");

  assert.match(client, /launcher\.classList\.toggle\("embedded-chat-switcher", isConnection && !isVideo\)/);
  assert.match(client, /chatView\.insertBefore\(launcher, chatForm\)/);
  assert.match(connectionCss, /lesson-comms-launcher\.embedded-chat-switcher[\s\S]{0,240}position:static/);
  assert.match(connectionCss, /env\(safe-area-inset-bottom\)/);
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


test("route recovery keeps local media and active call intact", () => {
  const client = read("public/lesson-comms.mjs");
  const rebuildStart = client.indexOf('event: "peer-rebuild"');
  const rebuildEnd = client.indexOf("await createOffer(peerId)", rebuildStart);
  const rebuild = client.slice(rebuildStart, rebuildEnd);

  assert.doesNotMatch(rebuild, /track\.stop\(/);
  assert.doesNotMatch(rebuild, /localStream = null/);
  assert.doesNotMatch(rebuild, /activeCallId = null/);
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

test("RTC v2 routes signaling by stable client id instead of socket id", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");

  assert.match(server, /const rtc2CallsByLesson = new Map\(\)/);
  assert.match(server, /function rtc2SocketForClient\(lessonId, clientId\)/);
  assert.match(server, /socket\.on\("rtc2:signal"/);
  assert.match(server, /targetClientId/);
  assert.match(client, /socket\.emit\("rtc2:signal"/);
  assert.match(client, /targetClientId/);
  assert.doesNotMatch(client, /socket\.emit\("rtc:signal"/);
});

test("RTC v2 has one caller offerer and fresh peer per offer", () => {
  const client = read("public/lesson-comms.mjs");

  assert.match(client, /async function createFreshPeer\(targetClientId\)/);
  assert.match(client, /destroyPeer\(\);[\s\S]{0,200}peerClientId = targetClientId/);
  assert.match(client, /async function startOffer\(targetClientId/);
  assert.match(client, /const pc = await createFreshPeer\(targetClientId\)/);
  assert.match(client, /socket\.on\("rtc2:accepted"/);
});

test("RTC v2 reconnect resumes by stable call session", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");

  assert.match(server, /socket\.on\("rtc2:resume"/);
  assert.match(client, /function resumeRtc2Session/);
  assert.match(client, /resumeRtc2Session\("socket-reconnect"\)/);
  assert.match(client, /scheduleRtc2Resume\("network-change"\)/);
});

test("RTC v2 is cache-busted on lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261004-assets3/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261004-huawei-pdf3/);
  assert.match(read("public/student.html"), /app\.js\?v=20261004-huawei-pdf3/);
});


test("RTC v2 requires explicit accept before caller starts negotiation", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /socket\.emit\("rtc2:call"/);
  assert.match(client, /socket\.on\("rtc2:incoming-call"/);
  assert.match(client, /socket\.emit\("rtc2:accept"/);
  assert.match(client, /socket\.on\("rtc2:accepted"[\s\S]{0,700}startOffer\(peer\.clientId, "accepted"\)/);
});

test("RTC v2 preserves ringtone and explicit hangup behavior", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /function startRingtone\(\)/);
  assert.match(client, /rtc2:incoming-call[\s\S]{0,600}startRingtone\(\)/);
  assert.match(client, /hangupButton\.addEventListener\("click", \(\) => stopCall\(\)\)/);
  assert.match(client, /socket\.emit\("rtc2:leave"/);
  assert.match(client, /socket\.emit\("rtc2:cancel"/);
});

test("RTC v2 keeps calls isolated by call id and rebuilds peers fresh", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /activeCallId = crypto\.randomUUID\(\)/);
  assert.match(client, /payload\.callId !== activeCallId/);
  assert.match(client, /function destroyPeer\(\)/);
  assert.match(client, /async function createFreshPeer\(targetClientId\)/);
  assert.match(client, /destroyPeer\(\);[\s\S]{0,220}peerClientId = targetClientId/);
});

test("RTC v2 tunes lesson capture and sender bitrate", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /width: \{ ideal: 480, max: 640 \}/);
  assert.match(client, /height: \{ ideal: 270, max: 360 \}/);
  assert.match(client, /frameRate: \{ ideal: 15, max: 18 \}/);
  assert.match(client, /maxBitrate = 280_000/);
  assert.match(client, /maxFramerate = 15/);
  assert.match(client, /maxBitrate = 48_000/);
});

test("RTC v2 reconnect recovery is stable-client based and watchdog bounded", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");
  assert.match(server, /socket\.on\("rtc2:resume"/);
  assert.match(client, /let connectWatchdogTimer = null/);
  assert.match(client, /event: "connect-timeout-v2"/);
  assert.match(client, /resumeRtc2Session\("connect-timeout"\)/);
  assert.match(client, /resumeRtc2Session\("socket-reconnect"\)/);
  assert.match(client, /scheduleRtc2Resume\("network-change"\)/);
});

test("RTC v2 diagnostics keep network context and omit raw SDP or candidates from Mongo writes", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /function rtcNetworkSnapshot\(\)/);
  assert.match(client, /event: "network-change-v2"/);
  assert.match(server, /diagnosticCallId/);
  assert.match(server, /rtcDiagnostics\?\.insertOne\(\{/);
  const start = server.indexOf("rtcDiagnostics?.insertOne({");
  const end = server.indexOf("}).catch", start);
  const writeBlock = server.slice(start, end);
  assert.doesNotMatch(writeBlock, /\bsdp\b/);
  assert.doesNotMatch(writeBlock, /\bcandidate\b/);
});

test("RTC v2 cache bust is active on both lesson pages", () => {
  assert.match(read("public/app.js"), /lesson-comms\.mjs\?v=20261004-assets3/);
  assert.match(read("public/teacher.html"), /app\.js\?v=20261004-huawei-pdf3/);
  assert.match(read("public/student.html"), /app\.js\?v=20261004-huawei-pdf3/);
});


test("RTC v2 always targets the newest socket for a stable client id", () => {
  const server = read("server.js");
  assert.match(server, /socket\.data\.connectedAt = Date\.now\(\)/);
  assert.match(server, /function rtc2SocketForClient\(lessonId, clientId\)/);
  assert.match(server, /peer\.data\.connectedAt/);
  assert.match(server, /newest\.data\.connectedAt/);
});

test("RTC v2 deduplicates lesson recipients by stable client id", () => {
  const server = read("server.js");
  assert.match(server, /function rtc2UniquePeersForLesson\(lessonId, excludeClientId = null\)/);
  assert.match(server, /const peersByClientId = new Map\(\)/);
  assert.match(server, /const recipientPeers = rtc2UniquePeersForLesson\(lessonId, callerClientId\)/);
  assert.match(server, /const recipients = recipientPeers\.length/);
});


test("RTC v2 prevents concurrent lesson calls from replacing the active session", () => {
  const server = read("server.js");
  assert.match(server, /existing\.callId !== callId/);
  assert.match(server, /"CALL_IN_PROGRESS"/);
  assert.match(server, /"CALL_RINGING"/);
});

test("RTC v2 logs offer answer and candidate routing without SDP bodies", () => {
  const server = read("server.js");
  const client = read("public/lesson-comms.mjs");
  assert.match(server, /const signalKind = signal\.description\?\.type \|\| \(signal\.candidate \? "candidate" : "unknown"\)/);
  assert.match(server, /RTC2 signal lesson=/);
  assert.match(client, /event: "answer-v2"/);
  assert.match(client, /event: "answer-received-v2"/);
});


test("Cloudflare TURN credentials are cached and concurrent fetches are deduplicated", () => {
  const server = read("server.js");
  assert.match(server, /let cloudflareTurnCache = null/);
  assert.match(server, /let cloudflareTurnFetchPromise = null/);
  assert.match(server, /const CLOUDFLARE_TURN_CACHE_MS = 5 \* 60 \* 1000/);
  assert.match(server, /cloudflareTurnCache\?\.expiresAt > now/);
  assert.match(server, /if \(cloudflareTurnFetchPromise\) return cloudflareTurnFetchPromise/);
});

test("RTC v2 mobile media profile stays within measured relay bandwidth", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /width: \{ ideal: 480, max: 640 \}/);
  assert.match(client, /height: \{ ideal: 270, max: 360 \}/);
  assert.match(client, /frameRate: \{ ideal: 15, max: 18 \}/);
  assert.match(client, /maxBitrate = 280_000/);
  assert.match(client, /maxFramerate = 15/);
});


test("RTC v2 connect watchdog does not rebuild an ICE-connected route", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /\["connected", "completed"\]\.includes\(peerConnection\.iceConnectionState\)/);
  assert.match(client, /event: "connect-watchdog-grace-v2"/);
  const watchdogStart = client.indexOf("connectWatchdogTimer = setTimeout");
  const watchdogEnd = client.indexOf("}, 12000)", watchdogStart);
  const watchdog = client.slice(watchdogStart, watchdogEnd);
  assert.match(watchdog, /iceConnectionState/);
  assert.match(watchdog, /return;/);
});


test("RTC v2 does not rebuild a healthy peer on browser effectiveType changes", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /function|const rtc2NetworkChange/);
  assert.match(client, /!\["disconnected", "failed"\]\.includes\(peerConnection\.connectionState\)/);
  const start = client.indexOf("const rtc2NetworkChange");
  const end = client.indexOf("const rtc2Online", start);
  const block = client.slice(start, end);
  assert.match(block, /return;/);
  assert.match(block, /scheduleRtc2Resume\("network-change"\)/);
});

test("RTC v2 only resumes on online when the peer is not already connected", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /const rtc2Online = \(\) =>/);
  assert.match(client, /peerConnection\.connectionState !== "connected"/);
  assert.match(client, /scheduleRtc2Resume\("network-online"\)/);
  assert.match(client, /event: "network-offline-v2"/);
});


test("RTC v2 sends answer before flushing queued remote ICE candidates", () => {
  const client = read("public/lesson-comms.mjs");
  const start = client.indexOf('if (payload.description?.type === "offer")');
  const end = client.indexOf('if (payload.description?.type === "answer")', start);
  const block = client.slice(start, end);

  const answerSignal = block.indexOf("const result = await sendRtc2Signal");
  const remoteFlush = block.indexOf("flushRemoteCandidates(pc)");
  assert.ok(answerSignal >= 0);
  assert.ok(remoteFlush > answerSignal);
  assert.match(block, /event: "offer-remote-set-v2"/);
});

test("RTC v2 queued candidate flush failure does not block answer negotiation", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /flushRemoteCandidates\(pc\)\.catch/);
  assert.match(client, /event: "candidate-flush-error-v2"/);
});


test("RTC v2 prefetches and caches ICE config outside the peer critical path", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /const ICE_CONFIG_CLIENT_TTL_MS = 4 \* 60 \* 1000/);
  assert.match(client, /let iceConfigCache = null/);
  assert.match(client, /let iceConfigPromise = null/);
  assert.match(client, /function warmIceConfig\(\)/);
  assert.match(client, /warmIceConfig\(\);[\s\S]{0,120}updateMediaButtons\(\)/);
  assert.match(client, /event: "iceconfig-fetch-v2"/);
  assert.match(client, /event: "peer-iceconfig-ready-v2"/);
});

test("RTC v2 records answer creation and local-description timing", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /event: "answer-created-v2"/);
  assert.match(client, /event: "answer-local-set-v2"/);
  assert.match(client, /const answerStartedAt = performance\.now\(\)/);
});


test("RTC v2 gives transient disconnected state a grace period before rebuilding", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /reason === "connection-disconnected" \? 5000 : 1200/);
  assert.match(client, /event: "recovery-scheduled-v2"/);
  assert.match(client, /event: "recovery-skipped-v2"/);
  assert.match(client, /peerConnection\.connectionState === "connected"/);
  assert.match(client, /\["connected", "completed"\]\.includes\(peerConnection\.iceConnectionState\)/);
});

test("RTC v2 cancels pending recovery when the peer reconnects", () => {
  const client = read("public/lesson-comms.mjs");
  const connected = client.indexOf('if (pc.connectionState === "connected")');
  const block = client.slice(connected, connected + 900);
  assert.match(block, /if \(reconnectTimer\)/);
  assert.match(block, /clearTimeout\(reconnectTimer\)/);
  assert.match(block, /event: "recovery-cancelled-v2"/);
});


test("approved video call mock has friendly pre-call and active-call states", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");

  assert.match(client, /lesson-comms-placeholder/);
  assert.match(client, /скоро подключится/);
  assert.match(client, /lesson-comms-live/);
  assert.match(client, /lesson-comms-duration/);
  assert.match(client, /panel\.classList\.toggle\("call-active"/);
  assert.match(client, /panel\.classList\.toggle\("call-connected"/);
  assert.match(css, /Approved friendly video-call mock/);
  assert.match(css, /linear-gradient\(135deg,#8d6cf4,#7254e8\)/);
  assert.match(css, /lesson-comms-panel\.call-connected/);
  assert.match(css, /lesson-comms-hangup/);
});


test("video call UI uses the generated asset pack instead of emoji controls", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");

  assert.match(client, /09_32_41-1\.png/);
  assert.match(client, /09_32_42-2\.png/);
  assert.match(client, /09_32_43-3\.png/);
  assert.match(client, /09_32_44-4\.png/);
  assert.match(client, /09_32_45-5\.png/);
  assert.match(client, /09_32_45-6\.png/);
  assert.match(client, /09_32_46-7\.png/);
  assert.match(client, /09_32_48-8\.png/);
  assert.match(client, /09_32_49-9\.png/);
  assert.match(client, /09_32_49-10\.png/);
  assert.match(client, /lesson-comms-placeholder-image/);
  assert.match(client, /lesson-comms-button-icon/);
  assert.match(css, /asset-backed v2/);
  assert.match(css, /lesson-comms-placeholder-image/);
  assert.match(css, /lesson-comms-remote-fallback/);
  assert.match(css, /lesson-comms-local-fallback/);
});

test("video call copy adapts to teacher and student roles", () => {
  const client = read("public/lesson-comms.mjs");
  assert.match(client, /role === "teacher" \? "Ученик" : "Учитель"/);
  assert.match(client, /Позвонить \$\{role === "teacher" \? "ученику" : "учителю"\}/);
});


test("video call live-review polish keeps the primary CTA purple and separates pre-call from waiting", () => {
  const client = read("public/lesson-comms.mjs");
  const css = read("public/lesson-comms.css");
  assert.match(client, /remoteFallback/);
  assert.match(client, /role === "teacher"[\s\S]{0,350}09_32_43-3\.png/);
  assert.match(css, /button\.lesson-comms-start\.primary/);
  assert.match(css, /call-active \.lesson-comms-placeholder/);
  assert.match(css, /call-active \.lesson-comms-remote-fallback/);
  assert.match(css, /transform: scale\(1\.6\)/);
});


test("chat history reloads after socket connects when chat is already open", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "lesson-comms.mjs"), "utf8");
  assert.match(
    source,
    /socket\.on\("connect", \(\) => \{[\s\S]*?currentView === "chat"[\s\S]*?historyLoaded = false;[\s\S]*?loadChatHistory\(\)/
  );
});


test("persistent connection chat treats role side as message ownership", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "lesson-comms.mjs"), "utf8");
  assert.match(source, /if \(isConnection\) return message\.role === role;/);
});

test("persistent connection chat supports edit delete and emoji picker", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "lesson-comms.mjs"), "utf8");
  assert.match(source, /chat:edit/);
  assert.match(source, /chat:delete/);
  assert.match(source, /lesson-comms-emoji-picker/);
  assert.match(source, /Редактирование сообщения/);
});


test("connection chat embeds switcher and portals message menu", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "lesson-comms.mjs"), "utf8");
  assert.match(source, /embedded-chat-switcher/);
  assert.match(source, /chatView\.insertBefore\(launcher, chatForm\)/);
  assert.match(source, /connection-menu-portal/);
  assert.match(source, /document\.body\.appendChild\(menu\)/);
});
