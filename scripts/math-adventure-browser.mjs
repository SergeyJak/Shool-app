import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Chrome/Chromium required for adventure tests");
let progress={unlocked:0,stars:0,completed:[],startLevel:1};
const server=http.createServer((req,res)=>{
 const json=value=>{res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
 if(req.url==="/api/auth/me"){json({user:{id:"adventure-test-student",username:"student",role:"student"}});return;}
 if(req.url==="/api/math/adventure"){
  if(req.method==="POST"){
   let raw="";req.on("data",chunk=>raw+=chunk);req.on("end",()=>{
    const body=JSON.parse(raw);
    if(body.userId!=="adventure-test-student"){res.writeHead(409,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"ACCOUNT_MISMATCH"}));return;}
    progress=body.level===1?{unlocked:2,stars:6,completed:[0,1],startLevel:1}:{unlocked:1,stars:3,completed:[0],startLevel:1};
    json({userId:"adventure-test-student",progress,passed:true});
   });return;
  }
  json({userId:"adventure-test-student",progress,assessmentRequired:false});return;
 }
 const resource=new URL(req.url,"http://fixture").pathname;
 const file=path.join(pub,resource==="/"?"math-adventure.html":resource);
 if(!file.startsWith(pub)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{"Content-Type":file.endsWith(".html")?"text/html":file.endsWith(".js")?"application/javascript":"application/octet-stream"});res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu"]});
try{
 const page=await browser.newPage();
 await page.evaluateOnNewDocument(()=>{
  window.__adventurePosts=[];
  const request=window.fetch.bind(window);
  window.fetch=(url,opts={})=>{
   if(url==="/api/math/adventure"&&opts.method==="POST")window.__adventurePosts.push(JSON.parse(opts.body));
   return request(url,opts);
  };
 });
 await page.goto(base);
 await page.waitForFunction(()=>!document.getElementById("world").hidden);
 assert.equal(await page.$$eval(".node",els=>els.length),5);
 assert.match(await page.$eval("#adventureLevelHeading",el=>el.textContent),/из 100/);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),1);
 await page.$eval(".node",el=>el.click());
 assert.equal(await page.$eval("#world",el=>el.classList.contains("hidden")),true,"Map must hide while answering");
 assert.equal(await page.$eval("#game",el=>el.classList.contains("hidden")),false);
 for(let i=0;i<5;i++){
  assert.match(await page.$eval("#counter",el=>el.textContent),new RegExp("Игра "+(i+1)+" из 5"));
  const target=[1,2,3,4,5][i];
  await page.$eval(".apple-hint",el=>el.click());
  assert.match(await page.$eval("#feedback",el=>el.textContent),/Осталось добавить/);
  assert.equal(await page.$eval("#next",el=>el.classList.contains("hidden")),true);
  for(let j=0;j<target;j++){
   await page.$eval(".apple-pick:not(:disabled)",el=>el.click());
  }
  assert.match(await page.$eval("#feedback",el=>el.textContent),/Отлично|Ура/);
  assert.equal(await page.$eval("#next",el=>el.classList.contains("hidden")),false);
  await page.$eval("#next",el=>el.click());
 }
 assert.match(await page.$eval("#resultTitle",el=>el.textContent),/Яблоки собраны/);
 await page.waitForFunction(()=>window.__adventurePosts.length===1&&document.getElementById("resultText").textContent.includes("сервере"));
 assert.deepEqual(await page.evaluate(()=>window.__adventurePosts[0]),{userId:"adventure-test-student",level:0,correct:10,total:10});
 assert.match(await page.$eval("#resultText",el=>el.textContent),/сервере/);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),2);
 await page.$eval("#return",el=>el.click());
 assert.match(await page.$eval("#summary",el=>el.textContent),/Звёзд: 3/);
 await page.reload();
 await page.waitForFunction(()=>!document.getElementById("world").hidden&&document.querySelectorAll(".node").length===5);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),2);
 assert.match(await page.$eval("#summary",el=>el.textContent),/Звёзд: 3/);
 await page.$eval(".node:not(:disabled)",els=>{const nodes=document.querySelectorAll(".node:not(:disabled)");nodes[1].click()});
 for(let i=0;i<5;i++){
  assert.match(await page.$eval("#counter",el=>el.textContent),new RegExp("Рейс "+(i+1)+" из 5"));
  const target=[2,3,4,5,7][i];
  await page.$eval(".apple-hint",el=>el.click());
  assert.match(await page.$eval("#feedback",el=>el.textContent),/В кузове было/);
  for(let j=0;j<target;j++)await page.$eval(".bridge-plank:not(.removed)",el=>el.click());
  assert.match(await page.$eval("#feedback",el=>el.textContent),/Поехали/);
  await page.$eval("#next",el=>el.click());
 }
 assert.match(await page.$eval("#resultTitle",el=>el.textContent),/Мост построен/);
 await page.waitForFunction(()=>window.__adventurePosts.length===1&&document.getElementById("resultText").textContent.includes("сервере"));
 assert.deepEqual(await page.evaluate(()=>window.__adventurePosts[0]),{userId:"adventure-test-student",level:1,correct:10,total:10});
 await page.$eval("#return",el=>el.click());
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),3);
 await page.reload();
 await page.waitForFunction(()=>!document.getElementById("world").hidden&&document.querySelectorAll(".node").length===5);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),3);
 console.log("✓ adventure: apple and bridge training, hints, unlock, persisted progress");
 await page.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
