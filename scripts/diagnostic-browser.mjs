import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import diagnostic from '../lib/math-diagnostic-v2.js';
import { diagnosticFixture } from './support/diagnostic-fixture.mjs';

// Browser plugin is unavailable in this environment. Use the installed Chromium.
// Flow: real academy route -> real diagnostic answers -> saved result -> retake.
const chrome = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome, 'Chrome/Chromium is required');
let fixture = await diagnosticFixture();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const failures = [], evidence = [];
async function test(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (error) { failures.push({ name, error: error.stack }); console.error(`✗ ${name}: ${error.message}`); }
}
async function open(width = 360, height = 640, auto = true) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (['error', 'warn'].includes(msg.type())) errors.push(msg.text()); });
  await page.setViewport({ width, height });
  await page.goto(`${fixture.url}/math-academy.html${auto ? '?start=1' : ''}`, { waitUntil: 'networkidle0' });
  assert.match(await page.title(), /Математическая академия/);
  if (auto) await page.waitForSelector('#options input');
  return { page, errors };
}
const reset = () => fetch(`${fixture.url}/api/math/diagnostic-v2/restart`, { method: 'POST' });
const button = (page, text) => page.$eval('#options', (node, label) => {
  const ids = { 'Ответить': '#diagnosticSubmit', 'Не знаю': '#diagnosticSkip', 'Не понял вопрос': '#diagnosticUnclear' };
  const target = node.querySelector(ids[label]) || [...node.querySelectorAll('button')].find(el => el.textContent.trim() === label);
  if (!target) throw Error(`Missing button: ${label}`);
  target.click();
}, text);
const waitAnswered = (page, count) => page.waitForFunction(expected => {
  const progress = document.getElementById('progress').textContent;
  return !document.getElementById('results').classList.contains('hidden') || Number(progress.match(/\d+/)?.[0]) === expected;
}, {}, count);
async function answer(page, value, enter = false) {
  await page.$eval('#options input', (field, input) => { field.value = input; field.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  if (enter) await page.focus('#options input').then(() => page.keyboard.press('Enter'));
  else await button(page, 'Ответить');
}
async function screenshot(page, name) {
  const file = path.join(os.tmpdir(), `diagnostic-after-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function assertVisibleInViewport(page, selector) {
  const box = await page.$eval(selector, node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, display: style.display, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.notEqual(box.display, 'none', `${selector} is hidden`);
  assert.ok(box.height > 0 && box.top >= 0 && box.bottom <= box.viewportHeight && box.left >= 0 && box.right <= box.viewportWidth, `${selector} must fit without scrolling: ${JSON.stringify(box)}`);
}
function seedTo(predicate) {
  let session = diagnostic.createSession();
  for (let index = 0; index < 42 && !session.finished; index++) {
    const question = diagnostic.nextQuestion(session);
    if (predicate(question)) return session;
    session = diagnostic.submitAnswer(session, question.id, question.answer);
  }
  assert.fail('The all-correct diagnostic path must include the requested representative question');
}
function seedQuestion(target) {
  let session = diagnostic.createSession();
  for (let index = 0; index < 42 && !session.finished; index++) {
    const question = diagnostic.nextQuestion(session);
    if (question.id === target.id) return session;
    const clarification = target.id.endsWith('-c') && question.chapter === target.chapter && question.id.endsWith('-b');
    session = diagnostic.submitAnswer(session, question.id, clarification ? String(Number(question.answer) + 1) : question.answer);
  }
  assert.fail(`Question ${target.id} is unreachable through a valid engine session`);
}
async function verifyVisual(page, visual) {
  if (!visual) return;
  await assertVisibleInViewport(page, '#diagnosticVisual');
  const rendered = await page.$eval('#diagnosticVisual', node => ({
    label: node.getAttribute('aria-label'),
    items: [...node.querySelectorAll('.visual-items span')].map(item => item.textContent),
    groups: [...node.querySelectorAll('.visual-group')].map(group => group.children.length),
    parts: node.querySelectorAll('.visual-fraction span').length,
    filled: node.querySelectorAll('.visual-fraction .filled').length,
    bars: [...node.querySelectorAll('.visual-bar-row')].map(row => ({ label: row.firstElementChild.textContent, value: Number(row.lastElementChild.textContent) })),
    places: [...node.querySelectorAll('.visual-place strong')].map(cell => Number(cell.textContent)),
    equation: node.querySelector('.visual-equation')?.textContent
  }));
  assert.match(rendered.label, /Рисунок/);
  if (visual.type === 'items') assert.deepEqual(rendered.items, visual.items);
  if (visual.type === 'groups') assert.deepEqual(rendered.groups, Array(visual.groups).fill(visual.perGroup));
  if (visual.type === 'fraction') { assert.equal(rendered.parts, visual.parts); assert.equal(rendered.filled, visual.filled); }
  if (visual.type === 'bars') assert.deepEqual(rendered.bars, visual.values.map((value, index) => ({ label: visual.labels[index], value })));
  if (visual.type === 'place-value') assert.deepEqual(rendered.places, [visual.hundreds, visual.tens, visual.ones]);
  if (visual.type === 'equation') assert.equal(rendered.equation, visual.text);
}
async function withSeed(session, fn) {
  const previous = fixture;
  fixture = await diagnosticFixture(session);
  try { await fn(); } finally { await fixture.close(); fixture = previous; }
}

try {
  for (const version of ['legacy', 'v3']) {
    await test(`${version} result trains on the recommended map instead of an unrelated three-question loop`, async () => {
      let session = version === 'legacy' ? { answers: [], asked: [], finished: false } : diagnostic.createSession();
      while (!session.finished) {
        const question = diagnostic.nextQuestion(session);
        session = diagnostic.submitAnswer(session, question.id, question.answer);
      }
      const expected = diagnostic.result(session).startingLevel ?? diagnostic.result(session).level;
      await withSeed(session, async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 320, height: 640 });
        // A stale local practice result must not select the training topic or change placement.
        await page.evaluateOnNewDocument(() => localStorage.setItem('school-math-diagnostic-v1', JSON.stringify({ mode: 'practice', answers: [{ origin: 0, correct: false, value: 0 }] })));
        try {
          await page.goto(`${fixture.url}/math-academy.html?start=1`, { waitUntil: 'networkidle0' });
          await page.waitForSelector('#results:not(.hidden)');
          const oldPractice = await page.$('#practice:not([hidden])');
          await page.click(oldPractice ? '#practice' : '#adventureLaunch');
          await page.waitForFunction(() => location.pathname === '/math-adventure' || !document.getElementById('play')?.classList.contains('hidden'));
          assert.equal(new URL(page.url()).pathname, '/math-adventure', 'Practice must lead to the adventure, not the obsolete local quiz');
          await page.waitForFunction(() => !document.getElementById('world').hidden && document.querySelectorAll('.node').length === 5);
          assert.match(await page.$eval('#chapterTitle', node => node.textContent), new RegExp(`Глава ${Math.ceil(expected / 5)} из 20`));
          await page.$$eval('.node', (nodes, level) => {
            const target = nodes.find(node => Number(node.querySelector('.node-number')?.textContent || node.textContent.match(/\d+/)?.[0]) === level);
            if (!target || target.disabled) throw Error('Recommended game must be available');
            target.click();
          }, expected);
          await page.waitForSelector('#game:not(.hidden)');
          assert.equal(errors.length, 0, errors.join('\n'));
          assert.deepEqual(fixture.session(), session, 'Training navigation must preserve the completed diagnostic');
        } finally { await page.close(); }
      });
    });
  }
  await test('Intro accurately describes the current diagnostic', async () => {
    const { page, errors } = await open(360, 640, false);
    try {
      const intro = await page.$eval('#intro', el => el.textContent);
      evidence.push({ kind: 'intro', width: 360, height: 640, image: await screenshot(page, 'intro-360') });
      assert.doesNotMatch(intro, /12 заданий|четырём темам/);
      assert.equal(errors.length, 0, errors.join('\n'));
    } finally { await page.close(); }
  });

  await test('Unclear records a separate answer and resumes that progress', async () => {
    await reset();
    const { page } = await open();
    try {
      const original = fixture.question();
      await button(page, 'Не понял вопрос');
      await page.waitForFunction(() => Number(document.getElementById('progress').textContent.match(/\d+/)?.[0]) === 1, { timeout: 2000 });
      assert.deepEqual(fixture.posts.at(-1), { id: original.id, value: '__MISUNDERSTOOD__' });
      assert.equal(fixture.session().answers[0].misunderstood, true);
      const nextId = fixture.question().id;
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#options input');
      assert.equal(fixture.question().id, nextId);
      assert.match(await page.$eval('#progress', el => el.textContent), /^1\D/);
    } finally { await page.close(); }
  });

  await test('Pending skip locks every answer control', async () => {
    await reset();
    const { page } = await open();
    fixture.fault.delay = 250;
    try {
      await button(page, 'Не знаю');
      assert.equal(await page.$$eval('#options button', buttons => buttons.every(el => el.disabled)), true);
      await waitAnswered(page, 1);
      assert.equal(fixture.session().answers[0].skipped, true);
      assert.equal(fixture.session().answers[0].misunderstood, false);
    } finally {
      await page.waitForNetworkIdle({ idleTime: 50 });
      fixture.fault.delay = 0;
      await page.close();
    }
  });

  await test('Save retry, Enter, real engine scoring, reload, and archived retake', async () => {
    await reset();
    const { page } = await open(412, 740);
    try {
      const first = fixture.question();
      assert.equal(await page.$eval('#options button', el => el.disabled), true, 'Empty answers must not submit');
      fixture.fault.answer = true;
      await answer(page, first.answer);
      await page.waitForFunction(() => /Ошибка сохранения|Не удалось/.test(document.getElementById('feedback').textContent));
      assert.equal(fixture.session().answers.length, 0);
      assert.equal(fixture.question().id, first.id);
      fixture.fault.answer = false;
      await answer(page, first.answer, true);
      await waitAnswered(page, 1);
      assert.equal(fixture.session().answers[0].correct, true);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#options input');
      assert.match(await page.$eval('#progress', el => el.textContent), /^1\D/);
      while (!fixture.session().finished) {
        const count = fixture.session().answers.length;
        await answer(page, fixture.question().answer);
        await waitAnswered(page, count + 1);
      }
      await page.waitForSelector('#results:not(.hidden)');
      const completed = fixture.session();
      assert.ok(completed.answers.length <= 42);
      assert.equal(completed.answers.every(item => item.correct), true);
      assert.equal(await page.$$eval('#resultStats .result-stat strong', nodes => nodes.reduce((sum, node) => sum + Number(node.textContent), 0)), completed.answers.length);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#results:not(.hidden)');
      await page.click('#repeat');
      await page.waitForSelector('#options input');
      assert.equal(fixture.session().answers.length, 0);
      assert.deepEqual(fixture.history.at(-1).session, completed);
    } finally { fixture.fault.answer = false; await page.close(); }
  });

  await test('Public question exposes visual and format metadata without answer material', async () => {
    await reset();
    const response = await fetch(`${fixture.url}/api/math/diagnostic-v2`).then(res => res.json());
    assert.equal(response.version, 3);
    assert.equal(response.maxQuestions, 42);
    assert.equal(response.minQuestions, 6);
    assert.deepEqual(Object.keys(response.question).filter(key => !['id', 'skill', 'prompt', 'chapter', 'topic', 'topicTitle', 'answerFormat', 'visual'].includes(key)), []);
    assert.ok(response.question.answerFormat);
    assert.ok(response.question.visual);
    assert.equal('answer' in response.question, false);
    assert.equal('explanation' in response.question, false);
  });

  await test('Question headings use readable Russian titles instead of internal topic IDs', async () => {
    await reset();
    const { page } = await open();
    try {
      const heading = await page.$eval('#mode', node => node.textContent);
      assert.doesNotMatch(heading, /[a-z]+[-_][a-z]+/i, 'Internal topic slug is visible to the student');
      const publicQuestion = await fetch(`${fixture.url}/api/math/diagnostic-v2`).then(res => res.json()).then(data => data.question);
      assert.match(publicQuestion.topicTitle, /[А-Яа-яЁё]/);
    } finally { await page.close(); }
  });

  await test('Decimal comma input is explained and scored through the actual engine', async () => {
    const session = seedTo(q => q.answerFormat?.kind === 'decimal' && String(q.answer).includes('.'));
    await withSeed(session, async () => {
      const { page } = await open(360, 640);
      try {
        const question = fixture.question(), answered = fixture.session().answers.length;
        assert.equal(await page.$eval('#options input', node => node.inputMode), 'decimal');
        assert.match(await page.$eval('#answerFormatHint', node => node.textContent), /запят|десятич/i);
        await answer(page, String(question.answer).replace('.', ','));
        await waitAnswered(page, answered + 1);
        assert.equal(fixture.session().answers.at(-1).correct, true);
      } finally { await page.close(); }
    });
  });

  await test('Signed coordinate input accepts a negative answer through the actual engine', async () => {
    const session = seedTo(q => String(q.answer).startsWith('-'));
    await withSeed(session, async () => {
      const { page } = await open(320, 640);
      try {
        const question = fixture.question(), answered = fixture.session().answers.length;
        const minusAccessible = await page.evaluate(() => {
          const field = document.querySelector('#options input');
          return ['text', ''].includes(field.inputMode) || [...document.querySelectorAll('#options button')].some(node => /(?:±|сменить знак|минус)/i.test(node.textContent + ' ' + node.getAttribute('aria-label')));
        });
        assert.equal(minusAccessible, true, 'Android decimal/numeric keyboards lack a minus key: use text input or a visible sign toggle');
        await answer(page, question.answer, true);
        await waitAnswered(page, answered + 1);
        assert.equal(fixture.session().answers.at(-1).correct, true);
      } finally { await page.close(); }
    });
  });

  await test('Every bank question fits 320×640 and all six visual types preserve their meaning', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 320, height: 640 });
    const questions = [], problems = [], visualTypes = new Set(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const question of diagnostic.BANK) {
        fixture.restore(seedQuestion(question));
        await page.goto(`${fixture.url}/math-academy.html?start=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#options input');
        try {
          assert.equal(await page.evaluate(() => scrollY), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          for (const selector of ['#question', '#diagnostic-answer', '#diagnosticSubmit', '#diagnosticSkip', '#diagnosticUnclear']) await assertVisibleInViewport(page, selector);
          await verifyVisual(page, question.visual);
          if (question.visual && !visualTypes.has(question.visual.type)) {
            visualTypes.add(question.visual.type);
            await screenshot(page, `visual-${question.visual.type}-320`);
          }
          questions.push({ id: question.id, chapter: question.chapter, visual: question.visual?.type, passed: true });
        } catch (error) {
          const image = await screenshot(page, `question-failure-${question.id}-320`);
          problems.push(`${question.id}: ${error.message}`);
          questions.push({ id: question.id, chapter: question.chapter, passed: false, image, error: error.message });
        }
      }
      evidence.push({ kind: 'all-bank-mobile', width: 320, height: 640, questions, visualTypes: [...visualTypes] });
      assert.deepEqual([...visualTypes].sort(), ['bars', 'equation', 'fraction', 'groups', 'items', 'place-value']);
      assert.equal(errors.length, 0, errors.join('\n'));
      assert.deepEqual(problems, []);
      console.log(`  ${questions.length} real questions checked at 320×640`);
    } finally { await page.close(); }
  });

  for (const [width, height] of [[320, 640], [360, 640], [412, 740], [1280, 800]]) {
    await test(`Responsive question and results ${width}×${height}`, async () => {
      await reset();
      const { page, errors } = await open(width, height);
      const record = { width, height, consoleErrors: errors };
      evidence.push(record);
      try {
        record.questionImage = await screenshot(page, `question-${width}`);
        assert.equal(await page.evaluate(() => scrollY), 0, 'Question must not auto-scroll the header away');
        await assertVisibleInViewport(page, '#question');
        await assertVisibleInViewport(page, '#options input');
        await assertVisibleInViewport(page, '#options button:last-of-type');
        assert.ok(await page.$('#diagnosticVisual'), 'New question illustration must be present');
        assert.ok(await page.$eval('#diagnosticVisual', node => node.childElementCount > 0), 'Question illustration must contain rendered content');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Question must not overflow horizontally');
        assert.equal(await page.$$eval('#options button', nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), true, 'Controls must have usable touch targets');
        while (!fixture.session().finished) {
          const count = fixture.session().answers.length;
          await button(page, 'Не знаю');
          await waitAnswered(page, count + 1);
        }
        await page.waitForSelector('#results:not(.hidden)');
        record.resultsImage = await screenshot(page, `results-${width}`);
        assert.equal(await page.evaluate(() => scrollY), 0, 'Result must open without scrolling');
        await assertVisibleInViewport(page, '#adventureLaunch');
        assert.match(await page.$eval('#adventureLaunch', el => el.textContent), /карт|игр|приключ|начать/i);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Results must not overflow horizontally');
        assert.equal(errors.length, 0, errors.join('\n'));
      } finally { await page.close(); }
    });
  }
} finally {
  fs.writeFileSync(path.join(os.tmpdir(), 'diagnostic-browser-evidence.json'), JSON.stringify({ evidence, failures }, null, 2));
  await browser.close();
  await fixture.close();
}
if (failures.length) process.exitCode = 1;
