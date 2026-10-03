export function initLessonComms({ socket, role, lessonId, showSnackbar }) {
  if (!socket || role === "observer") return;

  let localStream = null;
  let remoteStream = null;
  let peerConnection = null;
  let peerClientId = null;
  let pendingRemoteCandidates = [];
  let pendingLocalCandidates = [];
  let canSendLocalCandidates = false;
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
  let reconnectTimer = null;
  let connectWatchdogTimer = null;
  let rebuilding = false;

  function rtcNetworkSnapshot() {
    const connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection ||
      null;
    return {
      type: connection?.type || null,
      effectiveType: connection?.effectiveType || null,
      downlink: Number.isFinite(Number(connection?.downlink)) ? Number(connection.downlink) : null,
      rtt: Number.isFinite(Number(connection?.rtt)) ? Number(connection.rtt) : null,
      saveData: Boolean(connection?.saveData),
      online: navigator.onLine,
    };
  }

  function emitRtcDebug(payload = {}) {
    socket.emit("rtc:debug", {
      ...payload,
      callId: activeCallId || pendingCallId || null,
      network: rtcNetworkSnapshot(),
    });
  }


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

  function clearRtcTimers() {
    if (rtcQualityTimer) {
      clearInterval(rtcQualityTimer);
      rtcQualityTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (connectWatchdogTimer) {
      clearTimeout(connectWatchdogTimer);
      connectWatchdogTimer = null;
    }
  }

  function destroyPeer() {
    clearRtcTimers();
    peerConnection?.close();
    peerConnection = null;
    peerClientId = null;
    pendingRemoteCandidates = [];
    pendingLocalCandidates = [];
    canSendLocalCandidates = false;
    remoteStream = null;
    remoteVideo.srcObject = null;
  }

  function startRtcQualityMonitor(pc) {
    if (rtcQualityTimer) clearInterval(rtcQualityTimer);
    let previousLost = 0;
    let previousReceived = 0;
    rtcQualityTimer = setInterval(async () => {
      if (pc !== peerConnection || pc.connectionState === "closed") return;
      try {
        const stats = await pc.getStats();
        let selectedPair = null;
        let jitter = null;
        let packetsLost = null;
        let packetsReceived = null;
        let availableOutgoingBitrate = null;
        stats.forEach((report) => {
          if (
            report.type === "candidate-pair" &&
            (report.selected || report.nominated) &&
            report.state === "succeeded"
          ) {
            selectedPair = report;
            if (Number.isFinite(report.availableOutgoingBitrate)) {
              availableOutgoingBitrate = Math.round(report.availableOutgoingBitrate);
            }
          }
          if (report.type === "inbound-rtp" && report.kind === "video") {
            if (Number.isFinite(report.jitter)) jitter = Number(report.jitter.toFixed(4));
            if (Number.isFinite(report.packetsLost)) packetsLost = report.packetsLost;
            if (Number.isFinite(report.packetsReceived)) packetsReceived = report.packetsReceived;
          }
        });
        emitRtcDebug({
          event: "quality",
          state: JSON.stringify({
            availableOutgoingBitrate,
            jitter,
            lostDelta: packetsLost == null ? null : Math.max(0, packetsLost - previousLost),
            receivedDelta: packetsReceived == null ? null : Math.max(0, packetsReceived - previousReceived),
          }),
        });
        if (packetsLost != null) previousLost = packetsLost;
        if (packetsReceived != null) previousReceived = packetsReceived;

        if (selectedPair) {
          const local = stats.get(selectedPair.localCandidateId);
          const remote = stats.get(selectedPair.remoteCandidateId);
          emitRtcDebug({
            event: "selected-pair",
            state: `local=${local?.candidateType || "?"}/${local?.protocol || "?"}/${local?.relayProtocol || "?"};remote=${remote?.candidateType || "?"}/${remote?.protocol || "?"}/${remote?.relayProtocol || "?"}`,
          });
        }
      } catch {}
    }, 5000);
  }

  function sendRtc2Signal(payload) {
    return new Promise((resolve) => {
      socket.emit("rtc2:signal", payload, (result) => resolve(result || { ok: false }));
    });
  }

  async function flushLocalCandidates() {
    if (!canSendLocalCandidates || !activeCallId || !peerClientId) return;
    const queued = pendingLocalCandidates;
    pendingLocalCandidates = [];
    for (const candidate of queued) {
      await sendRtc2Signal({
        callId: activeCallId,
        targetClientId: peerClientId,
        candidate,
      });
    }
  }

  async function flushRemoteCandidates(pc) {
    if (!pc.remoteDescription) return;
    const queued = pendingRemoteCandidates;
    pendingRemoteCandidates = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function createFreshPeer(targetClientId) {
    if (!activeCallId || !targetClientId || !localStream) {
      throw new Error("RTC2_PEER_PRECONDITION");
    }
    destroyPeer();
    peerClientId = targetClientId;
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    const iceConfig = await getIceConfig();
    const pc = new RTCPeerConnection({
      iceServers: iceConfig.iceServers,
      iceTransportPolicy: iceConfig.iceTransportPolicy,
    });
    peerConnection = pc;
    emitRtcDebug({
      event: "iceconfig-v2",
      state: `${iceConfig.source}:${iceConfig.iceTransportPolicy}`,
    });

    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream);
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      if (track.kind === "video") {
        params.encodings[0].maxBitrate = 500_000;
        params.encodings[0].maxFramerate = 20;
      } else if (track.kind === "audio") {
        params.encodings[0].maxBitrate = 48_000;
      }
      sender.setParameters(params).catch(() => {});
    }

    pc.addEventListener("icecandidate", ({ candidate }) => {
      if (!candidate || pc !== peerConnection || targetClientId !== peerClientId) return;
      const serialized = candidate.toJSON ? candidate.toJSON() : candidate;
      if (!canSendLocalCandidates) {
        pendingLocalCandidates.push(serialized);
        return;
      }
      sendRtc2Signal({
        callId: activeCallId,
        targetClientId,
        candidate: serialized,
      });
    });

    pc.addEventListener("track", ({ track, streams }) => {
      if (pc !== peerConnection) return;
      const stream = streams?.[0];
      if (stream) {
        remoteStream = stream;
        remoteVideo.srcObject = stream;
      } else if (!remoteStream.getTracks().includes(track)) {
        remoteStream.addTrack(track);
      }
      remoteVideo.play().catch(() => {});
      setCallState("Соединение установлено");
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc !== peerConnection) return;
      emitRtcDebug({ event: "connectionstate-v2", state: pc.connectionState });

      if (pc.connectionState === "connected") {
        if (connectWatchdogTimer) {
          clearTimeout(connectWatchdogTimer);
          connectWatchdogTimer = null;
        }
        rebuilding = false;
        setCallState("Соединение установлено");
        startRtcQualityMonitor(pc);
      } else if (pc.connectionState === "connecting") {
        setCallState("Соединяем…");
      } else if (["disconnected", "failed"].includes(pc.connectionState)) {
        setCallState("Связь прервалась. Восстанавливаем…");
        scheduleRtc2Resume(`connection-${pc.connectionState}`);
      }
    });

    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc !== peerConnection) return;
      emitRtcDebug({ event: "iceconnectionstate-v2", state: pc.iceConnectionState });
    });

    pc.addEventListener("icegatheringstatechange", () => {
      if (pc !== peerConnection) return;
      emitRtcDebug({ event: "icegatheringstate-v2", state: pc.iceGatheringState });
    });

    pc.addEventListener("icecandidateerror", (event) => {
      emitRtcDebug({
        event: "icecandidateerror-v2",
        errorCode: event.errorCode || null,
        errorText: String(event.errorText || "").slice(0, 300),
        url: String(event.url || "").slice(0, 300),
      });
    });

    return pc;
  }

  function armConnectWatchdog() {
    if (connectWatchdogTimer) clearTimeout(connectWatchdogTimer);
    connectWatchdogTimer = setTimeout(() => {
      connectWatchdogTimer = null;
      if (!peerConnection || peerConnection.connectionState === "connected") return;
      emitRtcDebug({
        event: "connect-timeout-v2",
        state: `connection=${peerConnection.connectionState};ice=${peerConnection.iceConnectionState}`,
      });
      resumeRtc2Session("connect-timeout");
    }, 12000);
  }

  async function startOffer(targetClientId, reason = "accepted") {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const pc = await createFreshPeer(targetClientId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const result = await sendRtc2Signal({
        callId: activeCallId,
        targetClientId,
        description: pc.localDescription,
      });
      if (!result?.ok) throw new Error(result?.error || "RTC2_SIGNAL_FAILED");
      canSendLocalCandidates = true;
      await flushLocalCandidates();
      armConnectWatchdog();
      emitRtcDebug({ event: "offer-v2", state: reason });
      setCallState("Соединяем…");
    } catch (error) {
      rebuilding = false;
      console.error("RTC2 offer failed", error);
      setCallState("Не удалось установить видеосвязь.");
    }
  }

  async function handleRtc2Signal(payload = {}) {
    if (!payload.callId || payload.callId !== activeCallId || !payload.fromClientId || !localStream) return;
    try {
      if (payload.description?.type === "offer") {
        rebuilding = true;
        const pc = await createFreshPeer(payload.fromClientId);
        await pc.setRemoteDescription(payload.description);
        await flushRemoteCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const result = await sendRtc2Signal({
          callId: activeCallId,
          targetClientId: payload.fromClientId,
          description: pc.localDescription,
        });
        if (!result?.ok) throw new Error(result?.error || "RTC2_SIGNAL_FAILED");
        canSendLocalCandidates = true;
        await flushLocalCandidates();
        armConnectWatchdog();
        rebuilding = false;
        return;
      }

      if (payload.description?.type === "answer") {
        if (!peerConnection || peerClientId !== payload.fromClientId) return;
        await peerConnection.setRemoteDescription(payload.description);
        await flushRemoteCandidates(peerConnection);
        return;
      }

      if (payload.candidate) {
        if (
          peerConnection &&
          peerClientId === payload.fromClientId &&
          peerConnection.remoteDescription
        ) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          pendingRemoteCandidates.push(payload.candidate);
        }
      }
    } catch (error) {
      rebuilding = false;
      console.error("RTC2 signaling failed", error);
      emitRtcDebug({ event: "signal-error-v2", state: String(error?.message || error) });
      scheduleRtc2Resume("signal-error");
    }
  }

  function scheduleRtc2Resume(reason) {
    if (reconnectTimer || !activeCallId || !callAccepted) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      resumeRtc2Session(reason);
    }, 1200);
  }

  function resumeRtc2Session(reason = "resume") {
    if (!activeCallId || !callAccepted || !socket.connected) return;
    socket.emit("rtc2:resume", { callId: activeCallId }, (result) => {
      if (!result?.ok) {
        setCallState("Не удалось восстановить видеосвязь.");
        return;
      }
      emitRtcDebug({
        event: "resume-v2",
        state: `reason=${reason};offerer=${Boolean(result.offerer)};peerOnline=${Boolean(result.peerOnline)}`,
      });
      if (!result.peerOnline) {
        setCallState("Ждём переподключения второго участника…");
        return;
      }
      if (result.offerer) {
        rebuilding = false;
        startOffer(result.peerClientId, reason);
      } else {
        rebuilding = false;
        destroyPeer();
        peerClientId = result.peerClientId;
        setCallState("Ждём восстановления соединения…");
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
      emitRtcDebug({ event: "local-media-v2", state: "ready" });
      updateMediaButtons();
      return true;
    } catch (error) {
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
    outgoingCall = true;
    callAccepted = false;
    incomingBox.hidden = true;
    startButton.textContent = "Звоним…";
    setCallState("Звоним второму участнику…");
    updateMediaButtons();

    socket.emit("rtc2:call", { callId: activeCallId }, (result) => {
      if (!result?.ok) {
        outgoingCall = false;
        startButton.textContent = "Позвонить";
        setCallState("Не удалось начать звонок.");
        updateMediaButtons();
      } else if (!result.recipients) {
        setCallState("Звонок начат. Ждём второго участника…");
      }
    });
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
      if (outgoingCall && !callAccepted) socket.emit("rtc2:cancel", { callId });
      else socket.emit("rtc2:leave", { callId });
    }
    destroyPeer();
    for (const track of localStream?.getTracks() || []) track.stop();
    localStream = null;
    localVideo.srcObject = null;
    outgoingCall = false;
    callAccepted = false;
    activeCallId = null;
    rebuilding = false;
    resetIncomingCall();
    startButton.textContent = "Позвонить";
    updateMediaButtons();
    setCallState(finalState);
  }

  updateMediaButtons();

  startButton.addEventListener("click", startCall);
  hangupButton.addEventListener("click", () => stopCall());

  acceptButton.addEventListener("click", async () => {
    const callerClientId = pendingCallerId;
    const callId = pendingCallId;
    if (!callerClientId || !callId) return;
    stopRingtone();
    acceptButton.disabled = true;
    if (!(await acquireLocalMedia())) {
      acceptButton.disabled = false;
      return;
    }
    activeCallId = callId;
    socket.emit("rtc2:accept", { callerClientId, callId }, (result) => {
      acceptButton.disabled = false;
      if (!result?.ok) {
        activeCallId = null;
        resetIncomingCall();
        setCallState("Звонок уже завершён.");
        return;
      }
      outgoingCall = false;
      callAccepted = true;
      peerClientId = callerClientId;
      resetIncomingCall();
      startButton.textContent = "Подключено";
      setCallState("Соединяем…");
      updateMediaButtons();
    });
  });

  declineButton.addEventListener("click", () => {
    if (pendingCallerId && pendingCallId) {
      socket.emit("rtc2:decline", {
        callerClientId: pendingCallerId,
        callId: pendingCallId,
      });
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

  socket.on("rtc2:incoming-call", ({ caller, callId } = {}) => {
    if (!caller?.clientId || !callId || localStream || outgoingCall || callAccepted) return;
    pendingCallerId = caller.clientId;
    pendingCallId = callId;
    incomingName.textContent = `${caller.displayName || "Участник"} хочет присоединиться`;
    incomingBox.hidden = false;
    updateMediaButtons();
    startRingtone();
    videoButton.classList.add("ringing");
    videoButton.textContent = "📞 Входящий";
    showView("video");
    setCallState("Можно ответить, когда будете готовы 🙂");
  });

  socket.on("rtc2:accepted", ({ peer, callId } = {}) => {
    if (!outgoingCall || !localStream || !peer?.clientId || callId !== activeCallId) return;
    outgoingCall = false;
    callAccepted = true;
    peerClientId = peer.clientId;
    startButton.textContent = "Подключено";
    updateMediaButtons();
    startOffer(peer.clientId, "accepted");
  });

  socket.on("rtc2:signal", handleRtc2Signal);

  socket.on("rtc2:restart", ({ callId, peerClientId: otherClientId, offerer } = {}) => {
    if (!callAccepted || callId !== activeCallId || !otherClientId) return;
    if (offerer) {
      rebuilding = false;
      startOffer(otherClientId, "peer-resume");
    } else {
      rebuilding = false;
      destroyPeer();
      peerClientId = otherClientId;
      setCallState("Ждём восстановления соединения…");
    }
  });

  socket.on("rtc2:declined", ({ callId } = {}) => {
    if (callId !== activeCallId) return;
    stopCall({ notify: false, finalState: "Звонок отклонён." });
  });

  socket.on("rtc2:cancelled", ({ callId } = {}) => {
    if (callId !== pendingCallId) return;
    resetIncomingCall();
    setCallState("Входящий звонок завершён.");
  });

  socket.on("rtc2:ended", ({ callId } = {}) => {
    if (callId !== activeCallId) return;
    stopCall({
      notify: false,
      finalState: "Собеседник завершил звонок. Можно позвонить снова.",
    });
  });

  socket.on("connect", () => {
    if (callAccepted && activeCallId) {
      resumeRtc2Session("socket-reconnect");
    } else if (outgoingCall && activeCallId) {
      socket.emit("rtc2:call", { callId: activeCallId });
    }
  });

  const rtc2NetworkChange = () => {
    if (!callAccepted || !activeCallId) return;
    emitRtcDebug({
      event: "network-change-v2",
      state: `online=${navigator.onLine};effectiveType=${rtcNetworkSnapshot().effectiveType || "unknown"}`,
    });
    scheduleRtc2Resume("network-change");
  };
  const rtc2Connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection ||
    null;
  rtc2Connection?.addEventListener?.("change", rtc2NetworkChange);
  window.addEventListener("online", rtc2NetworkChange);
  window.addEventListener("offline", rtc2NetworkChange);

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
