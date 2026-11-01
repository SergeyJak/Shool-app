// Keep asynchronous authorization and writes in packet order. Calling next()
// from independent async Socket.IO middleware would allow later packets to pass
// a slow earlier lookup and would not wait for earlier handler writes to finish.
function createSocketEventRegistrar({ socket, authorize, onError = () => {}, maxPending = 256 }) {
  let queue = Promise.resolve();
  let pending = 0;
  return (event, handler) => socket.on(event, (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.at(-1) : null;
    if (pending >= maxPending) {
      ack?.({ ok: false, error: 'TOO_MANY_EVENTS' });
      socket.disconnect(true);
      return;
    }
    pending++;
    queue = queue.then(async () => {
      if (!socket.connected || !await authorize(socket, event) || !socket.connected) {
        ack?.({ ok: false, error: 'AUTH_REVOKED' });
        return;
      }
      await handler(...args);
    }).catch(error => {
      try { onError(event, error); } catch { /* Error reporting cannot break the queue. */ }
      try { ack?.({ ok: false, error: 'INVALID_EVENT' }); } catch { /* Peer already gone. */ }
    }).finally(() => { pending--; });
  });
}

module.exports = { createSocketEventRegistrar };
