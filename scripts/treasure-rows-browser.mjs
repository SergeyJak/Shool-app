import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';

// Browser plugin unavailable; drive the production page through the existing HTTP fixture.
const chrome=[process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'Chrome/Chromium required');
const fixture=await adventureFixture({unlocked:99,completed:Array.from({length:15},(_,i)=>i),stars:45,startLevel:1});
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
const errors=[];
const shapes=[[3,2],[4,3],[5,4],[6,5],[6,6]];
const click=(page,selector)=>page.$eval(selector,node=>{if(node.disabled)throw new Error('Disabled control: '+node.className);node.click();});
const phase=page=>page.$eval('.ag-equal-groups',node=>node.dataset.phase);
async function expectPhase(page,expected){
  assert.equal(await phase(page),expected,`the learner is at the ${expected} step`);
  if(expected==='multiply')assert.equal(await page.$$eval('.ag-check',nodes=>nodes.length),0,'the multiplication choice itself completes the round');
}
const noContinue=async page=>assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),true,'Continue waits for the completed multiplication choice');
const setCount=(page,value)=>page.$eval('.ag-total-answer',(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
const fillRow=page=>page.$$eval('.ag-group-cell',cells=>cells.forEach(cell=>{if(cell.getAttribute('aria-pressed')!=='true')cell.click();}));
async function assertFits(page,label){
  const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,
    controls:[...document.querySelectorAll('#game button,#game input')].filter(node=>node.getClientRects().length).map(node=>({class:node.className,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})).filter(node=>node.left< -1||node.right>innerWidth+1)}));
  assert.ok(overflow.document<=overflow.width+1&&!overflow.controls.length,`${label}: ${JSON.stringify(overflow)}`);
}
async function chooseAddends(page,values){
  for(let index=0;index<values.length;index++){
    await click(page,`.ag-addend-slot[data-index="${index}"]`);
    await click(page,`.ag-addend-choice[data-value="${values[index]}"]`);
  }
}
async function noTotalRevealed(page,total){
  const visible=await page.evaluate(()=>['#question','.ag-equal-groups','#feedback'].map(selector=>document.querySelector(selector)?.innerText||'').join(' '));
  assert.doesNotMatch(visible,new RegExp(`(^|\\D)${total}(?!\\d)`),'counting instructions and hints do not reveal the total');
  const defaults=await page.$eval('.ag-total-answer',node=>[node.getAttribute('value'),node.getAttribute('placeholder'),node.getAttribute('aria-label'),node.getAttribute('aria-valuenow')].filter(Boolean).join(' '));
  assert.doesNotMatch(defaults,new RegExp(`(^|\\D)${total}(?!\\d)`),'the input has no answer in an accessible default');
}
async function buildGroups(page,cols,rows){
  await expectPhase(page,'row');
  assert.equal(await page.$$eval('.ag-group-cell',nodes=>nodes.length),cols,'only one editable row is offered');
  assert.equal(await page.$$eval('.ag-group-cell[data-y="0"]',nodes=>nodes.length),cols);
  assert.equal(await page.$eval('.ag-confirm-row',node=>node.disabled),true,'an incomplete row cannot be confirmed');
  await fillRow(page);
  assert.equal(await page.$eval('.ag-confirm-row',node=>node.disabled),false);
  await click(page,'.ag-confirm-row');await expectPhase(page,'groups');await noContinue(page);
  assert.equal(await page.$$eval('.ag-equal-row',nodes=>nodes.length),1);
  assert.equal(await page.$eval('.ag-remove-row',node=>node.disabled),true,'the first equal row cannot be removed');
  assert.equal(await page.$eval('.ag-finish-groups',node=>node.disabled),true,'one row is not the requested number of groups');
  for(let n=1;n<rows;n++)await click(page,'.ag-add-row');
  assert.equal(await page.$$eval('.ag-equal-row',nodes=>nodes.length),rows);
  assert.deepEqual(await page.$$eval('.ag-equal-row',nodes=>nodes.map(node=>node.querySelectorAll('.ag-group-diamond').length)),Array(rows).fill(cols),'every copy contains the same number of diamonds');
  assert.equal(await page.$$eval('.ag-group-cell',nodes=>nodes.length),0,'copied groups are read only');
  assert.equal(await page.$eval('.ag-finish-groups',node=>node.disabled),false);
  await click(page,'.ag-finish-groups');await expectPhase(page,'count');await noContinue(page);
  assert.equal(await page.$$eval('.ag-group-diamond',nodes=>nodes.length),cols*rows,'all diamonds remain visible for independent counting');
  assert.equal(await page.$eval('.ag-total-answer',node=>node.value),'','the learner enters the independently counted total');
  await noTotalRevealed(page,cols*rows);
}
async function finishRound(page,cols,rows){
  await setCount(page,cols*rows);await click(page,'.ag-check');await expectPhase(page,'addition');await noContinue(page);
  assert.equal(await page.$$eval('.ag-addend-slot',nodes=>nodes.length),rows,'one additive term represents each row');
  await chooseAddends(page,Array(rows).fill(cols));await click(page,'.ag-check');await expectPhase(page,'multiply');await noContinue(page);
  await click(page,`.ag-multiply-choice[data-expression="${rows}x${cols}"]`);await expectPhase(page,'solved');
  assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),false);
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success');
}
try {
  async function open(width=360,height=800){
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height,hasTouch:width<600,isMobile:width<600});
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.goto(fixture.url);
    await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
    await page.evaluate(()=>{for(let i=0;i<20;i++){
      const chapter=Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);if(chapter===4)break;
      document.querySelector(chapter>4?'#chapterPrev':'#chapterNext').click();
    }document.querySelector('.node').click();});
    await page.waitForFunction(()=>document.querySelector('#choices')?.dataset.level==='16');
    return page;
  }
  const page=await open();
  await expectPhase(page,'row'); // RED against the former fill-all board.
  const cell=await page.$('.ag-group-cell');const emptyColor=await cell.evaluate(node=>getComputedStyle(node).backgroundColor);
  await cell.tap();assert.match(await cell.evaluate(node=>node.textContent),/💎/);
  await cell.tap();assert.equal(await cell.evaluate(node=>node.textContent),'');
  assert.equal(await cell.evaluate(node=>getComputedStyle(node).backgroundColor),emptyColor,'touch removal restores the empty appearance');
  await cell.focus();await page.keyboard.press('Space');assert.match(await cell.evaluate(node=>node.textContent),/💎/,'keyboard places a diamond');
  await page.keyboard.press('Space');assert.equal(await cell.evaluate(node=>node.getAttribute('aria-pressed')),'false','keyboard removes a diamond');
  await page.evaluate(()=>window.__oldTreasureCell=document.querySelector('.ag-group-cell'));
  await click(page,'.ag-hint');assert.ok((await page.$eval('#feedback',node=>node.textContent)).length>10);
  await click(page,'.ag-reset');await page.evaluate(()=>window.__oldTreasureCell.click());
  assert.equal(await page.$$eval('.ag-group-cell[aria-pressed="true"]',nodes=>nodes.length),0,'reset detaches old row controls');
  await fillRow(page);await click(page,'.ag-confirm-row');await click(page,'.ag-add-row');await click(page,'.ag-remove-row');
  assert.equal(await page.$$eval('.ag-equal-row',nodes=>nodes.length),1,'undo removes one copied row');
  assert.equal(await page.$eval('.ag-finish-groups',node=>node.disabled),true,'undo restores the incomplete groups gate');
  await click(page,'.ag-add-row');await page.evaluate(()=>window.__oldAddRow=document.querySelector('.ag-add-row'));
  await click(page,'.ag-finish-groups');await page.evaluate(()=>window.__oldAddRow.click());
  await expectPhase(page,'count');assert.equal(await page.$$eval('.ag-equal-row',nodes=>nodes.length),2,'stale group controls cannot change the counting board');
  await click(page,'.ag-hint');await noTotalRevealed(page,6);
  await setCount(page,2);await click(page,'.ag-check');await expectPhase(page,'count');await noContinue(page);
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'error','the number of rows is not accepted as the diamond total');
  await noTotalRevealed(page,6);
  await setCount(page,'');await click(page,'.ag-check');await expectPhase(page,'count');
  await setCount(page,'abc');await click(page,'.ag-check');await expectPhase(page,'count');
  await page.evaluate(()=>{window.__oldCountInput=document.querySelector('.ag-total-answer');window.__oldCountCheck=document.querySelector('.ag-check');});
  await setCount(page,6);await page.$eval('.ag-total-answer',node=>node.focus());await page.keyboard.press('Enter');await expectPhase(page,'addition');await noContinue(page);
  await page.evaluate(()=>{window.__oldCountCheck.click();window.__oldCountInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
  await expectPhase(page,'addition');
  await chooseAddends(page,[2,3]);await click(page,'.ag-check');await expectPhase(page,'addition');await noContinue(page);
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'error','unequal terms cannot represent equal groups');
  await chooseAddends(page,[3,3]);await page.evaluate(()=>window.__oldAdditionCheck=document.querySelector('.ag-check'));
  await click(page,'.ag-check');await expectPhase(page,'multiply');
  await page.evaluate(()=>window.__oldAdditionCheck.click());await expectPhase(page,'multiply');await noContinue(page);
  const wrongExpression=await page.$$eval('.ag-multiply-choice',nodes=>nodes.find(node=>node.dataset.expression!=='2x3').dataset.expression);
  await click(page,`.ag-multiply-choice[data-expression="${wrongExpression}"]`);await expectPhase(page,'multiply');await noContinue(page);
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'error','a wrong multiplication choice remains retryable');
  await click(page,'.ag-hint');assert.equal(fixture.posts.length,0);
  await click(page,'.ag-reset');await expectPhase(page,'row');
  assert.equal(await page.$$eval('.ag-group-cell[aria-pressed="true"]',nodes=>nodes.length),0,'reset restarts the complete teaching sequence');
  await buildGroups(page,3,2);await page.evaluate(()=>window.__exitedCountCheck=document.querySelector('.ag-check'));
  await click(page,'.ag-back');await page.evaluate(()=>window.__exitedCountCheck.click());assert.equal(fixture.posts.length,0,'leaving a partially built sequence sends no save');
  await page.close();

  const rounds=await open();
  for(let index=0;index<shapes.length;index++){
    const [cols,rows]=shapes[index];await buildGroups(rounds,cols,rows);
    if(index===1){
      await setCount(rounds,12);await click(rounds,'.ag-check');await chooseAddends(rounds,[3,5,4]);await click(rounds,'.ag-check');
      await expectPhase(rounds,'addition');await noContinue(rounds);
      assert.equal(await rounds.$eval('#feedback',node=>node.dataset.kind),'error','3 + 5 + 4 = 12 does not represent three equal rows of four');
      await chooseAddends(rounds,[4,4,4]);await click(rounds,'.ag-check');await expectPhase(rounds,'multiply');
      await click(rounds,'.ag-multiply-choice[data-expression="3x4"]');await expectPhase(rounds,'solved');
    }else await finishRound(rounds,cols,rows);
    assert.equal(fixture.posts.length,0,'all five complete teaching rounds are required before saving');
    await click(rounds,'#next');
  }
  await rounds.waitForFunction(()=>document.querySelector('#resultText').textContent.includes('сервере'));
  assert.equal(fixture.posts.length,1);assert.deepEqual(fixture.posts[0],{userId:'continuation-student',level:15,correct:10,total:10});
  assert.equal(fixture.progress().stars,48);await rounds.close();

  for(const [width,height] of [[320,568],[412,915],[1280,900]]){
    const responsive=await open(width,height);
    await buildGroups(responsive,3,2);await finishRound(responsive,3,2);await click(responsive,'#next');
    await buildGroups(responsive,4,3);
    for(const step of ['count','addition','multiply']){
      await expectPhase(responsive,step);
      await assertFits(responsive,`${step} fits ${width}px`);
      await responsive.screenshot({path:`/tmp/equal-groups-${step}-${width}.png`,fullPage:true});
      if(step==='count'){await setCount(responsive,12);await click(responsive,'.ag-check');}
      if(step==='addition'){await chooseAddends(responsive,[4,4,4]);await click(responsive,'.ag-check');}
    }
    await responsive.close();
  }
  const largest=await open(320,568);
  for(const [cols,rows] of shapes.slice(0,4)){
    await buildGroups(largest,cols,rows);await finishRound(largest,cols,rows);await click(largest,'#next');
  }
  await buildGroups(largest,6,6);await setCount(largest,36);await click(largest,'.ag-check');await expectPhase(largest,'addition');
  await chooseAddends(largest,Array(6).fill(6));await assertFits(largest,'six equal terms fit 320px');
  assert.equal(await largest.$$eval('.ag-addend-slot',nodes=>nodes.length),6,'the largest round retains all six editable terms');
  const terms=await largest.$$eval('.ag-addend-slot',nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom};}));
  for(let index=1;index<terms.length;index++)assert.ok(terms[index].top>=terms[index-1].bottom||terms[index].left>=terms[index-1].right,'wrapped additive terms remain separate and readable');
  await largest.screenshot({path:'/tmp/equal-groups-addition-6x6-320.png',fullPage:true});await largest.close();
  const geometry=await open(412,915);await click(geometry,'.ag-back');
  await geometry.evaluate(()=>{for(let i=0;i<7;i++)document.querySelector('#chapterNext').click();
    [...document.querySelectorAll('.node')].find(node=>node.querySelector('.node-number').textContent==='53').click();});
  assert.match(await geometry.$eval('.ag-build-status',node=>node.textContent),/Площадь: 0 кл.*Периметр: 0 сторон/);
  await click(geometry,'.ag-cell');assert.match(await geometry.$eval('.ag-build-status',node=>node.textContent),/Площадь: 1 кл.*Периметр: 4 сторон/);
  await geometry.close();assert.deepEqual(errors,[],'no browser errors');
  console.log('PASS five equal-group rounds: build row, copy rows, independent total, repeated addition, multiplication; wrong answers, hints, keyboard, undo/reset/back/stale controls, save; 320/412/1280px; geometry retains area/perimeter');
} catch(error) {
  const page=(await browser.pages()).at(-1);if(page)await page.screenshot({path:'/tmp/equal-groups-failure.png',fullPage:true}).catch(()=>{});
  throw error;
} finally {await browser.close();await fixture.close();}
