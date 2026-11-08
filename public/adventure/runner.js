(function (root) {
  'use strict';
  root.AdventureGames = { start };
  function start(number, options) {
    const level = root.AdventureLevels.get(number);
    if (!level) throw new Error('Unknown adventure level ' + number);
    const { root: area, question, counter, meter, feedback, next, onComplete, onExit } = options;
    const session = new AbortController();
    let round = 0, completed = false, solved = false, active = true, roundEvents;
    const el = (tag, className, text) => {
      const node = document.createElement(tag); node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    };
    function say(text, kind = 'info') { root.AdventureFeedback.set(feedback, text, kind); }
    function destroy() {
      active = false; roundEvents?.abort(); session.abort();
      root.AdventureFeedback.clear(feedback);
      document.body.classList.remove('ag-playing');
    }
    next.addEventListener('click', () => {
      if (!active || !solved || completed) return;
      if (++round < level.rounds.length) render();
      else { completed = true; destroy(); onComplete(); }
    }, { signal: session.signal });
    function render() {
      roundEvents?.abort(); roundEvents = new AbortController(); solved = false;
      const task = level.rounds[round]; let hintText = () => task.hint;
      area.replaceChildren(); area.className = 'choices ag-root';
      area.dataset.level = number; area.dataset.round = round + 1; area.dataset.mechanic = task.mechanic;
      question.textContent = task.prompt;
      counter.textContent = 'Испытание ' + (round + 1) + ' из ' + level.rounds.length;
      meter.style.width = (round / level.rounds.length * 100) + '%';
      next.classList.add('hidden'); next.textContent = round === level.rounds.length - 1 ? 'Завершить приключение' : 'Продолжить';
      say(round === 0 ? level.intro : 'Попробуй сам. Совёнок поможет, если понадобится.');
      const listen = (element, event, handler) => element.addEventListener(event, e => {
        if (active && !solved) handler(e);
      }, { signal: roundEvents.signal });
      const button = (text, onClick, className = 'ag-control') => {
        const b = el('button', className, text); b.type = 'button'; b.setAttribute('aria-label', text);
        listen(b, 'click', onClick); return b;
      };
      const ctx = { root: area, task, level, el, listen, button, feedback: say,
        format: (value, scale = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value / scale),
        setHint: fn => { hintText = fn; },
        solve: explanation => {
          if (!active || solved) return;
          solved = true; area.classList.add('ag-solved');
          area.querySelectorAll('button:not(.ag-back),input').forEach(control => { control.disabled = true; });
          area.querySelectorAll('[role=button]').forEach(control => { control.setAttribute('aria-disabled', 'true'); control.tabIndex = -1; });
          say(explanation || task.explanation, 'success');
          meter.style.width = ((round + 1) / level.rounds.length * 100) + '%';
          next.classList.remove('hidden'); next.focus({ preventScroll: true });
        }
      };
      root.AdventureMechanics[task.mechanic](ctx);
      const tools = el('div', 'ag-tools');
      const helper = el('img', 'ag-helper'); helper.src = '/assets/owl-mascot-pack/owl-teacher.png?v=20261106-cutout'; helper.alt = 'Совёнок-помощник';
      const hint = button('💡 Подсказка', () => say(hintText()), 'ag-hint'); hint.dataset.action = 'hint';
      const reset = button('↺ Начать заново', () => render(), 'ag-reset'); reset.dataset.action = 'reset';
      // Leaving is available even after solving; it never awards an unfinished game.
      const back = el('button', 'ag-back', 'К карте'); back.type = 'button'; back.dataset.action = 'exit';
      back.addEventListener('click', () => { if (active) { destroy(); onExit(); } }, { signal: roundEvents.signal });
      tools.append(helper, hint, reset, back); area.append(tools);
      question.tabIndex = -1;
      question.focus({ preventScroll: true });
      question.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    document.body.classList.add('ag-playing'); render(); return { destroy };
  }
})(globalThis);
