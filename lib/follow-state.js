function normalizeFollowPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function normalizeControllerKey(value) {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9:_-]{3,180}$/.test(key) ? key : null;
}

function createFollowState({
  disconnectGraceMs = 8000,
  schedule = setTimeout,
  cancel = clearTimeout,
  onExpired = () => {},
} = {}) {
  let enabled = false;
  let page = 1;
  let controllerKey = null;
  let disconnectTimer = null;

  function clearDisconnectTimer() {
    if (!disconnectTimer) return;
    cancel(disconnectTimer);
    disconnectTimer = null;
  }

  function state() {
    return { enabled, page, controllerKey };
  }

  function stopInternal() {
    clearDisconnectTimer();
    enabled = false;
    controllerKey = null;
    return state();
  }

  return {
    start(nextPage, nextControllerKey) {
      const normalizedPage = normalizeFollowPage(nextPage);
      const normalizedController = normalizeControllerKey(nextControllerKey);
      if (!normalizedPage || !normalizedController) return false;
      clearDisconnectTimer();
      enabled = true;
      page = normalizedPage;
      controllerKey = normalizedController;
      return true;
    },

    move(nextPage, requesterKey) {
      const normalizedPage = normalizeFollowPage(nextPage);
      const normalizedRequester = normalizeControllerKey(requesterKey);
      if (!enabled || !normalizedPage || normalizedRequester !== controllerKey) return false;
      page = normalizedPage;
      return true;
    },

    stop(requesterKey, { force = false } = {}) {
      const normalizedRequester = normalizeControllerKey(requesterKey);
      if (!enabled) return true;
      if (!force && normalizedRequester !== controllerKey) return false;
      stopInternal();
      return true;
    },

    reconnect(requesterKey) {
      const normalizedRequester = normalizeControllerKey(requesterKey);
      if (!enabled || normalizedRequester !== controllerKey) return false;
      clearDisconnectTimer();
      return true;
    },

    disconnect(requesterKey) {
      const normalizedRequester = normalizeControllerKey(requesterKey);
      if (!enabled || normalizedRequester !== controllerKey) return false;
      clearDisconnectTimer();
      disconnectTimer = schedule(() => {
        disconnectTimer = null;
        if (!enabled || controllerKey !== normalizedRequester) return;
        const expired = stopInternal();
        onExpired(expired);
      }, disconnectGraceMs);
      return true;
    },

    snapshot(viewerKey = null) {
      const normalizedViewer = normalizeControllerKey(viewerKey);
      return {
        enabled,
        page,
        controlling: Boolean(enabled && normalizedViewer && normalizedViewer === controllerKey),
      };
    },

    rawSnapshot() {
      return state();
    },
  };
}

module.exports = {
  normalizeFollowPage,
  normalizeControllerKey,
  createFollowState,
};
