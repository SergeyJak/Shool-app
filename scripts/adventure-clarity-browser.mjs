import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';
import { assertAdventureFits } from './support/adventure-layout.mjs';

// Drive the production page and real controls, without runner hooks.
const require = createRequire(import.meta.url);
const levels = require('../public/adventure/catalog.js').all;
const balanceOnly = process.env.ADVENTURE_CLARITY_FOCUS === 'balance';
const viewports = [{ width: 320, height: 640 }, { width: 360, height: 640 }, { width: 412, height: 740 }, { width: 1280, height: 800 }];
const targets = { 7: [12,27,38,64,97], 11: [123,240,305,418,672], 37: [5,9,750,1200,1750], 39: [null,12,null,15,1250], 40: [null,75,1500,1250,null], 48: [null,12,16,null,24], 66: [50,125,null,235,408], 81: [5,8,12,9,13], 82: [12,9,null,null,8] };
for (const [number, values] of Object.entries(targets)) assert.deepEqual(levels.find(level => level.level === Number(number)).rounds.map(task => task.target ?? null), values, `L${number}: mathematical targets remain intact`);
const fixture = await adventureFixture();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errors = [], captures = [];
let current = 'load', rounds = 0;
page.on('pageerror', error => errors.push(`${current}: ${error.message}`));
page.on('console', message => { if (['error', 'warn'].includes(message.type())) errors.push(`${current}: ${message.text()}`); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${current}: HTTP ${response.status()} ${response.url()}`); });
async function open(number) {
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
  await page.waitForFunction(number => document.querySelector('#choices')?.dataset.level === String(number), {}, number);
}
async function tap(selector) {
  await page.$eval(selector, node => { if (node.disabled) throw new Error('Disabled real control: ' + node.className); node.click(); });
}
async function picture(label) {
  const path = `/tmp/adventure-clarity-${label}.png`;
  await page.screenshot({ path }); captures.push(path);
}
async function finish() {
  await page.evaluate(async () => {
    await Promise.all(document.querySelector('#game').getAnimations({ subtree: true }).filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
async function balance(left, right, equal) {
  const actual = await page.$eval('.ag-balance-board', node => ({ left: Number(node.dataset.left), right: Number(node.dataset.right), equal: node.dataset.balanced === 'true' }));
  assert.deepEqual(actual, { left, right, equal }, current + ': displayed balance totals');
  for (const [side, value] of [['left', left], ['right', right]]) {
    const pan = `.ag-balance-pan[data-side="${side}"]`;
    assert.equal(await page.$eval(pan, node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }), true, current + ': actual visible pan');
    assert.match(await page.$eval(`${pan} .ag-balance-total`, node => node.textContent), new RegExp(`(^|\\D)${value}\\s*г`), current + ': visible pan mass with grams');
  }
}
async function focusedBalance(viewport) {
  current = `L82 balance lifecycle ${viewport.width}`;
  await open(82);
  const beforePath = '/tmp/adventure-clarity-before-L82-320.png';
  if (viewport.width === 320 && !fs.existsSync(beforePath)) await page.screenshot({ path: beforePath });
  assert.ok(await page.$('.ag-balance-board'), 'L82 must show actual balance pans for the weights described in its question');
  await balance(7,19,false);
  assert.equal(await page.$eval('.ag-balance-added',node=>node.hidden),true,'empty balance shows no invented zero-gram weight');
  assert.equal(await page.$$('.ag-piece .ag-weight-icon').then(nodes => nodes.length),3, 'all three mass controls depict weights');
  const controls = await page.$$eval('.ag-piece', nodes => nodes.map(node => ({ text: node.textContent, value: Number(node.dataset.value) })));
  assert.deepEqual(controls.map(item => item.value),[1,5,10]);
  assert.ok(controls.every(item => new RegExp(`(^|\\D)${item.value}\\s*г`).test(item.text)), 'every real weight button visibly labels its mass');
  assert.doesNotMatch(await page.$eval('#choices', node => node.textContent), /🪙/, 'mass problems never depict coins');
  await assertAdventureFits(page,current + ' empty');
  if (viewport.width === 320) await picture('after-L82-empty-320');
  await tap('.ag-check');
  assert.equal(await page.$eval('#feedback', node => node.dataset.kind),'error');
  assert.equal(await page.$$('.ag-celebration').then(nodes => nodes.length),0,'wrong answer never celebrates');
  await tap('.ag-piece[data-value="10"]'); await balance(17,19,false);
  await tap('.ag-token'); await balance(7,19,false);
  await tap('.ag-piece[data-value="10"]'); await tap('.ag-piece[data-value="1"]'); await tap('.ag-piece[data-value="1"]');
  await balance(19,19,true);
  assert.deepEqual(await page.$$eval('.ag-balance-piece',nodes=>nodes.map(node=>node.textContent.replace(/\s/g,''))),['10г','1г×2'],'left pan depicts selected denominations and exact counts');
  await finish();
  const geometry = await page.evaluate(() => ({ beam: getComputedStyle(document.querySelector('.ag-balance-beam')).transform, pans: [...document.querySelectorAll('.ag-balance-pan')].map(node => node.getBoundingClientRect().top) }));
  assert.match(geometry.beam, /^matrix\(1, 0, 0, 1, 0, 0\)$/, 'equal totals leave the actual beam horizontal');
  assert.equal(geometry.pans[0],geometry.pans[1],'equal masses settle both actual pans at the same height');
  assert.equal(await page.$eval('.ag-scene',node=>Number(node.dataset.value)),12,'answer is unknown mass, independently of fixed 7g');
  await assertAdventureFits(page,current + ' balanced');
  if (viewport.width === 320) await picture('after-L82-balanced-320');
  await tap('.ag-reset'); await balance(7,19,false);
  assert.equal(await page.$eval('#game',node=>node.dataset.answerState),'neutral','retry resets feedback');
  for(let n=0;n<25;n++)await tap(`.ag-piece[data-value="${[1,5,10][n%3]}"]`);
  await balance(136,19,false);await finish();
  assert.deepEqual(await page.$$eval('.ag-balance-piece',nodes=>nodes.map(node=>node.textContent.replace(/\s/g,''))),['1г×9','5г×8','10г×8'],'maximum mixed collection shows all three real denominations with exact counts');
  await assertAdventureFits(page,current+' mixed 25-piece collection');
  if(viewport.width===320)await picture('after-L82-mixed25-320');
  await tap('.ag-piece[data-value="1"]');
  assert.equal(await page.$eval('.ag-scene',node=>Number(node.dataset.value)),129,'26th piece cannot silently increase the pan mass');
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'error');
  await tap('.ag-token');await balance(135,19,false);
  await tap('.ag-reset');await balance(7,19,false);
  for (const value of [10,1,1]) await tap(`.ag-piece[data-value="${value}"]`);
  await tap('.ag-check');
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success');
  assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),false,'Continue remains immediately available');
  const evidence = await page.evaluate(async () => {
    const animations = [...document.querySelectorAll('.ag-feedback-icon,.ag-celebration-owl')].flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running');
    await Promise.all(animations.map(animation => animation.ready));
    const before = animations.map(animation => animation.currentTime);
    for(let n=0;n<12 && !animations.some((animation,index)=>animation.currentTime>before[index]);n++) await new Promise(resolve=>requestAnimationFrame(resolve));
    return animations.map((animation,index)=>({before:before[index],after:animation.currentTime,duration:animation.effect.getComputedTiming().duration,frames:animation.effect.getKeyframes().length}));
  });
  assert.ok(evidence.some(item=>item.after>item.before && item.duration>0 && item.frames>=2),'correct balance triggers real advancing success animation');
  await assertAdventureFits(page,current + ' success');
  await tap('#next');
  assert.equal(await page.$eval('#choices',node=>node.dataset.round),'2');
  assert.equal(await page.$$('.ag-celebration').then(nodes=>nodes.length),0,'advancing immediately cleans success animation');
  assert.equal(fixture.posts.length,0,'balance exploration does not save unfinished level');
}
function composePath(task) {
  const queue = [{ value:0,path:[] }], seen = new Set([0]);
  for (const item of queue) {
    if(item.value===task.target)return item.path;
    if(item.path.length>=(task.maxPieces||25))continue;
    for(const [index,piece] of task.pieces.entries()) { const value=item.value+piece.value; if(value<=task.target&&!seen.has(value)){seen.add(value);queue.push({value,path:[...item.path,index]});} }
  }
  throw new Error('No solution for real denominations');
}
async function solve(task) {
  switch(task.mechanic){
    case 'compose': for(const index of composePath(task)) await tap(`.ag-piece[data-piece="${index}"]`); break;
    case 'measure': await page.$eval('.ag-measure-range',(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},task.target);break;
    case 'match': for(let index=0;index<task.pairs.length;index++){await tap(`.ag-match-card[data-side="left"][data-card-index="${index}"]`);await tap(`.ag-match-card[data-side="right"][data-card-index="${task.pairs.length-1-index}"]`);}return;
    case 'sort': for(const item of task.items){await tap(`.ag-sort-item[data-item="${item.id}"]`);await tap(`.ag-sort-bin-button[data-bin="${item.bin}"]`);}return;
    case 'share': for(let group=0;group<task.groups;group++)for(let n=0;n<task.each;n++)await tap(`.ag-give[data-group="${group}"]`);break;
    default: throw new Error('Unexpected clarity mechanic '+task.mechanic);
  }
  await assertAdventureFits(page,current+' filled');
  await tap('.ag-check');
}
async function semantics(number,task,index) {
  const text=await page.$eval('#choices',node=>node.textContent);
  if(task.mechanic==='compose'){
    const money=[7,66].includes(number), mass=/^(г|кг)$/.test(task.unit||'');
    if(money)assert.match(await page.$eval('.ag-piece-tray',node=>node.textContent),/🪙/,'currency exercises retain real coin visuals');
    else assert.doesNotMatch(text,/🪙/,'nonmoney composition never defaults to currency');
    if(mass)assert.equal(await page.$$('.ag-piece .ag-weight-icon').then(nodes=>nodes.length),task.pieces.length,'every mass denomination depicts a weight');
  }
  if(number===82&&index===4){
    assert.ok(await page.$('.ag-mass-group'),'two unknown masses are visibly represented');
    assert.equal(await page.$$('.ag-mass-group .ag-weight-icon').then(nodes=>nodes.length),2,'exactly two unknown weights are pictured');
    const group=await page.$eval('.ag-mass-group',node=>node.textContent);
    assert.match(group,/16\s*г/,'given total mass is visible');
  }
  if(number===82&&task.mechanic==='share'){
    assert.equal(task.unit,'г');assert.deepEqual([task.total,task.groups,task.each],[18,3,6]);
    assert.equal(await page.$$('.ag-share-group').then(nodes=>nodes.length),3);
  }
}
try {
  for(const viewport of viewports){
    await page.setViewport({...viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
    await focusedBalance(viewport);
  }
  for(const viewport of balanceOnly ? [] : viewports){
    await page.setViewport({...viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    for(const number of Object.keys(targets).map(Number)){
      await open(number);
      const level=levels.find(item=>item.level===number);
      for(const [index,task] of level.rounds.entries()){
        current=`L${number} R${index+1} ${viewport.width}x${viewport.height}`;
        await semantics(number,task,index);await assertAdventureFits(page,current+' initial');
        await solve(task);await finish();
        assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success',current+': solved with real controls');
        if(number===82&&task.mechanic==='share'){
          assert.deepEqual(await page.$$eval('.ag-share-group',nodes=>nodes.map(node=>Number(node.dataset.count))),[6,6,6]);
          const counts=await page.$$eval('.ag-share-count',nodes=>nodes.map(node=>node.textContent));
          assert.ok(counts.every(text=>/6\s*г/.test(text)),'each pan visibly contains six grams');
          assert.equal(await page.$$('.ag-share-item.ag-weight-icon').then(nodes=>nodes.length),18,'all eighteen one-gram weights are visible');
        }
        await assertAdventureFits(page,current+' solved');rounds++;
        if(index<4)await tap('#next');
      }
    }
    console.log(`PASS clarity semantics and real controls at ${viewport.width}x${viewport.height}`);
  }
  assert.equal(rounds,balanceOnly ? 0 : 180);assert.equal(fixture.posts.length,0,'semantic exploration cannot save unfinished games');
  assert.deepEqual(errors,[],'no browser warnings, errors, or failed assets');
  console.log(`PASS balance removal/retry/mixed25/live feedback animation across four viewports${balanceOnly ? '' : `; mass/number/length/currency semantics; ${rounds} rounds`}; screenshots ${captures.join(' ')}`);
} catch(error){await page.screenshot({path:'/tmp/adventure-clarity-failure.png',fullPage:true});console.error('FAIL '+current);throw error;}
finally { await browser.close(); await fixture.close(); }
