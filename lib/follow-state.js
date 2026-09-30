function normalizeFollowPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function createFollowState() {
  let enabled = false;
  let page = 1;

  return {
    start(nextPage) {
      const normalized = normalizeFollowPage(nextPage);
      if (!normalized) return false;
      enabled = true;
      page = normalized;
      return true;
    },
    move(nextPage) {
      const normalized = normalizeFollowPage(nextPage);
      if (!enabled || !normalized) return false;
      page = normalized;
      return true;
    },
    stop() {
      enabled = false;
    },
    snapshot() {
      return { enabled, page };
    },
  };
}

module.exports = {
  normalizeFollowPage,
  createFollowState,
};
