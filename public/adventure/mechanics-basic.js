(function (root, factory) {
  const mechanics = factory();
  if (typeof module === 'object' && module.exports) module.exports = mechanics;
  else Object.assign(root.AdventureMechanics ||= {}, mechanics);
})(globalThis, function () {
  function scenery(c) {
    const scene = c.el('div', 'ag-scene ag-scene--' + c.level.scene);
    const prop = c.el('div', 'ag-scene-prop', ({ shop: '🏪', market: '🛒', train: '🚂', balloon: '🎈', city: '🏠',
      island: '🏝️', cave: '💎', castle: '🏰', workshop: '🛠️', mountain: '⛰️', laboratory: '⚖️', space: '🚀' })[c.level.scene] || c.level.icon);
    prop.setAttribute('aria-hidden', 'true');
    const badge = c.el('output', 'ag-scene-value'); badge.setAttribute('aria-live', 'polite');
    scene.append(prop, badge); c.root.append(scene);
    return { scene, prop, badge };
  }
  function check(c, action) {
    const b = c.button('Проверить', action, 'ag-check ag-primary'); c.root.append(b); return b;
  }
  const massUnit = t => t.unit === 'г' || t.unit === 'кг';
  function weightIcon(c, text = '') {
    const icon = c.el('span', 'ag-weight-icon', text);icon.setAttribute('aria-hidden', 'true');return icon;
  }
  function quantityUnit(unit, value) {
    const forms = { 'монет':['монета','монеты','монет'], 'камней':['камень','камня','камней'], 'клеток':['клетка','клетки','клеток'], 'ягод':['ягода','ягоды','ягод'], 'досок':['доска','доски','досок'] }[unit];
    if (!forms) return unit || '';
    const n = Math.abs(value) % 100, last = n % 10;
    return forms[n >= 11 && n <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
  }
  function pieceButton(c, piece, action, className, count = 1, collected = false) {
    const t = c.task, mass = massUnit(t);
    const label = mass ? (collected ? '' : '+') + c.format(piece.value, t.displayScale) + ' ' + t.unit : piece.label;
    const quantity = collected && count > 1 ? ' · ' + count + ' шт.' : '';
    const icon = mass ? null : piece.icon || (['₽','руб.','руб','монет'].includes(t.unit) ? '🪙' : ['см','м','км'].includes(t.unit) ? '📏' : '🔢');
    const button = c.button((icon ? icon + ' ' : '') + label + quantity, action, className);
    if (mass) button.prepend(weightIcon(c));
    return button;
  }
  function massContext(c, scene) {
    const t = c.task;
    if (t.visual === 'balance') {
      const board = c.el('div', 'ag-balance-board');board.setAttribute('role', 'group');board.setAttribute('aria-label', 'Весы');
      const beam = c.el('div', 'ag-balance-beam'), stand = c.el('div', 'ag-balance-stand');
      beam.setAttribute('aria-hidden', 'true');stand.setAttribute('aria-hidden', 'true');board.append(beam, stand);
      const left = c.el('div', 'ag-balance-pan'), right = c.el('div', 'ag-balance-pan');left.dataset.side = 'left';right.dataset.side = 'right';
      const known = weightIcon(c, t.balance.known + ' г'), added = c.el('span', 'ag-balance-added'), goal = weightIcon(c, t.balance.total + ' г'), plus = c.el('span', '', '+');added.setAttribute('aria-hidden', 'true');
      const leftTotal = c.el('output', 'ag-balance-total'), rightTotal = c.el('output', 'ag-balance-total', t.balance.total + ' г');
      const leftWeights = c.el('div', 'ag-balance-weights'), rightWeights = c.el('div', 'ag-balance-weights');
      leftWeights.append(known, plus, added);rightWeights.append(goal);
      left.append(leftWeights, leftTotal);right.append(rightWeights, rightTotal);board.append(left, right);scene.prepend(board);scene.classList.add('ag-mass-scene');
      return (value, picked) => {
        const total = t.balance.known + value, tilt = Math.max(-6, Math.min(6, (t.balance.total - total) / 2));
        if (total === t.balance.total && board.dataset.balanced !== 'true') {
          const view = scene.ownerDocument.defaultView;
          board.style.setProperty('--balance-start-beam', view.getComputedStyle(beam).transform);
          board.style.setProperty('--balance-start-left', view.getComputedStyle(left).transform);
          board.style.setProperty('--balance-start-right', view.getComputedStyle(right).transform);
        }
        board.dataset.left = String(total);board.dataset.right = String(t.balance.total);board.dataset.balanced = String(total === t.balance.total);
        board.style.setProperty('--balance-tilt', tilt + 'deg');
        left.style.transform = `translateY(${-tilt * 1.5}px)`;right.style.transform = `translateY(${tilt * 1.5}px)`;
        added.replaceChildren();
        const counts = new Map();picked.forEach(index => counts.set(index, (counts.get(index) || 0) + 1));
        counts.forEach((count, index) => {
          const group = c.el('span', 'ag-balance-piece');group.dataset.piece = String(index);group.append(weightIcon(c, c.format(t.pieces[index].value) + ' г'));
          if (count > 1) group.append(c.el('small', 'ag-balance-piece-count', '×' + count));
          added.append(group);
        });
        added.hidden = value === 0;plus.hidden = value === 0;leftTotal.textContent = total + ' г';
        left.setAttribute('aria-label', `На левой чаше ${t.balance.known} г и добавленные ${value} г. Всего ${total} г.`);
        right.setAttribute('aria-label', `На правой чаше ${t.balance.total} г.`);
      };
    }
    if (t.visual === 'mass-group') {
      const group = c.el('div', 'ag-mass-group');group.setAttribute('aria-label', `${t.massGroup.count} одинаковые гирьки. Вместе ${t.massGroup.total} г.`);
      for (let i = 0; i < t.massGroup.count; i++) group.append(weightIcon(c, '?'));
      group.append(c.el('strong', '', `Вместе ${t.massGroup.total} г`));scene.prepend(group);scene.classList.add('ag-mass-scene');
    }
    return () => {};
  }
  function compose(c) {
    const t = c.task, picked = [];
    const { scene, prop, badge } = scenery(c);
    const updateContext = massContext(c, scene);
    const motion = massUnit(t) ? globalThis.AdventureWeightMotion?.create(c) : null;
    const tokens = c.el('div', 'ag-collected'); scene.append(tokens);
    const controls = c.el('div', 'ag-piece-tray');
    const sum = () => picked.reduce((n, i) => n + t.pieces[i].value, 0);
    function paint() {
      const value = sum();
      const amount = t.unit === 'восьмых целого' ? value + '/8 целого' : c.format(value, t.displayScale) + (t.unit ? ' ' + quantityUnit(t.unit, value) : '');
      badge.textContent = (t.answerLabel ? t.answerLabel + ': ' : '') + amount;
      updateContext(value, picked);
      tokens.replaceChildren();
      const counts = new Map();
      picked.forEach(index => counts.set(index, (counts.get(index) || 0) + 1));
      counts.forEach((count, index) => {
        const piece = t.pieces[index];
        const token = pieceButton(c, piece, event => {
          const source = motion ? c.root.querySelector(`.ag-balance-piece[data-piece="${index}"]`) || event.currentTarget : null;
          const from = source?.getBoundingClientRect();
          const position = picked.indexOf(index);
          if (position !== -1) {
            picked.splice(position, 1); paint();
            motion?.fly(from, controls.querySelector(`[data-piece="${index}"]`), c.format(piece.value, t.displayScale) + ' ' + t.unit);
          }
        }, 'ag-token', count, true);
        token.dataset.piece = String(index);
        token.setAttribute('aria-label', (massUnit(t) ? 'Убрать гирьку: ' + c.format(piece.value, t.displayScale) + ' ' + t.unit : 'Убрать один предмет: ' + piece.label) + '. В наборе: ' + count + '.'); tokens.append(token);
      });
      scene.dataset.value = String(value);
      if (c.level.scene === 'balloon') prop.style.transform = `translateY(${-Math.min(80, value / Math.max(1, t.target) * 80)}px)`;
    }
    t.pieces.forEach((piece, index) => {
      const b = pieceButton(c, piece, event => {
        if (picked.length >= (t.maxPieces || 25)) { c.feedback('Больше добавлять нельзя. Убери лишнее или начни заново.', 'error'); return; }
        const from = motion ? (event.currentTarget.querySelector('.ag-weight-icon') || event.currentTarget).getBoundingClientRect() : null;
        picked.push(index); paint(); c.feedback(massUnit(t) ? 'Гирька добавлена. Нажми на добавленную гирьку, чтобы убрать её.' : 'Добавлено. Нажми на выбранный элемент, чтобы убрать его.');
        if (motion) {
          const target = c.root.querySelector(`.ag-balance-piece[data-piece="${index}"] .ag-weight-icon`) || tokens.querySelector(`[data-piece="${index}"] .ag-weight-icon`);
          motion.fly(from, target, c.format(piece.value, t.displayScale) + ' ' + t.unit);
        }
      }, 'ag-piece ag-control');
      b.dataset.value = String(piece.value); b.dataset.piece = String(index); controls.append(b);
    });
    c.root.append(controls);
    check(c, () => sum() === t.target ? c.solve(t.explanation) : c.feedback('Пока не совпало. Посмотри на собранное число и попробуй изменить набор.', 'error'));
    paint();
  }
  function order(c) {
    const t = c.task, chosen = [], { scene } = scenery(c);
    const train = c.el('div', 'ag-order-track'), tray = c.el('div', 'ag-order-tray');
    scene.append(train); c.root.append(tray);
    const options = new Map();
    function paint() {
      train.replaceChildren();
      for (let i = 0; i < t.items.length; i++) {
        const id = chosen[i], item = t.items.find(p => p.id === id);
        const slot = c.button(item ? item.label : '· · ·', () => { if (id !== undefined) { chosen.splice(i, 1); paint(); } }, 'ag-order-slot');
        slot.dataset.position = String(i); slot.setAttribute('aria-label', `Место ${i + 1}: ${item?.label || 'пусто'}`); train.append(slot);
      }
      for (const [id, b] of options) b.disabled = chosen.includes(id);
    }
    [...t.items].reverse().forEach(item => {
      const b = c.button((item.icon ? item.icon + ' ' : '') + item.label, () => {
        if (chosen.length < t.items.length) { chosen.push(item.id); paint(); }
      }, 'ag-order-item ag-control'); b.dataset.item = String(item.id); options.set(item.id, b); tray.append(b);
    });
    check(c, () => chosen.length === t.solution.length && chosen.every((id, i) => id === t.solution[i])
      ? c.solve(t.explanation) : c.feedback('Проверь порядок вагончиков. Нажми на вагончик сверху, чтобы вернуть его и переставить.', 'error'));
    paint();
  }
  function share(c) {
    const t = c.task, counts = Array(t.groups).fill(0), { scene, badge } = scenery(c);
    const groups = c.el('div', 'ag-share-groups'); c.root.append(groups);
    groups.style.setProperty('--ag-share-groups', Math.min(3, t.groups));
    groups.classList.toggle('ag-share-groups--dense', t.groups > 3);
    const visibleLimit = Math.max(8, t.each), itemIcon = t.itemIcon || '●';
    const bins = [];
    function paint() {
      const left = t.total - counts.reduce((a, b) => a + b, 0);
      badge.textContent = 'Осталось: ' + left + (massUnit(t) ? ' ' + t.unit : '');
      bins.forEach((b, i) => {
        b.count.textContent = String(counts[i]) + (massUnit(t) ? ' ' + t.unit : '');
        b.count.setAttribute('aria-label', (t.groupLabels?.[i] || 'Корзина ' + (i + 1)) + ': ' + counts[i] + (massUnit(t) ? ' ' + t.unit : ''));
        const visible = Math.min(visibleLimit, counts[i]);
        while (b.pieces.length > visible) b.pieces.pop().remove();
        while (b.pieces.length < visible) {
          const piece = itemIcon === 'weight' ? weightIcon(c, '1 г') : c.el('span', '', itemIcon);
          piece.classList.add('ag-share-item');
          b.items.append(piece); b.pieces.push(piece);
        }
        const overflow = counts[i] - visible;
        b.overflow.textContent = overflow ? '+' + overflow : '';
        b.overflow.hidden = overflow === 0;
        b.add.disabled = left <= 0; b.remove.disabled = counts[i] === 0;
        b.box.dataset.count = String(counts[i]);
      });
      scene.dataset.remaining = String(left);
    }
    for (let i = 0; i < t.groups; i++) {
      const box = c.el('div', 'ag-share-group'), title = c.el('strong', '', t.groupLabels?.[i] || 'Корзина ' + (i + 1));
      const recipient = c.el('span', 'ag-share-recipient', (Array.isArray(t.groupIcon) ? t.groupIcon[i] : t.groupIcon) || '🧺');
      recipient.setAttribute('aria-hidden', 'true');
      const label = c.el('span', 'ag-share-label', title.textContent);
      const ordinal = c.el('span', 'ag-share-ordinal', '№' + (i + 1));ordinal.setAttribute('aria-hidden', 'true');
      box.setAttribute('role', 'group');box.setAttribute('aria-label', label.textContent);
      title.replaceChildren(recipient, label, ordinal);
      const count = c.el('output', 'ag-share-count'), items = c.el('div', 'ag-share-items');
      items.setAttribute('aria-hidden', 'true');
      const overflow = c.el('span', 'ag-share-overflow'); overflow.setAttribute('aria-hidden', 'true');
      const add = c.button('+1', () => { if (counts.reduce((a, b) => a + b, 0) < t.total) { counts[i]++; paint(); } }, 'ag-give ag-control');
      const remove = c.button('−1', () => { if (counts[i] > 0) { counts[i]--; paint(); } }, 'ag-take ag-control');
      add.dataset.group = remove.dataset.group = String(i);
      add.setAttribute('aria-label', (massUnit(t) ? 'Добавить гирьку 1 ' + t.unit + ': ' : 'Положить один: ') + label.textContent); remove.setAttribute('aria-label', (massUnit(t) ? 'Убрать гирьку 1 ' + t.unit + ': ' : 'Забрать один: ') + label.textContent);
      box.append(title, items, overflow, count, add, remove); groups.append(box); bins.push({ box, count, items, overflow, pieces: [], add, remove });
    }
    check(c, () => counts.every(n => n === t.each) && counts.reduce((a, b) => a + b, 0) === t.total
      ? c.solve(t.explanation) : c.feedback('Нужно разложить всё поровну. Сравни корзинки: из полной можно вернуть один предмет.', 'error'));
    paint();
  }
  function rectangle(c) {
    if (c.task.visual === 'treasures') {
      const lesson = typeof module === 'object' && module.exports ? require('./treasure-lesson') : globalThis.AdventureTreasureLesson;
      lesson(c);return;
    }
    const t = c.task, selected = new Set(), board = c.el('div', 'ag-paint-board');
    const grid = c.el('div', 'ag-paint-grid'); grid.style.setProperty('--ag-cols', t.cols);
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Клетчатое поле');
    const status = c.el('output', 'ag-build-status'); status.setAttribute('aria-live', 'polite');
    board.append(grid, status); c.root.append(board);
    const cells = [];
    function perimeter() {
      let n = 0;
      for (const id of selected) {
        const x = id % t.cols, y = Math.floor(id / t.cols);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= t.cols || ny < 0 || ny >= t.rows || !selected.has(ny * t.cols + nx)) n++;
        }
      }
      return n;
    }
    function paint() {
      cells.forEach((b, i) => {
        const picked = selected.has(i);b.classList.toggle('ag-painted', picked);b.setAttribute('aria-pressed', String(picked));
      });
      const p = perimeter();
      status.textContent = t.cols === 10 && t.rows === 10 && !t.requireRectangle ? `Закрашено: ${selected.size} из 100 (${selected.size}%)` : `Площадь: ${selected.size} кл. · Периметр: ${p} сторон`;
      board.dataset.area = String(selected.size); board.dataset.perimeter = String(p);
    }
    for (let y = 0; y < t.rows; y++) for (let x = 0; x < t.cols; x++) {
      const id = y * t.cols + x;
      const b = c.button('', () => { selected.has(id) ? selected.delete(id) : selected.add(id); paint(); }, 'ag-cell');
      b.dataset.x = String(x); b.dataset.y = String(y); b.setAttribute('aria-label', `Клетка ${x + 1}, ${y + 1}`); grid.append(b); cells.push(b);
    }
    if (t.cols === 10) {
      const row = c.button('Закрасить ряд из 10 клеток', () => {
        for (let y = 0; y < t.rows; y++) {
          if (Array.from({ length: t.cols }, (_, x) => y * t.cols + x).every(id => !selected.has(id))) {
            for (let x = 0; x < t.cols; x++) selected.add(y * t.cols + x); paint(); return;
          }
        }
        c.feedback('Пустых рядов больше нет. Можно менять отдельные клетки.');
      }, 'ag-fill-row ag-control'); c.root.append(row);
    }
    check(c, () => {
      let isRectangle = selected.size > 0;
      if (isRectangle && t.requireRectangle) {
        const xs = [...selected].map(id => id % t.cols), ys = [...selected].map(id => Math.floor(id / t.cols));
        isRectangle = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) === selected.size;
      }
      if (isRectangle && (t.targetArea === undefined || selected.size === t.targetArea) && (t.targetPerimeter === undefined || perimeter() === t.targetPerimeter)) c.solve(t.explanation);
      else c.feedback(t.requireRectangle ? 'Проверь: фигура должна быть цельным прямоугольником нужного размера. Пробелы можно закрасить, лишнее — убрать.' : 'Посчитай закрашенные клетки. Нажми на лишнюю клетку, чтобы стереть её.', 'error');
    });
    paint();
  }
  function fraction(c) {
    const t = c.task, chosen = new Set(), doc = c.root.ownerDocument;
    const board = c.el('div', 'ag-fraction-board'), counter = c.el('output', 'ag-fraction-count');
    counter.setAttribute('aria-live', 'polite');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 200'); svg.classList.add('ag-pizza'); svg.setAttribute('aria-label', 'Круг из ' + t.parts + ' равных частей');
    const wedges = [], controls = c.el('div', 'ag-fraction-pieces'), buttons = [];
    function paint() {
      counter.textContent = `Закрашено: ${chosen.size}/${t.parts}`;
      wedges.forEach((w, i) => { w.classList.toggle('ag-painted', chosen.has(i)); w.setAttribute('aria-pressed', String(chosen.has(i))); });
      buttons.forEach((b, i) => { b.classList.toggle('ag-painted', chosen.has(i)); b.setAttribute('aria-pressed', String(chosen.has(i))); });
      board.dataset.selected = String(chosen.size);
    }
    const toggle = i => { chosen.has(i) ? chosen.delete(i) : chosen.add(i); paint(); };
    for (let i = 0; i < t.parts; i++) {
      const a = i * Math.PI * 2 / t.parts - Math.PI / 2, b = (i + 1) * Math.PI * 2 / t.parts - Math.PI / 2;
      const wedge = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      wedge.setAttribute('d', `M100 100 L${100 + 90 * Math.cos(a)} ${100 + 90 * Math.sin(a)} A90 90 0 ${b - a > Math.PI ? 1 : 0} 1 ${100 + 90 * Math.cos(b)} ${100 + 90 * Math.sin(b)} Z`);
      wedge.setAttribute('role', 'button'); wedge.setAttribute('tabindex', '0'); wedge.setAttribute('aria-label', 'Долька ' + (i + 1));
      c.listen(wedge, 'click', () => toggle(i));
      c.listen(wedge, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i); } });
      svg.append(wedge); wedges.push(wedge);
      const button = c.button(String(i + 1), () => toggle(i), 'ag-fraction-piece'); button.dataset.part = String(i); button.setAttribute('aria-label', 'Долька ' + (i + 1));
      controls.append(button); buttons.push(button);
    }
    board.append(svg, counter, controls); c.root.append(board);
    check(c, () => chosen.size * t.target.d === t.target.n * t.parts ? c.solve(t.explanation) : c.feedback('Доли должны быть равными. Подумай, сколько долек нужно закрасить, чтобы получить нужную часть целого.', 'error'));
    paint();
  }
  function route(c) {
    const t = c.task, history = [t.start], { scene, prop, badge } = scenery(c);
    const path = c.el('div', 'ag-number-path'), actions = c.el('div', 'ag-route-controls'); scene.append(path); c.root.append(actions);
    function paint() {
      const value = history.at(-1); badge.textContent = c.format(value) + (t.unit ? ' ' + t.unit : '');
      scene.dataset.value = String(value); path.replaceChildren();
      history.slice(-10).forEach(n => path.append(c.el('span', 'ag-path-stone', c.format(n))));
      // Keep the character inside its flex slot at every route position.
      prop.style.transform = `translateX(${Math.max(0, Math.min(1, (value - t.start) / (t.target - t.start || 1))) * 20}px)`;
    }
    for (const step of t.steps) {
      const b = c.button((step > 0 ? '+' : '−') + Math.abs(step), () => {
        if (history.length > 25) { c.feedback('Путь стал длинным. Верни несколько шагов или начни раунд заново.'); return; }
        history.push(history.at(-1) + step); paint();
      }, 'ag-route-step ag-control'); b.dataset.step = String(step); actions.append(b);
    }
    const undo = c.button('↶ Назад на один шаг', () => { if (history.length > 1) { history.pop(); paint(); } }, 'ag-route-undo ag-secondary'); c.root.append(undo);
    check(c, () => history.at(-1) === t.target ? c.solve(t.explanation) : c.feedback('Пока не у цели. Проверь шаги: можно вернуться назад и выбрать другой ход.', 'error'));
    paint();
  }
  return { compose, order, share, rectangle, fraction, route };
});
