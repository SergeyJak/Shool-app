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
  function compose(c) {
    const t = c.task, picked = [];
    const { scene, prop, badge } = scenery(c);
    const tokens = c.el('div', 'ag-collected'); scene.append(tokens);
    const controls = c.el('div', 'ag-piece-tray');
    const sum = () => picked.reduce((n, i) => n + t.pieces[i].value, 0);
    function paint() {
      const value = sum(); badge.textContent = c.format(value, t.displayScale) + (t.unit ? ' ' + t.unit : '');
      tokens.replaceChildren();
      picked.forEach((index, position) => {
        const piece = t.pieces[index];
        const token = c.button((piece.icon || '🪙') + ' ' + piece.label, () => { picked.splice(position, 1); paint(); }, 'ag-token');
        token.setAttribute('aria-label', 'Убрать ' + piece.label); tokens.append(token);
      });
      scene.dataset.value = String(value);
      if (c.level.scene === 'balloon') prop.style.transform = `translateY(${-Math.min(80, value / Math.max(1, t.target) * 80)}px)`;
    }
    t.pieces.forEach((piece, index) => {
      const b = c.button((piece.icon || '🪙') + ' ' + piece.label, () => {
        if (picked.length >= (t.maxPieces || 25)) { c.feedback('В корзине уже много предметов. Убери лишние или начни раунд заново.', 'error'); return; }
        picked.push(index); paint(); c.feedback('Предмет добавлен. Ненужный можно нажать, чтобы убрать.');
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
    const bins = [];
    function paint() {
      const left = t.total - counts.reduce((a, b) => a + b, 0);
      badge.textContent = 'Осталось: ' + left;
      bins.forEach((b, i) => {
        b.count.textContent = String(counts[i]);
        b.items.textContent = '💎'.repeat(Math.min(12, counts[i])) + (counts[i] > 12 ? ' +' + (counts[i] - 12) : '');
        b.add.disabled = left <= 0; b.remove.disabled = counts[i] === 0;
        b.box.dataset.count = String(counts[i]);
      });
      scene.dataset.remaining = String(left);
    }
    for (let i = 0; i < t.groups; i++) {
      const box = c.el('div', 'ag-share-group'), title = c.el('strong', '', t.groupLabels?.[i] || 'Корзина ' + (i + 1));
      const count = c.el('output', 'ag-share-count'), items = c.el('div', 'ag-share-items');
      const add = c.button('+1', () => { if (counts.reduce((a, b) => a + b, 0) < t.total) { counts[i]++; paint(); } }, 'ag-give ag-control');
      const remove = c.button('−1', () => { if (counts[i] > 0) { counts[i]--; paint(); } }, 'ag-take ag-control');
      add.dataset.group = remove.dataset.group = String(i);
      add.setAttribute('aria-label', 'Положить один: ' + title.textContent); remove.setAttribute('aria-label', 'Забрать один: ' + title.textContent);
      box.append(title, items, count, add, remove); groups.append(box); bins.push({ box, count, items, add, remove });
    }
    check(c, () => counts.every(n => n === t.each) && counts.reduce((a, b) => a + b, 0) === t.total
      ? c.solve(t.explanation) : c.feedback('Нужно разложить всё поровну. Сравни корзинки: из полной можно вернуть один предмет.', 'error'));
    paint();
  }
  function equalGroups(c) {
    const t = c.task, workshop = c.el('section', 'ag-equal-groups'), firstRow = new Set();
    c.root.append(workshop);
    let phase = 'row', rowCount = 1, total = null, version = 0, activeSlot = 0;
    const addends = Array(t.rows).fill(null);
    const word = n => n === 1 ? 'алмаз' : n < 5 ? 'алмаза' : 'алмазов';
    const button = (label, action, className = 'ag-control') => {
      const current = version;
      return c.button(label, event => { if (current === version) action(event); }, className);
    };
    function show(nextPhase, focusSelector) { phase = nextPhase; render(focusSelector); }
    function rowView(editable = false) {
      const rows = c.el('div', 'ag-equal-rows'); rows.setAttribute('aria-label', 'Ряды алмазов');
      let refresh = () => {};
      const cells = [];
      for (let y = 0; y < (editable ? 1 : rowCount); y++) {
        const row = c.el('div', 'ag-equal-row'), label = c.el('span', 'ag-row-label', String(y + 1));
        label.setAttribute('aria-hidden', 'true');
        const line = c.el('div', 'ag-equal-cells ag-treasure-grid');line.style.setProperty('--ag-cols', t.cols);
        row.setAttribute('role', 'group');row.setAttribute('aria-label', editable ? 'Первый ряд' : `Ряд ${y + 1}: ${t.cols} ${word(t.cols)}`);
        for (let x = 0; x < t.cols; x++) {
          if (editable) {
            const cell = button('', () => { firstRow.has(x) ? firstRow.delete(x) : firstRow.add(x); refresh(); }, 'ag-cell ag-group-cell');
            cell.dataset.x = x;cell.dataset.y = 0;cells.push(cell);line.append(cell);
          } else {
            const diamond = c.el('span', 'ag-group-diamond', '💎');diamond.setAttribute('aria-hidden', 'true');line.append(diamond);
          }
        }
        row.append(label, line);rows.append(row);
      }
      if (editable) refresh = () => cells.forEach((cell, x) => {
        const selected = firstRow.has(x);cell.textContent = selected ? '💎' : '';cell.classList.toggle('ag-painted', selected);
        cell.setAttribute('aria-pressed', String(selected));cell.setAttribute('aria-label', `${selected ? 'Убрать' : 'Положить'} алмаз: клетка ${x + 1}`);
      });
      refresh();return { rows, repaint: () => refresh(), onChange: fn => { const paint = refresh;refresh = () => { paint();fn(); }; } };
    }
    c.setHint(() => {
      if (phase === 'row') return 'Нажимай на пустые клетки первого ряда. В каждой клетке должен появиться один алмаз.';
      if (phase === 'groups') return 'Кнопка «Добавить такой же ряд» добавляет целую группу. В новом ряду столько же алмазов, сколько в первом.';
      if (phase === 'count') return 'Сосчитай алмазы в первом ряду, затем прибавляй столько же за каждый следующий ряд. Общий ответ введи сам.';
      if (phase === 'addition') return 'В каждом ряду одинаковое количество алмазов. Нажми на это число внизу и повтори для каждого ряда. Чтобы исправить число, нажми на него в сумме.';
      return 'Первое число — количество рядов. Второе — число алмазов в одном ряду. Знак × означает умножение.';
    });
    function render(focusSelector) {
      version++;workshop.replaceChildren();workshop.dataset.phase = phase;
      const step = phase === 'row' ? 1 : phase === 'groups' ? 2 : phase === 'count' ? 3 : 4;
      const title = c.el('h3', 'ag-group-instruction');title.tabIndex = -1;
      workshop.append(c.el('p', 'ag-group-step', `Шаг ${step} из 4`), title);
      if (phase === 'row') {
        title.textContent = `Собери первый ряд: положи ${t.cols} ${word(t.cols)}.`;
        const view = rowView(true), status = c.el('output', 'ag-group-status');status.setAttribute('aria-live', 'polite');
        const done = button('Ряд готов', () => { if (firstRow.size === t.cols) show('groups'); }, 'ag-confirm-row ag-primary');
        const update = () => { status.textContent = `В первом ряду: ${firstRow.size} из ${t.cols}`;done.disabled = firstRow.size !== t.cols; };
        view.onChange(update);update();workshop.append(view.rows, status, done);
      } else if (phase === 'groups') {
        const left = t.rows - rowCount;
        title.textContent = left ? `Добавь ещё ${left} ${left === 1 ? 'такой же ряд' : left < 5 ? 'таких же ряда' : 'таких же рядов'}.` : 'Все ряды готовы. Теперь сосчитаем алмазы.';
        const add = button('Добавить такой же ряд', () => {
          if (rowCount < t.rows) { rowCount++;render(rowCount < t.rows ? '.ag-add-row' : '.ag-finish-groups'); }
        }, 'ag-add-row ag-primary');add.disabled = rowCount >= t.rows;
        const remove = button('Убрать последний ряд', () => { if (rowCount > 1) { rowCount--;render('.ag-add-row'); } }, 'ag-remove-row');remove.disabled = rowCount === 1;
        const done = button('Ряды готовы', () => { if (rowCount === t.rows) show('count'); }, 'ag-finish-groups ag-primary');done.disabled = rowCount !== t.rows;
        const controls = c.el('div', 'ag-group-controls');controls.append(add, remove);
        workshop.append(rowView().rows, c.el('p', 'ag-group-status', `Рядов: ${rowCount} из ${t.rows}`), controls, done);
      } else if (phase === 'count') {
        title.textContent = 'Сколько всего алмазов на поле?';workshop.append(rowView().rows);
        const label = c.el('label', 'ag-answer-label', 'Введи свой ответ'), input = c.el('input', 'ag-total-answer');
        input.id = 'ag-total-answer';label.htmlFor = input.id;input.type = 'text';input.inputMode = 'numeric';input.pattern = '[0-9]*';input.maxLength = 3;input.autocomplete = 'off';
        input.placeholder = 'Число';
        const current = version;
        const verify = () => {
          if (current !== version) return;
          const value = input.value.trim();
          if (!/^\d{1,3}$/.test(value)) { input.setAttribute('aria-invalid', 'true');c.feedback('Введи количество алмазов цифрами.', 'error');return; }
          if (Number(value) !== t.rows * t.cols) {
            input.setAttribute('aria-invalid', 'true');c.feedback('Посчитай ещё раз. Начни с первого ряда и прибавляй алмазы следующего ряда.', 'error');return;
          }
          total = Number(value);show('addition');
        };
        c.listen(input, 'input', () => { if (current === version) input.removeAttribute('aria-invalid'); });
        c.listen(input, 'keydown', event => { if (current === version && event.key === 'Enter') { event.preventDefault();verify(); } });
        workshop.append(label, input, button('Проверить ответ', verify, 'ag-check ag-primary'));
      } else if (phase === 'addition') {
        title.textContent = 'Покажи, как можно сосчитать алмазы рядами.';workshop.append(rowView().rows);
        workshop.append(c.el('p', 'ag-group-guide', 'Нажми внизу на число алмазов в одном ряду. Повтори для каждого ряда.'));
        const expression = c.el('div', 'ag-addend-expression'), slots = [], choices = c.el('div', 'ag-group-controls');
        expression.setAttribute('role', 'group');expression.setAttribute('aria-label', 'Сумма алмазов во всех рядах');
        const paint = () => slots.forEach((slot, index) => {
          slot.textContent = addends[index] === null ? '?' : String(addends[index]);slot.setAttribute('aria-pressed', String(index === activeSlot));
          slot.setAttribute('aria-label', `Алмазов в ряду ${index + 1}: ${addends[index] === null ? 'выбери число' : addends[index]}`);
        });
        for (let i = 0; i < t.rows; i++) {
          if (i) expression.append(c.el('span', 'ag-expression-sign', '+'));
          const slot = button('?', () => { activeSlot = i;paint(); }, 'ag-addend-slot');slot.dataset.index = i;slots.push(slot);expression.append(slot);
        }
        expression.append(c.el('span', 'ag-expression-result', '= ' + total));
        for (const value of [t.cols + 1, t.cols - 1, t.cols]) {
          const choice = button(String(value), () => {
            if (activeSlot < 0) { c.feedback('Чтобы изменить число, сначала нажми на него в сумме.');return; }
            addends[activeSlot] = value;activeSlot = addends.indexOf(null);paint();
          }, 'ag-addend-choice');choice.dataset.value = value;choices.append(choice);
        }
        paint();workshop.append(expression, choices, button('Проверить сумму', () => {
          if (addends.every(value => value === t.cols)) show('multiply');
          else c.feedback('Каждое число в сумме показывает алмазы в одном ряду. Сравни выбранные числа с рядами и попробуй ещё раз.', 'error');
        }, 'ag-check ag-primary'));
      } else {
        title.textContent = phase === 'solved' ? 'Ты посчитал одинаковые группы!' : 'Как записать эту сумму с помощью умножения?';
        workshop.append(rowView().rows, c.el('p', 'ag-group-equation', addends.join(' + ') + (phase === 'solved' ? ` = ${t.rows} × ${t.cols}` : '') + ' = ' + total));
        if (phase !== 'solved') {
          const options = [
            {label:`${t.rows} × ${t.cols}`, expression:`${t.rows}x${t.cols}`, correct:true},
            {label:`${t.rows} + ${t.cols}`, expression:`${t.rows}+${t.cols}`},
            {label:`${t.rows + 1} × ${t.cols}`, expression:`${t.rows + 1}x${t.cols}`}
          ];
          const shift = (t.rows + t.cols) % options.length, choices = c.el('div', 'ag-group-controls');
          [...options.slice(shift), ...options.slice(0, shift)].forEach(option => {
            const choice = button(option.label, () => {
              if (option.correct) { show('solved');c.solve(t.explanation); }
              else c.feedback('Найди пример с умножением: количество рядов умножаем на число алмазов в одном ряду.', 'error');
            }, 'ag-multiply-choice');choice.dataset.expression = option.expression;choices.append(choice);
          });
          workshop.append(choices);
        }
      }
      if (phase !== 'solved') c.feedback(phase === 'count' ? 'Сосчитай все алмазы и введи свой ответ. Можно считать рядами.' : phase === 'addition' ? `Верно, всего ${total} алмазов. Теперь составь сумму одинаковых групп.` : 'Следуй шагам. Если нужна помощь, нажми «Подсказка».');
      const focus = focusSelector ? workshop.querySelector(focusSelector) : title;
      focus?.focus({preventScroll:true});focus?.scrollIntoView({block:'nearest',behavior:'instant'});
    }
    render();
  }
  function rectangle(c) {
    if (c.task.visual === 'treasures') { equalGroups(c);return; }
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
      status.textContent = `Площадь: ${selected.size} кл. · Периметр: ${p} сторон`;
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
    svg.setAttribute('viewBox', '0 0 200 200'); svg.classList.add('ag-pizza'); svg.setAttribute('aria-label', 'Пирог из ' + t.parts + ' равных долей');
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
      prop.style.left = Math.max(5, Math.min(80, 5 + (value - t.start) / (t.target - t.start || 1) * 75)) + '%';
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
