import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { adventureFixture } from './support/adventure-fixture.mjs';

// Browser plugin not available; use the repository's existing Chromium workflow.
const chrome = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome, 'Chromium required');
const directory = process.env.MAP_SCREENSHOT_DIR || '/tmp/adventure-map-qa';
fs.mkdirSync(directory, { recursive: true });
const fixture = await adventureFixture();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
let progress, current = 'loading';
const issues = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (['error', 'warn'].includes(message.type())) issues.push(message.text()); });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().endsWith('/api/math/adventure') && request.method() === 'GET') {
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'continuation-student', progress, assessmentRequired: false }) });
    } else void request.continue();
  });
  async function open(chapter, slot = 0) {
    const active = chapter * 5 + slot;
    progress = { unlocked: 99, startLevel: 1, stars: 297, completed: Array.from({ length: 100 }, (_, i) => i).filter(i => i !== active) };
    await page.goto(fixture.url);
    await page.waitForFunction(() => document.querySelectorAll('.node').length === 5 && !document.querySelector('#world').hidden);
    await page.evaluate(target => {
      for (let i = 0; i < 20; i++) {
        const chapter = Number(document.querySelector('#chapterTitle').textContent.match(/\d+/)[0]) - 1;
        if (chapter === target) break;
        document.querySelector(chapter > target ? '#chapterPrev' : '#chapterNext').click();
      }
    }, chapter);
    await page.waitForFunction(number => document.querySelector('.map-owl-companion')?.closest('.node')?.querySelector('.node-number')?.textContent === String(number), {}, active + 1);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll('#world img')].map(image => image.decode().catch(() => {})));
      const scene = document.querySelector('#mapStage') || document.querySelector('#world');
      const image = new Image(); image.src = getComputedStyle(scene).backgroundImage.slice(5, -2);
      if (image.src && !image.complete) await image.decode().catch(() => {});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }
  async function inspect() {
    return page.evaluate(() => {
      const world = document.querySelector('#world'), stage = document.querySelector('#mapStage') || world;
      const bounds = stage.getBoundingClientRect();
      const rect = element => { const r = element.getBoundingClientRect(); return { x:r.left - bounds.left, y:r.top - bounds.top, w:r.width, h:r.height }; };
      const nodes = [...world.querySelectorAll('.node')];
      const boxes = nodes.flatMap(node => [{ kind:'badge', level:node.querySelector('.node-number').textContent, ...rect(node) },
        { kind:'caption', level:node.querySelector('.node-number').textContent, ...rect(node.querySelector('.checkpoint-label')) }]);
      const owl = world.querySelector('.map-owl-companion'); if (owl) boxes.push({ kind:'owl', ...rect(owl) });
      const outside = boxes.filter(r => r.x < -1 || r.y < -1 || r.x + r.w > bounds.width + 1 || r.y + r.h > bounds.height + 1);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x) > 1 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y) > 1) overlaps.push([a,b]);
      }
      const owlBox=boxes.find(r=>r.kind==='owl'), badges=boxes.filter(r=>r.kind==='badge');
      const owlDistance = r => Math.hypot(r.x+r.w/2-owlBox.x-owlBox.w/2,r.y+r.h/2-owlBox.y-owlBox.h/2);
      const owlLevel=owl.closest('.node').querySelector('.node-number').textContent;
      const nearest=badges.slice().sort((a,b)=>owlDistance(a)-owlDistance(b))[0];
      return { width:bounds.width, height:bounds.height, ratio:bounds.width / bounds.height, outside, overlaps,
        owlLevel,owlNearest:nearest.level,owlDistance:owlDistance(badges.find(r=>r.level===owlLevel)),
        horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1,
        numbers:nodes.map(node=>Number(node.querySelector('.node-number').textContent)),
        normalized:nodes.map(node=>{const r=rect(node);return [(r.x+r.w/2)/bounds.width,(r.y+r.h/2)/bounds.height];}) };
    });
  }
  const normalized = new Map();
  for (const [width,height] of [[360,800],[412,915],[1280,900],[320,568],[844,390]]) {
    await page.setViewport({ width,height });
    for (let chapter = 0; chapter < 20; chapter++) {
      current = `${width}×${height}, chapter ${chapter + 1}`;
      await open(chapter);
      const result = await inspect();
      assert.ok(Math.abs(result.ratio - 852/1846) < .001, `${current}: preserve the full artwork proportions, got ${result.ratio}`);
      assert.deepEqual(result.outside, [], `${current}: checkpoint decorations clipped`);
      assert.deepEqual(result.overlaps, [], `${current}: checkpoint decorations overlap`);
      assert.equal(result.owlNearest,result.owlLevel,`${current}: owl must stay beside its current checkpoint`);
      assert.ok(result.owlDistance<=96,`${current}: owl too far from its checkpoint (${result.owlDistance}px)`);
      assert.equal(result.horizontalOverflow, false, `${current}: horizontal page overflow`);
      assert.deepEqual(result.numbers, Array.from({length:5}, (_,i)=>chapter*5+i+1));
      const previous = normalized.get(chapter);
      if (previous) for(let i=0;i<5;i++) for(let axis=0;axis<2;axis++) assert.ok(Math.abs(previous[i][axis]-result.normalized[i][axis])<.002, `${current}: marker drifts off its illustrated platform after resizing`);
      else normalized.set(chapter,result.normalized);
      if ([360,1280].includes(width)) await page.$eval('#world', async element => element.scrollIntoView({block:'start',behavior:'instant'}));
      if ([360,1280].includes(width)) await (await page.$('#world')).screenshot({path:path.join(directory,`${width}-chapter-${String(chapter+1).padStart(2,'0')}.png`)});
    }
    console.log(`PASS all 20 maps at ${width}×${height}: full art, no collisions/clipping, stable anchors`);
  }
  await page.setViewport({width:360,height:800});
  for (let chapter=0;chapter<20;chapter++) for(let slot=1;slot<5;slot++) {
    current=`owl at chapter ${chapter+1}, checkpoint ${slot+1}`;
    await open(chapter,slot);const result=await inspect();
    assert.deepEqual(result.outside,[],current+': clipped companion');
    assert.deepEqual(result.overlaps,[],current+': companion overlaps a checkpoint');
    assert.equal(result.owlNearest,result.owlLevel,current+': companion appears beside another checkpoint');
    assert.ok(result.owlDistance<=96,current+': companion too far from its checkpoint');
  }
  current='chapter navigation and game entry';
  await open(1,1);
  await page.$$eval('.node',nodes=>nodes.find(node=>node.querySelector('.node-number').textContent==='7').click());
  await page.waitForFunction(()=>document.querySelector('#choices')?.dataset.level==='7');
  await page.$eval('.ag-back',node=>node.click());
  assert.match(await page.$eval('#chapterTitle',node=>node.textContent),/2 из 20/);
  assert.equal(fixture.posts.length,0,'repositioning/navigation cannot write progress');
  assert.deepEqual(issues,[],'clean browser console');
  console.log('PASS all 100 companion positions; game entry/return and progress preserved');
} catch(error) {
  const page=(await browser.pages()).at(-1);
  await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});
  console.error(`FAIL ${current}; evidence ${directory}/failure.png`);throw error;
} finally { await browser.close();await fixture.close(); }
