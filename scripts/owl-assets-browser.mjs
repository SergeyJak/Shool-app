import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';

// Browser plugin unavailable; verify actual served PNGs using the existing Chromium setup.
const files=fs.readdirSync(new URL('../public/assets/owl-mascot-pack/',import.meta.url)).filter(name=>/^owl-.*\.png$/.test(name)).sort();
assert.equal(files.length,24);
const chrome=[process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
const fixture=await adventureFixture();
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
const errors=[];
try {
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(fixture.url);
  const results=await page.evaluate(async files=>{
    return Promise.all(files.map(async name=>{
      const image=new Image();image.src='/assets/owl-mascot-pack/'+name;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      let borderMax=0,transparent=0,visible=0;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const alpha=pixels[(y*canvas.width+x)*4+3];
        if(x<16||y<16||x>=canvas.width-16||y>=canvas.height-16)borderMax=Math.max(borderMax,alpha);
        if(alpha===0)transparent++;if(alpha>32)visible++;
      }
      return {name,width:canvas.width,height:canvas.height,borderMax,transparent:transparent/(canvas.width*canvas.height),visible:visible/(canvas.width*canvas.height)};
    }));
  },files);
  for(const result of results){
    assert.equal(result.width,512,result.name);assert.equal(result.height,512,result.name);
    assert.equal(result.borderMax,0,result.name+': clean transparent padding, no neighbouring sprites or matte reaching the edge');
    assert.ok(result.transparent>.3,result.name+': substantial genuinely transparent background');
    assert.ok(result.visible>.08&&result.visible<.7,result.name+': character remains visible without a solid background rectangle');
  }
  await page.setViewport({width:412,height:915});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.waitForFunction(()=>document.querySelectorAll('.node').length===5&&!document.querySelector('#world').hidden);
  await page.evaluate(()=>{for(let i=0;i<18;i++)document.querySelector('#chapterPrev').click();
    [...document.querySelectorAll('.node')].find(node=>node.querySelector('.node-number').textContent==='7').click();});
  const helper=await page.$eval('.ag-helper',async image=>{await image.decode();return {width:image.naturalWidth,src:image.src};});
  assert.equal(helper.width,512);assert.match(helper.src,/v=20261106-cutout/);
  await page.$eval('.ag-hint',button=>button.click());
  await page.screenshot({path:'/tmp/owl-helper-mobile.png',fullPage:true});
  await page.setViewport({width:1280,height:900});
  await page.screenshot({path:'/tmp/owl-helper-desktop.png',fullPage:true});
  await page.$eval('.ag-back',button=>button.click());
  await page.evaluate(()=>{document.querySelector('#chapterPrev').click();document.querySelector('.node').click();});
  for(let round=0;round<5;round++){
    for(let n=0;n<round+1;n++)await page.$eval('.apple-pick:not(:disabled)',button=>button.click());
    await page.$eval('#next',button=>button.click());
  }
  await page.waitForFunction(()=>!document.querySelector('#result').classList.contains('hidden')&&document.querySelector('#resultText').textContent.includes('сервере'));
  const celebration=await page.$eval('.celebration-owl',async image=>{await image.decode();return {width:image.naturalWidth,src:image.src};});
  assert.equal(celebration.width,512);assert.match(celebration.src,/v=20261106-cutout/);
  await page.$eval('.level-celebration',async stage=>{await Promise.all(stage.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
  await page.setViewport({width:412,height:915});
  await page.screenshot({path:'/tmp/owl-celebration-mobile.png',fullPage:true});
  await page.setViewport({width:1000,height:1100});
  await page.setContent('<style>body{margin:0;font:12px system-ui;background:#e9e8e4}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:12px}.tile{padding:8px;text-align:center;border-radius:12px;background:#f5f0df}.tile:nth-child(even){background:#213c4c;color:white}img{width:170px;height:170px;object-fit:contain;max-width:100%}</style><main></main>');
  await page.evaluate(files=>{for(const name of files){const card=document.createElement('div');card.className='tile';const image=document.createElement('img');image.src='/assets/owl-mascot-pack/'+name;const label=document.createElement('div');label.textContent=name;card.append(image,label);document.querySelector('main').append(card);}},files);
  await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
  await page.screenshot({path:'/tmp/owl-cutouts-gallery.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS all 24 served owl PNGs: 512px, clean transparent border, visible subject, real alpha; light/dark gallery /tmp/owl-cutouts-gallery.png');
} finally {await browser.close();await fixture.close();}
