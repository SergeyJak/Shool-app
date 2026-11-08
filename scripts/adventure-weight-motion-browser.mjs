import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';
import { assertAdventureFits } from './support/adventure-layout.mjs';

// Browser plugin not available; use the installed browser and production HTTP fixture.
// Flow: chapter map -> actual mass controls -> immediate totals with decorative flights.
const fixture = await adventureFixture();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const viewports = [{ width:320,height:640 }, { width:360,height:640 }, { width:412,height:740 }, { width:1280,height:800 }];
const errors = [], evidence = [], captures = [];
const levels = createRequire(import.meta.url)('../public/adventure/catalog.js').all;
let current = 'load';
async function open(page, number = 82) {
  await page.goto(fixture.url);
  await page.waitForFunction(() => document.querySelectorAll('.node').length === 5 && !document.querySelector('#world').hidden);
  await page.evaluate(number => {
    const target = Math.ceil(number / 5);
    for (let i=0; i<20; i++) {
      const chapter = Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);
      if (chapter === target) break;
      document.querySelector(chapter > target ? '#chapterPrev' : '#chapterNext').click();
    }
    [...document.querySelectorAll('.node')].find(node => Number(node.querySelector('.node-number').textContent) === number).click();
  }, number);
  await page.waitForFunction(number => document.querySelector('#choices')?.dataset.level === String(number), {}, number);
  assert.match(await page.title(), /математ|приключ|math/i, 'page identity');
  assert.ok((await page.$eval('#game', node => node.textContent)).trim().length > 50, 'meaningful game content');
  assert.equal(await page.$('vite-error-overlay,nextjs-portal'), null, 'no framework error overlay');
}
async function makePage(viewport, reduced = false) {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(`${current}: ${error.message}`));
  page.on('console', message => { if (['error','warn'].includes(message.type())) errors.push(`${current}: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${current}: HTTP ${response.status()} ${response.url()}`); });
  await page.setViewport({ ...viewport, isMobile:viewport.width < 600, hasTouch:viewport.width < 600 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion',value:reduced ? 'reduce' : 'no-preference' }]);
  return page;
}
const tap = (page, selector) => page.$eval(selector, node => { if (node.disabled) throw new Error('Disabled real control ' + node.className); node.click(); });
async function finish(page) {
  await page.evaluate(async () => {
    for (let pass=0; pass<3; pass++) {
      const animations = document.querySelector('#game').getAnimations({subtree:true}).filter(animation => animation.effect.getComputedTiming().iterations !== Infinity);
      if (!animations.length) break;
      await Promise.all(animations.map(animation => { if (animation.playState === 'paused') animation.play(); return animation.finished.catch(() => {}); }));
    }
  });
}
async function amount(page, value) {
  assert.equal(await page.$eval('.ag-scene', node => Number(node.dataset.value)), value, current + ': answer changes immediately');
  if (await page.$('.ag-balance-board')) assert.equal(await page.$eval('.ag-balance-board', node => Number(node.dataset.left)), 7 + value, current + ': pan total changes immediately');
}
async function advancing(page, selector, label) {
  const result = await page.evaluate(async selector => {
    const animations = [...document.querySelectorAll(selector)].flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running');
    await Promise.all(animations.map(animation => animation.ready));
    const before = animations.map(animation => Number(animation.currentTime));
    for (let frame=0; frame<12 && !animations.some((animation,index) => Number(animation.currentTime) > before[index]); frame++) await new Promise(resolve => requestAnimationFrame(resolve));
    return animations.map((animation,index) => ({ before:before[index], after:Number(animation.currentTime), duration:animation.effect.getComputedTiming().duration, frames:animation.effect.getKeyframes(), side:animation.effect.target.dataset.side, translation:animation.effect.target.dataset.side ? animation.effect.getKeyframes().map(frame=>new DOMMatrix(frame.transform).m42) : null, name:animation.animationName || animation.transitionProperty || 'web-animation' }));
  }, selector);
  assert.ok(result.some(item => item.after > item.before && item.duration > 0 && item.frames.length >= 2), `${label}: real browser animation clock advances`);
  evidence.push({label,result});
  return result;
}
async function flights(page, label) {
  const visible = await page.$$eval('.ag-weight-flight', nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { width:rect.width,height:rect.height,opacity:Number(style.opacity),visibility:style.visibility,hidden:node.closest('[aria-hidden="true"]') !== null,pointer:style.pointerEvents,weight:node.matches('.ag-weight-icon') || !!node.querySelector('.ag-weight-icon') };
  }));
  assert.ok(visible.length > 0 && visible.length <= 3, `${label}: one to three visible .ag-weight-flight ghosts`);
  assert.ok(visible.every(item => item.width > 0 && item.height > 0 && item.opacity > 0 && item.visibility !== 'hidden' && item.hidden && item.pointer === 'none' && item.weight), `${label}: visible, decorative, noninteractive actual weight`);
  await advancing(page,'.ag-weight-flight',label);
}
async function clean(page, label) {
  assert.equal(await page.$$('.ag-weight-flight').then(nodes => nodes.length), 0, label + ': no stale flight nodes');
}
async function picture(page, label) {
  const path = `/tmp/weight-motion-${label}.png`; await page.screenshot({path}); captures.push(path);
}
async function rect(page, selector) {
  return page.$eval(selector, node => { const box = node.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; });
}
async function endpoints(page, start, end, label) {
  const result = await page.evaluate(({start,end}) => {
    const ghost = document.querySelector('.ag-weight-flight');
    const animation = ghost?.getAnimations().find(animation => animation.playState === 'running');
    if (!animation) return null;
    const elapsed = animation.currentTime, duration = Number(animation.effect.getComputedTiming().duration);
    animation.pause();
    const center = () => { const box=ghost.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; };
    animation.currentTime=0; const from=center();
    animation.currentTime=duration-.01; const to=center();
    animation.currentTime=elapsed; animation.play();
    return {from,to,start,end,distance:Math.hypot(from.x-to.x,from.y-to.y)};
  }, {start,end});
  assert.ok(result && result.distance > 20,label + ': weight actually travels between separate controls and board');
  for (const [actual,expected] of [[result.from,start],[result.to,end]]) assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y) < 32,label + ': flight endpoint matches the actual weight icon: ' + JSON.stringify(result));
  evidence.push({label,endpoints:result});
}
async function animationsOf(page, selector) {
  return page.$$eval(selector, nodes => nodes.flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').map(animation => ({name:animation.animationName || animation.transitionProperty || 'web-animation',frames:animation.effect.getKeyframes(),duration:animation.effect.getComputedTiming().duration})));
}
async function solveBalance(page) {
  for (const value of [10,1,1]) await tap(page,`.ag-piece[data-value="${value}"]`);
  await amount(page,12);
}
async function balanceContinuity() {
  const page=await makePage(viewports[0]); current='L82 settle continuity 320x640';
  await open(page); await finish(page);
  for(const settled of [true,false]) {
    if(!settled){await tap(page,'.ag-reset');await finish(page);}
    await tap(page,'.ag-piece[data-value="1"]');await tap(page,'.ag-piece[data-value="1"]');
    if(settled)await finish(page);
    const transforms=await page.evaluate(() => {
      const nodes=[document.querySelector('.ag-balance-beam'),...document.querySelectorAll('.ag-balance-pan')];
      const matrix=node=>{const transform=new DOMMatrix(getComputedStyle(node).transform);return [transform.a,transform.b,transform.c,transform.d,transform.e,transform.f];};
      const before=nodes.map(matrix);
      document.querySelector('.ag-piece[data-value="10"]').click();
      const starts=nodes.map(node=>{
        const animation=node.getAnimations().find(animation=>animation.animationName?.includes('settle'));
        if(!animation)throw new Error('Missing own CSS balance settle animation');
        animation.pause();animation.currentTime=0;return matrix(node);
      });
      return {before,starts};
    });
    evidence.push({label:current+(settled?' settled approach':' rapid approach'),transforms});
    assert.ok(transforms.before.every((matrix,index)=>matrix.every((value,component)=>Math.abs(value-transforms.starts[index][component])<.001)),`${current}: ${settled?'settled':'moving'} beam and both pans retain their actual transform at settle 0ms: ${JSON.stringify(transforms)}`);
    await finish(page);
  }
  await page.close();
}
async function normal(viewport) {
  const label = `${viewport.width}x${viewport.height}`, page = await makePage(viewport);
  current = `L82 normal ${label}`;
  await open(page); await finish(page); await assertAdventureFits(page,current + ' empty');
  const recorder = viewport.width === 320 ? await page.screencast({path:'/tmp/weight-motion-preview.webm',fps:30}) : null;
  const control = await rect(page,'.ag-piece[data-value="10"] .ag-weight-icon');
  await tap(page,'.ag-piece[data-value="10"]'); await amount(page,10);
  await flights(page,current + ' add 10g');
  await endpoints(page,control,await rect(page,'.ag-balance-piece[data-piece="2"] .ag-weight-icon'),current + ' add endpoints');
  await advancing(page,'.ag-balance-pan,.ag-balance-beam',current + ' tilt');
  await picture(page,'flight-' + label); await finish(page); await clean(page,current + ' landed');
  const pan = await rect(page,'.ag-balance-piece[data-piece="2"] .ag-weight-icon');
  await tap(page,'.ag-token'); await amount(page,0); await flights(page,current + ' remove 10g');
  await endpoints(page,pan,control,current + ' removal endpoints');
  await finish(page); await clean(page,current + ' removed');
  await tap(page,'.ag-check');
  assert.equal(await page.$eval('#feedback',node => node.dataset.kind),'error','wrong Check remains incorrect');
  assert.equal(await page.$$('.ag-celebration').then(nodes=>nodes.length),0,'wrong answer never celebrates');
  assert.deepEqual(await animationsOf(page,'.ag-balance-board,.ag-balance-pan,.ag-balance-beam'),[],'wrong Check cannot settle or glow as correct');
  if(viewport.width===320) {
    await tap(page,'.ag-piece[data-value="1"]');await tap(page,'.ag-piece[data-value="1"]');await finish(page);
    await tap(page,'.ag-piece[data-value="10"]');await amount(page,12);
  } else await solveBalance(page);
  const settle = await advancing(page,'.ag-balance-board,.ag-balance-pan,.ag-balance-beam',current + ' balanced settle');
  assert.ok(settle.some(item => item.frames.length >= 3 && item.frames.some(frame => 'transform' in frame)),current + ': brief balanced settle has actual overshoot keyframes');
  const leftSettle=settle.find(item=>item.side==='left'&&item.frames.length>=3), rightSettle=settle.find(item=>item.side==='right'&&item.frames.length>=3);
  assert.ok(leftSettle && rightSettle && leftSettle.translation.some(value=>Math.abs(value)>0) && leftSettle.translation.every((value,index)=>Math.abs(value+rightSettle.translation[index])<.01),current + ': both pans settle in opposite directions like a real beam');
  assert.equal(await page.$eval('.ag-balance-board',node=>node.dataset.balanced),'true');
  assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),true,'balanced exploration still requires Check');
  await finish(page);
  const aligned = await page.$$eval('.ag-balance-pan',nodes=>nodes.map(node=>node.getBoundingClientRect().top));
  assert.equal(aligned[0],aligned[1],'equal masses finish with both actual pans aligned');
  assert.match(await page.$eval('.ag-balance-beam',node=>getComputedStyle(node).transform),/^matrix\(1, 0, 0, 1, 0, 0\)$/,'balanced beam settles horizontally');
  await tap(page,'.ag-check');
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success');
  assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),false,'Continue becomes available immediately');
  const glow = await advancing(page,'.ag-balance-board,.ag-balance-pan',current + ' correct glow');
  assert.ok(glow.some(item => item.frames.some(frame => 'boxShadow' in frame || 'filter' in frame || 'backgroundColor' in frame)),current + ': correct Check has visible glow keyframes');
  assert.ok(await page.$('.ag-celebration-owl'),'existing universal owl still celebrates success');
  await picture(page,'correct-' + label); await assertAdventureFits(page,current + ' correct');
  await finish(page); if (recorder) await recorder.stop();
  // Rapid clicks update the live answer on every event, while limiting decoration.
  await tap(page,'#next'); await clean(page,current + ' next solved'); await open(page); await finish(page);
  const rapid = await page.evaluate(() => {
    const states=[]; let value=0;
    for(let index=0;index<24;index++) {
      const piece=[1,5,10][index%3];
      document.querySelector(`.ag-piece[data-value="${piece}"]`).click(); value+=piece;
      states.push({actual:Number(document.querySelector('.ag-scene').dataset.value),expected:value,ghosts:document.querySelectorAll('.ag-weight-flight').length});
      if(index%4===3) { const token=document.querySelector('.ag-token'); const denomination=Number(document.querySelector(`.ag-piece[data-piece="${token.dataset.piece}"]`).dataset.value); token.click();value-=denomination;states.push({actual:Number(document.querySelector('.ag-scene').dataset.value),expected:value,ghosts:document.querySelectorAll('.ag-weight-flight').length}); }
    }
    return states;
  });
  assert.ok(rapid.every(item=>item.actual===item.expected && item.ghosts>0 && item.ghosts<=3),'rapid mixed add/remove keeps exact immediate values and at most three flights');
  await assertAdventureFits(page,current + ' rapid');
  await tap(page,'.ag-reset'); await amount(page,0); await clean(page,current + ' reset in flight');
  await solveBalance(page); await tap(page,'.ag-check'); await tap(page,'#next');
  assert.equal(await page.$eval('#choices',node=>node.dataset.round),'2','fast Continue advances while flights still run');
  await clean(page,current + ' next');
  assert.equal(await page.$$('.ag-celebration').then(nodes=>nodes.length),0,'Next clears universal success decoration');
  await open(page); await tap(page,'.ag-piece[data-value="10"]'); await flights(page,current + ' before exit');
  await tap(page,'.ag-back'); await clean(page,current + ' exit'); await page.close();
}
async function genericMass(viewport) {
  const label = `${viewport.width}x${viewport.height}`, page = await makePage(viewport);
  current = `L37 normal ${label}`; await open(page,37); await finish(page);
  const control = await rect(page,'.ag-piece[data-piece="0"] .ag-weight-icon');
  await tap(page,'.ag-piece[data-piece="0"]'); await amount(page,2);
  await flights(page,current + ' add 2kg');
  await endpoints(page,control,await rect(page,'.ag-token[data-piece="0"] .ag-weight-icon'),current + ' token destination');
  await finish(page); const token = await rect(page,'.ag-token[data-piece="0"] .ag-weight-icon');
  await tap(page,'.ag-token[data-piece="0"]'); await amount(page,0); await flights(page,current + ' remove 2kg');
  await endpoints(page,token,control,current + ' reverse token flight');
  await tap(page,'.ag-reset'); await clean(page,current + ' reset');
  for (const piece of [0,0,1]) await tap(page,`.ag-piece[data-piece="${piece}"]`);
  await amount(page,5); await tap(page,'.ag-check'); await tap(page,'#next');
  await clean(page,current + ' next'); assert.equal(await page.$eval('#choices',node=>node.dataset.round),'2');
  await page.close();
}
async function reduced(viewport) {
  const label = `${viewport.width}x${viewport.height}`, page = await makePage(viewport,true);
  current = `L82 reduced ${label}`; await open(page);
  await tap(page,'.ag-piece[data-value="10"]'); await amount(page,10); await clean(page,current + ' add');
  await tap(page,'.ag-token'); await amount(page,0); await clean(page,current + ' remove');
  await solveBalance(page); await tap(page,'.ag-check');
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success','reduced motion retains successful feedback');
  await clean(page,current + ' balanced');
  assert.deepEqual(await animationsOf(page,'.ag-balance-board,.ag-balance-pan,.ag-balance-beam,.ag-weight-flight'),[],'reduced motion has no pan, beam, settle, glow, or flight animations');
  await assertAdventureFits(page,current + ' correct'); await picture(page,'reduced-' + label);
  await tap(page,'#next'); await open(page);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  await tap(page,'.ag-piece[data-value="10"]'); await flights(page,current + ' before preference toggle');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.waitForFunction(()=>!document.querySelector('.ag-weight-flight'));
  await amount(page,10); await clean(page,current + ' preference toggled');
  assert.deepEqual(await animationsOf(page,'.ag-balance-board,.ag-balance-pan,.ag-balance-beam'),[],'preference toggle cancels live weight motion');
  await page.close();
}
async function completionDuringFlight() {
  const page = await makePage(viewports[0]); current = 'L37 final save during flight'; await open(page,37);
  const tasks = levels.find(level=>level.level===37).rounds;
  for (const [round,task] of tasks.entries()) {
    const queue=[{value:0,path:[]}], seen=new Set([0]); let path;
    for (const item of queue) {
      if(item.value===task.target){path=item.path;break;}
      for(const [index,piece] of task.pieces.entries()) {
        const value=item.value+piece.value;
        if(value<=task.target && !seen.has(value)){seen.add(value);queue.push({value,path:[...item.path,index]});}
      }
    }
    assert.ok(path,'real mass denominations can solve each catalog round');
    await page.evaluate(path=>{for(const index of path)document.querySelector(`.ag-piece[data-piece="${index}"]`).click();document.querySelector('.ag-check').click();},path);
    assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success');
    if(round<tasks.length-1){await tap(page,'#next');await clean(page,current + ' intermediate next');continue;}
    const saved=page.waitForResponse(response=>response.url().endsWith('/api/math/adventure')&&response.request().method()==='POST');
    const immediate = await page.evaluate(() => {
      const animations=[...document.querySelectorAll('.ag-weight-flight')].flatMap(node=>node.getAnimations());
      const flying=animations.some(animation=>animation.playState==='running');
      document.querySelector('#next').click();
      return {flying,clean:!document.querySelector('.ag-weight-flight'),canceled:animations.every(animation=>animation.playState==='idle'||animation.playState==='finished'),resultVisible:!document.querySelector('#result').classList.contains('hidden')};
    });
    assert.deepEqual(immediate,{flying:true,clean:true,canceled:true,resultVisible:true},'final Continue renders result and cancels active flights synchronously');
    await saved;
    assert.equal(fixture.posts.length,1,'exactly one completed-level save starts without waiting for animation');
    assert.equal(fixture.posts[0].level,36,'only the fully completed real level saves');
  }
  await page.close();
}
try {
  await balanceContinuity();
  for (const viewport of viewports) await normal(viewport);
  for (const viewport of viewports) await genericMass(viewport);
  for (const viewport of viewports) await reduced(viewport);
  assert.equal(fixture.posts.length,0,'decorative mass exploration never saves an unfinished level');
  await completionDuringFlight();
  assert.deepEqual(errors,[],'no browser errors, warnings, or failed assets');
  fs.writeFileSync('/tmp/weight-motion-evidence.json',JSON.stringify({evidence,captures},null,2));
  console.log('PASS real advancing L82/L37 add/remove flights and endpoint geometry, pan/beam tilt, balanced settle, correct glow, unchanged owl, exact immediate values, bounded rapid clicks, wrong/Check/Next/reset/exit cleanup, reduced motion including live toggle, layout and console health across four viewports; final result and save proceed during active flight. ' + captures.join(' '));
} catch (error) {
  fs.writeFileSync('/tmp/weight-motion-evidence.json',JSON.stringify({current,evidence,captures,errors},null,2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); await fixture.close(); }
