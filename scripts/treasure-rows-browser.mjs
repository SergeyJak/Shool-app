import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';

// Browser plugin unavailable; exercise the real page through the existing Chromium fixture.
const chrome=[process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
const fixture=await adventureFixture({unlocked:99,completed:Array.from({length:15},(_,i)=>i),stars:45,startLevel:1});
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
const errors=[];
const shapes=[[3,2],[4,3],[5,4],[6,5],[6,6]];
try {
  async function open(width,height){
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
  const click=(page,selector)=>page.$eval(selector,node=>node.click());
  const fill=page=>page.$$eval('.ag-cell',cells=>cells.forEach(cell=>{if(cell.getAttribute('aria-pressed')!=='true')cell.click();}));
  const page=await open(360,800);
  assert.match(await page.$eval('.ag-grid-instruction',node=>node.textContent),/Нажимай на.*клетки/,'the game explicitly tells the learner how to place treasures');
  assert.doesNotMatch(await page.$eval('.ag-build-status',node=>node.textContent),/Площадь|Периметр/,'multiplication uses object counts, not untaught geometry');
  const cell=await page.$('.ag-cell');const emptyColor=await cell.evaluate(node=>getComputedStyle(node).backgroundColor);
  await cell.tap();assert.match(await cell.evaluate(node=>node.textContent),/💎/);
  assert.match(await page.$eval('.ag-build-status',node=>node.textContent),/1 из 6/);
  await cell.tap();assert.equal(await cell.evaluate(node=>node.textContent),'');
  assert.equal(await cell.evaluate(node=>getComputedStyle(node).backgroundColor),emptyColor,'a touch hover must not look like a selected treasure after removal');
  await page.$eval('.ag-cell',node=>node.focus());await page.keyboard.press('Space');
  assert.match(await page.$eval('.ag-cell',node=>node.textContent),/💎/,'keyboard can place a treasure');
  await page.keyboard.press('Space');assert.equal(await page.$eval('.ag-cell',node=>node.getAttribute('aria-pressed')),'false');
  await page.$$eval('.ag-cell[data-y="0"]',cells=>cells.forEach(cell=>cell.click()));
  assert.match(await page.$eval('.ag-build-status',node=>node.textContent),/Готово рядов: 1 из 2/);
  await click(page,'.ag-check');assert.equal(await page.$eval('#next',node=>node.classList.contains('hidden')),true);
  assert.match(await page.$eval('#feedback',node=>node.textContent),/Заполни все ряды/);
  await click(page,'.ag-hint');assert.equal(fixture.posts.length,0);
  await click(page,'.ag-reset');assert.equal(await page.$$eval('.ag-cell[aria-pressed="true"]',nodes=>nodes.length),0);
  for(let i=0;i<5;i++){
    const [cols,rows]=shapes[i];
    assert.equal(await page.$$eval('.ag-cell',nodes=>nodes.length),cols*rows);
    assert.match(await page.$eval('#question',node=>node.textContent),/Заполни/);
    assert.match(await page.$eval('.ag-build-status',node=>node.textContent),new RegExp('0 из '+cols*rows));
    await fill(page);
    assert.equal(await page.$$eval('.ag-cell',nodes=>nodes.filter(node=>node.textContent==='💎').length),cols*rows);
    assert.match(await page.$eval('.ag-build-status',node=>node.textContent),new RegExp('Готово рядов: '+rows+' из '+rows));
    await click(page,'.ag-check');assert.equal(await page.$eval('#feedback',node=>node.dataset.kind),'success');
    await click(page,'#next');
  }
  await page.waitForFunction(()=>document.querySelector('#resultText').textContent.includes('сервере'));
  assert.equal(fixture.posts.length,1);assert.equal(fixture.posts[0].level,15);
  assert.equal(fixture.progress().stars,48);
  await page.close();
  for(const [width,height] of [[320,568],[412,915],[1280,900]]){
    const page=await open(width,height);await fill(page);await click(page,'.ag-check');await click(page,'#next');
    assert.match(await page.$eval('#question',node=>node.textContent),/3 ряда.*по 4 сокровища в каждом/);
    await click(page,'.ag-cell');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,'the explanation and treasures fit '+width+'px');
    await page.screenshot({path:'/tmp/treasure-rows-'+width+'.png',fullPage:true});
    await page.close();
  }
  const geometry=await open(412,915);await click(geometry,'.ag-back');
  await geometry.evaluate(()=>{for(let i=0;i<7;i++)document.querySelector('#chapterNext').click();
    [...document.querySelectorAll('.node')].find(node=>node.querySelector('.node-number').textContent==='53').click();});
  assert.match(await geometry.$eval('.ag-build-status',node=>node.textContent),/Площадь: 0 кл.*Периметр: 0 сторон/);
  await click(geometry,'.ag-cell');
  assert.match(await geometry.$eval('.ag-build-status',node=>node.textContent),/Площадь: 1 кл.*Периметр: 4 сторон/);
  assert.deepEqual(errors,[]);
  console.log('PASS all five treasure rounds: clear action/row instructions, visible treasures/counts, touch undo/hover, keyboard, retry/hint/reset, save; 320/412/1280px; geometry retains area/perimeter');
} finally {await browser.close();await fixture.close();}
