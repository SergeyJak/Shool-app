import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const pub=path.resolve(import.meta.dirname,'../public');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,'Chrome required');
const server=http.createServer((req,res)=>{
 const route=new URL(req.url,'http://fixture').pathname;
 const file=path.resolve(pub,'.'+(route==='/'?'/math-hub.html':route));
 if(!file.startsWith(pub+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-gpu']});
try{
 for(const scenario of [{name:'new student',access:false,finished:false},{name:'completed diagnostic',access:true,finished:true},{name:'retake with previous placement',access:true,finished:false}]){
  const page=await browser.newPage();await page.setViewport({width:390,height:844,isMobile:true});
  await page.evaluateOnNewDocument(s=>{
   window.__requests=[];
   window.fetch=async url=>{window.__requests.push(url);return {ok:true,json:async()=>url==='/api/math/adventure'?{userId:'hub-student',assessmentRequired:!s.access,progress:s.access?{startLevel:64,unlocked:63,stars:0,completed:[]}:null}:{finished:s.finished,result:s.finished?{level:64}:null}};};
  },scenario);
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
  const actual=await page.evaluate(()=>({locked:document.querySelector('#adventure').classList.contains('locked'),href:document.querySelector('#adventure').getAttribute('href'),overflow:document.documentElement.scrollWidth>innerWidth,requests:window.__requests}));
  assert.equal(actual.locked,!scenario.access,scenario.name);
  assert.equal(actual.href,scenario.access?'/math-adventure':'#',scenario.name);
  assert.equal(actual.overflow,false,'Mobile must not overflow');
  assert.ok(actual.requests.includes('/api/math/adventure'),'Hub access must use the same placement/progress decision as the adventure API');
  await page.close();console.log('✓ Math hub:',scenario.name);
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
