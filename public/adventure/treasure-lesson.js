(function (root, factory) {
  const render = factory();
  if (typeof module === 'object' && module.exports) module.exports = render;
  else root.AdventureTreasureLesson = render;
})(globalThis, function () {
  return function treasureLesson(c) {
    const t = c.task;
    const kinds = ['row-count', 'build-groups', 'total', 'addition', 'transfer'];
    const lesson = kinds.includes(t.lesson) ? t.lesson : 'total';
    c.root.classList.add('ag-treasure-lesson');
    const board = c.el('section', 'ag-equal-groups');board.dataset.lesson = lesson;board.tabIndex = -1;
    board.setAttribute('aria-label', t.prompt);c.root.append(board);
    let rowCount = lesson === 'build-groups' ? 1 : t.rows, version = 0, solved = false, activeSlot = 0;
    const addends = Array(t.rows).fill(null);
    const button = (label, action, className = 'ag-control') => {
      const current = version;
      return c.button(label, event => { if (!solved && current === version) action(event); }, className);
    };
    const listen = (node, event, action) => {
      const current = version;
      c.listen(node, event, e => { if (!solved && current === version) action(e); });
    };
    function finish() {
      if (solved) return;
      solved = true;version++;board.dataset.phase = 'solved';c.solve(t.explanation);
    }
    function picture(highlight = false) {
      const rows = c.el('div', 'ag-equal-rows' + (highlight ? ' ag-highlight-rows' : ''));rows.setAttribute('role', 'group');rows.setAttribute('aria-label', 'Алмазы рядами');
      for (let y = 0; y < rowCount; y++) {
        const row = c.el('div', 'ag-equal-row' + (highlight ? y === 0 ? ' ag-row-highlight' : ' ag-row-muted' : ''));
        row.setAttribute('role', 'group');row.setAttribute('aria-label', `Ряд ${y + 1}` + (highlight && y === 0 ? '. Выделенный ряд.' : ''));
        const label = c.el('span', 'ag-row-label', String(y + 1));label.setAttribute('aria-hidden', 'true');
        const items = c.el('div', 'ag-equal-cells');items.style.setProperty('--ag-cols', t.cols);
        for (let x = 0; x < t.cols; x++) {
          const diamond = c.el('span', 'ag-group-diamond', '💎');diamond.setAttribute('role', 'img');diamond.setAttribute('aria-label', 'Алмаз');items.append(diamond);
        }
        row.append(label, items);rows.append(row);
      }
      return rows;
    }
    function numberField(className, labelText, id) {
      const field = c.el('div', 'ag-answer-field'), label = c.el('label', 'ag-answer-label', labelText), input = c.el('input', className);
      input.id = id;label.htmlFor = id;input.type = 'text';input.inputMode = 'numeric';input.pattern = '[0-9]*';input.maxLength = 3;input.autocomplete = 'off';input.placeholder = 'Число';
      listen(input, 'input', () => input.removeAttribute('aria-invalid'));
      field.append(label, input);return {field,input};
    }
    function enterChecks(input, verify) { listen(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault();verify(); } }); }
    const readNumber = input => /^\d{1,3}$/.test(input.value.trim()) ? Number(input.value.trim()) : null;
    c.setHint(() => {
      if (lesson === 'row-count') return 'Ряд идёт слева направо. Считай только алмазы внутри выделенной рамки.';
      if (lesson === 'build-groups') return 'Кнопка «Добавить такой же ряд» добавляет целую группу. В новом ряду столько же алмазов, сколько в первом.';
      if (lesson === 'total') return 'Сосчитай алмазы в первом ряду. Прибавляй столько же за каждый следующий ряд.';
      if (lesson === 'addition') return 'Каждое число в сумме описывает один ряд. Выбери число алмазов в первом ряду, затем в остальных. Чтобы исправить число, нажми на него в сумме.';
      return 'Сосчитай корзины и яблоки в одной корзине. Используй эти два числа в умножении, затем сосчитай все яблоки.';
    });
    function render(focusSelector) {
      version++;board.replaceChildren();board.dataset.phase = 'lesson';
      const captions = {'row-count':'Разбираемся с рядом','build-groups':'Собираем одинаковые группы',total:'Считаем самостоятельно',addition:'Записываем сумму',transfer:'Новая картинка'};
      board.append(c.el('p', 'ag-group-step', captions[lesson]));
      if (lesson === 'build-groups') {
        const left = t.rows - rowCount;
        const guide = left ? `Добавь ещё ${left} ${left === 1 ? 'такой же ряд' : left < 5 ? 'таких же ряда' : 'таких же рядов'}.` : 'Все ряды готовы. Нажми «Проверить ряды».';
        board.append(c.el('p', 'ag-group-guide', guide), picture(), c.el('p', 'ag-group-status', `Рядов: ${rowCount} из ${t.rows}`));
        const add = button('Добавить такой же ряд', () => {
          if (rowCount < t.rows) { rowCount++;render(rowCount < t.rows ? '.ag-add-row' : '.ag-finish-groups'); }
        }, 'ag-add-row ag-primary');add.disabled = rowCount >= t.rows;
        const remove = button('Убрать последний ряд', () => { if (rowCount > 1) { rowCount--;render('.ag-add-row'); } }, 'ag-remove-row');remove.disabled = rowCount === 1;
        const done = button('Проверить ряды', () => { if (rowCount === t.rows) finish(); }, 'ag-finish-groups ag-primary');done.disabled = rowCount !== t.rows;
        const controls = c.el('div', 'ag-group-controls');controls.append(add, remove);board.append(controls, done);
      } else if (lesson === 'row-count' || lesson === 'total') {
        if (lesson === 'row-count') board.append(c.el('p', 'ag-group-guide', 'Верхний ряд выделен рамкой. Считай только алмазы в этом ряду.'));
        board.append(picture(lesson === 'row-count'));
        const {field,input} = numberField('ag-number-answer ag-total-answer', 'Введи свой ответ', 'ag-count-answer');
        const verify = () => {
          const value = readNumber(input), expected = lesson === 'row-count' ? t.cols : t.rows * t.cols;
          if (value === null) { input.setAttribute('aria-invalid', 'true');c.feedback('Введи количество алмазов цифрами.', 'error');return; }
          if (value !== expected) {
            input.setAttribute('aria-invalid', 'true');c.feedback(lesson === 'row-count' ? 'Посчитай только алмазы в выделенном верхнем ряду. Нижний ряд сейчас не считаем.' : 'Посчитай ещё раз. Можно считать рядами и складывать полученные числа.', 'error');return;
          }
          finish();
        };
        enterChecks(input, verify);board.append(field, button('Проверить ответ', verify, 'ag-check ag-primary'));
      } else if (lesson === 'addition') {
        board.append(picture());
        const expression = c.el('div', 'ag-addend-expression'), slots = [], choices = c.el('div', 'ag-group-controls');
        expression.setAttribute('role', 'group');expression.setAttribute('aria-label', 'Сумма алмазов во всех рядах');
        const paint = () => slots.forEach((slot, index) => {
          slot.textContent = addends[index] === null ? '?' : String(addends[index]);slot.setAttribute('aria-pressed', String(index === activeSlot));
          slot.setAttribute('aria-label', `Алмазов в ряду ${index + 1}: ${addends[index] === null ? 'выбери число' : addends[index]}`);
        });
        for (let i = 0; i < t.rows; i++) {
          if (i) expression.append(c.el('span', 'ag-expression-sign', '+'));
          const term = c.el('span', 'ag-addend-term'), label = c.el('span', 'ag-addend-label', `Ряд ${i + 1}`);
          label.setAttribute('aria-hidden', 'true');
          const slot = button('?', () => { activeSlot = i;paint(); }, 'ag-addend-slot');slot.dataset.index = i;slots.push(slot);term.append(label, slot);expression.append(term);
        }
        const result = c.el('span', 'ag-expression-result', '= ?');expression.append(result);
        for (const value of [t.cols + 1, t.cols - 1, t.cols]) {
          const choice = button(String(value), () => {
            if (activeSlot < 0) { c.feedback('Чтобы изменить число, сначала нажми на него в сумме.');return; }
            addends[activeSlot] = value;activeSlot = addends.indexOf(null);paint();
          }, 'ag-addend-choice');choice.dataset.value = value;choices.append(choice);
        }
        paint();board.append(expression, choices, button('Проверить сумму', () => {
          if (addends.every(value => value === t.cols)) { result.textContent = '= ' + t.rows * t.cols;finish(); }
          else c.feedback('Каждое число в сумме показывает алмазы в одном ряду. Сравни выбранные числа с рядами и попробуй ещё раз.', 'error');
        }, 'ag-check ag-primary'));
      } else {
        const baskets = c.el('div', 'ag-transfer-baskets');baskets.setAttribute('role', 'group');baskets.setAttribute('aria-label', 'Корзины с яблоками');
        for (let y = 0; y < t.rows; y++) {
          const basket = c.el('div', 'ag-transfer-basket');basket.setAttribute('role', 'group');basket.setAttribute('aria-label', `Корзина ${y + 1}`);
          const label = c.el('span', 'ag-basket-label', `Корзина ${y + 1}`);label.setAttribute('aria-hidden', 'true');
          const items = c.el('div', 'ag-basket-items');
          for (let x = 0; x < t.cols; x++) { const apple = c.el('span', 'ag-basket-item', '🍎');apple.setAttribute('role', 'img');apple.setAttribute('aria-label', 'Яблоко');items.append(apple); }
          const icon = c.el('span', 'ag-basket-icon', '🧺');icon.setAttribute('aria-hidden', 'true');basket.append(label, items, icon);baskets.append(basket);
        }
        const equation = c.el('div', 'ag-transfer-equation');equation.setAttribute('role', 'group');equation.setAttribute('aria-label', 'Умножение для картинки');
        const first = numberField('ag-factor-first ag-equation-input', 'Первое число', 'ag-factor-first');
        const second = numberField('ag-factor-second ag-equation-input', 'Второе число', 'ag-factor-second');
        const product = numberField('ag-product-answer ag-equation-input', 'Всего яблок', 'ag-product-answer');
        for (const field of [first,second,product]) { field.field.classList.add('ag-equation-field');field.input.placeholder = '?'; }
        equation.append(first.field,c.el('span','ag-equation-sign','×'),second.field,c.el('span','ag-equation-sign','='),product.field);
        const verify = () => {
          const inputs = [first.input,second.input,product.input], values = inputs.map(readNumber);
          inputs.forEach(input=>input.removeAttribute('aria-invalid'));
          if (values.some(value=>value===null)) { inputs.forEach((input,i)=>{if(values[i]===null)input.setAttribute('aria-invalid','true');});c.feedback('Заполни все пустые места цифрами.', 'error');return; }
          const [a,b,total] = values;
          if (!((a===t.rows && b===t.cols)||(a===t.cols && b===t.rows))) {
            first.input.setAttribute('aria-invalid','true');second.input.setAttribute('aria-invalid','true');
            c.feedback('Пример должен описывать картинку. Сосчитай корзины и яблоки в одной корзине.', 'error');return;
          }
          if (total !== t.rows*t.cols) { product.input.setAttribute('aria-invalid','true');c.feedback('Проверь результат. Сосчитай все яблоки в корзинах.', 'error');return; }
          finish();
        };
        [first,second,product].forEach(field=>enterChecks(field.input,verify));board.append(baskets,equation,button('Проверить пример',verify,'ag-check ag-primary'));
      }
      if (focusSelector) { const focus=board.querySelector(focusSelector);focus?.focus({preventScroll:true});focus?.scrollIntoView({block:'nearest',behavior:'instant'}); }
    }
    render();
  };
});
