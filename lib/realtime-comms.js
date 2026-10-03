function normalizeChatMessage(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, 2000);
}

function normalizeRtcSignal(payload) {
  if (!payload || typeof payload !== "object") return null;
  const targetId = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
  const callId = typeof payload.callId === "string" ? payload.callId.trim() : "";
  if (!targetId || targetId.length > 200) return null;
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(callId)) return null;

  if (payload.description) {
    const type = payload.description.type;
    const sdp = typeof payload.description.sdp === "string" ? payload.description.sdp : "";
    if (!["offer", "answer", "rollback"].includes(type)) return null;
    if (sdp.length > 200_000) return null;
    return { callId, targetId, description: { type, sdp } };
  }

  if (payload.candidate) {
    const candidate = typeof payload.candidate.candidate === "string"
      ? payload.candidate.candidate
      : "";
    if (candidate.length > 20_000) return null;
    return {
      callId,
      targetId,
      candidate: {
        candidate,
        sdpMid:
          payload.candidate.sdpMid == null
            ? null
            : String(payload.candidate.sdpMid).slice(0, 200),
        sdpMLineIndex: Number.isInteger(payload.candidate.sdpMLineIndex)
          ? payload.candidate.sdpMLineIndex
          : null,
        usernameFragment:
          payload.candidate.usernameFragment == null
            ? null
            : String(payload.candidate.usernameFragment).slice(0, 500),
      },
    };
  }

  return null;
}

module.exports = { normalizeChatMessage, normalizeRtcSignal };
