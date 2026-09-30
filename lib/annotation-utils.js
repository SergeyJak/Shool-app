function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return distance(point, a);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)
  );
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointHitsErasePath(point, erase) {
  for (let i = 1; i < erase.points.length; i += 1) {
    if (distancePointToSegment(point, erase.points[i - 1], erase.points[i]) <= erase.radius) {
      return true;
    }
  }
  return false;
}

function splitStrokeByErasePath(stroke, erase) {
  const parts = [];
  let current = [];

  for (const point of stroke.points || []) {
    if (pointHitsErasePath(point, erase)) {
      if (current.length >= 2) parts.push({ ...stroke, points: current });
      current = [];
    } else {
      current.push(point);
    }
  }

  if (current.length >= 2) parts.push({ ...stroke, points: current });
  return parts;
}

function isValidErasePath(erase) {
  return (
    erase &&
    Number.isInteger(erase.page) &&
    erase.page > 0 &&
    Number.isFinite(erase.radius) &&
    erase.radius > 0 &&
    erase.radius <= 0.08 &&
    Array.isArray(erase.points) &&
    erase.points.length >= 2 &&
    erase.points.length <= 5000 &&
    erase.points.every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1
    )
  );
}

function isValidStroke(stroke) {
  return (
    stroke &&
    typeof stroke.id === "string" &&
    Number.isInteger(stroke.page) &&
    stroke.page > 0 &&
    typeof stroke.color === "string" &&
    Number.isFinite(stroke.width) &&
    stroke.width > 0 &&
    Array.isArray(stroke.points) &&
    stroke.points.length >= 2 &&
    stroke.points.length <= 10000 &&
    stroke.points.every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1
    )
  );
}

module.exports = {
  distance,
  distancePointToSegment,
  pointHitsErasePath,
  splitStrokeByErasePath,
  isValidErasePath,
  isValidStroke,
};
