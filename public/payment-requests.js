(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaymentRequests = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function createPaymentSubmitter(send, makeId = () => crypto.randomUUID()) {
    const submissions = new Map();
    return function submit(form, url, body) {
      const payload = JSON.stringify(body);
      let state = submissions.get(form);
      if (state?.pending) return state.pending;
      if (!state || state.url !== url || state.payload !== payload) {
        state = { url, payload, key: makeId(), pending: null };
        submissions.set(form, state);
      }
      state.pending = Promise.resolve().then(() => send(url, {
        method: 'POST', body: payload,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': state.key },
      })).then(result => {
        submissions.delete(form);
        return result;
      }).catch(error => {
        // Unknown outcomes retain their key so retrying cannot double-book.
        // A definite client rejection can be corrected and submitted anew.
        if (error.status >= 400 && error.status < 500) submissions.delete(form);
        throw error;
      }).finally(() => { state.pending = null; });
      return state.pending;
    };
  }
  return { createPaymentSubmitter };
});
