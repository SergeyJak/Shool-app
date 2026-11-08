(function (root) {
  'use strict';
  root.AdventureWeightMotion = { create };
  function create(c) {
    const game = c.root.closest('#game'), view = c.root.ownerDocument.defaultView;
    const preference = view.matchMedia('(prefers-reduced-motion: reduce)'), flights = new Set();
    let layer;
    function discard(flight) {
      if (!flights.delete(flight)) return;
      flight.animation.cancel();flight.node.remove();
      if (!flights.size) { layer?.remove();layer = null; }
    }
    function clear() { [...flights].forEach(discard); }
    const changed = () => { if (preference.matches) clear(); };
    preference.addEventListener('change', changed);
    c.signal?.addEventListener('abort', () => { clear();preference.removeEventListener('change', changed); }, { once:true });
    function fly(from, target, label) {
      if (!game || !from || !target?.isConnected || preference.matches || c.signal?.aborted || !view.Element.prototype.animate) return;
      while (flights.size >= 3) discard(flights.values().next().value);
      if (!layer) {
        layer = c.el('div', 'ag-weight-flights');layer.setAttribute('aria-hidden', 'true');game.append(layer);
      }
      const bounds = layer.getBoundingClientRect(), to = target.getBoundingClientRect();
      const clamp = (n, max) => Math.max(24, Math.min(max - 24, n));
      const start = { x:clamp(from.left + from.width / 2 - bounds.left,bounds.width), y:clamp(from.top + from.height / 2 - bounds.top,bounds.height) };
      const end = { x:clamp(to.left + to.width / 2 - bounds.left,bounds.width), y:clamp(to.top + to.height / 2 - bounds.top,bounds.height) };
      const transform = (x,y,scale) => `translate(${x - 22}px,${y - 18}px) scale(${scale})`;
      const ghost = c.el('span', 'ag-weight-icon ag-weight-flight', label);layer.append(ghost);
      const animation = ghost.animate([
        { transform:transform(start.x,start.y,.65), opacity:.8 },
        { transform:transform((start.x+end.x)/2,clamp(Math.min(start.y,end.y)-28,bounds.height),1.08), opacity:1, offset:.5 },
        { transform:transform(end.x,end.y,.85), opacity:0 }
      ], { duration:440, easing:'cubic-bezier(.2,.65,.3,1)' });
      const flight = { node:ghost, animation };flights.add(flight);
      animation.finished.catch(() => {}).finally(() => discard(flight));
    }
    return { fly, clear };
  }
})(globalThis);
