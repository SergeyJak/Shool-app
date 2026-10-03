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
  let ringtoneTimer = null;
  let ringtoneContext = null;
  let ringtoneUnlocked = false;
  let activeCallId = null;
  let pendingCallId = null;
  let rtcQualityTimer = null;
  let peerCallId = null;
  let iceRestartTimer = null;
  let iceRestartAttempts = 0;

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
      <div class="lesson-comms-brand">
        <span class="lesson-comms-mascot" aria-hidden="true">🦉</span>
        <span>
          <strong class="lesson-comms-title">Связь</strong>
          <small class="lesson-comms-subtitle">Вы на занятии вместе</small>
        </span>
      </div>
      <div class="lesson-comms-window-actions">
        <button class="lesson-comms-minimize" type="button" aria-label="Свернуть видеозвонок">
          <span aria-hidden="true">▁</span>
          <span>Свернуть</span>
        </button>
        <button class="lesson-comms-close" type="button" aria-label="Закрыть окно видеозвонка">
          <span aria-hidden="true">✕</span>
          <span>Закрыть</span>
        </button>
      </div>
    </div>
    <div class="lesson-comms-view lesson-comms-video">
      <div class="lesson-comms-incoming" hidden>
        <div>
          <strong class="lesson-comms-incoming-title">К вам звонят 👋</strong>
          <span class="lesson-comms-incoming-name">Участник хочет присоединиться</span>
        </div>
        <div class="lesson-comms-incoming-actions">
          <button class="lesson-comms-accept" type="button">📹 Ответить</button>
          <button class="lesson-comms-decline danger" type="button">Не сейчас</button>
        </div>
      </div>
      <div class="lesson-comms-video-stage">
        <video class="lesson-comms-remote" autoplay playsinline></video>
        <video class="lesson-comms-local" autoplay playsinline muted></video>
        <div class="lesson-comms-call-state">Нажмите «Начать», чтобы подключить камеру и микрофон.</div>
      </div>
      <div class="lesson-comms-controls">
        <button class="lesson-comms-start primary" type="button">
          <span class="lesson-comms-control-icon" aria-hidden="true">📞</span>
          <span>Позвонить</span>
        </button>
        <button class="lesson-comms-mic call-control" type="button" hidden disabled>
          <span class="lesson-comms-control-icon" aria-hidden="true">🎙️</span>
          <span>Микрофон</span>
        </button>
        <button class="lesson-comms-camera call-control" type="button" hidden disabled>
          <span class="lesson-comms-control-icon" aria-hidden="true">📷</span>
          <span>Камера</span>
        </button>
        <button class="lesson-comms-hangup danger call-control" type="button" hidden disabled>
          <span class="lesson-comms-control-icon" aria-hidden="true">🔴</span>
          <span>Завершить</span>
        </button>
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
  const minimizeButton = panel.querySelector(".lesson-comms-minimize");
  const closeButton = panel.querySelector(".lesson-comms-close");
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
  const chatSubmitButton = chatForm.querySelector('button[type="submit"]');

  function syncChatViewportHeight() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    panel.style.setProperty("--lesson-viewport-height", `${Math.round(viewportHeight)}px`);
  }

  window.visualViewport?.addEventListener("resize", syncChatViewportHeight);
  window.addEventListener("resize", syncChatViewportHeight);
  syncChatViewportHeight();

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
    minimizeButton.hidden = !isVideo;
    launcher.classList.toggle("chat-open", !isVideo);
    videoButton.classList.toggle("active", isVideo);
    chatButton.classList.toggle("active", !isVideo);
    if (!isVideo) {
      setUnread(0);
      loadChatHistory();
    }
  }

  function closePanel() {
    panel.hidden = true;
    panel.classList.remove("mini-video");
    launcher.classList.remove("chat-open");
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
  closeButton.addEventListener("click", closePanel);
  remoteVideo.addEventListener("click", () => {
    if (panel.classList.contains("mini-video")) {
      restoreVideo();
      return;
    }
    remoteVideo.play().catch(() => {});
  });

  function ensureRingtoneContext() {
    if (!ringtoneContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      ringtoneContext = new AudioContextClass();
    }
    return ringtoneContext;
  }

  function unlockRingtone() {
    const context = ensureRingtoneContext();
    if (!context) return;
    context.resume().then(() => {
      ringtoneUnlocked = true;
    }).catch(() => {});
  }

  function playRingtoneBubble() {
    const context = ensureRingtoneContext();
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
    master.connect(context.destination);

    [
      { frequency: 520, start: 0, duration: 0.22 },
      { frequency: 690, start: 0.28, duration: 0.26 },
    ].forEach(({ frequency, start, duration }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + start);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * 0.92,
        now + start + duration
      );
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.75, now + start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.03);
    });
  }

  function startRingtone() {
    stopRingtone();
    const context = ensureRingtoneContext();
    if (!context) return;
    context.resume()
      .then(() => {
        ringtoneUnlocked = true;
        playRingtoneBubble();
        ringtoneTimer = window.setInterval(playRingtoneBubble, 2400);
      })
      .catch(() => {});
  }

  function stopRingtone() {
    if (ringtoneTimer) {
      window.clearInterval(ringtoneTimer);
      ringtoneTimer = null;
    }
    if (ringtoneContext?.state === "running") {
      ringtoneContext.suspend().catch(() => {});
    }
  }

  document.addEventListener("pointerdown", unlockRingtone, { once: true, passive: true });
  document.addEventListener("keydown", unlockRingtone, { once: true });

  function setCallState(text) {
    callState.textContent = text;
    callState.hidden = Boolean(remoteStream?.getTracks().length);
  }

  function updateMediaButtons() {
    const audio = localStream?.getAudioTracks()[0];
    const video = localStream?.getVideoTracks()[0];
    const callIsActive = Boolean(localStream || outgoingCall || callAccepted);
    const incomingCallPending = Boolean(pendingCallerId);

    startButton.hidden = callIsActive || incomingCallPending;
    for (const button of [micButton, cameraButton, hangupButton]) {
      button.hidden = !callIsActive;
    }

    micButton.disabled = !audio;
    cameraButton.disabled = !video;
    hangupButton.disabled = !callIsActive;

    micButton.innerHTML = audio?.enabled
      ? '<span class="lesson-comms-control-icon" aria-hidden="true">🎙️</span><span>Микрофон</span>'
      : '<span class="lesson-comms-control-icon" aria-hidden="true">🔇</span><span>Включить звук</span>';
    cameraButton.innerHTML = video?.enabled
      ? '<span class="lesson-comms-control-icon" aria-hidden="true">📷</span><span>Камера</span>'
      : '<span class="lesson-comms-control-icon" aria-hidden="true">🚫</span><span>Включить камеру</span>';
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
    if (rtcQualityTimer) {
      clearInterval(rtcQualityTimer);
      rtcQualityTimer = null;
    }
    let previousPacketsLost = 0;
    let previousPacketsReceived = 0;
    rtcQualityTimer = setInterval(async () => {
      if (pc !== peerConnection || pc.connectionState === "closed") {
        clearInterval(rtcQualityTimer);
        rtcQualityTimer = null;
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
    if (!activeCallId) throw new Error("CALL_ID_REQUIRED");
    if (
      peerConnection &&
      activePeerId === peerId &&
      peerCallId === activeCallId &&
      !["failed", "closed"].includes(peerConnection.connectionState)
    ) {
      return peerConnection;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    const connectionCallId = activeCallId;
    peerCallId = connectionCallId;
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
        params.encodings[0].maxBitrate = 500_000;
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
      if (!candidate || !activePeerId || connectionCallId !== activeCallId) return;
      socket.emit("rtc:signal", {
        callId: connectionCallId,
        targetId: activePeerId,
        candidate: candidate.toJSON ? candidate.toJSON() : candidate,
      });
    });

    pc.addEventListener("track", ({ track, streams }) => {
      if (connectionCallId !== activeCallId || pc !== peerConnection) return;
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

    const scheduleIceRestart = () => {
      if (iceRestartTimer || connectionCallId !== activeCallId || pc !== peerConnection) return;
      if (iceRestartAttempts >= 2) return;

      const delay =
        iceRestartAttempts === 0
          ? (pc.connectionState === "failed" ? 250 : 1500)
          : 250;

      iceRestartTimer = setTimeout(async () => {
        iceRestartTimer = null;
        if (
          connectionCallId !== activeCallId ||
          pc !== peerConnection ||
          !["disconnected", "failed"].includes(pc.connectionState)
        ) return;

        const peerId = activePeerId;
        const shouldOffer = role === "teacher" || String(socket.id) < String(peerId || "");
        if (!shouldOffer || !peerId) return;

        iceRestartAttempts += 1;
        const attempt = iceRestartAttempts;

        try {
          if (attempt === 1) {
            socket.emit("rtc:debug", {
              event: "ice-restart",
              state: `attempt=1;connection=${pc.connectionState}`,
            });
            await createOffer(peerId, { iceRestart: true });

            // A restart can finish gathering without ever producing a usable
            // candidate pair. If the route is still dead a few seconds later,
            // escalate to a fresh RTCPeerConnection.
            iceRestartTimer = setTimeout(() => {
              iceRestartTimer = null;
              if (
                connectionCallId === activeCallId &&
                pc === peerConnection &&
                ["disconnected", "failed"].includes(pc.connectionState)
              ) {
                scheduleIceRestart();
              }
            }, 5000);
            return;
          }

          socket.emit("rtc:debug", {
            event: "peer-rebuild",
            state: `attempt=2;connection=${pc.connectionState}`,
          });

          if (rtcQualityTimer) {
            clearInterval(rtcQualityTimer);
            rtcQualityTimer = null;
          }

          // Detach the dead peer without touching the local camera/microphone
          // or the active call. ensurePeer() will fetch a fresh ICE config and
          // construct a brand-new RTCPeerConnection for the same callId.
          if (peerConnection === pc) {
            peerConnection = null;
            peerCallId = null;
            activePeerId = null;
            pendingCandidates = [];
            remoteStream = null;
            remoteVideo.srcObject = null;
          }
          pc.close();

          await createOffer(peerId);
        } catch (error) {
          console.warn("WebRTC route recovery failed", error);
        }
      }, delay);
    };

    pc.addEventListener("connectionstatechange", () => {
      if (pc !== peerConnection) return;
      if (pc.connectionState === "connected") {
        if (iceRestartTimer) {
          clearTimeout(iceRestartTimer);
          iceRestartTimer = null;
        }
        iceRestartAttempts = 0;
        setCallState("Соединение установлено");
        const videoSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
        if (videoSender) {
          const params = videoSender.getParameters();
          params.degradationPreference = "maintain-framerate";
          params.encodings = params.encodings?.length ? params.encodings : [{}];
          params.encodings[0].maxBitrate = 500_000;
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
              state: `local=${local?.candidateType || "?"}/${local?.protocol || "?"}/${local?.relayProtocol || "?"};remote=${remote?.candidateType || "?"}/${remote?.protocol || "?"}/${remote?.relayProtocol || "?"}`,
            });
          })
          .catch(() => {});
      }
      if (pc.connectionState === "connecting") setCallState("Соединяем…");
      if (pc.connectionState === "failed") {
        setCallState("Связь потеряна. Пытаемся восстановить маршрут…");
        scheduleIceRestart();
      } else if (pc.connectionState === "disconnected") {
        setCallState("Связь прервалась. Пытаемся переподключиться…");
        scheduleIceRestart();
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

  async function createOffer(peerId, { iceRestart = false } = {}) {
    if (!localStream || !peerId) return;
    const pc = await ensurePeer(peerId);
    const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await pc.setLocalDescription(offer);
    socket.emit("rtc:signal", {
      callId: activeCallId,
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
    if (!localStream || !payload?.from || !payload?.callId) return;
    if (payload.callId !== activeCallId) return;
    try {
      const pc = await ensurePeer(payload.from);
      if (payload.description) {
        await pc.setRemoteDescription(payload.description);
        await flushPendingCandidates();
        if (payload.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("rtc:signal", {
            callId: activeCallId,
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
    socket.emit("rtc:ready", { callId: activeCallId }, async (result) => {
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
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = true;
        socket.emit("rtc:debug", {
          event: "local-audio",
          state: `readyState=${audioTrack.readyState};enabled=${audioTrack.enabled};muted=${audioTrack.muted}`,
        });
      }
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
    pendingCallId = null;
    activeCallId = crypto.randomUUID();
    incomingBox.hidden = true;
    outgoingCall = true;
    callAccepted = false;
    updateMediaButtons();
    startButton.textContent = "Звоним…";
    setCallState("Звоним второму участнику…");

    socket.emit("rtc:call", { callId: activeCallId }, (result) => {
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
    if (rtcQualityTimer) {
      clearInterval(rtcQualityTimer);
      rtcQualityTimer = null;
    }
    if (iceRestartTimer) {
      clearTimeout(iceRestartTimer);
      iceRestartTimer = null;
    }
    iceRestartAttempts = 0;
    peerConnection?.close();
    peerConnection = null;
    peerCallId = null;
    activePeerId = null;
    pendingCandidates = [];
    remoteStream = null;
    remoteVideo.srcObject = null;
  }

  function resetIncomingCall() {
    stopRingtone();
    pendingCallerId = null;
    pendingCallId = null;
    incomingBox.hidden = true;
    videoButton.classList.remove("ringing");
    videoButton.textContent = "🎥 Связь";
  }

  function stopCall({
    notify = true,
    finalState = "Нажмите «Позвонить», чтобы начать видеосвязь.",
  } = {}) {
    const callId = activeCallId || pendingCallId;
    if (notify && socket.connected && callId) {
      if (outgoingCall && !callAccepted) socket.emit("rtc:cancel", { callId });
      else socket.emit("rtc:leave", { callId });
    }
    closePeer();
    for (const track of localStream?.getTracks() || []) track.stop();
    localStream = null;
    localVideo.srcObject = null;
    callStarted = false;
    outgoingCall = false;
    callAccepted = false;
    activeCallId = null;
    resetIncomingCall();
    startButton.textContent = "Позвонить";
    updateMediaButtons();
    setCallState(finalState);
  }

  updateMediaButtons();

  startButton.addEventListener("click", startCall);
  hangupButton.addEventListener("click", () => stopCall());

  acceptButton.addEventListener("click", async () => {
    const callerId = pendingCallerId;
    const callId = pendingCallId;
    if (!callerId || !callId) return;
    stopRingtone();
    acceptButton.disabled = true;
    activeCallId = callId;
    if (!(await acquireLocalMedia())) {
      activeCallId = null;
      acceptButton.disabled = false;
      return;
    }

    socket.emit("rtc:accept", { callerId, callId }, (result) => {
      acceptButton.disabled = false;
      if (!result?.ok) {
        activeCallId = null;
        resetIncomingCall();
        setCallState("Звонок уже завершён.");
        return;
      }
      if (result.callId !== callId) return;
      callAccepted = true;
      outgoingCall = false;
      activeCallId = callId;
      activePeerId = callerId;
      resetIncomingCall();
      startButton.textContent = "Подключено";
      setCallState("Соединяем…");
    });
  });

  declineButton.addEventListener("click", () => {
    if (pendingCallerId && pendingCallId) {
      socket.emit("rtc:decline", { callerId: pendingCallerId, callId: pendingCallId });
    }
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

  window.addEventListener("pagehide", stopRingtone);

  socket.on("rtc:incoming-call", ({ from, caller, callId } = {}) => {
    if (!from || !callId || localStream || outgoingCall || callAccepted) return;
    pendingCallerId = from;
    pendingCallId = callId;
    incomingName.textContent = `${caller?.displayName || "Участник"} хочет присоединиться`;
    incomingBox.hidden = false;
    updateMediaButtons();
    startRingtone();
    videoButton.classList.add("ringing");
    videoButton.textContent = "📞 Входящий";
    showView("video");
    setCallState("Можно ответить, когда будете готовы 🙂");
  });

  socket.on("rtc:accepted", async ({ peer, callId } = {}) => {
    if (!outgoingCall || !localStream || !peer?.id || callId !== activeCallId) return;
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

  socket.on("rtc:declined", ({ callId } = {}) => {
    if (!callId || callId !== activeCallId) return;
    stopCall({ notify: false });
    setCallState("Звонок отклонён.");
  });

  socket.on("rtc:cancelled", ({ from, callId } = {}) => {
    if (!callId || callId !== pendingCallId) return;
    if (from && pendingCallerId && from !== pendingCallerId) return;
    resetIncomingCall();
    setCallState("Входящий звонок завершён.");
  });

  socket.on("rtc:peer-ready", async (peer) => {
    if (!localStream || !callAccepted || !peer?.id || peer.role === role) return;
    if (!peer.callId || peer.callId !== activeCallId) return;
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

  socket.on("rtc:ended", ({ from, callId } = {}) => {
    if (!callId || callId !== activeCallId) return;
    if (from && activePeerId && from !== activePeerId) return;
    stopCall({
      notify: false,
      finalState: "Собеседник завершил звонок. Можно позвонить снова.",
    });
  });

  socket.on("rtc:peer-left", ({ id, callId } = {}) => {
    if (!callId || callId !== activeCallId || id !== activePeerId) return;
    closePeer();
    if (localStream) {
      callAccepted = true;
      setCallState("Второй участник отключился. Ждём переподключения…");
    }
  });

  socket.on("connect", () => {
    if (localStream && callAccepted) announceReady();
    else if (localStream && outgoingCall) {
      socket.emit("rtc:call", { callId: activeCallId }, (result) => {
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

  chatSubmitButton?.addEventListener("pointerdown", (event) => {
    if (document.activeElement === chatInput) {
      event.preventDefault();
    }
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text || chatSubmitButton?.disabled) return;

    if (chatSubmitButton) chatSubmitButton.disabled = true;

    socket.emit("chat:send", { text }, (result) => {
      if (chatSubmitButton) chatSubmitButton.disabled = false;

      if (result?.ok) {
        chatInput.value = "";
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
