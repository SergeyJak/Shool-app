import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';
import { assertAdventureFits } from './support/adventure-layout.mjs';

// Browser plugin not available; use the repository's installed Chromium fixture.
const fixture = await adventureFixture();
const browser = await puppeteer.launch({ executablePath:process.env.CHROME_BIN || '/usr/bin/chromium', headless:true, args:['--no-sandbox','--disable-gpu'] });
const errors = [], failures = [];
const tap = (page,selector) => page.$eval(selector,node=>node.click());
async function choose(page,selector,text) {
  await page.$$eval(selector,(nodes,text)=>{
    const node=nodes.find(node=>node.textContent.trim()===String(text));
    if(!node)throw new Error('Missing answer '+text);node.click();
  },text);
}
async function fit(page,label) {
  try { await assertAdventureFits(page,label); }
  catch(error) { failures.push(error.message);if(!failures.slice(0,-1).some(item=>item.split(':')[0]===label.split(':')[0]))await page.screenshot({path:`/tmp/original-layout-${label.split(':')[0]}.png`,fullPage:true}); }
}
try {
  for(const viewport of [{width:320,height:640},{width:360,height:640},{width:412,height:740},{width:1280,height:800}]) {
    for(let level=1;level<=6;level++) {
      const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
      await page.setViewport({...viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
      await page.goto(fixture.url);await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
      await page.evaluate(level=>{
        for(let i=0;i<20;i++){
          const chapter=Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]),target=Math.ceil(level/5);
          if(chapter===target)break;document.querySelector(chapter>target?'#chapterPrev':'#chapterNext').click();
        }
        [...document.querySelectorAll('.node')].find(node=>Number(node.querySelector('.node-number').textContent)===level).click();
      },level);
      assert.equal(await page.$eval('#game',node=>node.classList.contains('hidden')),false);
      for(let round=0;round<(level===5?4:5);round++) {
        const label=`L${level}-${viewport.width}:round${round+1}`;
        await fit(page,label+' initial');
        await tap(page,'.apple-hint,.path-hint,.dragon-hint,.tens-hint');await fit(page,label+' hint');
        if(level===1)for(let i=0;i<round+1;i++)await tap(page,'.apple-pick:not(:disabled)');
        if(level===2)for(let i=0;i<[2,3,4,5,7][round];i++)await tap(page,'.bridge-plank:not(.removed)');
        if(level===3){const center=[4,7,12,19,28][round];await choose(page,'.neighbor-tile',center-1);await choose(page,'.neighbor-tile',center+1);}
        if(level===4)await choose(page,'.path-choice',[3,8,10,30,12][round]);
        if(level===5){
          if(round<2)for(let i=0;i<3;i++)await page.$$eval('.dragon-key',(nodes,i)=>nodes[i].click(),i);
          else if(round===2){await choose(page,'.dragon-key',8);await choose(page,'.dragon-key',10);}
          else await choose(page,'.dragon-key',6);
          await tap(page,'.dragon-check');
        }
        if(level===6){
          const total=[23,34,46,57,68][round];
          for(let i=0;i<Math.floor(total/10);i++)await tap(page,'.resident-button[aria-label="Заселить десять жителей"]');
          for(let i=0;i<total%10;i++)await tap(page,'.resident-button[aria-label="Заселить одного жителя"]');
        }
        await page.waitForFunction(()=>!document.querySelector('#next').classList.contains('hidden'));
        // Let reduced-motion completion styles settle, including basket delivery.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await fit(page,label+' solved');
        if(round===0&&viewport.width===360)await page.screenshot({path:`/tmp/original-compact-${level}-360.png`});
        await tap(page,'#next');
      }
      await page.waitForFunction(()=>!document.querySelector('#result').classList.contains('hidden'));await page.close();
    }
  }
  assert.deepEqual(errors,[],'no page or console errors');
  if(failures.length)console.error(failures.join('\n'));
  assert.equal(failures.length,0,'all six original games fit the viewport');
  console.log('PASS six original games, all 29 rounds × four viewports, initial/hint/solved states, real answers and Continue, no scrolling/clipping/overlap');
} finally { await browser.close();await fixture.close(); }
