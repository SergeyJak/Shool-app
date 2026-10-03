import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const modulePath = path.join(root, "public", "lesson-comms.mjs");

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("Headless Chrome/Chromium is required for RTC browser tests");

let iceConfigRequests = 0;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RTC_E2E:PENDING</title>
</head>
<body>
<script type="module">
  import { initLessonComms } from "/lesson-comms.mjs";

  const result = {
    connectedRoles: [],
    firstOfferToAnswerMs: null,
    resumeCalls: 0,
    networkChangeDidNotResume: false,
    reconnectRecovered: false,
    repeatedCallRecovered: false,
    remoteVideoTracks: 0,
    debugTail: [],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(predicate, label, timeoutMs = 12000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (predicate()) return;
      await sleep(50);
    }
    throw new Error("Timed out waiting for " + label);
  }

  class FakeSocket {
    constructor(bus, role, clientId) {
      this.bus = bus;
      this.role = role;
      this.clientId = clientId;
      this.connected = true;
      this.id = "socket-" + role;
      this.handlers = new Map();
    }

    on(event, handler) {
      const list = this.handlers.get(event) || [];
      list.push(handler);
      this.handlers.set(event, list);
    }

    emit(event, ...args) {
      const maybeAck = args.at(-1);
      const ack = typeof maybeAck === "function" ? maybeAck : undefined;
      const payload = args[0] ?? {};
      this.bus.handle(this, event, payload, ack);
    }

    deliver(event, payload) {
      for (const handler of this.handlers.get(event) || []) {
        handler(payload);
      }
    }
  }

  class FakeRtc2Bus {
    constructor() {
      this.sockets = [];
      this.session = null;
      this.debug = [];
      this.signalTimeline = [];
      this.resumeCalls = 0;
    }

    add(role, clientId) {
      const socket = new FakeSocket(this, role, clientId);
      this.sockets.push(socket);
      return socket;
    }

    other(socket) {
      return this.sockets.find((candidate) => candidate !== socket);
    }

    byClientId(clientId) {
      return this.sockets.find((candidate) => candidate.clientId === clientId);
    }

    handle(socket, event, payload, ack) {
      if (event === "rtc:debug") {
        this.debug.push({
          role: socket.role,
          event: payload?.event || "",
          state: payload?.state || "",
        });
        result.debugTail = this.debug.slice(-30);
        ack?.({ ok: true });
        return;
      }

      if (event === "chat:history") {
        ack?.({ ok: true, currentUserId: socket.role, messages: [] });
        return;
      }
      if (event === "chat:send") {
        ack?.({ ok: true });
        return;
      }

      if (event === "rtc2:call") {
        this.session = {
          callId: payload.callId,
          callerClientId: socket.clientId,
          calleeClientId: null,
          accepted: false,
        };
        const peer = this.other(socket);
        peer?.deliver("rtc2:incoming-call", {
          callId: payload.callId,
          caller: {
            clientId: socket.clientId,
            role: socket.role,
            displayName: socket.role,
          },
        });
        ack?.({ ok: true, recipients: peer ? 1 : 0 });
        return;
      }

      if (event === "rtc2:accept") {
        if (!this.session || this.session.callId !== payload.callId) {
          ack?.({ ok: false, error: "CALL_NOT_FOUND" });
          return;
        }
        this.session.accepted = true;
        this.session.calleeClientId = socket.clientId;
        const caller = this.byClientId(this.session.callerClientId);
        caller?.deliver("rtc2:accepted", {
          callId: this.session.callId,
          peer: {
            clientId: socket.clientId,
            role: socket.role,
            displayName: socket.role,
          },
        });
        ack?.({
          ok: true,
          callId: this.session.callId,
          caller: caller
            ? {
                clientId: caller.clientId,
                role: caller.role,
                displayName: caller.role,
              }
            : null,
        });
        return;
      }

      if (event === "rtc2:signal") {
        const kind = payload.description?.type || (payload.candidate ? "candidate" : "unknown");
        this.signalTimeline.push({
          kind,
          at: performance.now(),
          from: socket.role,
        });
        const target = this.byClientId(payload.targetClientId);
        target?.deliver("rtc2:signal", {
          callId: payload.callId,
          fromClientId: socket.clientId,
          description: payload.description,
          candidate: payload.candidate,
        });
        ack?.({ ok: Boolean(target) });
        return;
      }

      if (event === "rtc2:resume") {
        this.resumeCalls += 1;
        result.resumeCalls = this.resumeCalls;
        const session = this.session;
        if (!session || session.callId !== payload.callId) {
          ack?.({ ok: false, error: "CALL_NOT_FOUND" });
          return;
        }
        const caller = socket.clientId === session.callerClientId;
        const peerClientId = caller ? session.calleeClientId : session.callerClientId;
        const peer = this.byClientId(peerClientId);
        peer?.deliver("rtc2:restart", {
          callId: session.callId,
          peerClientId: socket.clientId,
          offerer: peerClientId === session.callerClientId,
        });
        ack?.({
          ok: true,
          peerClientId,
          peerOnline: Boolean(peer),
          offerer: caller,
        });
        return;
      }

      if (event === "rtc2:leave") {
        const session = this.session;
        if (session?.callId === payload.callId) {
          const peerClientId =
            socket.clientId === session.callerClientId
              ? session.calleeClientId
              : session.callerClientId;
          this.byClientId(peerClientId)?.deliver("rtc2:ended", {
            callId: session.callId,
            fromClientId: socket.clientId,
          });
          this.session = null;
        }
        ack?.({ ok: true });
        return;
      }

      if (event === "rtc2:cancel") {
        const session = this.session;
        if (session?.callId === payload.callId) {
          this.other(socket)?.deliver("rtc2:cancelled", {
            callId: session.callId,
            callerClientId: socket.clientId,
          });
          this.session = null;
        }
        ack?.({ ok: true });
        return;
      }

      if (event === "rtc2:decline") {
        const session = this.session;
        if (session?.callId === payload.callId) {
          this.byClientId(session.callerClientId)?.deliver("rtc2:declined", {
            callId: session.callId,
          });
          this.session = null;
        }
        ack?.({ ok: true });
        return;
      }

      ack?.({ ok: true });
    }
  }

  const bus = new FakeRtc2Bus();
  const teacher = bus.add("teacher", "teacher-client");
  const student = bus.add("student", "student-client");

  initLessonComms({
    socket: teacher,
    role: "teacher",
    lessonId: "rtc-e2e-lesson",
    showSnackbar: () => {},
  });
  initLessonComms({
    socket: student,
    role: "student",
    lessonId: "rtc-e2e-lesson",
    showSnackbar: () => {},
  });

  const starts = [...document.querySelectorAll(".lesson-comms-start")];
  const accepts = [...document.querySelectorAll(".lesson-comms-accept")];
  const hangups = [...document.querySelectorAll(".lesson-comms-hangup")];
  const remoteVideos = [...document.querySelectorAll(".lesson-comms-remote")];

  if (starts.length !== 2 || accepts.length !== 2 || hangups.length !== 2) {
    throw new Error("Expected two independent lesson communication UIs");
  }

  starts[0].click();
  await waitFor(
    () => !document.querySelectorAll(".lesson-comms-incoming")[1].hidden,
    "student incoming call"
  );
  accepts[1].click();

  await waitFor(
    () => bus.debug.filter((entry) => entry.event === "connectionstate-v2" && entry.state === "connected").length >= 2,
    "first call connected",
    15000
  );

  const firstOffer = bus.signalTimeline.find((entry) => entry.kind === "offer");
  const firstAnswer = bus.signalTimeline.find((entry) => entry.kind === "answer");
  if (!firstOffer || !firstAnswer) throw new Error("Missing offer/answer in first call");
  result.firstOfferToAnswerMs = Math.round(firstAnswer.at - firstOffer.at);
  if (result.firstOfferToAnswerMs > 3000) {
    throw new Error("First SDP answer took too long: " + result.firstOfferToAnswerMs + "ms");
  }

  await waitFor(
    () => remoteVideos.every((video) => video.srcObject?.getVideoTracks?.().length > 0),
    "remote video tracks",
    10000
  );
  result.remoteVideoTracks = remoteVideos.reduce(
    (sum, video) => sum + (video.srcObject?.getVideoTracks?.().length || 0),
    0
  );

  const resumesBeforeNetworkChange = bus.resumeCalls;
  if (navigator.connection?.dispatchEvent) {
    navigator.connection.dispatchEvent(new Event("change"));
    await sleep(1600);
    if (bus.resumeCalls !== resumesBeforeNetworkChange) {
      throw new Error("Healthy peer resumed after navigator.connection change");
    }
    result.networkChangeDidNotResume = true;
  } else {
    result.networkChangeDidNotResume = true;
  }

  const connectedBeforeReconnect = bus.debug.filter(
    (entry) => entry.event === "connectionstate-v2" && entry.state === "connected"
  ).length;
  teacher.deliver("connect");
  await waitFor(
    () =>
      bus.debug.filter(
        (entry) => entry.event === "connectionstate-v2" && entry.state === "connected"
      ).length >= connectedBeforeReconnect + 2,
    "socket reconnect recovery",
    15000
  );
  result.reconnectRecovered = true;

  hangups[0].click();
  await waitFor(() => bus.session === null, "first call hangup");

  const connectedBeforeSecondCall = bus.debug.filter(
    (entry) => entry.event === "connectionstate-v2" && entry.state === "connected"
  ).length;

  starts[0].click();
  await waitFor(
    () => !document.querySelectorAll(".lesson-comms-incoming")[1].hidden,
    "second incoming call"
  );
  accepts[1].click();
  await waitFor(
    () =>
      bus.debug.filter(
        (entry) => entry.event === "connectionstate-v2" && entry.state === "connected"
      ).length >= connectedBeforeSecondCall + 2,
    "second call connected",
    15000
  );
  result.repeatedCallRecovered = true;

  result.connectedRoles = [
    ...new Set(
      bus.debug
        .filter((entry) => entry.event === "connectionstate-v2" && entry.state === "connected")
        .map((entry) => entry.role)
    ),
  ];

  document.title = "RTC_E2E:" + encodeURIComponent(JSON.stringify(result));
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/lesson-comms.mjs")) {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    fs.createReadStream(modulePath).pipe(res);
    return;
  }

  if (req.url?.startsWith("/api/webrtc/config")) {
    iceConfigRequests += 1;
    if (iceConfigRequests === 2) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        iceServers: [],
        source: "rtc-browser-e2e",
        iceTransportPolicy: "all",
      })
    );
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/`;

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--disable-features=MediaStreamTrackWebRtcStats",
    "--virtual-time-budget=30000",
    "--dump-dom",
    url,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => {
  child.kill("SIGKILL");
}, 45000);

const exitCode = await new Promise((resolve) => child.on("close", resolve));
clearTimeout(timeout);
server.close();

if (exitCode !== 0) {
  throw new Error(
    `RTC browser Chrome failed with ${exitCode}: ${stderr.slice(-2000)}\n${stdout.slice(-1000)}`
  );
}

const matches = [...stdout.matchAll(/<title>RTC_E2E:([^<]+)<\/title>/g)];
const encoded = matches.map((match) => match[1]).find((value) => value !== "PENDING");
if (!encoded) {
  throw new Error(
    `RTC browser test returned no final result; stderr=${stderr.slice(-1200)} stdout=${stdout.slice(-2000)}`
  );
}

const result = JSON.parse(decodeURIComponent(encoded));

if (!result.connectedRoles.includes("teacher") || !result.connectedRoles.includes("student")) {
  throw new Error(`Both peers did not connect: ${JSON.stringify(result)}`);
}
if (result.remoteVideoTracks < 2) {
  throw new Error(`Remote media was not established for both peers: ${JSON.stringify(result)}`);
}
if (!result.networkChangeDidNotResume) {
  throw new Error(`Network change regression: ${JSON.stringify(result)}`);
}
if (!result.reconnectRecovered) {
  throw new Error(`Socket reconnect recovery failed: ${JSON.stringify(result)}`);
}
if (!result.repeatedCallRecovered) {
  throw new Error(`Repeated call recovery failed: ${JSON.stringify(result)}`);
}

console.log(
  `✓ RTC browser E2E: offer→answer ${result.firstOfferToAnswerMs}ms, remote video on both peers, reconnect/repeat/network-change scenarios passed`
);
