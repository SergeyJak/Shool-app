import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';
import { assertAdventureFits } from './support/adventure-layout.mjs';

// Browser plugin unavailable; drive the production page through its real controls.
const chrome=[process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'Chrome/Chromium required');
const fixture=await adventureFixture();
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
const errors=[], layouts=[], captures=[];
const click=(page,selector)=>page.$eval(selector,node=>{if(node.disabled)throw new Error('Disabled control '+node.className);node.click();});
const input=(page,selector,value)=>page.$eval(selector,(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
const fields=['.ag-factor-first','.ag-factor-second','.ag-product-answer'];
async function values(page,entries){for(const [index,value] of entries.entries())await input(page,fields[index],value);}
async function snapshot(page,label){
  try{await assertAdventureFits(page,label);}catch(error){layouts.push(error.message);}
  const path=`/tmp/feedback-${label.replaceAll(/[^\w-]/g,'-')}.png`;
  await page.screenshot({path,fullPage:true});captures.push(path);
}
async function neutral(page,clearInvalid=true){
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'info');
  assert.doesNotMatch(await page.$eval('#feedback',node=>node.textContent),/Верно!|Попробуй ещё раз|[✓×]/,'instructions and hints are neutral');
  assert.equal(await page.$eval('#game',node=>node.dataset.answerState),'neutral','round state clears result treatment');
  if(clearInvalid)assert.equal(await page.$$eval('#choices [aria-invalid="true"]',nodes=>nodes.length),0,'new or reset rounds clear invalid fields');
}
async function result(page,kind,invalidFields=fields.slice(0,2)){
  const state=await page.evaluate(()=>{
    const feedback=document.querySelector('#feedback');
    const visible=node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&box.width>0&&box.height>0;};
    const icon=[...feedback.querySelectorAll('*')].find(node=>/^[✓×]$/.test(node.textContent.trim())&&visible(node));
    return {kind:feedback.dataset.kind,text:feedback.textContent,message:feedback.querySelector('.ag-feedback-message')?.textContent,frame:document.querySelector('#game').dataset.answerState,icon:icon?.textContent.trim(),iconHidden:icon?.getAttribute('aria-hidden'),live:feedback.getAttribute('aria-live')||(feedback.getAttribute('role')==='status'?'polite':null)};
  });
  assert.equal(state.kind,kind);
  assert.match(state.text,kind==='error'?/Попробуй ещё раз/:/Верно!/,'explicit answer result heading');
  assert.equal(state.icon,kind==='error'?'×':'✓','visible result icon distinguishes error and success');
  assert.equal(state.iconHidden,'true','decorative result icon does not repeat the live announcement');
  assert.equal(state.frame,kind);
  assert.equal(state.live,'polite');
  assert.ok(state.message?.length>15,'result retains the educational explanation');
  const colors=await page.evaluate(()=>{
    const rgb=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    const background=node=>{const style=getComputedStyle(node);return rgb(style.backgroundImage==='none'?style.backgroundColor:style.backgroundImage);};
    return {check:background(document.querySelector('.ag-check')),next:background(document.querySelector('#next'))};
  });
  if(kind==='error'){
    assert.ok(colors.check[0]>colors.check[1]*1.3&&colors.check[0]>colors.check[2]*1.3,'incorrect Check uses red treatment');
    const invalid=await page.$$eval(fields.join(','),nodes=>nodes.map(node=>({invalid:node.getAttribute('aria-invalid'),border:getComputedStyle(node).borderTopColor})));
    assert.equal(invalid.length,3);
    for(const [index,field] of invalid.entries()){if(invalidFields.includes(fields[index])){assert.equal(field.invalid,'true','incorrect transfer fields expose aria-invalid');const [r,g,b]=field.border.match(/[\d.]+/g).map(Number);assert.ok(r>g*1.3&&r>b*1.3,'incorrect fields have visible red borders');}else assert.notEqual(field.invalid,'true','valid fields avoid error treatment');}
    assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),true,'error cannot advance');
  }else{
    assert.ok(colors.next[1]>colors.next[0]*1.2&&colors.next[1]>colors.next[2]*1.2,'correct Continue uses green treatment');
    assert.equal(await page.$$eval('#choices [aria-invalid="true"]',nodes=>nodes.length),0,'success clears invalid state');
    assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),false);
  }
}
async function open(viewport){
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(['error','warn'].includes(message.type()))errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP ${response.status()} ${response.url()}`);});
  await page.setViewport({...viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.goto(fixture.url);
  await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
  await page.evaluate(()=>{for(let i=0;i<20;i++){const chapter=Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);if(chapter===4)break;document.querySelector(chapter>4?'#chapterPrev':'#chapterNext').click();}document.querySelector('.node').click();});
  await page.waitForFunction(()=>document.querySelector('#choices')?.dataset.level==='16');
  return page;
}
async function reachTransfer(page){
  await input(page,'.ag-number-answer',3);await click(page,'.ag-check');await click(page,'#next');
  await click(page,'.ag-add-row');await click(page,'.ag-add-row');await click(page,'.ag-finish-groups');await click(page,'#next');
  await input(page,'.ag-number-answer',20);await click(page,'.ag-check');await click(page,'#next');
  for(let index=0;index<3;index++){await click(page,`.ag-addend-slot[data-index="${index}"]`);await click(page,'.ag-addend-choice[data-value="4"]');}
  await click(page,'.ag-check');await click(page,'#next');
  assert.equal(await page.$eval('.ag-equal-groups',node=>node.dataset.lesson),'transfer');
}
try{
  for(const viewport of [{width:320,height:640},{width:360,height:640},{width:412,height:740},{width:1280,height:800}]){
    const page=await open(viewport), label=`${viewport.width}x${viewport.height}`;
    await reachTransfer(page);
    await snapshot(page,`transfer-initial-${label}`);
    await values(page,[5,5,25]);await click(page,'.ag-check');
    await snapshot(page,`transfer-error-${label}`);
    await result(page,'error');
    assert.equal(fixture.posts.length,0,'wrong answers cannot save');
    await click(page,'.ag-hint');await neutral(page,false);await snapshot(page,`transfer-hint-${label}`);
    assert.match(await page.$eval('#feedback',node=>node.textContent),/\S.{15}/,'hint keeps its teaching explanation');
    await values(page,[2,5,12]);await click(page,'.ag-check');await result(page,'error',[fields[2]]);
    await click(page,'.ag-reset');await neutral(page);
    assert.deepEqual(await page.$$eval(fields.join(','),nodes=>nodes.map(node=>node.value)),['','',''],'reset clears answers');
    await values(page,[5,2,10]);await page.$eval('.ag-product-answer',node=>node.focus());await page.keyboard.press('Enter');
    await result(page,'success');await snapshot(page,`transfer-solved-${label}`);
    assert.ok((await page.$eval('#feedback .ag-feedback-message',node=>node.textContent)).length>15,'success keeps its teaching explanation');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'next','keyboard success focuses Continue');
    assert.equal(fixture.posts.length,0,'solving does not save before Continue');
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
    const animated=await page.evaluate(()=>[...document.querySelectorAll('#feedback,#feedback *,#next')].some(node=>{const style=getComputedStyle(node);return style.animationName!=='none'&&style.animationDuration.split(',').some(value=>parseFloat(value)>.01);}));
    assert.equal(animated,false,'result cue respects reduced motion');
    assert.equal(await page.$$eval('dialog[open],[role="dialog"]',nodes=>nodes.filter(node=>node.getClientRects().length).length),0,'feedback stays inline');
    await click(page,'.ag-back');await page.close();
    // A successful round must be cleared when the next task is rendered.
    const transition=await open(viewport);
    await input(transition,'.ag-number-answer',3);await click(transition,'.ag-check');
    await transition.keyboard.press('Enter');
    assert.equal(await transition.$eval('#choices',node=>node.dataset.round),'2');await neutral(transition);
    assert.equal(fixture.posts.length,0,'partial work and keyboard continuation cannot save');
    await click(transition,'.ag-back');await transition.close();
  }
  fs.writeFileSync('/tmp/feedback-layout-failures.json',JSON.stringify(layouts,null,2));
  assert.deepEqual(errors,[],'no browser errors, warnings, or failed assets');
  assert.equal(layouts.length,0,`${layouts.length} layout failures: ${layouts.join('\n')}`);
  console.log(`PASS explicit incorrect/correct icons, headings, red invalid inputs, green Continue; neutral hints/reset/round transition; keyboard, no-save, reduced motion; initial/hint/error/solved at four viewports. Screenshots: ${captures.join(', ')}`);
}catch(error){fs.writeFileSync('/tmp/feedback-layout-failures.json',JSON.stringify(layouts,null,2));console.error(error);process.exitCode=1;}
finally{await browser.close();await fixture.close();}
