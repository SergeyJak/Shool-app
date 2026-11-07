(function (scope) {
  'use strict';

  function scene(ctx, name) {
    ctx.root.dataset.mechanic = name;
    const board = ctx.el('div', 'ag-board ag-' + name + '-board');
    ctx.root.append(board);
    return board;
  }
  function pressed(node, value) {
    node.setAttribute('aria-pressed', String(value));
    node.dataset.selected = String(value);
  }
  function check(ctx, parent, verify) {
    const button = ctx.button('Проверить', verify, 'ag-control ag-check');
    parent.append(button);
    return button;
  }
  function complete(ctx) { ctx.solve(ctx.task.explanation); }
  function retry(ctx, message) { ctx.feedback(message, 'error'); }
  function controls(ctx, parent) {
    const row = ctx.el('div', 'ag-controls');
    parent.append(row);
    return row;
  }

  function clock(ctx) {
    const task = ctx.task, board = scene(ctx, 'clock');
    let total = ((task.startHour || 0) * 60 + (task.startMinute || 0)) % 1440;
    const dial = ctx.el('div', 'ag-clock-dial');
    dial.setAttribute('role', 'img');
    for (let n = 1; n <= 12; n++) {
      const mark = ctx.el('span', 'ag-clock-number', n);
      const angle = n * Math.PI / 6;
      mark.style.left = (50 + 41 * Math.sin(angle)) + '%';
      mark.style.top = (50 - 41 * Math.cos(angle)) + '%';
      dial.append(mark);
    }
    const hourHand = ctx.el('span', 'ag-clock-hand ag-clock-hour');
    const minuteHand = ctx.el('span', 'ag-clock-hand ag-clock-minute');
    dial.append(hourHand, minuteHand, ctx.el('span', 'ag-clock-pin'));
    const value = ctx.el('output', 'ag-clock-value');
    value.setAttribute('aria-live', 'polite');
    board.append(dial, value);
    const row = controls(ctx, board);
    function update() {
      const hour = Math.floor(total / 60), minute = total % 60;
      board.dataset.hour = hour; board.dataset.minute = minute;
      const label = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
      value.textContent = label;
      dial.setAttribute('aria-label', 'На часах ' + label);
      hourHand.style.transform = 'rotate(' + ((hour % 12) * 30 + minute / 2) + 'deg)';
      minuteHand.style.transform = 'rotate(' + (minute * 6) + 'deg)';
    }
    for (const [label, action, delta] of [
      ['− 1 час', 'hour-minus', -60], ['+ 1 час', 'hour-plus', 60],
      ['− 5 минут', 'minute-minus', -5], ['+ 5 минут', 'minute-plus', 5]
    ]) {
      const b = ctx.button(label, () => { total = (total + delta + 1440) % 1440; update(); });
      b.dataset.action = action; row.append(b);
    }
    check(ctx, board, () => {
      if (total === task.hour * 60 + task.minute) complete(ctx);
      else retry(ctx, 'Сверь часы и минуты с условием. Короткая стрелка показывает часы, длинная — минуты.');
    });
    ctx.setHint(() => task.hint + ' Сейчас на часах ' + value.textContent + '.');
    update();
  }

  function calendar(ctx) {
    const task = ctx.task, board = scene(ctx, 'calendar');
    let selected = null;
    const date = new Date(Date.UTC(task.year, task.month - 1, 1));
    const title = ctx.el('h3', 'ag-calendar-title', date.toLocaleDateString('ru-RU', {month:'long', year:'numeric', timeZone:'UTC'}));
    const grid = ctx.el('div', 'ag-calendar-grid');
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Календарь: ' + title.textContent);
    for (const name of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']) grid.append(ctx.el('span', 'ag-calendar-weekday', name));
    const offset = (date.getUTCDay() + 6) % 7;
    for (let n = 0; n < offset; n++) {
      const blank = ctx.el('span', 'ag-calendar-empty'); blank.setAttribute('aria-hidden', 'true'); grid.append(blank);
    }
    const days = new Date(Date.UTC(task.year, task.month, 0)).getUTCDate();
    const dayButtons = [];
    for (let day = 1; day <= days; day++) {
      const b = ctx.button(String(day), () => {
        selected = day; board.dataset.day = day;
        for (const button of dayButtons) pressed(button, button === b);
      }, 'ag-control ag-calendar-day');
      b.dataset.day = day;
      b.setAttribute('aria-label', day + ' ' + date.toLocaleDateString('ru-RU', {month:'long', timeZone:'UTC'}));
      pressed(b, false); dayButtons.push(b); grid.append(b);
    }
    board.append(title, grid);
    check(ctx, board, () => {
      if (selected === task.day) complete(ctx);
      else retry(ctx, selected === null ? 'Выбери день в календаре.' : 'Отсчитай дни по календарю ещё раз. Неделя начинается с понедельника.');
    });
  }

  function match(ctx) {
    const task = ctx.task, board = scene(ctx, 'match');
    const columns = ctx.el('div', 'ag-match-columns');
    const leftColumn = ctx.el('div', 'ag-match-column'), rightColumn = ctx.el('div', 'ag-match-column');
    leftColumn.setAttribute('aria-label', 'Первые карточки'); rightColumn.setAttribute('aria-label', 'Парные карточки');
    columns.append(leftColumn, rightColumn); board.append(columns);
    const matched = new Set(), cards = [];
    let selection = null;
    function select(card) {
      if (matched.has(card.pair.id)) return;
      if (!selection || selection.side === card.side) {
        selection = selection === card ? null : card;
        for (const entry of cards) pressed(entry.node, entry === selection);
        return;
      }
      if (selection.pair.id !== card.pair.id) {
        retry(ctx, 'Эти карточки не образуют пару. Сравни их значения или свойства и выбери другую.');
        return;
      }
      matched.add(card.pair.id);
      for (const entry of cards) {
        if (entry.pair.id === card.pair.id) {
          entry.node.dataset.matched = 'true'; entry.node.disabled = true;
          entry.node.setAttribute('aria-label', entry.node.textContent + ' — пара найдена');
        }
        pressed(entry.node, false);
      }
      selection = null; board.dataset.matched = matched.size;
      if (matched.size === task.pairs.length) complete(ctx);
      else ctx.feedback('Пара найдена! Соедини оставшиеся карточки.');
    }
    for (const [side, list, column] of [['left', task.pairs, leftColumn], ['right', task.pairs.slice().reverse(), rightColumn]]) {
      list.forEach((pair, index) => {
        const card = {pair, side};
        card.node = ctx.button(pair[side], () => select(card), 'ag-control ag-match-card');
        card.node.dataset.side = side; card.node.dataset.cardIndex = index;
        card.node.dataset.matched = 'false'; pressed(card.node, false);
        cards.push(card); column.append(card.node);
      });
    }
  }

  function sort(ctx) {
    const task = ctx.task, board = scene(ctx, 'sort');
    const tray = ctx.el('div', 'ag-sort-tray'), bins = ctx.el('div', 'ag-sort-bins');
    tray.setAttribute('aria-label', 'Предметы для распределения');
    board.append(tray, bins);
    let selected = null;
    const placed = new Set(), items = [];
    for (const item of task.items) {
      const b = ctx.button((item.icon ? item.icon + ' ' : '') + item.label, () => {
        selected = item; for (const entry of items) pressed(entry.node, entry.item.id === item.id);
        ctx.feedback('Теперь выбери подходящую корзину.');
      }, 'ag-control ag-sort-item');
      b.dataset.item = item.id; b.dataset.placed = 'false'; pressed(b, false);
      items.push({item, node:b}); tray.append(b);
    }
    for (const bin of task.bins) {
      const container = ctx.el('section', 'ag-sort-bin'); container.dataset.bin = bin.id;
      const label = ctx.button(bin.label, () => {
        if (!selected) { ctx.feedback('Сначала выбери предмет.'); return; }
        if (selected.bin !== bin.id) { retry(ctx, 'Подумай, какое свойство объединяет предметы в этой корзине. Попробуй другую.'); return; }
        const entry = items.find(entry => entry.item.id === selected.id);
        placed.add(selected.id); entry.node.dataset.placed = 'true'; entry.node.disabled = true;
        pressed(entry.node, false); container.append(entry.node); selected = null;
        board.dataset.placed = placed.size;
        if (placed.size === task.items.length) complete(ctx);
        else ctx.feedback('Верно! Выбери следующий предмет.');
      }, 'ag-control ag-sort-bin-button');
      // A bin's button is its accessible action; the surrounding section owns its contents.
      label.dataset.bin = bin.id; container.removeAttribute('data-bin');
      container.append(label); bins.append(container);
    }
  }

  function sequence(ctx) {
    const task = ctx.task, board = scene(ctx, 'sequence');
    const values = task.terms.slice(), slots = [];
    let selected = values.indexOf(null);
    const train = ctx.el('div', 'ag-sequence-train'), choices = ctx.el('div', 'ag-sequence-choices');
    train.setAttribute('aria-label', 'Поезд закономерности'); choices.setAttribute('aria-label', 'Плитки для пустых вагонов');
    function update() {
      for (const slot of slots) {
        slot.node.textContent = values[slot.index] === null ? '?' : String(values[slot.index]);
        slot.node.dataset.value = values[slot.index] === null ? '' : String(values[slot.index]);
        slot.node.setAttribute('aria-label', 'Место ' + (slot.index + 1) + ': ' + slot.node.textContent);
        pressed(slot.node, selected === slot.index);
      }
    }
    task.terms.forEach((term,index) => {
      if (term !== null) { train.append(ctx.el('span', 'ag-sequence-fixed', String(term))); return; }
      const b = ctx.button('?', () => { selected = index; update(); }, 'ag-control ag-sequence-slot');
      b.dataset.index = index; slots.push({index,node:b}); train.append(b);
    });
    task.choices.forEach((choice,index) => {
      const b = ctx.button(String(choice), () => {
        if (selected < 0) { ctx.feedback('Выбери пустой вагон или вагон, который хочешь изменить.'); return; }
        values[selected] = choice;
        selected = values.findIndex(value => value === null); update();
      }, 'ag-control ag-sequence-choice');
      b.dataset.choice = index; choices.append(b);
    });
    board.append(train, choices);
    check(ctx, board, () => {
      const wrongIndex = values.findIndex((value,index) => String(value) !== String(task.solution[index]));
      if (wrongIndex === -1) complete(ctx);
      else retry(ctx, 'Проверь место ' + (wrongIndex + 1) + '. Найди правило между соседними вагонами; плитки можно использовать снова.');
    });
    update();
  }

  function coordinate(ctx) {
    const task = ctx.task, board = scene(ctx, 'coordinate');
    let position = task.start ? {...task.start} : {x:task.xMin,y:task.yMin}, next = 0;
    const visited = new Set(), cells = [];
    const targetLabel = ctx.el('p', 'ag-coordinate-target');
    const guide = ctx.el('p', 'ag-coordinate-guide', 'x → вправо, y ↑ вверх. Сначала x, затем y.');
    const grid = ctx.el('div', 'ag-coordinate-grid');
    grid.style.gridTemplateColumns = 'repeat(' + (task.xMax - task.xMin + 1) + ', minmax(0, 1fr))';
    grid.style.setProperty('--ag-grid-ratio', Math.min(1, (task.xMax - task.xMin + 1) / (task.yMax - task.yMin + 1)));
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Координатная плоскость');
    function accept(x, y) {
      const target = task.targets[next];
      if (target && x === target.x && y === target.y) {
        visited.add(x + ',' + y); next++;
        board.dataset.reached = next;
        if (next === task.targets.length) { update(); complete(ctx); return; }
        ctx.feedback('Точка найдена! Следующая остановка отмечена в задании.');
      } else if (task.mode === 'point') retry(ctx, 'Проверь обе координаты: x отсчитывай по горизонтали, y — вверх.');
      update();
    }
    function update() {
      const target = task.targets[next];
      targetLabel.textContent = target ? (task.mode === 'robot' ? 'Проведи робота к ' : 'Найди точку ') + '(' + target.x + '; ' + target.y + ') · ' + (next + 1) + ' из ' + task.targets.length : 'Все точки найдены!';
      board.dataset.x = position.x; board.dataset.y = position.y;
      for (const cell of cells) {
        const robot = task.mode === 'robot' && cell.x === position.x && cell.y === position.y;
        const found = visited.has(cell.x + ',' + cell.y);
        cell.node.dataset.robot = String(robot); cell.node.dataset.visited = String(found);
        cell.node.textContent = (robot ? '🤖 ' : found ? '✓ ' : '') + cell.x + ';' + cell.y;
        cell.node.setAttribute('aria-label', (robot ? 'Робот, ' : '') + 'x ' + cell.x + ', y ' + cell.y + (found ? ', найдена' : ''));
      }
    }
    for (let y = task.yMax; y >= task.yMin; y--) for (let x = task.xMin; x <= task.xMax; x++) {
      const node = task.mode === 'point' ? ctx.button('', () => accept(x, y), 'ag-control ag-coordinate-cell') : ctx.el('span', 'ag-coordinate-cell');
      node.dataset.x = x; node.dataset.y = y;
      cells.push({x,y,node}); grid.append(node);
    }
    board.append(targetLabel, guide, grid);
    if (task.mode === 'robot') {
      const row = controls(ctx, board);
      function move(dx, dy) {
        const x = position.x + dx, y = position.y + dy;
        if (x < task.xMin || x > task.xMax || y < task.yMin || y > task.yMax) { retry(ctx, 'Здесь край поля. Выбери стрелку, которая ведёт внутрь.'); return; }
        position = {x,y}; accept(x,y);
      }
      for (const [label,action,dx,dy] of [['← Влево','robot-left',-1,0],['↑ Вверх','robot-up',0,1],['↓ Вниз','robot-down',0,-1],['→ Вправо','robot-right',1,0]]) {
        const b = ctx.button(label, () => move(dx,dy)); b.dataset.action = action; row.append(b);
      }
      grid.tabIndex = 0;
      ctx.listen(grid, 'keydown', event => {
        const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];
        if (delta) { event.preventDefault(); move(...delta); }
      });
    }
    update();
    if (task.mode === 'robot' && task.targets[0].x === position.x && task.targets[0].y === position.y) accept(position.x, position.y);
  }

  function bars(ctx) {
    const task = ctx.task, board = scene(ctx, 'bars');
    const chart = ctx.el('div', 'ag-bar-chart'), values = task.labels.map(() => 0), columns = [];
    chart.setAttribute('role', 'group'); chart.setAttribute('aria-label', 'Столбчатая диаграмма. Максимум ' + task.maxValue);
    board.append(ctx.el('p', 'ag-bar-scale', 'Шкала: от 0 до ' + task.maxValue + (task.unit ? ' ' + task.unit : '')), chart);
    function update(index) {
      const entry = columns[index], value = values[index];
      entry.column.dataset.value = value; entry.fill.style.height = (100 * value / task.maxValue) + '%';
      entry.output.textContent = ctx.format(value) + (task.unit ? ' ' + task.unit : '');
      entry.column.setAttribute('aria-label', task.labels[index] + ': ' + entry.output.textContent);
    }
    task.labels.forEach((label,index) => {
      const column = ctx.el('div', 'ag-bar-column'), track = ctx.el('div', 'ag-bar-track');
      track.style.setProperty('--ag-bar-step', (100 / task.maxValue) + '%');
      column.dataset.index = index;
      const fill = ctx.el('div', 'ag-bar-fill'), output = ctx.el('output', 'ag-bar-value');
      output.setAttribute('aria-live', 'polite'); track.append(fill);
      const row = controls(ctx, column);
      const minus = ctx.button('−', () => { values[index] = Math.max(0, values[index] - 1); update(index); }, 'ag-control ag-bar-minus');
      const plus = ctx.button('+', () => { values[index] = Math.min(task.maxValue, values[index] + 1); update(index); }, 'ag-control ag-bar-plus');
      for (const [b,verb] of [[minus,'Уменьшить'],[plus,'Увеличить']]) { b.dataset.index = index; b.setAttribute('aria-label', verb + ' столбец ' + label); }
      row.append(minus, plus); column.append(track, output, ctx.el('span', 'ag-bar-label', label)); chart.append(column);
      columns.push({column,fill,output}); update(index);
    });
    check(ctx, board, () => {
      if (values.every((value,index) => value === task.values[index])) complete(ctx);
      else retry(ctx, 'Сравни каждый столбец с данными в условии. Одна кнопка меняет высоту на одно деление.');
    });
  }

  function measure(ctx) {
    const task = ctx.task, board = scene(ctx, 'measure');
    let value = task.start === undefined ? task.min : task.start;
    const range = ctx.el('input', 'ag-measure-range');
    range.type = 'range'; range.min = task.min; range.max = task.max; range.step = task.step;
    range.setAttribute('aria-label', 'Положение на шкале');
    const ruler = ctx.el('div', 'ag-ruler'), fill = ctx.el('div', 'ag-ruler-fill');
    ruler.append(fill);
    const ticks = ctx.el('div', 'ag-ruler-ticks');
    const steps = Math.round((task.max - task.min) / task.step), tickCount = Math.min(10, steps);
    for (let i = 0; i <= tickCount; i++) {
      const v = task.min + Math.round(i * steps / tickCount) * task.step;
      const tick = ctx.el('span', 'ag-ruler-tick', ctx.format(v, task.displayScale || 1));
      tick.style.left = (100 * (v - task.min) / (task.max - task.min)) + '%'; ticks.append(tick);
    }
    const output = ctx.el('output', 'ag-measure-value'); output.setAttribute('aria-live', 'polite');
    board.append(ruler, ticks, range, output);
    function update() {
      value = Number(value.toFixed(10)); range.value = value; board.dataset.value = value;
      output.textContent = ctx.format(value, task.displayScale || 1) + (task.unit ? ' ' + task.unit : '');
      range.setAttribute('aria-valuetext', output.textContent);
      fill.style.width = (100 * (value - task.min) / (task.max - task.min)) + '%';
    }
    ctx.listen(range, 'input', () => { value = Number(range.value); update(); });
    const row = controls(ctx, board);
    row.append(ctx.button('− ' + ctx.format(task.step, task.displayScale || 1), () => { value = Math.max(task.min, value - task.step); update(); }, 'ag-control ag-measure-minus'));
    row.append(ctx.button('+ ' + ctx.format(task.step, task.displayScale || 1), () => { value = Math.min(task.max, value + task.step); update(); }, 'ag-control ag-measure-plus'));
    check(ctx, board, () => {
      if (Math.abs(value - task.target) < 1e-8) complete(ctx);
      else retry(ctx, 'Сверь значение с условием. Одно деление шкалы — ' + ctx.format(task.step, task.displayScale || 1) + (task.unit ? ' ' + task.unit : '') + '.');
    });
    update();
  }

  const renderers = {clock, calendar, match, sort, sequence, coordinate, bars, measure};
  if (typeof module === 'object' && module.exports) module.exports = renderers;
  else Object.assign(scope.AdventureMechanics || (scope.AdventureMechanics = {}), renderers);
})(typeof globalThis === 'object' ? globalThis : this);
