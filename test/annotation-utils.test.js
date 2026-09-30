const test = require("node:test");
const assert = require("node:assert/strict");
const {
  distancePointToSegment,
  splitStrokeByErasePath,
  isValidErasePath,
  isValidStroke,
} = require("../lib/annotation-utils");

test("validates a normal stroke", () => {
  assert.equal(isValidStroke({
    id: "s1",
    page: 2,
    color: "#1565c0",
    width: 2.5,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }],
  }), true);
});

test("rejects strokes outside normalized page coordinates", () => {
  assert.equal(isValidStroke({
    id: "bad",
    page: 1,
    color: "#000",
    width: 2,
    points: [{ x: -0.1, y: 0.2 }, { x: 0.2, y: 0.3 }],
  }), false);
});

test("validates eraser paths and radius limits", () => {
  assert.equal(isValidErasePath({
    page: 1,
    radius: 0.022,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
  }), true);
  assert.equal(isValidErasePath({
    page: 1,
    radius: 0.5,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
  }), false);
});

test("distance to a segment uses the closest point on the segment", () => {
  const d = distancePointToSegment(
    { x: 0.5, y: 0.2 },
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  );
  assert.ok(Math.abs(d - 0.2) < 1e-9);
});

test("eraser splits a stroke instead of deleting the whole line", () => {
  const stroke = {
    _id: "s1",
    page: 1,
    role: "student",
    color: "#1565c0",
    width: 2.5,
    points: [
      { x: 0.10, y: 0.5 },
      { x: 0.20, y: 0.5 },
      { x: 0.30, y: 0.5 },
      { x: 0.40, y: 0.5 },
      { x: 0.50, y: 0.5 },
      { x: 0.60, y: 0.5 },
      { x: 0.70, y: 0.5 },
    ],
  };
  const erase = {
    page: 1,
    radius: 0.055,
    points: [{ x: 0.40, y: 0.4 }, { x: 0.40, y: 0.6 }],
  };

  const parts = splitStrokeByErasePath(stroke, erase);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].points, stroke.points.slice(0, 3));
  assert.deepEqual(parts[1].points, stroke.points.slice(4));
});
