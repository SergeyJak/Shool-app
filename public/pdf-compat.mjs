// PDF.js 6's legacy build requires Promise.withResolvers without polyfilling it.
// Restore it only when absent, including inside the dedicated PDF worker.
if (typeof Promise.withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve;
      let reject;
      const promise = new this((resolvePromise, rejectPromise) => {
        if (resolve !== undefined || reject !== undefined) {
          throw new TypeError("Promise executor must be called only once");
        }
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      if (typeof resolve !== "function" || typeof reject !== "function") {
        throw new TypeError("Promise constructor must provide resolve and reject functions");
      }
      return { promise, resolve, reject };
    },
  });
}
