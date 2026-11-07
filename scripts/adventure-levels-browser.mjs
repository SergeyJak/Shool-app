import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';

// Browser plugin not available. The repository's installed Puppeteer/Chromium
// workflow drives the production page and real DOM controls, without runner hooks.
const require = createRequire(import.meta.url);
const levels = require('../public/adventure/catalog.js').all;
assert.equal(levels.length, 94, 'the real-control suite must cover every new game');
const chrome = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome, 'Chrome/Chromium required');
const fixture = await adventureFixture();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const errors = [], warnings = [], screenshots = [], mechanics = new Set(), retried = new Set();
let current = 'initial load', completedRounds = 0;

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
function mistake(task) {
  if(task.mechanic==='rectangle'&&task.visual==='treasures'){
    // The first rectangle objective asks for one row; the whole-picture total
    // is a meaningful wrong answer, checked before this mechanic is retried.
    assert.equal(task.lesson,'row-count');
    return [{selector:'.ag-number-answer',value:task.targetArea},click('.ag-check')];
  }
  switch(task.mechanic){
    case 'match':return [click('.ag-match-card[data-side="left"][data-card-index="0"]'),click('.ag-match-card[data-side="right"][data-card-index="0"]')];
    case 'sort':return [click(`.ag-sort-item[data-item="${task.items[0].id}"]`),click(`.ag-sort-bin-button[data-bin="${task.bins.find(b=>b.id!==task.items[0].bin).id}"]`)];
    case 'coordinate':
      if(task.mode==='point'){
        for(let y=task.yMin;y<=task.yMax;y++)for(let x=task.xMin;x<=task.xMax;x++)if(x!==task.targets[0].x||y!==task.targets[0].y)return [click(`.ag-coordinate-cell[data-x="${x}"][data-y="${y}"]`)];
      }else{
        const start=task.start||{x:task.xMin,y:task.yMin};
        // Move to an edge and try one more move: a visible, recoverable boundary error.
        return Array(start.x-task.xMin+1).fill(click('[data-action="robot-left"]'));
      }
      break;
    case 'calendar':return [click(`.ag-calendar-day[data-day="${task.day===1?2:1}"]`),click('.ag-check')];
    case 'clock':return [...((task.startHour||0)===task.hour&&(task.startMinute||0)===task.minute?[click('[data-action="minute-plus"]')]:[]),click('.ag-check')];
    case 'measure':return [{selector:'.ag-measure-range',value:task.target===task.min?task.max:task.min},click('.ag-check')];
    default:return [click('.ag-check')];
  }
  throw new Error('No wrong attempt for '+task.mechanic);
}

