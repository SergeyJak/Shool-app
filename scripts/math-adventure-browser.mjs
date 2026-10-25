import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Chrome/Chromium required for adventure tests");
const html=fs.readFileSync(path.join(pub,"math-adventure.html"),"utf8").replace(/<script src="\/math-adventure\.js(?:\?[^"]*)?"><\/script>/,"<script>"+fs.readFileSync(path.join(pub,"math-adventure.js"),"utf8")+"</script>");
const file=path.join(os.tmpdir(),"school-math-adventure-test.html");fs.writeFileSync(file,html);
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu"]});
try{
 const page=await browser.newPage();
 await page.evaluateOnNewDocument(()=>{
  window.__adventurePosts=[];
  window.fetch=async(url,opts={})=>{
   if(url==="/api/math/progress")return {ok:true,json:async()=>({attempts:[{mode:"diagnostic",correct:0,total:12}]})};
   if(url==="/api/math/adventure"&&(!opts.method||opts.method==="GET"))return {ok:true,json:async()=>({progress:{unlocked:0,stars:0,completed:[],startLevel:1}})};
   if(url==="/api/math/adventure"&&opts.method==="POST"){
    const body=JSON.parse(opts.body);window.__adventurePosts.push(body);
    return {ok:true,json:async()=>({progress:body.level===1?{unlocked:2,stars:6,completed:[0,1]}:{unlocked:1,stars:3,completed:[0]},passed:true})};
   }
   throw Error("Unexpected fetch "+url);
  };
 });
 await page.goto(pathToFileURL(file).href);
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
  assert.match(await page.$eval("#feedback",el=>el.textContent),/Получилось/);
  assert.equal(await page.$eval("#next",el=>el.classList.contains("hidden")),false);
  await page.$eval("#next",el=>el.click());
 }
 assert.match(await page.$eval("#resultTitle",el=>el.textContent),/Яблоки собраны/);
 await page.waitForFunction(()=>window.__adventurePosts.length===1);
 assert.deepEqual(await page.evaluate(()=>window.__adventurePosts[0]),{level:0,correct:10,total:10});
 assert.match(await page.$eval("#resultText",el=>el.textContent),/сервере/);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),2);
 await page.$eval("#return",el=>el.click());
 assert.match(await page.$eval("#summary",el=>el.textContent),/Звёзд: 3/);
 await page.reload();
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),2);
 assert.match(await page.$eval("#summary",el=>el.textContent),/Звёзд: 3/);
 await page.$eval(".node:not(:disabled)",els=>{const nodes=document.querySelectorAll(".node:not(:disabled)");nodes[1].click()});
 for(let i=0;i<5;i++){
  assert.match(await page.$eval("#counter",el=>el.textContent),new RegExp("Мост "+(i+1)+" из 5"));
  const target=[2,3,4,5,7][i];
  await page.$eval(".apple-hint",el=>el.click());
  assert.match(await page.$eval("#feedback",el=>el.textContent),/Вычитание означает/);
  for(let j=0;j<target;j++)await page.$eval(".bridge-plank:not(.removed)",el=>el.click());
  assert.match(await page.$eval("#feedback",el=>el.textContent),/Мост готов/);
  await page.$eval("#next",el=>el.click());
 }
 assert.match(await page.$eval("#resultTitle",el=>el.textContent),/Мост построен/);
 await page.waitForFunction(()=>window.__adventurePosts.length===1);
 assert.deepEqual(await page.evaluate(()=>window.__adventurePosts[0]),{level:1,correct:10,total:10});
 await page.$eval("#return",el=>el.click());
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),3);
 await page.reload();
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),3);
 console.log("✓ adventure: apple and bridge training, hints, unlock, persisted progress");
 await page.close();
}finally{await browser.close();}
