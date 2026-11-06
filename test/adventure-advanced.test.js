const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const source = path.resolve(__dirname, '../public/adventure/mechanics-advanced.js');
const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);

// These tests use Chromium's real DOM and real click/input events. The context
// is the production runner's narrow boundary, including its solved guard.
test('advanced games remain teachable and solvable through real DOM controls', async t => {
  assert.ok(fs.existsSync(source), 'advanced renderers must exist');
  const exported = require(source);
  assert.deepEqual(Object.keys(exported).sort(), ['bars','calendar','clock','coordinate','match','measure','sequence','sort']);
  assert.ok(chrome, 'Chromium is required for interactive adventure verification');
  const browser = await puppeteer.launch({executablePath: chrome, headless: true, args:['--no-sandbox', '--disable-gpu']});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({width:360,height:800});
  await page.setContent('<main id="board"></main><p id="feedback" role="status"></p>');
  await page.addScriptTag({path:source});
  async function mount(task) {
    await page.evaluate(task => {
      const root = document.querySelector('#board');
      root.replaceChildren(); root.removeAttribute('data-mechanic');
      window.solved = 0; window.hint = null;
      const listen = (node,event,handler) => node.addEventListener(event, e => {if(!window.solved)handler(e);});
      const el = (tag, cls, text) => {const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
      const ctx={root,task,level:{level:7},el,listen,
        button(text,fn,cls='ag-control'){const b=el('button',cls,text);b.type='button';b.setAttribute('aria-label',text);listen(b,'click',fn);return b;},
        feedback(text,kind='info'){document.querySelector('#feedback').textContent=text;window.feedbackKind=kind;},
        solve(){window.solved++;root.querySelectorAll('button,input').forEach(n=>n.disabled=true);},
        setHint(fn){window.hint=fn;},format(v,s=1){return String(v/s).replace('.',',');}};
      window.AdventureMechanics[task.mechanic](ctx);
    }, {prompt:'Задание',hint:'Подсказка',explanation:'Объяснение',...task});
  }
  const click = selector => page.$eval(selector, n => n.click());
  const solved = () => page.evaluate(() => window.solved);
  const wrong = async () => {assert.equal(await solved(),0);assert.equal(await page.evaluate(()=>window.feedbackKind),'error');};
  await t.test('clock has rotating hands, independent hour/minute controls, and retry', async()=>{
    await mount({mechanic:'clock',hour:15,minute:10,startHour:14,startMinute:0});
    assert.equal(await page.$$eval('.ag-clock-hand',n=>n.length),2);
    await click('.ag-check'); await wrong();
    await click('[data-action="hour-plus"]');
    await click('[data-action="minute-plus"]'); await click('[data-action="minute-plus"]');
    await click('.ag-check'); assert.equal(await solved(),1);
  });
  await t.test('calendar uses real Monday-first dates and leap days',async()=>{
    await mount({mechanic:'calendar',year:2024,month:2,day:29});
    assert.equal(await page.$$eval('.ag-calendar-day',n=>n.length),29);
    assert.equal(await page.$$eval('.ag-calendar-empty',n=>n.length),3);
    await click('[data-day="28"]'); await click('.ag-check'); await wrong();
    await click('[data-day="29"]'); await click('.ag-check'); assert.equal(await solved(),1);
  });
  await t.test('match cards recover after a wrong pair and complete each real pair',async()=>{
    await mount({mechanic:'match',pairs:[{id:'a',left:'2+2',right:'4'},{id:'b',left:'3+3',right:'6'}]});
    await click('.ag-match-card[data-side="left"][data-card-index="0"]');
    await click('.ag-match-card[data-side="right"][data-card-index="0"]'); await wrong();
    await click('.ag-match-card[data-side="right"][data-card-index="1"]');
    await click('.ag-match-card[data-side="left"][data-card-index="1"]');
    await click('.ag-match-card[data-side="right"][data-card-index="0"]');
    assert.equal(await solved(),1);
  });
  await t.test('sort retains an incorrectly placed item and moves each item into its bin',async()=>{
    await mount({mechanic:'sort',bins:[{id:'even',label:'Чётные'},{id:'odd',label:'Нечётные'}],items:[{id:'a',label:'2',bin:'even'},{id:'b',label:'3',bin:'odd'},{id:'c',label:'4',bin:'even'}]});
    await click('[data-item="a"]');await click('[data-bin="odd"]');await wrong();
    await click('[data-bin="even"]');
    for(const [id,bin] of [['b','odd'],['c','even']]){await click(`[data-item="${id}"]`);await click(`[data-bin="${bin}"]`);}
    assert.equal(await page.$$eval('.ag-sort-bin [data-item]',n=>n.length),3);assert.equal(await solved(),1);
  });
  await t.test('sequence slots accept reusable tiles and preserve wrong attempts',async()=>{
    await mount({mechanic:'sequence',terms:[1,null,3,null],solution:[1,2,3,4],choices:[2,4,7]});
    await click('[data-index="1"].ag-sequence-slot');await click('[data-choice="2"]');
    await click('[data-index="3"].ag-sequence-slot');await click('[data-choice="1"]');await click('.ag-check');await wrong();
    await click('[data-index="1"].ag-sequence-slot');await click('[data-choice="0"]');await click('.ag-check');assert.equal(await solved(),1);
  });
  await t.test('coordinate plane is y-up, point mistakes retry, robot travels in order',async()=>{
    await mount({mechanic:'coordinate',xMin:-1,xMax:1,yMin:-1,yMax:1,mode:'point',targets:[{x:1,y:1},{x:-1,y:0}]});
    assert.equal(await page.$eval('.ag-coordinate-cell',n=>n.dataset.y),'1');
    await click('[data-x="0"][data-y="0"]');await wrong();
    await click('[data-x="1"][data-y="1"]');await click('[data-x="-1"][data-y="0"]');assert.equal(await solved(),1);
    await mount({mechanic:'coordinate',xMin:0,xMax:2,yMin:0,yMax:2,mode:'robot',start:{x:0,y:0},targets:[{x:0,y:1},{x:1,y:1}]});
    await click('[data-action="robot-down"]');await wrong();
    await click('[data-action="robot-up"]');await click('[data-action="robot-right"]');assert.equal(await solved(),1);
  });
  await t.test('bar chart adjusts independent bars and verifies the whole chart',async()=>{
    await mount({mechanic:'bars',labels:['Лисы','Совы'],values:[2,1],maxValue:4});
    assert.equal(await page.$eval('.ag-bar-track',n=>n.style.getPropertyValue('--ag-bar-step')),'25%','chart tick spacing reflects one unit of the declared scale');
    await click('.ag-check');await wrong();
    await click('.ag-bar-plus[data-index="0"]');await click('.ag-bar-plus[data-index="0"]');await click('.ag-bar-plus[data-index="1"]');
    await click('.ag-check');assert.equal(await solved(),1);
  });
  await t.test('measure responds to range input, decimal steps, and buttons',async()=>{
    await mount({mechanic:'measure',min:0,max:10,step:1,target:4,start:0,displayScale:10,unit:'м'});
    await click('.ag-check');await wrong();
    await page.$eval('.ag-measure-range',n=>{n.value='3';n.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('.ag-measure-plus');assert.match(await page.$eval('.ag-measure-value',n=>n.textContent),/0,4/);
    await click('.ag-check');assert.equal(await solved(),1);
  });
  assert.equal(await page.evaluate(()=>{const before=window.solved;document.querySelector('.ag-check').click();return window.solved-before;}),0,'solved scenes cannot complete twice');
});