try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(`${current}: ${error.message}`));
  page.on('console', msg => {if(msg.type()==='error')errors.push(`${current}: ${msg.text()}`);if(msg.type()==='warn')warnings.push(`${current}: ${msg.text()}`);});
  page.on('response', response => {if(response.status()>=400)errors.push(`${current}: HTTP${response.status()} ${response.url()}`);});
  await page.setViewport({width:360,height:800});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.goto(fixture.url);
  assert.match(await page.title(), /приключение/i);
  await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
  assert.match(await page.$eval('main',n=>n.textContent),/Волшебный лес чисел/,'meaningful page content');
  async function act(actions) {
    await page.evaluate(actions=>{
      for(const action of actions){
        const node=document.querySelector('#choices '+action.selector);
        if(!node)throw new Error('Missing real control: '+action.selector);
        if(node.disabled)throw new Error('Disabled real control: '+action.selector);
        if('value' in action){node.value=String(action.value);node.dispatchEvent(new Event('input',{bubbles:true}));}
        else node.click();
      }
    },actions);
  }
  async function open(level) {
    await page.waitForFunction(()=>!document.querySelector('#world').hidden&&!document.querySelector('#world').classList.contains('hidden'));
    await page.evaluate(number=>{
      const target=Math.ceil(number/5);
      for(let i=0;i<20;i++){
        const chapter=Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);
        if(chapter===target)break;
        document.querySelector(chapter>target?'#chapterPrev':'#chapterNext').click();
      }
      const node=Array.from(document.querySelectorAll('.node')).find(n=>Number(n.querySelector('.node-number').textContent)===number);
      if(!node||node.disabled)throw new Error('Level '+number+' is unavailable');
      node.click();
    },level.level);
    await page.waitForFunction(number=>document.querySelector('#choices.ag-root')?.dataset.level===String(number),{},level.level);
    assert.equal(await page.$eval('#choices',n=>n.dataset.round),'1');
  }
  async function overflow(label) {
    const details=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,
      nodes:[...document.querySelectorAll('#game button,#game input,#choices>div')].filter(n=>n.getClientRects().length).map(n=>({class:n.className,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})).filter(n=>n.left< -1||n.right>innerWidth+1)}));
    assert.ok(details.document<=details.width+1 && !details.nodes.length, `${label}: horizontal overflow ${JSON.stringify(details)}`);
  }
  async function picture(label) {
    const file=`/tmp/adventure-${label}.png`;await page.screenshot({path:file,fullPage:true});screenshots.push(file);
  }
  async function solveRound(task,level,index) {
    const expectedPosts=fixture.posts.length;
    assert.equal(await page.$eval('#choices',n=>n.dataset.round),String(index+1),`${level.level}: round advances once`);
    assert.equal(await page.$eval('#choices',n=>n.dataset.mechanic),task.mechanic);
    assert.equal(await page.$eval('#next',n=>n.classList.contains('hidden')),true,'continue is hidden until real completion');
    await act(solution(task));
    assert.equal(await page.$eval('#next',n=>n.classList.contains('hidden')),false,`L${level.level} R${index+1} ${task.mechanic}: solving controls must reveal Continue`);
    assert.equal(await page.$eval('#feedback',n=>n.dataset.kind),'success');
    assert.equal(fixture.posts.length,expectedPosts,'solving a round must not save the full game');
    // A second event on a solved scene cannot award or advance anything.
    await page.$eval('#choices',root=>{root.querySelector('button')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    assert.equal(await page.$eval('#choices',n=>n.dataset.round),String(index+1));
    if(index===4){const saved=page.waitForResponse(r=>r.url().endsWith('/api/math/adventure')&&r.request().method()==='POST');await page.$eval('#next',n=>n.click());assert.equal((await saved).status(),200);}
    else await page.$eval('#next',n=>n.click());
    completedRounds++;
  }

  // Partial progress, reset, hint, and leaving are exercised before any awards.
  current='partial game lifecycle';
  await open(levels[0]);
  await act([click('.ag-hint')]);
  assert.ok((await page.$eval('#feedback',n=>n.textContent)).length>10,'hint is visible');
  await act([click('.ag-piece')]);
  await page.$eval('.ag-piece',n=>{window.__detachedAdventureControl=n;});
  await act([click('.ag-reset')]);
  assert.equal(await page.$eval('.ag-scene',n=>n.dataset.value),'0','reset restores a fresh scene');
  await page.evaluate(()=>window.__detachedAdventureControl.click());
  assert.equal(await page.$eval('.ag-scene',n=>n.dataset.value),'0','reset removes old event handlers');
  await page.$eval('.ag-piece',n=>{window.__detachedAdventureControl=n;});
  await act([click('.ag-back')]);
  assert.equal(fixture.posts.length,0,'leaving an unfinished game sends no save');
  await open(levels[0]);
  await page.evaluate(()=>window.__detachedAdventureControl.click());
  assert.equal(await page.$eval('.ag-scene',n=>n.dataset.value),'0','exit removes old scene event handlers');
  await act([click('.ag-back')]);

  current='keyboard Continue and round focus';
  await open(levels[0]);
  await act(solution(levels[0].rounds[0]));
  assert.equal(await page.evaluate(()=>document.activeElement.id),'next','solving focuses Continue');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#choices',n=>n.dataset.round),'2','keyboard Continue advances one round');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'question','new round focuses the question');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('ag-piece')),true,'Tab enters the new interactive board');
  await act([click('.ag-back')]);

  current='solved round exit and stale Continue';
  await open(levels[0]);
  await act(solution(levels[0].rounds[0]));
  await page.$eval('#next',n=>{window.__exitedAdventureNext=n;});
  await page.$eval('.ag-check',n=>{window.__exitedAdventureCheck=n;});
  assert.equal(await page.$eval('.ag-back',n=>n.disabled),false,'map exit stays available after solving a round');
  await act([click('.ag-back')]);
  await page.evaluate(()=>{window.__exitedAdventureNext.click();window.__exitedAdventureCheck.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  assert.equal(fixture.posts.length,0,'exited solved scene and stale Continue cannot save');
  assert.equal(await page.$eval('#world',n=>n.hidden||n.classList.contains('hidden')),false,'stale Continue cannot leave the map');
  await open(levels[0]);
  await page.evaluate(()=>window.__exitedAdventureCheck.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.$eval('#choices',n=>n.dataset.round),'1','stale controls cannot advance a new scene');
  assert.equal(await page.$eval('#next',n=>n.classList.contains('hidden')),true,'stale controls cannot solve a new scene');
  await act([click('.ag-back')]);

  current='original first game after continuation exit';
  await page.evaluate(()=>{
    for(let n=0;n<20;n++)document.querySelector('#chapterPrev').click();
    const first=[...document.querySelectorAll('.node')].find(n=>n.querySelector('.node-number').textContent==='1');first.click();
  });
  assert.ok(await page.$$eval('.apple-pick',nodes=>nodes.length)>0,'the original orchard opens normally');
  assert.equal(await page.$$eval('.ag-tools',nodes=>nodes.length),0,'continuation tools are removed from the original games');
  assert.equal(await page.$eval('#choices',n=>n.classList.contains('ag-root')),false,'continuation classes are removed from the original games');
  const firstCounter=await page.$eval('#counter',n=>n.textContent);
  await page.evaluate(()=>window.__exitedAdventureNext.click());
  assert.equal(await page.$eval('#counter',n=>n.textContent),firstCounter,'stale Continue cannot skip an unanswered original round');
  await page.$eval('.apple-pick',n=>n.click());
  assert.equal(await page.$eval('#next',n=>n.classList.contains('hidden')),false,'the original orchard still solves with a real apple');
  await page.$eval('#next',n=>n.click());
  assert.match(await page.$eval('#counter',n=>n.textContent),/2 из 5/,'original Continue advances exactly one original round');
  assert.equal(fixture.posts.length,0,'partial original game is not saved');
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);

  for(const [number,scene,hint] of [[2,'.truck-scene','.apple-hint'],[3,'.neighbor-street','.apple-hint'],[4,'.number-path-scene','.path-hint'],[5,'.dragon-scene','.dragon-hint'],[6,'.resident-scene','.tens-hint']]){
    current=`original game ${number} after continuation exit`;
    await open(levels[0]);await act([click('.ag-back')]);
    await page.evaluate(number=>{
      const chapter=Math.ceil(number/5);
      for(let n=0;n<20;n++){
        const now=Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);
        if(now===chapter)break;document.querySelector(now>chapter?'#chapterPrev':'#chapterNext').click();
      }
      [...document.querySelectorAll('.node')].find(n=>Number(n.querySelector('.node-number').textContent)===number).click();
    },number);
    assert.ok(await page.$(scene),`original game ${number} retains its authored scene`);
    assert.equal(await page.$$eval('.ag-tools',nodes=>nodes.length),0,'continuation tools do not leak into originals');
    const before=await page.$eval('#feedback',n=>n.textContent);
    await page.$eval(hint,n=>n.click());
    assert.notEqual(await page.$eval('#feedback',n=>n.textContent),before,'the original hint still responds');
    assert.equal(fixture.posts.length,0,'opening and hinting the original scenes cannot save');
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
  }

  for(const level of levels){
    current=`level ${level.level}: ${level.title}`;
    // Rotate viewport coverage through every chapter, keeping most rounds mobile.
    const width=level.level%3===0?1280:level.level%3===1?360:412;
    await page.setViewport({width,height:width===1280?900:915});
    await open(level);
    const before=fixture.posts.length;
    for(let index=0;index<level.rounds.length;index++){
      const task=level.rounds[index];current=`L${level.level} R${index+1} ${task.mechanic}`;
      mechanics.add(task.mechanic);
      await overflow(current);
      if(!retried.has(task.mechanic)){
        await act(mistake(task));
        assert.equal(await page.$eval('#feedback',n=>n.dataset.kind),'error',`${current}: incorrect attempt should teach`);
        assert.equal(await page.$eval('#next',n=>n.classList.contains('hidden')),true,`${current}: wrong attempt cannot advance`);
        assert.ok(await page.$eval('#choices',n=>[...n.querySelectorAll('button,input')].some(n=>!n.disabled)),'wrong attempts retain controls');
        await act([click('.ag-hint')]);
        assert.notEqual(await page.$eval('#feedback',n=>n.dataset.kind),'error','hint responds after wrong answer');
        assert.equal(fixture.posts.length,before,'mistakes and hints cannot save');
        await act([click('.ag-reset')]);
        assert.equal(await page.$eval('#choices',n=>n.dataset.round),String(index+1),'reset preserves teaching round');
        if(['clock','calendar','coordinate','bars','fraction','compose'].includes(task.mechanic))await picture(`${task.mechanic}-${width}`);
        retried.add(task.mechanic);
      }
      await solveRound(task,level,index);
    }
    await page.waitForFunction(()=>!document.querySelector('#result').classList.contains('hidden'));
    assert.equal(fixture.posts.length,before+1,`${current}: game saves only once after all five rounds`);
    assert.deepEqual(fixture.posts.at(-1),{userId:'continuation-student',level:level.level-1,correct:10,total:10});
    // The POST response precedes the account recheck and UI acknowledgement.
    await page.waitForFunction(()=>/сервер|сохран/i.test(document.querySelector('#resultText').textContent));
    assert.match(await page.$eval('#resultText',n=>n.textContent),/сервер|сохран/i);
    await page.$eval('#return',n=>n.click());
    if(level.level%10===0)console.log(`✓ real controls completed games 7–${level.level}`);
  }
  assert.equal(completedRounds,470);
  assert.equal(mechanics.size,14,'all fourteen interactive mechanics exercised');
  assert.equal(retried.size,14,'every mechanic teaches and retries after a wrong attempt');
  assert.equal(fixture.progress().completed.length,100,'first six completions are preserved');
  assert.equal(fixture.progress().stars,300);

  current='replay completed game';
  const starsBefore=fixture.progress().stars;
  await open(levels[0]);
  for(let index=0;index<5;index++)await solveRound(levels[0].rounds[index],levels[0],index);
  assert.equal(fixture.progress().stars,starsBefore,'replaying awards no duplicate stars');
  await page.$eval('#return',n=>n.click());
  current='reload completed progress';
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
  assert.match(await page.$eval('#summary',n=>n.textContent),/300/,'server progress survives reload');
  current='final chapter map at 360px';
  await page.setViewport({width:360,height:800});
  await page.evaluate(()=>{for(let n=0;n<20;n++)document.querySelector('#chapterNext').click();});
  assert.match(await page.$eval('#chapterTitle',n=>n.textContent),/20 из 20/);
  const mapOverflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,
    clipped:[...document.querySelectorAll('.checkpoint-label')].map(n=>({text:n.textContent,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})).filter(n=>n.left< -1||n.right>innerWidth+1)}));
  assert.ok(mapOverflow.document<=mapOverflow.width+1&&!mapOverflow.clipped.length,'long final-chapter titles fit the mobile map: '+JSON.stringify(mapOverflow));
  await picture('map-chapter20-360');
  for(const width of [360,412,1280]){
    await page.setViewport({width,height:900});
    await open(levels.find(level=>level.rounds.some(task=>task.mechanic==='calendar')));
    await overflow(`final responsive game at ${width}`);
    await picture(`responsive-${width}`);
    await act([click('.ag-back')]);
  }
  assert.deepEqual(errors,[],'no browser errors or failed assets');
  assert.deepEqual(warnings,[],'no browser warnings');
  console.log(`PASS all 94 games × 5 rounds, all 14 mechanics, retries/hints/reset/back, cleanup, save/replay/reload, 360/412/1280px. Screenshots: ${screenshots.join(', ')}`);
} catch(error) {
  const page=(await browser.pages()).at(-1);
  if(page)await page.screenshot({path:'/tmp/adventure-levels-failure.png',fullPage:true}).catch(()=>{});
  console.error(`FAIL ${current}; screenshot /tmp/adventure-levels-failure.png; console: ${errors.join('; ')}`);
  throw error;
} finally {
  await browser.close();await fixture.close();
}
