import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';
import { assertAdventureFits } from './support/adventure-layout.mjs';

// Exercise the production page through the existing local HTTP/Chromium fixture.
const chrome=[process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'Chrome/Chromium required');
const fixture=await adventureFixture({unlocked:99,completed:Array.from({length:15},(_,i)=>i),stars:45,startLevel:1});
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
const errors=[];
const warnings=[];
const lessons=['row-count','build-groups','total','addition','transfer'];
const click=(page,selector)=>page.$eval(selector,node=>{if(node.disabled)throw new Error('Disabled control: '+node.className);node.click();});
const input=(page,selector,value)=>page.$eval(selector,(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
const noContinue=async page=>assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),true,'each objective must be completed before Continue');
async function expectLesson(page,lesson,solved=false){
  assert.deepEqual(await page.$eval('.ag-equal-groups',node=>({lesson:node.dataset.lesson,phase:node.dataset.phase})),{lesson,phase:solved?'solved':'lesson'});
  if(!solved)await noContinue(page);
}
async function assertFits(page,label){
  await assertAdventureFits(page,label);
}
async function assertContinueClear(page,label){
  const overlap=await page.evaluate(()=>{
    const next=document.querySelector('#next').getBoundingClientRect();
    return ['#feedback','.ag-tools'].flatMap(selector=>{
      const node=document.querySelector(selector);if(!node?.getClientRects().length)return [];
      const box=node.getBoundingClientRect();
      return Math.min(next.right,box.right)-Math.max(next.left,box.left)>1&&Math.min(next.bottom,box.bottom)-Math.max(next.top,box.top)>1?[selector]:[];
    });
  });
  assert.deepEqual(overlap,[],`${label}: Continue must not cover the explanation or tools`);
}
async function noAnswerRevealed(page,answer){
  const visible=await page.evaluate(()=>['#question','.ag-equal-groups','#feedback'].map(selector=>document.querySelector(selector)?.innerText||'').join(' '));
  assert.doesNotMatch(visible,new RegExp(`(^|\\D)${answer}(?!\\d)`),'the picture, instructions and method hint do not give the answer');
  const defaults=await page.$$eval('.ag-equal-groups input',nodes=>nodes.map(node=>[node.defaultValue,node.getAttribute('placeholder'),node.getAttribute('aria-label'),node.getAttribute('aria-valuenow')].filter(Boolean).join(' ')).join(' '));
  assert.doesNotMatch(defaults,new RegExp(`(^|\\D)${answer}(?!\\d)`),'accessible input defaults do not give the answer');
}
async function methodHint(page){
  await click(page,'.ag-hint');
  assert.doesNotMatch(await page.$eval('#feedback',node=>node.textContent),/\d/,'optional hints describe a method without giving numeric answers or factors');
}
async function chooseAddends(page,values){
  for(let index=0;index<values.length;index++){
    await click(page,`.ag-addend-slot[data-index="${index}"]`);await click(page,`.ag-addend-choice[data-value="${values[index]}"]`);
  }
}
async function solve(page,lesson,reverse=false){
  if(lesson==='row-count'||lesson==='total'){
    await input(page,'.ag-number-answer',lesson==='row-count'?3:20);await click(page,'.ag-check');
  }else if(lesson==='build-groups'){
    await click(page,'.ag-add-row');await click(page,'.ag-add-row');await click(page,'.ag-finish-groups');
  }else if(lesson==='addition'){
    await chooseAddends(page,[4,4,4]);await click(page,'.ag-check');
  }else{
    await input(page,'.ag-factor-first',reverse?5:2);await input(page,'.ag-factor-second',reverse?2:5);await input(page,'.ag-product-answer',10);await click(page,'.ag-check');
  }
  await expectLesson(page,lesson,true);
  assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),false,'this objective alone finishes its round');
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success');
}
async function open(width=360,height=800){
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warn')warnings.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP${response.status()} ${response.url()}`);});
  await page.setViewport({width,height,hasTouch:width<600,isMobile:width<600});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.goto(fixture.url);
  await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
  await page.evaluate(()=>{for(let i=0;i<20;i++){
    const chapter=Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]);if(chapter===4)break;
    document.querySelector(chapter>4?'#chapterPrev':'#chapterNext').click();
  }document.querySelector('.node').click();});
  await page.waitForFunction(()=>document.querySelector('#choices')?.dataset.level==='16');return page;
}
async function checkPicture(page,cols,rows){
  assert.equal(await page.$$eval('.ag-equal-row',nodes=>nodes.length),rows);
  assert.deepEqual(await page.$$eval('.ag-equal-row',nodes=>nodes.map(node=>node.querySelectorAll('.ag-group-diamond').length)),Array(rows).fill(cols));
  assert.equal(await page.$$eval('.ag-group-cell',nodes=>nodes.length),0,'the learner can count a static picture without placing every object');
  assert.deepEqual(await page.$$eval('.ag-group-diamond',nodes=>[...new Set(nodes.map(node=>node.getAttribute('aria-label')))]),['Алмаз']);
  assert.equal(await page.$$eval('.ag-group-diamond',nodes=>nodes.every(node=>node.getAttribute('role')==='img')),true);
  const labels=await page.$$eval('.ag-equal-row',nodes=>nodes.map(node=>node.getAttribute('aria-label')));
  assert.ok(labels.every((label,index)=>label===`Ряд ${index+1}`||(index===0&&label==='Ряд 1. Выделенный ряд.')),'accessible rows identify each row and its highlight without giving its quantity');
}
async function wrongCheck(page,lesson){
  await click(page,'.ag-check');await expectLesson(page,lesson);
  assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'error','wrong answers teach without advancing');
}
try{
  const page=await open();
  await expectLesson(page,'row-count'); // RED against the former repeated full-chain activity.
  await assertFits(page,'row-count initial 360x800');
  await checkPicture(page,3,2);
  assert.equal(await page.$$eval('.ag-row-highlight',nodes=>nodes.length),1,'only the row being counted is highlighted');
  assert.equal(await page.$eval('.ag-row-highlight',node=>node.closest('.ag-equal-row')===document.querySelector('.ag-equal-row')),true,'the upper row is highlighted');
  assert.equal(await page.$$eval('.ag-group-guide',nodes=>nodes.length),1);
  assert.equal(await page.$eval('.ag-number-answer',node=>node.type),'text');
  await noAnswerRevealed(page,3);
  await input(page,'.ag-number-answer',6);await wrongCheck(page,'row-count');await noAnswerRevealed(page,3);
  for(const value of ['', 'abc', '-1', '2.5']){await input(page,'.ag-number-answer',value);await wrongCheck(page,'row-count');}
  await methodHint(page);await noAnswerRevealed(page,3);
  await page.evaluate(()=>window.__oldCount=document.querySelector('.ag-check'));
  await click(page,'.ag-reset');await page.evaluate(()=>window.__oldCount.click());await expectLesson(page,'row-count');
  assert.equal(await page.$eval('.ag-number-answer',node=>node.value),'','reset starts a fresh objective');
  await page.evaluate(()=>window.__exitedCount=document.querySelector('.ag-check'));await click(page,'.ag-back');await page.evaluate(()=>window.__exitedCount.click());
  assert.equal(fixture.posts.length,0,'leaving an unfinished objective sends no save');await page.close();

  const rounds=await open();
  await input(rounds,'.ag-number-answer',3);await rounds.$eval('.ag-number-answer',node=>node.focus());await rounds.keyboard.press('Enter');await expectLesson(rounds,'row-count',true);
  await rounds.evaluate(()=>window.__solvedRowCheck=document.querySelector('.ag-check'));
  assert.equal(fixture.posts.length,0);await click(rounds,'#next');await expectLesson(rounds,'build-groups');
  await rounds.evaluate(()=>window.__solvedRowCheck.click());await expectLesson(rounds,'build-groups');
  assert.equal(await rounds.$$eval('.ag-group-guide',nodes=>nodes.length),1);await checkPicture(rounds,4,1);
  assert.equal(await rounds.$eval('.ag-remove-row',node=>node.disabled),true,'one ready row is retained');
  assert.equal(await rounds.$eval('.ag-finish-groups',node=>node.disabled),true);
  await click(rounds,'.ag-add-row');await click(rounds,'.ag-remove-row');await checkPicture(rounds,4,1);
  assert.equal(await rounds.$eval('.ag-finish-groups',node=>node.disabled),true,'undo restores the incomplete grouping gate');
  await rounds.$eval('.ag-add-row',node=>node.focus());await rounds.keyboard.press('Space');await checkPicture(rounds,4,2);
  await click(rounds,'.ag-add-row');await checkPicture(rounds,4,3);
  await rounds.evaluate(()=>window.__oldAdd=document.querySelector('.ag-add-row'));
  await click(rounds,'.ag-finish-groups');await expectLesson(rounds,'build-groups',true);
  assert.equal(await rounds.$$eval('.ag-number-answer,.ag-addend-slot,.ag-multiply-choice',nodes=>nodes.length),0,'grouping finishes without a forced count or expression chain');
  assert.equal(fixture.posts.length,0);await click(rounds,'#next');await expectLesson(rounds,'total');
  await rounds.evaluate(()=>window.__oldAdd.click());await checkPicture(rounds,5,4);await expectLesson(rounds,'total');
  assert.equal(await rounds.$$eval('.ag-group-guide',nodes=>nodes.length),0,'persistent guidance fades after the first two objectives');
  await noAnswerRevealed(rounds,20);await methodHint(rounds);await noAnswerRevealed(rounds,20);
  await input(rounds,'.ag-number-answer',4);await wrongCheck(rounds,'total');await noAnswerRevealed(rounds,20);
  await solve(rounds,'total');assert.equal(fixture.posts.length,0);await click(rounds,'#next');await expectLesson(rounds,'addition');
  await checkPicture(rounds,4,3);assert.equal(await rounds.$$eval('.ag-group-guide',nodes=>nodes.length),0);
  assert.match(await rounds.$eval('.ag-expression-result',node=>node.textContent),/=\s*\?/);await noAnswerRevealed(rounds,12);
  await methodHint(rounds);await noAnswerRevealed(rounds,12);
  await chooseAddends(rounds,[3,5,4]);await wrongCheck(rounds,'addition');
  assert.match(await rounds.$eval('.ag-expression-result',node=>node.textContent),/=\s*\?/,'an equal total with unequal terms does not reveal the answer');
  await solve(rounds,'addition');assert.match(await rounds.$eval('.ag-expression-result',node=>node.textContent),/=\s*12/);
  assert.equal(await rounds.$$eval('.ag-multiply-choice',nodes=>nodes.length),0,'addition itself completes this objective');
  assert.equal(fixture.posts.length,0);await click(rounds,'#next');await expectLesson(rounds,'transfer');
  assert.equal(await rounds.$$eval('.ag-group-guide,.ag-equal-row,.ag-addend-slot,.ag-multiply-choice',nodes=>nodes.length),0,'the new picture has no row or addition scaffold or answer choices');
  assert.equal(await rounds.$$eval('.ag-transfer-basket',nodes=>nodes.length),2);
  assert.deepEqual(await rounds.$$eval('.ag-transfer-basket',nodes=>nodes.map(node=>node.querySelectorAll('.ag-basket-item').length)),[5,5]);
  assert.doesNotMatch(await rounds.$$eval('.ag-transfer-basket',nodes=>nodes.map(node=>node.getAttribute('aria-label')||'').join(' ')),/(^|\D)5(?!\d)/,'accessible basket labels do not state the number of apples');
  assert.equal(await rounds.$$eval('.ag-basket-item',nodes=>nodes.every(node=>node.getAttribute('role')==='img'&&node.getAttribute('aria-label')==='Яблоко')),true,'apples have item labels without numeric quantities');
  assert.doesNotMatch(await rounds.$eval('.ag-equal-groups',node=>node.innerText),/\d+\s*\+\s*\d+/,'the transfer picture does not supply a worked addition');
  assert.equal(await rounds.$$eval('.ag-factor-first,.ag-factor-second,.ag-product-answer',nodes=>nodes.every(node=>node.value===''&&node.type==='text')),true);
  await noAnswerRevealed(rounds,10);await methodHint(rounds);await noAnswerRevealed(rounds,10);
  for(const values of [[1,10,10],[2,5,12],['abc',5,10],[2,'',10]]){
    for(const [index,selector] of ['.ag-factor-first','.ag-factor-second','.ag-product-answer'].entries())await input(rounds,selector,values[index]);
    await wrongCheck(rounds,'transfer');await noAnswerRevealed(rounds,10);
  }
  await rounds.evaluate(()=>window.__oldTransfer=document.querySelector('.ag-check'));await click(rounds,'.ag-reset');await rounds.evaluate(()=>window.__oldTransfer.click());await expectLesson(rounds,'transfer');
  await input(rounds,'.ag-factor-first',5);await input(rounds,'.ag-factor-second',2);await input(rounds,'.ag-product-answer',10);await rounds.$eval('.ag-product-answer',node=>node.focus());await rounds.keyboard.press('Enter');await expectLesson(rounds,'transfer',true);
  assert.equal(fixture.posts.length,0,'all five objectives must finish before saving');await click(rounds,'#next');
  await rounds.waitForFunction(()=>document.querySelector('#resultText').textContent.includes('сервере'));
  assert.deepEqual(fixture.posts,[{userId:'continuation-student',level:15,correct:10,total:10}]);assert.equal(fixture.progress().stars,48);await rounds.close();

  for(const [width,height] of [[320,640],[360,640],[412,740],[1280,800]]){
    const responsive=await open(width,height);
    for(const [index,lesson] of lessons.entries()){
      await expectLesson(responsive,lesson);await assertFits(responsive,`${lesson} fits ${width}px`);
      await methodHint(responsive);await assertFits(responsive,`${lesson} hint fits ${width}x${height}`);
      if(lesson==='build-groups'){
        assert.equal(await responsive.$eval('.ag-finish-groups',node=>node.disabled),true,'incomplete grouping has no erroneous submission');
        await click(responsive,'.ag-add-row');await assertFits(responsive,`${lesson} partial fits ${width}x${height}`);
        await click(responsive,'.ag-remove-row');
      }else{
        await wrongCheck(responsive,lesson);await assertFits(responsive,`${lesson} error fits ${width}x${height}`);
      }
      assert.equal(await responsive.$$eval('.ag-group-guide',nodes=>nodes.length),index<2?1:0,'only the first two objectives have persistent guidance');
      await responsive.screenshot({path:`/tmp/scaffold-${lesson}-${width}.png`,fullPage:true});
      await solve(responsive,lesson);await assertFits(responsive,`${lesson} solved fits ${width}px`);await assertContinueClear(responsive,`${lesson} at ${width}px`);
      if(lesson==='transfer')await responsive.screenshot({path:`/tmp/scaffold-transfer-solved-${width}.png`,fullPage:true});
      await click(responsive,'#next');
    }
    await responsive.waitForFunction(()=>document.querySelector('#resultText').textContent.includes('сервере'));await responsive.close();
  }
  assert.equal(fixture.posts.length,5,'each full replay saves once');assert.equal(fixture.progress().stars,48,'replay awards no duplicate stars');
  const geometry=await open(412,915);await click(geometry,'.ag-back');
  await geometry.evaluate(()=>{for(let i=0;i<7;i++)document.querySelector('#chapterNext').click();[...document.querySelectorAll('.node')].find(node=>node.querySelector('.node-number').textContent==='53').click();});
  assert.match(await geometry.$eval('.ag-build-status',node=>node.textContent),/Площадь: 0 кл.*Периметр: 0 сторон/);await click(geometry,'.ag-cell');
  assert.match(await geometry.$eval('.ag-build-status',node=>node.textContent),/Площадь: 1 кл.*Периметр: 4 сторон/);await geometry.close();
  assert.deepEqual(errors,[],'no browser errors');
  assert.deepEqual(warnings,[],'no browser warnings');
  console.log('PASS five distinct fading-support objectives; row/total confusion, grouping undo, equal-term addition, new-picture transfer in both factor orders, retry/hints/keyboard/reset/back/stale controls/save/replay; initial/hint/error/solved layouts at320×640/360×640/412×740/1280×800; geometry intact');
}catch(error){
  const page=(await browser.pages()).at(-1);if(page)await page.screenshot({path:'/tmp/scaffold-failure.png',fullPage:true}).catch(()=>{});throw error;
}finally{await browser.close();await fixture.close();}
