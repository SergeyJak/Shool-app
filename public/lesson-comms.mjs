export function initLessonComms({ socket, role, lessonId, showSnackbar }) {
  if (!socket || role === "observer") return;

  let localStream = null;
  let remoteStream = null;
  let peerConnection = null;
  let activePeerId = null;
  let pendingCandidates = [];
  let callStarted = false;
  let historyLoaded = false;
  let currentView = null;
  let unread = 0;
  let currentUserId = null;
  let pendingCallerId = null;
  let outgoingCall = false;
  let callAccepted = false;

  const launcher = document.createElement("div");
  launcher.className = "lesson-comms-launcher";
  launcher.innerHTML = `
    <button class="lesson-comms-video-button" type="button">🎥 Связь</button>
    <button class="lesson-comms-chat-button" type="button">💬 Чат <span class="lesson-comms-unread" hidden></span></button>
  `;

  const panel = document.createElement("section");
  panel.className = "lesson-comms-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="lesson-comms-head">
      <strong class="lesson-comms-title">Связь</strong>
      <button class="lesson-comms-minimize" type="button" aria-label="Свернуть видео" title="Свернуть видео">↙</button>
      <button class="lesson-comms-close" type="button" aria-label="Закрыть">×</button>
    </div>
    <div class="lesson-comms-view lesson-comms-video">
      <div class="lesson-comms-incoming" hidden>
        <div>
          <strong class="lesson-comms-incoming-title">Входящий звонок</strong>
          <span class="lesson-comms-incoming-name">Участник звонит…</span>
        </div>
        <div class="lesson-comms-incoming-actions">
          <button class="lesson-comms-accept" type="button">Ответить</button>
          <button class="lesson-comms-decline danger" type="button">Отклонить</button>
        </div>
      </div>
      <div class="lesson-comms-video-stage">
        <video class="lesson-comms-remote" autoplay playsinline></video>
        <video class="lesson-comms-local" autoplay playsinline muted></video>
        <div class="lesson-comms-call-state">Нажмите «Начать», чтобы подключить камеру и микрофон.</div>
      </div>
      <div class="lesson-comms-controls">
        <button class="lesson-comms-start" type="button">Позвонить</button>
        <button class="lesson-comms-mic" type="button" disabled>🎙 Микрофон</button>
        <button class="lesson-comms-camera" type="button" disabled>📷 Камера</button>
        <button class="lesson-comms-hangup danger" type="button" disabled>Завершить</button>
      </div>
    </div>
    <div class="lesson-comms-view lesson-comms-chat" hidden>
      <div class="lesson-comms-messages" aria-live="polite"></div>
      <form class="lesson-comms-form">
        <textarea maxlength="2000" rows="2" placeholder="Сообщение…" aria-label="Сообщение"></textarea>
        <button type="submit">Отправить</button>
      </form>
    </div>
  `;
  document.body.append(launcher, panel);

  const videoButton = launcher.querySelector(".lesson-comms-video-button");
  const chatButton = launcher.querySelector(".lesson-comms-chat-button");
  const unreadEl = launcher.querySelector(".lesson-comms-unread");
  const closeButton = panel.querySelector(".lesson-comms-close");
  const minimizeButton = panel.querySelector(".lesson-comms-minimize");
  const titleEl = panel.querySelector(".lesson-comms-title");
  const videoView = panel.querySelector(".lesson-comms-video");
  const chatView = panel.querySelector(".lesson-comms-chat");
  const localVideo = panel.querySelector(".lesson-comms-local");
  const remoteVideo = panel.querySelector(".lesson-comms-remote");
  const callState = panel.querySelector(".lesson-comms-call-state");
  const incomingBox = panel.querySelector(".lesson-comms-incoming");
  const incomingName = panel.querySelector(".lesson-comms-incoming-name");
  const acceptButton = panel.querySelector(".lesson-comms-accept");
  const declineButton = panel.querySelector(".lesson-comms-decline");
  const startButton = panel.querySelector(".lesson-comms-start");
  const micButton = panel.querySelector(".lesson-comms-mic");
  const cameraButton = panel.querySelector(".lesson-comms-camera");
  const hangupButton = panel.querySelector(".lesson-comms-hangup");
  const messagesEl = panel.querySelector(".lesson-comms-messages");
  const chatForm = panel.querySelector(".lesson-comms-form");
  const chatInput = chatForm.querySelector("textarea");

  function setUnread(value) {
    unread = Math.max(0, value);
    unreadEl.hidden = unread === 0;
    unreadEl.textContent = unread > 99 ? "99+" : String(unread);
  }

  function showView(view) {
    currentView = view;
    panel.hidden = false;
    panel.classList.remove("mini-video");
    const isVideo = view === "video";
    videoView.hidden = !isVideo;
    chatView.hidden = isVideo;
    titleEl.textContent = isVideo ? "Видеосвязь" : "Чат занятия";
    videoButton.classList.toggle("active", isVideo);
    chatButton.classList.toggle("active", !isVideo);
    if (!isVideo) {
      setUnread(0);
      loadChatHistory();
      requestAnimationFrame(() => chatInput.focus({ preventScroll: true }));
    }
  }

  function closePanel() {
    panel.hidden = true;
    panel.classList.remove("mini-video");
    currentView = null;
    videoButton.classList.remove("active");
    chatButton.classList.remove("active");
  }

  videoButton.addEventListener("click", () => {
    if (!panel.hidden && currentView === "video") closePanel();
    else showView("video");
  });
  chatButton.addEventListener("click", () => {
    if (!panel.hidden && currentView === "chat") closePanel();
    else showView("chat");
  });
  closeButton.addEventListener("click", closePanel);

  function minimizeVideo() {
    if (currentView !== "video" || panel.hidden) return;
    panel.classList.add("mini-video");
    videoButton.classList.remove("active");
  }

  function restoreVideo() {
    if (!panel.classList.contains("mini-video")) return;
    panel.classList.remove("mini-video");
    currentView = "video";
    panel.hidden = false;
    videoButton.classList.add("active");
    remoteVideo.play().catch(() => {});
  }

  minimizeButton.addEventListener("click", minimizeVideo);
  remoteVideo.addEventListener("click", () => {
    if (panel.classList.contains("mini-video")) {
      restoreVideo();
      return;
    }
    remoteVideo.play().catch(() => {});
  });

  function setCallState(text) {
    callState.textContent = text;
    callState.hidden = Boolean(remoteStream?.getTracks().length);
  }

  function updateMediaButtons() {
    const audio = localStream?.getAudioTracks()[0];
    const video = localStream?.getVideoTracks()[0];
    micButton.disabled = !audio;
    cameraButton.disabled = !video;
    hangupButton.disabled = !localStream;
    startButton.disabled = Boolean(localStream);
    micButton.textContent = audio?.enabled ? "🎙 Микрофон" : "🔇 Микрофон";
    cameraButton.textContent = video?.enabled ? "📷 Камера" : "🚫 Камера";
  }

  async function getIceConfig() {
    const response = await fetch(`/api/webrtc/config?lesson=${encodeURIComponent(lessonId)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("ICE_CONFIG_FAILED");
    const payload = await response.json();
    return {
      iceServers: Array.isArray(payload.iceServers) ? payload.iceServers : [],
      iceTransportPolicy: payload.iceTransportPolicy === "relay" ? "relay" : "all",
      source: String(payload.source || "unknown"),
    };
  }

  function startRtcQualityMonitor(pc) {
    let previousPacketsLost = 0;
    let previousPacketsReceived = 0;
    const timer = setInterval(async () => {
      if (pc !== peerConnection || pc.connectionState === "closed") {
        clearInterval(timer);
        return;
      }
      try {
        const stats = await pc.getStats();
        let availableOutgoingBitrate = null;
        let jitter = null;
        let packetsLost = null;
        let packetsReceived = null;
        let framesDropped = null;
        let framesDecoded = null;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && (report.selected || report.nominated) && report.state === "succeeded") {
            if (Number.isFinite(report.availableOutgoingBitrate)) {
              availableOutgoingBitrate = Math.round(report.availableOutgoingBitrate);
            }
          }
          if (report.type === "inbound-rtp" && report.kind === "video") {
            if (Number.isFinite(report.jitter)) jitter = Number(report.jitter.toFixed(4));
            if (Number.isFinite(report.packetsLost)) packetsLost = report.packetsLost;
            if (Number.isFinite(report.packetsReceived)) packetsReceived = report.packetsReceived;
            if (Number.isFinite(report.framesDropped)) framesDropped = report.framesDropped;
            if (Number.isFinite(report.framesDecoded)) framesDecoded = report.framesDecoded;
          }
        });

        const lostDelta = packetsLost == null ? null : Math.max(0, packetsLost - previousPacketsLost);
        const receivedDelta = packetsReceived == null ? null : Math.max(0, packetsReceived - previousPacketsReceived);
        if (packetsLost != null) previousPacketsLost = packetsLost;
        if (packetsReceived != null) previousPacketsReceived = packetsReceived;

        socket.emit("rtc:debug", {
          event: "quality",
          state: JSON.stringify({
            availableOutgoingBitrate,
            jitter,
            lostDelta,
            receivedDelta,
            framesDropped,
            framesDecoded,
          }).slice(0, 300),
        });
      } catch {
        // Stats are best-effort and must never affect the call.
      }
    }, 5000);
  }

  async function ensurePeer(peerId) {
    if (peerConnection && activePeerId === peerId) return peerConnection;
    if (peerConnection) peerConnection.close();

    activePeerId = peerId;
    pendingCandidates = [];
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    const iceConfig = await getIceConfig();
    const pc = new RTCPeerConnection({
      iceServers: iceConfig.iceServers,
      iceTransportPolicy: iceConfig.iceTransportPolicy,
    });
    socket.emit("rtc:debug", {
      event: "iceconfig",
      state: `${iceConfig.source}:${iceConfig.iceTransportPolicy}`,
    });
    peerConnection = pc;
    startRtcQualityMonitor(pc);

    for (const track of localStream?.getTracks() || []) {
      const sender = pc.addTrack(track, localStream);
      if (track.kind === "video") {
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = 900_000;
        params.encodings[0].maxFramerate = 20;
        sender.setParameters(params).catch(() => {});
      }
      if (track.kind === "audio") {
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = 48_000;
        sender.setParameters(params).catch(() => {});
      }
    }

    pc.addEventListener("icecandidate", ({ candidate }) => {
      if (!candidate || !activePeerId) return;
      socket.emit("rtc:signal", {
        targetId: activePeerId,
        candidate: candidate.toJSON ? candidate.toJSON() : candidate,
      });
    });

    pc.addEventListener("track", ({ track, streams }) => {
      const stream = streams?.[0];
      if (stream) {
        remoteStream = stream;
        remoteVideo.srcObject = stream;
      } else if (!remoteStream.getTracks().includes(track)) {
        remoteStream.addTrack(track);
      }
      remoteVideo.play().catch((error) => {
        console.warn("Remote video autoplay was blocked", error);
        setCallState("Связь есть. Нажмите на окно видео для запуска.");
      });
      setCallState("Соединение установлено");
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc !== peerConnection) return;
      if (pc.connectionState === "connected") {
        setCallState("Соединение установлено");
        const videoSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
        if (videoSender) {
          const params = videoSender.getParameters();
          params.degradationPreference = "maintain-framerate";
          params.encodings = params.encodings?.length ? params.encodings : [{}];
          params.encodings[0].maxBitrate = 900_000;
          params.encodings[0].maxFramerate = 20;
          videoSender.setParameters(params).catch(() => {});
        }
        pc.getStats()
          .then((stats) => {
            let pair = null;
            stats.forEach((report) => {
              if (
                report.type === "candidate-pair" &&
                (report.selected || report.nominated) &&
                report.state === "succeeded"
              ) {
                pair = report;
              }
            });
            if (!pair) return;
            const local = stats.get(pair.localCandidateId);
            const remote = stats.get(pair.remoteCandidateId);
            socket.emit("rtc:debug", {
              event: "selected-pair",
              state: `local=${local?.candidateType || "?"}/${local?.protocol || "?"};remote=${remote?.candidateType || "?"}/${remote?.protocol || "?"}`,
            });
          })
          .catch(() => {});
      }
      if (pc.connectionState === "connecting") setCallState("Соединяем…");
      if (pc.connectionState === "failed") {
        setCallState("Не удалось проложить медиаканал. Нужен TURN.");
      } else if (pc.connectionState === "disconnected") {
        setCallState("Связь прервалась. Пытаемся переподключиться…");
      }
      if (pc.connectionState === "closed") setCallState("Звонок завершён");
      socket.emit("rtc:debug", {
        event: "connectionstate",
        state: pc.connectionState,
      });
    });

    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc !== peerConnection) return;
      const state = pc.iceConnectionState;
      if (state === "checking") setCallState("Проверяем сетевой маршрут…");
      if (state === "connected" || state === "completed") setCallState("Соединение установлено");
      if (state === "failed") setCallState("ICE failed: прямой маршрут не найден. Нужен TURN.");
      socket.emit("rtc:debug", {
        event: "iceconnectionstate",
        state,
      });
    });

    pc.addEventListener("icecandidateerror", (event) => {
      console.warn("ICE candidate error", event);
      socket.emit("rtc:debug", {
        event: "icecandidateerror",
        errorCode: event.errorCode || null,
        errorText: String(event.errorText || "").slice(0, 300),
        url: String(event.url || "").slice(0, 300),
      });
    });

    pc.addEventListener("icegatheringstatechange", () => {
      socket.emit("rtc:debug", {
        event: "icegatheringstate",
        state: pc.iceGatheringState,
      });
    });

    return pc;
  }

  async function createOffer(peerId) {
    if (!localStream || !peerId) return;
    const pc = await ensurePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("rtc:signal", {
      targetId: peerId,
      description: pc.localDescription,
    });
    setCallState("Соединяем…");
  }

  async function flushPendingCandidates() {
    if (!peerConnection?.remoteDescription) return;
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) {
      await peerConnection.addIceCandidate(candidate);
    }
  }

  async function handleSignal(payload) {
    if (!localStream || !payload?.from) return;
    try {
      const pc = await ensurePeer(payload.from);
      if (payload.description) {
        await pc.setRemoteDescription(payload.description);
        await flushPendingCandidates();
        if (payload.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("rtc:signal", {
            targetId: payload.from,
            description: pc.localDescription,
          });
        }
        return;
      }
      if (payload.candidate) {
        const candidate = new RTCIceCandidate(payload.candidate);
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else pendingCandidates.push(candidate);
      }
    } catch (error) {
      console.error("WebRTC signaling failed", error);
      setCallState("Не удалось установить видеосвязь.");
    }
  }

  function announceReady() {
    if (!localStream || !socket.connected) return;
    socket.emit("rtc:ready", {}, async (result) => {
      if (!result?.ok) return;
      const peer = (result.peers || []).find((item) => item.role !== role) || result.peers?.[0];
      if (!peer) {
        setCallState("Ждём переподключения второго участника…");
        return;
      }
      const shouldOffer = role === "teacher" || String(socket.id) < String(peer.id);
      if (!shouldOffer) return;
      try {
        await createOffer(peer.id);
      } catch (error) {
        console.error("WebRTC reconnect offer failed", error);
        setCallState("Не удалось восстановить видеосвязь.");
      }
    });
  }

  async function acquireLocalMedia() {
    if (localStream) return true;
    setCallState("Запрашиваем доступ к камере и микрофону…");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 640, max: 960 },
          height: { ideal: 360, max: 540 },
          frameRate: { ideal: 20, max: 24 },
          facingMode: "user",
        },
      });
      localVideo.srcObject = localStream;
      await localVideo.play().catch(() => {});
      callStarted = true;
      updateMediaButtons();
      return true;
    } catch (error) {
      callStarted = false;
      setCallState("Камера или микрофон недоступны.");
      showSnackbar?.({
        title: "Видеосвязь",
        message: "Разрешите доступ к камере и микрофону в браузере и попробуйте снова.",
        type: "error",
      });
      updateMediaButtons();
      return false;
    }
  }

  async function startCall() {
    if (outgoingCall || callAccepted) return;
    if (!(await acquireLocalMedia())) return;

    pendingCallerId = null;
    incomingBox.hidden = true;
    outgoingCall = true;
    callAccepted = false;
    startButton.textContent = "Звоним…";
    setCallState("Звоним второму участнику…");

    socket.emit("rtc:call", {}, (result) => {
      if (!result?.ok) {
        outgoingCall = false;
        startButton.textContent = "Позвонить";
        setCallState("Не удалось начать звонок.");
        return;
      }
      if (!(result.recipients || []).length) {
        setCallState("Звонок начат. Ждём второго участника…");
      }
    });
  }

  function closePeer() {
    peerConnection?.close();
    peerConnection = null;
    activePeerId = null;
    pendingCandidates = [];
    remoteStream = null;
    remoteVideo.srcObject = null;
  }

  function resetIncomingCall() {
    pendingCallerId = null;
    incomingBox.hidden = true;
    videoButton.classList.remove("ringing");
    videoButton.textContent = "🎥 Связь";
  }

  function stopCall({ notify = true } = {}) {
    if (notify && socket.connected) {
      if (outgoingCall && !callAccepted) socket.emit("rtc:cancel");
      else socket.emit("rtc:leave");
    }
    closePeer();
    for (const track of localStream?.getTracks() || []) track.stop();
    localStream = null;
    localVideo.srcObject = null;
    callStarted = false;
    outgoingCall = false;
    callAccepted = false;
    resetIncomingCall();
    startButton.textContent = "Позвонить";
    updateMediaButtons();
    setCallState("Нажмите «Позвонить», чтобы начать видеосвязь.");
  }

  startButton.addEventListener("click", startCall);
  hangupButton.addEventListener("click", () => stopCall());

  acceptButton.addEventListener("click", async () => {
    const callerId = pendingCallerId;
    if (!callerId) return;
    acceptButton.disabled = true;
    if (!(await acquireLocalMedia())) {
      acceptButton.disabled = false;
      return;
    }

    socket.emit("rtc:accept", { callerId }, (result) => {
      acceptButton.disabled = false;
      if (!result?.ok) {
        resetIncomingCall();
        setCallState("Звонок уже завершён.");
        return;
      }
      callAccepted = true;
      outgoingCall = false;
      activePeerId = callerId;
      resetIncomingCall();
      startButton.textContent = "Подключено";
      setCallState("Соединяем…");
    });
  });

  declineButton.addEventListener("click", () => {
    if (pendingCallerId) socket.emit("rtc:decline", { callerId: pendingCallerId });
    resetIncomingCall();
    closePanel();
  });

  micButton.addEventListener("click", () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    updateMediaButtons();
  });

  cameraButton.addEventListener("click", () => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    updateMediaButtons();
  });

  socket.on("rtc:incoming-call", ({ from, caller } = {}) => {
    if (!from || localStream || outgoingCall || callAccepted) return;
    pendingCallerId = from;
    incomingName.textContent = `${caller?.displayName || "Участник"} звонит…`;
    incomingBox.hidden = false;
    videoButton.classList.add("ringing");
    videoButton.textContent = "📞 Входящий";
    showView("video");
    setCallState("Входящий видеозвонок");
  });

  socket.on("rtc:accepted", async ({ peer } = {}) => {
    if (!outgoingCall || !localStream || !peer?.id) return;
    outgoingCall = false;
    callAccepted = true;
    startButton.textContent = "Подключено";
    setCallState("Соединяем…");
    try {
      await createOffer(peer.id);
    } catch (error) {
      console.error("WebRTC offer failed", error);
      setCallState("Не удалось установить видеосвязь.");
    }
  });

  socket.on("rtc:declined", () => {
    stopCall({ notify: false });
    setCallState("Звонок отклонён.");
  });

  socket.on("rtc:cancelled", ({ from } = {}) => {
    if (from && pendingCallerId && from !== pendingCallerId) return;
    resetIncomingCall();
    setCallState("Входящий звонок завершён.");
  });

  socket.on("rtc:peer-ready", async (peer) => {
    if (!localStream || !callAccepted || !peer?.id || peer.role === role) return;
    const shouldOffer = role === "teacher" || String(socket.id) < String(peer.id);
    if (!shouldOffer) return;
    try {
      await createOffer(peer.id);
    } catch (error) {
      console.error("WebRTC reconnect offer failed", error);
    }
  });

  socket.on("rtc:signal", (payload) => {
    handleSignal(payload);
  });

  socket.on("rtc:peer-left", ({ id } = {}) => {
    if (id !== activePeerId) return;
    closePeer();
    if (localStream) {
      callAccepted = true;
      setCallState("Второй участник отключился. Ждём переподключения…");
    }
  });

  socket.on("connect", () => {
    if (localStream && callAccepted) announceReady();
    else if (localStream && outgoingCall) {
      socket.emit("rtc:call", {}, (result) => {
        if (!result?.ok) setCallState("Не удалось восстановить звонок.");
      });
    }
  });

  function appendMessage(message) {
    if (!message?.id || messagesEl.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
    const item = document.createElement("div");
    item.className = "lesson-comms-message";
    item.dataset.messageId = message.id;
    if (message.userId && message.userId === currentUserId) item.classList.add("mine");

    const meta = document.createElement("span");
    meta.className = "lesson-comms-message-meta";
    const time = message.createdAt ? new Date(message.createdAt) : new Date();
    meta.textContent = `${message.displayName || (message.role === "teacher" ? "Учитель" : "Ученик")} · ${time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    const text = document.createElement("div");
    text.className = "lesson-comms-message-text";
    text.textContent = message.text || "";

    item.append(meta, text);
    messagesEl.appendChild(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadChatHistory() {
    if (historyLoaded || !socket.connected) return;
    socket.emit("chat:history", {}, (result) => {
      if (!result?.ok) return;
      historyLoaded = true;
      currentUserId = result.currentUserId || currentUserId;
      for (const message of result.messages || []) appendMessage(message);
    });
  }

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.disabled = true;
    socket.emit("chat:send", { text }, (result) => {
      chatInput.disabled = false;
      if (result?.ok) {
        chatInput.value = "";
        chatInput.focus();
      } else {
        showSnackbar?.({
          title: "Чат",
          message: "Не удалось отправить сообщение.",
          type: "error",
        });
      }
    });
  });

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });

  socket.on("chat:message", (message) => {
    appendMessage(message);
    if (currentView !== "chat") setUnread(unread + 1);
  });

  window.addEventListener("beforeunload", () => {
    if (localStream) stopCall({ notify: false });
  });

  updateMediaButtons();
}
