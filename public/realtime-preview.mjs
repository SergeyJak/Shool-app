export const PREVIEW_INTERVAL_MS = 32;

export function buildPreviewChunk(stroke, fromIndex) {
  if (!stroke?.points?.length) return null;

  const start = Math.max(0, Number(fromIndex) || 0);
  const chunkStart = start > 0 ? start - 1 : 0;
  const points = stroke.points.slice(chunkStart);

  if (points.length < 2) return null;

  return {
    id: stroke.id,
    page: stroke.page,
    role: stroke.role,
    color: stroke.color,
    width: stroke.width,
    points,
  };
}

export function mergePreviewStroke(existing, incoming) {
  if (!existing || existing.id !== incoming.id) {
    return { ...incoming, points: [...incoming.points] };
  }

  const current = existing.points || [];
  const next = incoming.points || [];
  if (!next.length) return existing;

  let appendFrom = 0;
  const last = current.at(-1);
  const first = next[0];

  if (last && first && last.x === first.x && last.y === first.y) {
    appendFrom = 1;
  }

  return {
    ...existing,
    ...incoming,
    points: current.concat(next.slice(appendFrom)),
  };
}
