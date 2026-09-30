const test = require("node:test");
const assert = require("node:assert/strict");

let preview;
test.before(async () => {
  preview = await import("../public/realtime-preview.mjs");
});

test("live preview cadence is capped near 30 fps", () => {
  assert.equal(preview.PREVIEW_INTERVAL_MS, 32);
});

test("preview chunks include one overlap point for seamless remote lines", () => {
  const stroke = {
    id: "s1",
    page: 1,
    role: "student",
    color: "#1565c0",
    width: 2.5,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ],
  };

  assert.deepEqual(preview.buildPreviewChunk(stroke, 2).points, [
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.3 },
    { x: 0.4, y: 0.4 },
  ]);
});

test("remote preview merges chunks without duplicating overlap point", () => {
  const existing = {
    id: "s1",
    page: 1,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
  };
  const incoming = {
    id: "s1",
    page: 1,
    points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }],
  };

  assert.deepEqual(preview.mergePreviewStroke(existing, incoming).points, [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.3 },
  ]);
});
