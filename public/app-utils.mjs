export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 3;

export function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || 1));
}

export function clampPage(value, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  return Math.max(1, Math.min(total, Number(value) || 1));
}

export function pageStorageKey(documentId, role) {
  return `school:lastPage:${documentId}:${role}`;
}

export function legacyPageStorageKey(documentId, role) {
  return `shool:lastPage:${documentId}:${role}`;
}
