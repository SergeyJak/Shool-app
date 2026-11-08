import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';
import { assertAdventureFits } from './support/adventure-layout.mjs';

const require = createRequire(import.meta.url);
const levels = require('../public/adventure/catalog.js').all;
const fixture = await adventureFixture();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const errors = [];
const tap = (page, selector) => page.$eval(selector, node => { assertEnabled(node); node.click(); function assertEnabled(node) { if (node.disabled) throw new Error('Disabled control ' + node.className); } });
async function open(page, number) {
  await page.goto(fixture.url);
  await page.waitForFunction(() => document.querySelectorAll('.node').length === 5 && !document.querySelector('#world').hidden);
  await page.evaluate(number => {
    const target = Math.ceil(number / 5);
    for (let i = 0; i < 20; i++) {
      const chapter = Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);
      if (chapter === target) break;
      document.querySelector(chapter > target ? '#chapterPrev' : '#chapterNext').click();
    }
    [...document.querySelectorAll('.node')].find(node => Number(node.querySelector('.node-number').textContent) === number).click();
  }, number);
  if (number > 6) await page.waitForFunction(number => document.querySelector('#choices')?.dataset.level === String(number), {}, number);
  else await page.waitForFunction(() => !document.querySelector('#game').classList.contains('hidden'));
}
async function visible(page, selector) {
  return page.$$eval(selector, nodes => nodes.filter(node => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0; }).map(node => node.textContent));
}
function pathTo(start, target, steps, maxPresses) {
  const queue = [{ value:start, path:[] }], seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.value === target) return item.path;
    if (item.path.length >= maxPresses) continue;
    for (let n = 0; n < steps.length; n++) {
      const value = item.value + steps[n];
      if (!seen.has(value)) { seen.add(value); queue.push({value,path:[...item.path,n]}); }
    }
  }
  throw new Error(`No control path from ${start} to ${target}`);
}
const click = selector => ({ selector });
function solution(task) {
  const actions = [], push = selector => actions.push(click(selector));
  switch (task.mechanic) {
    case 'compose':
      for (const index of pathTo(0,task.target,task.pieces.map(p=>p.value),task.maxPieces || 25)) push(`.ag-piece[data-piece="${index}"]`);
      break;
    case 'order': for (const id of task.solution) push(`.ag-order-item[data-item="${id}"]`); break;
    case 'share': for (let group=0;group<task.groups;group++) for(let n=0;n<task.each;n++) push(`.ag-give[data-group="${group}"]`); break;
    case 'rectangle': {
      if(task.visual==='treasures'){
        if(task.lesson==='row-count'||task.lesson==='total'){
          actions.push({selector:'.ag-number-answer',value:task.lesson==='row-count'?task.cols:task.targetArea});push('.ag-check');
        }else if(task.lesson==='build-groups'){
          for(let row=1;row<task.rows;row++)push('.ag-add-row');
          push('.ag-finish-groups');
        }else if(task.lesson==='addition'){
          for(let index=0;index<task.rows;index++){
            push(`.ag-addend-slot[data-index="${index}"]`);push(`.ag-addend-choice[data-value="${task.cols}"]`);
          }
          push('.ag-check');
        }else if(task.lesson==='transfer'){
          actions.push({selector:'.ag-factor-first',value:task.rows},{selector:'.ag-factor-second',value:task.cols},{selector:'.ag-product-answer',value:task.targetArea});push('.ag-check');
        }else{
          throw new Error('Unknown equal-groups objective '+task.lesson);
        }
        return actions;
      }
      let dimensions;
      for (let w=1;w<=task.cols && !dimensions;w++) for(let h=1;h<=task.rows;h++) {
        if ((task.targetArea===undefined || w*h===task.targetArea) && (task.targetPerimeter===undefined || 2*(w+h)===task.targetPerimeter)) { dimensions=[w,h];break; }
      }
      if (task.requireRectangle || task.targetPerimeter!==undefined) {
        assert.ok(dimensions,'rectangle should fit the teaching grid');
        for(let y=0;y<dimensions[1];y++)for(let x=0;x<dimensions[0];x++)push(`.ag-cell[data-x="${x}"][data-y="${y}"]`);
      } else for(let n=0;n<task.targetArea;n++)push(`.ag-cell[data-x="${n%task.cols}"][data-y="${Math.floor(n/task.cols)}"]`);
      break;
    }
    case 'fraction': for(let n=0;n<task.parts*task.target.n/task.target.d;n++)push(`.ag-fraction-piece[data-part="${n}"]`); break;
    case 'route': for(const index of pathTo(task.start,task.target,task.steps,12))push(`.ag-route-step[data-step="${task.steps[index]}"]`);break;
    case 'clock': {
      const difference=(task.hour*60+task.minute-(task.startHour||0)*60-(task.startMinute||0)+1440)%1440;
      for(let n=0;n<Math.floor(difference/60);n++)push('[data-action="hour-plus"]');
      for(let n=0;n<(difference%60)/5;n++)push('[data-action="minute-plus"]');
      break;
    }
    case 'calendar': push(`.ag-calendar-day[data-day="${task.day}"]`);break;
    case 'match': task.pairs.forEach((_,index)=>{push(`.ag-match-card[data-side="left"][data-card-index="${index}"]`);push(`.ag-match-card[data-side="right"][data-card-index="${task.pairs.length-1-index}"]`);});break;
    case 'sort': for(const item of task.items){push(`.ag-sort-item[data-item="${item.id}"]`);push(`.ag-sort-bin-button[data-bin="${item.bin}"]`);}break;
    case 'sequence': task.terms.forEach((term,index)=>{if(term===null){push(`.ag-sequence-slot[data-index="${index}"]`);push(`.ag-sequence-choice[data-choice="${task.choices.findIndex(c=>String(c)===String(task.solution[index]))}"]`);}});break;
    case 'coordinate': {
      if(task.mode==='point')for(const target of task.targets)push(`.ag-coordinate-cell[data-x="${target.x}"][data-y="${target.y}"]`);
      else {
        let {x,y}=task.start||{x:task.xMin,y:task.yMin};
        for(const target of task.targets){
          if(x===target.x && y===target.y)continue;
          while(x!==target.x){const dx=target.x>x?1:-1;push(`[data-action="robot-${dx>0?'right':'left'}"]`);x+=dx;}
          while(y!==target.y){const dy=target.y>y?1:-1;push(`[data-action="robot-${dy>0?'up':'down'}"]`);y+=dy;}
        }
      }
      break;
    }
    case 'bars': task.values.forEach((value,index)=>{for(let n=0;n<value;n++)push(`.ag-bar-plus[data-index="${index}"]`);});break;
    case 'measure': actions.push({selector:'.ag-measure-range',value:task.target});break;
    default: throw new Error('Unknown mechanic '+task.mechanic);
  }
  if(!['match','sort','coordinate'].includes(task.mechanic))push('.ag-check');
  return actions;
}

