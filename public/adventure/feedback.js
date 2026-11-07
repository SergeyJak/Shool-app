(function (root) {
  'use strict';
  root.AdventureFeedback = { set };
  function set(node, text, kind = 'info') {
    const result = kind === 'success' || kind === 'error';
    node.dataset.kind = result ? kind : 'info';
    node.setAttribute('aria-atomic', 'true');
    const game = node.closest('#game');
    if (game) {
      game.dataset.answerState = result ? kind : 'neutral';
      if (kind === 'success') game.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    }
    node.replaceChildren();
    if (result) {
      const icon = node.ownerDocument.createElement('span');
      icon.className = 'ag-feedback-icon';icon.setAttribute('aria-hidden', 'true');
      icon.textContent = kind === 'success' ? '✓' : '×';
      const title = node.ownerDocument.createElement('strong');
      title.className = 'ag-feedback-title';
      title.textContent = kind === 'success' ? 'Верно!' : 'Попробуй ещё раз';
      node.append(icon, title, node.ownerDocument.createTextNode(' '));
    }
    const message = node.ownerDocument.createElement('span');
    message.className = 'ag-feedback-message';message.textContent = text;
    node.append(message);
  }
})(globalThis);
