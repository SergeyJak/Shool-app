const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeChatMessage, normalizeRtcSignal } = require("../lib/realtime-comms");

test("chat messages are trimmed capped and reject empty content", () => {
  assert.equal(normalizeChatMessage("  hello  "), "hello");
  assert.equal(normalizeChatMessage("   "), null);
  assert.equal(normalizeChatMessage("x".repeat(2500)).length, 2000);
});

test("rtc descriptions require a target and supported SDP type", () => {
  assert.deepEqual(
    normalizeRtcSignal({
      callId: "call-12345",
      targetId: "peer-1",
      description: { type: "offer", sdp: "v=0" },
    }),
    { callId: "call-12345", targetId: "peer-1", description: { type: "offer", sdp: "v=0" } }
  );
  assert.equal(
    normalizeRtcSignal({ callId: "call-12345", targetId: "peer-1", description: { type: "invalid", sdp: "x" } }),
    null
  );
  assert.equal(
    normalizeRtcSignal({ callId: "call-12345", description: { type: "offer", sdp: "x" } }),
    null
  );
});

test("rtc candidates are normalized and bounded", () => {
  assert.deepEqual(
    normalizeRtcSignal({
      callId: "call-12345",
      callId: "call-12345",
      targetId: "peer-2",
      candidate: {
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "abc",
      },
    }),
    {
      callId: "call-12345",
      targetId: "peer-2",
      candidate: {
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "abc",
      },
    }
  );
  assert.equal(
    normalizeRtcSignal({ callId: "call-12345", targetId: "peer-2", candidate: { candidate: "x".repeat(20001) } }),
    null
  );
});
