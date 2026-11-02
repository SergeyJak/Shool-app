import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const pub=path.resolve(import.meta.dirname,'../public');
const chrome=[process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'Chrome/Chromium required');
const initial={unlocked:0,stars:0,completed:[],startLevel:1};
let account='A',identityStatus=200,cloudStatus=200,postStatus=200,holdIdentity=false,holdCloud=false,holdPost=false,switchAccountOnPost=null;
let identityWaiters=[],cloudWaiters=[],postWaiters=[],cloudRequests=0,postBodies=[];
const progress={A:{...initial},B:{unlocked:2,stars:6,completed:[0,1],startLevel:1}};
const server=http.createServer((req,res)=>{
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url==='/api/auth/me'){
  const reply=()=>json(identityStatus,{user:{id:account,username:'student-'+account,role:'student'}});
  if(holdIdentity)identityWaiters.push(reply);else reply();return;
 }
 if(req.url==='/api/math/adventure'){
  cloudRequests++;
  if(req.method==='POST'&&switchAccountOnPost){account=switchAccountOnPost;switchAccountOnPost=null;}
  const requestAccount=account;
  if(req.method==='POST'){
   let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const input=JSON.parse(body);postBodies.push(input);
    if(input.userId!==requestAccount){json(409,{error:'ACCOUNT_MISMATCH'});return;}
    if(postStatus===200)progress[requestAccount]={unlocked:input.level+1,stars:3,completed:[input.level],startLevel:1};
    const reply=()=>json(postStatus,{userId:requestAccount,progress:progress[requestAccount],passed:postStatus===200});
    if(holdPost)postWaiters.push(reply);else reply();
   });return;
  }
  const reply=()=>json(cloudStatus,{userId:requestAccount,progress:progress[requestAccount],assessmentRequired:progress[requestAccount]===null});
  if(holdCloud)cloudWaiters.push(reply);else reply();return;
 }
 if(req.url?.startsWith('/api/')){json(200,{attempts:[{mode:'diagnostic',correct:0,total:12}]});return;}
 const resource=new URL(req.url,'http://fixture').pathname;
 const file=path.join(pub,resource==='/'?'math-adventure.html':resource);
 if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 const body=fs.readFileSync(file);
 res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream'});res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage();
