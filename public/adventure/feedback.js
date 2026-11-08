(function (root) {
  'use strict';
  root.AdventureFeedback = { set, clear };
  const motion = root.matchMedia('(prefers-reduced-motion: reduce)');
  function clear(node) {
    node.closest('#game')?.querySelectorAll('.ag-celebration').forEach(scene => scene.remove());
    node.querySelector('.ag-feedback-icon')?.classList.remove('ag-feedback-icon--celebrate');
  }
  motion.addEventListener('change', () => {
    if (motion.matches) root.document.querySelectorAll('#feedback').forEach(clear);
  });
  function celebrate(game) {
    if (!game || motion.matches) return;
    const scene = game.ownerDocument.createElement('div');
    scene.className = 'ag-celebration';scene.setAttribute('aria-hidden', 'true');
    const owl = game.ownerDocument.createElement('img');
    owl.className = 'ag-celebration-owl';owl.alt = '';
    owl.src = '/assets/owl-mascot-pack/owl-celebrate.png?v=20261106-cutout';scene.append(owl);
    for (let i = 0; i < 8; i++) {
      const star = game.ownerDocument.createElement('span');
      star.className = 'ag-celebration-star';star.textContent = i % 2 ? '✦' : '★';
      star.style.setProperty('--star-index', i);scene.append(star);
    }
    scene.addEventListener('animationend', event => { if (event.target === scene) scene.remove(); });
    game.append(scene);
  }
  function set(node, text, kind = 'info') {
    const result = kind === 'success' || kind === 'error';
    const newSuccess = kind === 'success' && node.dataset.kind !== 'success';
    if (kind !== 'success') clear(node);
    node.dataset.kind = result ? kind : 'info';
    node.setAttribute('aria-atomic', 'true');
    const game = node.closest('#game');
    if (game) {
      game.dataset.answerState = result ? kind : 'neutral';
      if (kind === 'success') game.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    }
    // Delivery callbacks may update a correct answer's explanation. Keep the
    // current check and celebration rather than starting a second animation.
    const previousMessage = node.querySelector('.ag-feedback-message');
    if (kind === 'success' && !newSuccess && previousMessage) { previousMessage.textContent = text;return; }
    node.replaceChildren();
    if (result) {
      const icon = node.ownerDocument.createElement('span');
      icon.className = 'ag-feedback-icon' + (newSuccess && !motion.matches ? ' ag-feedback-icon--celebrate' : '');icon.setAttribute('aria-hidden', 'true');
      icon.textContent = kind === 'success' ? '✓' : '×';
      const title = node.ownerDocument.createElement('strong');
      title.className = 'ag-feedback-title';
      title.textContent = kind === 'success' ? 'Верно!' : 'Попробуй ещё раз';
      node.append(icon, title, node.ownerDocument.createTextNode(' '));
    }
    const message = node.ownerDocument.createElement('span');
    message.className = 'ag-feedback-message';message.textContent = text;
    node.append(message);
    if (newSuccess) celebrate(game);
  }
})(globalThis);