const viewports = [{ width: 320, height: 640 }, { width: 360, height: 640 }, { width: 412, height: 740 }, { width: 1280, height: 800 }];
const measurements = [], captures = [];
let current = 'initial load';
async function newPage(viewport, reduced = false) {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(`${current}: ${error.message}`));
  page.on('console', message => { if (['error', 'warn'].includes(message.type())) errors.push(`${current}: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${current}: HTTP ${response.status()} ${response.url()}`); });
  await page.setViewport({ ...viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  return page;
}
async function act(page, actions) {
  await page.evaluate(actions => {
    for (const action of actions) {
      const node = document.querySelector('#choices ' + action.selector);
      if (!node || node.disabled) throw new Error('Missing or disabled real control: ' + action.selector);
      if ('value' in action) { node.value = String(action.value); node.dispatchEvent(new Event('input', { bubbles: true })); }
      else node.click();
    }
  }, actions);
}
async function picture(page, label) {
  const file = `/tmp/live-${label}.png`;
  await page.screenshot({ path: file }); captures.push(file);
}
async function neutral(page) {
  assert.equal(await page.$eval('#game', node => node.dataset.answerState), 'neutral', current + ': neutral result state');
  assert.equal(await page.$eval('#feedback', node => node.dataset.kind), 'info');
  assert.equal(await page.$$('.ag-celebration').then(nodes => nodes.length), 0, current + ': old celebration is removed');
}
async function noCelebration(page) {
  assert.equal(await page.$$('.ag-celebration').then(nodes => nodes.length), 0, current + ': partial or wrong work has no full-success celebration');
  assert.equal(await page.$$eval('.ag-feedback-icon', nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length), 0, current + ': partial or wrong work has no success check animation');
}
// Observe actual advancing browser animation clocks, then sample the real styles
// at mid-animation for stable screenshots. Resume and await animation.finished;
// there are no fixed sleeps or waits for arbitrary animation durations.
async function motion(page, selector, label, { pause = false } = {}) {
  const evidence = await page.evaluate(async ({ selector, pause }) => {
    const animations = [...document.querySelectorAll(selector)].flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running');
    await Promise.all(animations.map(animation => animation.ready));
    const before = animations.map(animation => animation.currentTime);
    for (let frame = 0; frame < 12 && !animations.some((animation, index) => Number(animation.currentTime) > Number(before[index])); frame++)
      await new Promise(resolve => requestAnimationFrame(resolve));
    return animations.map((animation, index) => {
      const timing = animation.effect.getComputedTiming(), target = animation.effect.target;
      const result = { name: animation.animationName || 'web-animation', before: before[index], after: animation.currentTime,
        duration: timing.duration, frames: animation.effect.getKeyframes(), target: target.className, state: animation.playState };
      if (pause && animation.playState === 'running') { animation.pause(); animation.currentTime = Number(timing.delay || 0) + Number(timing.duration) * .45; }
      return result;
    });
  }, { selector, pause });
  assert.ok(evidence.length, label + ': at least one real running animation');
  assert.ok(evidence.some(item => item.after > item.before), label + ': normal-motion animation time advances');
  assert.ok(evidence.every(item => item.frames.length >= 2 && item.duration > 0), label + ': meaningful keyframes and duration');
  measurements.push({ label, evidence });
  return evidence;
}
async function finish(page, selector = '#game') {
  await page.evaluate(async selector => {
    const animations = document.querySelector(selector)?.getAnimations({ subtree: true }) || [];
    await Promise.all(animations.filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => { if (animation.playState === 'paused') animation.play(); return animation.finished.catch(() => {}); }));
  }, selector);
}
async function fillShare(page, task) {
  const actions = [];
  for (let group = 0; group < task.groups; group++) for (let n = 0; n < task.each; n++) actions.push({ selector: `.ag-give[data-group="${group}"]` });
  await act(page, actions);
}
async function checkShare(page, task, label) {
  assert.equal((await visible(page, '.ag-share-recipient')).length, task.groups, label + ': visible recipient count');
  const items = await visible(page, '.ag-share-item');
  assert.equal(items.length, task.total, label + ': every correctly placed item is visible');
  assert.ok(items.every(text => text.includes(task.itemIcon || task.unit)), label + ': items match the teaching story');
  assert.deepEqual(await page.$$eval('.ag-share-count', nodes => nodes.map(node => Number(node.textContent))), Array(task.groups).fill(task.each), label + ': exact counts');
}
async function focusedMotion(viewport) {
  const page = await newPage(viewport), label = `${viewport.width}x${viewport.height}`;
  const postsBefore = fixture.posts.length;
  current = `normal ${label}`;
  await open(page, 22);
  await neutral(page); await assertAdventureFits(page, current + ' initial');
  const recipients = await visible(page, '.ag-share-recipient');
  assert.equal(recipients.length, 2, 'level 22 shows two visible bunny recipients');
  assert.ok(recipients.every(text => /🐰|🐇/.test(text)), 'both recipients are bunnies');
  await tap(page, '.ag-check'); await noCelebration(page);
  assert.equal(await page.$eval('#feedback', node => node.dataset.kind), 'error');
  await tap(page, '.ag-check'); await noCelebration(page);
  await tap(page, '.ag-hint'); await neutral(page);
  await tap(page, '.ag-give[data-group="0"]');
  await motion(page, '.ag-share-item', 'one carrot placement ' + label);
  await finish(page);
  await tap(page, '.ag-check'); await noCelebration(page);
  await tap(page, '.ag-reset'); await neutral(page);
  assert.equal((await visible(page, '.ag-share-item')).length, 0, 'reset clears placed carrots');
  await fillShare(page, levels.find(level => level.level === 22).rounds[0]);
  await finish(page);
  await checkShare(page, levels.find(level => level.level === 22).rounds[0], current);
  let recorder;
  if (viewport.width === 320) recorder = await page.screencast({ path: '/tmp/live-bunnies-success.webm', fps: 30 });
  try {
    await tap(page, '.ag-check');
    assert.equal(await page.$eval('#feedback', node => node.dataset.kind), 'success');
    assert.equal(await page.$eval('#next', node => node.classList.contains('hidden')), false, 'Continue is available during animation');
    assert.equal(fixture.posts.length, postsBefore, 'solving and celebration cannot save progress');
    assert.equal(await page.$eval('.ag-celebration', node => node.getAttribute('aria-hidden')), 'true', 'celebration stays decorative');
    await motion(page, '.ag-feedback-icon', 'success check ' + label, { pause: true });
    await motion(page, '.ag-celebration-owl', 'success owl ' + label, { pause: true });
    await motion(page, '.ag-share-recipient', 'happy bunnies ' + label, { pause: true });
    await assertAdventureFits(page, current + ' animated mid-frame'); await picture(page, '22-mid-' + label);
    await finish(page);
    await page.waitForFunction(() => !document.querySelector('.ag-celebration'));
    await assertAdventureFits(page, current + ' settled'); await picture(page, '22-after-' + label);
    await page.evaluate(() => AdventureFeedback.set(document.querySelector('#feedback'), 'Доставка завершена.', 'success'));
    assert.equal(await page.$$('.ag-celebration').then(nodes => nodes.length), 0, 'duplicate success delivery message does not replay celebration');
    assert.equal(await page.$$eval('.ag-feedback-icon', nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length), 0, 'duplicate success does not restart check motion');
    await tap(page, '#next'); await neutral(page);
    assert.equal(await page.$eval('#choices', node => node.dataset.round), '2', 'next advances immediately');
    const pair = levels.find(level => level.level === 22).rounds[1].pairs[0];
    await tap(page, '.ag-match-card[data-side="left"][data-card-index="0"]');
    const task = levels.find(level => level.level === 22).rounds[1];
    await tap(page, `.ag-match-card[data-side="right"][data-card-index="${task.pairs.length - 1}"]`);
    await noCelebration(page);
    assert.equal(await page.$eval('#next', node => node.classList.contains('hidden')), true, 'one correct pair is partial work');
    assert.ok(pair, 'partial match uses a real pair');
    await tap(page, '.ag-back');
  } finally { if (recorder) await recorder.stop(); }
  // Exit and fast Continue while live animations are still running.
  await open(page, 22); await fillShare(page, levels.find(level => level.level === 22).rounds[0]); await tap(page, '.ag-check');
  assert.ok(await page.$('.ag-celebration')); await tap(page, '#next'); await neutral(page);
  await tap(page, '.ag-back');
  await open(page, 22); await fillShare(page, levels.find(level => level.level === 22).rounds[0]); await tap(page, '.ag-check');
  await tap(page, '.ag-back');
  assert.equal(await page.$$('.ag-celebration').then(nodes => nodes.length), 0, 'exit immediately cleans animation');
  await open(page, 22); await neutral(page); await page.close();
}
async function reducedMotion(viewport) {
  const page = await newPage(viewport, true), label = `${viewport.width}x${viewport.height}`;
  current = `reduced ${label}`; await open(page, 22);
  await fillShare(page, levels.find(level => level.level === 22).rounds[0]); await tap(page, '.ag-check');
  assert.equal(await page.$eval('#feedback .ag-feedback-icon', node => node.textContent), '✓', 'reduced motion retains static correct check');
  assert.equal(await page.$$eval('.ag-feedback-icon,.ag-celebration,.ag-celebration *,.ag-share-item,.ag-share-recipient', nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length), 0, 'reduced motion has no check/confetti/flights/bunny animation');
  assert.equal((await visible(page, '.ag-celebration')).length, 0, 'reduced motion has no confetti overlay');
  await assertAdventureFits(page, current + ' correct'); await picture(page, '22-reduced-' + label);
  await tap(page, '#next'); await neutral(page); await page.close();
}
async function allShares(viewport) {
  const page = await newPage(viewport), label = `${viewport.width}x${viewport.height}`;
  let shareRounds = 0;
  for (const level of levels.filter(level => level.rounds.some(task => task.mechanic === 'share'))) {
    await open(page, level.level);
    const lastShare = level.rounds.findLastIndex(task => task.mechanic === 'share');
    for (let index = 0; index <= lastShare; index++) {
      const task = level.rounds[index]; current = `L${level.level} R${index + 1} ${label}`;
      if (task.mechanic === 'share') {
        shareRounds++;
        await assertAdventureFits(page, current + ' empty');
        // Deliberately wrong imbalanced distribution must stay bounded even
        // when every item goes to one actor. Numeric count stays exact.
        await act(page, Array.from({ length: task.total }, () => ({ selector: '.ag-give[data-group="0"]' })));
        await finish(page);
        assert.equal(await page.$eval('.ag-share-count', node => Number(node.textContent)), task.total);
        assert.ok((await visible(page, '.ag-share-item')).length <= Math.max(8, task.each), 'imbalanced board bounds individual tokens');
        if (task.total > Math.max(8, task.each)) assert.match(await page.$eval('.ag-share-group', node => node.textContent), new RegExp('\\+' + (task.total - Math.max(8, task.each))), 'overflow explicitly counts every hidden item');
        await tap(page, '.ag-check'); await noCelebration(page);
        await assertAdventureFits(page, current + ' imbalanced');
        await tap(page, '.ag-reset'); await neutral(page);
        await fillShare(page, task); await finish(page); await checkShare(page, task, current);
        await assertAdventureFits(page, current + ' full'); await tap(page, '.ag-check');
        await motion(page, '.ag-celebration-owl', current + ' celebrates');
        await assertAdventureFits(page, current + ' success');
      } else await act(page, solution(task));
      assert.equal(await page.$eval('#next', node => node.classList.contains('hidden')), false, current + ': solved through real controls');
      if (index < lastShare) { await tap(page, '#next'); await neutral(page); }
    }
    await tap(page, '.ag-back');
  }
  assert.equal(shareRounds, 22, 'all 22 catalog sharing tasks exercised');
  await page.close();
}
async function originals() {
  const page = await newPage(viewports[0]);
  const choose = async (selector, value) => page.$$eval(selector, (nodes, value) => { const node = nodes.find(node => node.textContent.trim() === String(value)); if (!node) throw new Error('Missing original answer ' + value); node.click(); }, value);
  for (let level = 1; level <= 6; level++) {
    current = `original ${level} normal motion`; await open(page, level);
    if (level === 1) await tap(page, '.apple-pick:not(:disabled)');
    if (level === 2) for (let i = 0; i < 2; i++) await tap(page, '.bridge-plank:not(.removed)');
    if (level === 3) { await choose('.neighbor-tile', 3); await noCelebration(page); await choose('.neighbor-tile', 5); }
    if (level === 4) await choose('.path-choice', 3);
    if (level === 5) { for (let i = 0; i < 3; i++) await page.$$eval('.dragon-key', (nodes, i) => nodes[i].click(), i); await tap(page, '.dragon-check'); }
    if (level === 6) {
      for (const value of [10, 10, 1, 1, 1]) {
        await tap(page, `.resident-button[aria-label="Заселить ${value === 10 ? 'десять жителей' : 'одного жителя'}"]`);
        // Resident arrival is part of the original game. Its animationend
        // commits the move, so wait for its real completion, never a sleep.
        await finish(page, '#choices');
      }
    }
    await page.waitForFunction(() => document.querySelector('#feedback').dataset.kind === 'success');
    const nativeSelectors = ['.apple-basket', '.truck-cab', '.neighbor-house,.neighbor-number,.neighbor-owl', '.path-stone,.path-owl', '.dragon-character', '.resident-house'];
    if (level !== 6) await motion(page, nativeSelectors[level - 1], current + ' native');
    else {
      const resident = await page.$eval('.resident-house', node => ({ name: getComputedStyle(node).animationName, duration: getComputedStyle(node).animationDuration }));
      assert.match(resident.name, /resident-happy/, 'original resident completion retains native happy animation');
      assert.ok(parseFloat(resident.duration) > 0);
    }
    await motion(page, '.ag-feedback-icon', current + ' shared check');
    if (level === 1) {
      const starts = await page.evaluate(async () => {
        let starts = 0;
        const listener = event => { if (event.target.matches('.ag-feedback-icon,.ag-celebration-owl')) starts++; };
        document.querySelector('#game').addEventListener('animationstart', listener);
        await Promise.all(document.querySelector('.apple-basket').getAnimations().map(animation => animation.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        document.querySelector('#game').removeEventListener('animationstart', listener);
        return starts;
      });
      assert.equal(starts, 0, 'legacy basket delivery success message does not replay shared celebration');
    }
    await page.screenshot({ path: `/tmp/live-original-${level}-normal.png` });
  }
  await page.close();
}
async function completionDuringMotion() {
  const page = await newPage(viewports[0]);
  current = 'normal completion saves during motion'; await open(page, 21);
  const level = levels.find(level => level.level === 21), before = fixture.posts.length;
  for (const task of level.rounds.slice(0, -1)) { await act(page, solution(task)); await tap(page, '#next'); await neutral(page); }
  await act(page, solution(level.rounds.at(-1)));
  assert.ok(await page.$('.ag-celebration'), 'final task is still celebrating');
  const response = page.waitForResponse(response => response.url().endsWith('/api/math/adventure') && response.request().method() === 'POST');
  await tap(page, '#next'); await response;
  assert.equal(fixture.posts.length, before + 1, 'final Continue saves immediately without waiting for animation');
  assert.equal(await page.$$('.ag-celebration').then(nodes => nodes.length), 0, 'completion clears the final task animation');
  await page.close();
}
try {
  for (const viewport of viewports) {
    await focusedMotion(viewport); await reducedMotion(viewport); await allShares(viewport);
    console.log(`PASS motion and 22 sharing tasks at ${viewport.width}x${viewport.height}`);
  }
  await originals();
  await completionDuringMotion();
  assert.deepEqual(errors, [], 'no page errors, console warnings/errors or asset failures');
  console.log('PASS normal-motion advancing keyframes/midframes/settled states; sharing 22 tasks × four viewports; wrong/partial/repeated error/correct/reset/replay/fast-next/exit lifecycle; reduced-motion static check; six original native animations.');
  console.log('Artifacts: /tmp/live-motion-measurements.json /tmp/live-bunnies-success.webm ' + captures.join(' '));
} catch (error) {
  console.error(current + ':', error);
  const page = (await browser.pages()).at(-1);
  if (page) await page.screenshot({ path: '/tmp/live-motion-failure.png', fullPage: true });
  process.exitCode = 1;
}
finally {
  fs.writeFileSync('/tmp/live-motion-measurements.json', JSON.stringify(measurements, null, 2));
  await browser.close(); await fixture.close();
}