const releaseIdentity=()=>{holdIdentity=false;identityWaiters.splice(0).forEach(reply=>reply());};
const releaseCloud=()=>{holdCloud=false;cloudWaiters.splice(0).forEach(reply=>reply());};
const waitMap=()=>page.waitForFunction(()=>!document.getElementById('world').hidden&&document.querySelectorAll('.node').length===5);
const unlocked=()=>page.$$eval('.node:not(:disabled)',nodes=>nodes.length);
const reload=async()=>{await page.reload({waitUntil:'domcontentloaded'});await waitMap();};
const finishApples=async(waitForSave=true)=>{
 await page.$eval('.node',node=>node.click());
 for(const amount of [1,2,3,4,5]){
  for(let j=0;j<amount;j++)await page.$eval('.apple-pick:not(:disabled)',node=>node.click());
  await page.$eval('#next',node=>node.click());
 }
 if(waitForSave)await page.waitForFunction(()=>/сервере|недоступна|отклонён/.test(document.getElementById('resultText').textContent));
};
try{
 await page.goto(base);
 await page.evaluate(()=>{
  localStorage.clear();
  localStorage.setItem('school-math-adventure-v2',JSON.stringify({unlocked:99,stars:99,completed:[0,1,2,3,4]}));
  localStorage.setItem('school-math-diagnostic-v1',JSON.stringify({mode:'diagnostic',answers:Array(12).fill({correct:true})}));
 });
 holdIdentity=true;
 await page.reload({waitUntil:'domcontentloaded'});
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await page.$$eval('.node',nodes=>nodes.length),0,'identity pending must not load or display any account progress');
 releaseIdentity();await waitMap();
 assert.equal(await unlocked(),1,'unowned legacy adventure/diagnostic state must never be adopted');
 await finishApples();
 assert.match(await page.$eval('#resultText',node=>node.textContent),/сервере/);
 assert.deepEqual(postBodies[0],{userId:'A',level:0,correct:10,total:10},'every save must bind its intended account before transport');
 await reload();assert.equal(await unlocked(),2,'same-account reload keeps server progress');
 progress.A={...initial};
 await reload();assert.equal(await unlocked(),1,'initial cloud state replaces higher scoped local state');

 await page.$eval('.node',node=>node.click());
 holdIdentity=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.querySelector('main').hidden,{timeout:1000});
 releaseIdentity();await page.waitForFunction(()=>!document.querySelector('main').hidden);
 assert.equal(await page.$eval('#game',node=>node.classList.contains('hidden')),false,'same account focus keeps the current game');
 account='B';holdIdentity=true;
 await page.reload({waitUntil:'domcontentloaded'});
 assert.equal(await page.$$eval('.node',nodes=>nodes.length),0,'account switch must hide cached account A while identity is pending');
 releaseIdentity();await waitMap();assert.equal(await unlocked(),3,'account B receives only its own progress');
 cloudStatus=503;await reload();assert.equal(await unlocked(),3,'confirmed same account uses its scoped offline snapshot');
 account='A';await reload();assert.equal(await unlocked(),1,'offline fallback cannot borrow account B progress');
 identityStatus=503;const requestsBefore=cloudRequests;
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('Не удалось'));
 assert.equal(await page.$eval('#world',node=>node.hidden),true,'failed identity fetch must fail closed');
 assert.equal(await page.$$eval('.node',nodes=>nodes.length),0);
 assert.equal(cloudRequests,requestsBefore,'unknown identity cannot read cloud progress');
 identityStatus=200;cloudStatus=200;await reload();
 postStatus=409;await finishApples();
 assert.doesNotMatch(await page.$eval('#resultText',node=>node.textContent),/сохранён на сервере/);
 assert.equal(await unlocked(),1,'server-rejected completion must roll back optimistic unlock');
 cloudStatus=503;await reload();assert.equal(await unlocked(),1,'server-rejected unlock cannot reappear from offline cache');
 cloudStatus=200;postStatus=200;
 holdCloud=true;await page.reload({waitUntil:'domcontentloaded'});
 for(let i=0;i<200&&!cloudWaiters.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(cloudWaiters.length,'cloud response must be in flight');
 account='B';
 // A response in flight must be discarded if the session changes before it is applied.
 releaseCloud();await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('Не удалось'));
 assert.equal(await page.$eval('#world',node=>node.hidden),true,'late account A cloud response cannot populate account B session');
 await reload();assert.equal(await unlocked(),3);
 await page.evaluate(()=>{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key.includes('user:'))localStorage.setItem(key,'invalid json');}});
 cloudStatus=503;await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('Не удалось'));
 assert.equal(await page.$eval('#world',node=>node.hidden),true,'invalid scoped JSON must not recover via shared legacy state');
 cloudStatus=200;await reload();progress.B=null;
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.getElementById('diagnosticGate').classList.contains('hidden'));
 cloudStatus=503;await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('Не удалось'));
 assert.equal(await page.$eval('#world',node=>node.hidden),true,'authoritative assessment removal invalidates the scoped offline cache');
 cloudStatus=200;progress.B={unlocked:2,stars:6,completed:[0,1],startLevel:1};
 await page.evaluateOnNewDocument(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('disabled','SecurityError');}}));
 await reload();assert.equal(await unlocked(),3,'disabled browser storage must not prevent authoritative cloud loading');
 holdPost=true;await finishApples(false);
 for(let i=0;i<200&&!postWaiters.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(postWaiters.length,'save response must be in flight');
 identityStatus=503;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('Не удалось'));
 identityStatus=200;holdPost=false;postWaiters.splice(0).forEach(reply=>reply());
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await page.$$eval('.node',nodes=>nodes.length),0,'late save cannot revive a session invalidated by a failed identity check');
 account='A';progress.A={...initial};progress.B={unlocked:2,stars:6,completed:[0,1],startLevel:1};
 await reload();
 switchAccountOnPost='B';await finishApples(false);
 await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('Не удалось'));
 assert.deepEqual(postBodies.at(-1),{userId:'A',level:0,correct:10,total:10},'in-flight account switch preserves the intended owner in the request');
 assert.deepEqual(progress.A,{unlocked:0,stars:0,completed:[],startLevel:1},'mismatched save must not change the old account');
 assert.deepEqual(progress.B,{unlocked:2,stars:6,completed:[0,1],startLevel:1},'mismatched save must not change the newly authenticated account');
 assert.doesNotMatch(await page.$eval('#resultText',node=>node.textContent),/сохранён на сервере/);
 console.log('✓ account-scoped progress: identity gate, A→B switch, authoritative cloud, offline fallback, rejected save, late response, corrupt/disabled storage');
}finally{releaseIdentity();releaseCloud();postWaiters.splice(0).forEach(reply=>reply());await browser.close();await new Promise(resolve=>server.close(resolve));}
