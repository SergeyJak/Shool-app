import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const read=n=>fs.readFileSync(path.join(pub,n),"utf8");
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Chrome required");
const mocks=`<script>
window.__posts=[];window.__failSave=false;window.__v2Count=Number(localStorage.getItem("mock-v2-count")||0);window.__v2Done=window.__v2Count>=19;window.__v2Fail=false;
const v2Response=()=>({question:window.__v2Done?null:{id:"d2-"+window.__v2Count,skill:"arithmetic",prompt:"Сколько будет 2 + 3?"},answered:window.__v2Count,finished:window.__v2Done,result:window.__v2Done?{level:42,provisional:true,skills:{arithmetic:{estimate:42,count:19}}}:null});
window.fetch=async(url,opts={})=>{
 if(url==="/api/math/diagnostic-v2")return {ok:true,json:async()=>v2Response()};
 if(url==="/api/math/diagnostic-v2/restart"){window.__v2Count=0;window.__v2Done=false;localStorage.setItem("mock-v2-count","0");return {ok:true,json:async()=>({ok:true})};}
 if(url==="/api/math/diagnostic-v2/answer"){if(window.__v2Fail)return {ok:false};window.__v2Count++;localStorage.setItem("mock-v2-count",String(window.__v2Count));window.__v2Done=window.__v2Count>=19;return {ok:true,json:async()=>({...v2Response(),correct:true})};}
 if(url==="/api/math/progress")return {ok:true,json:async()=>({attempts:[]})};
 if(url==="/api/math/skill-map")return {ok:true,json:async()=>({skills:{"Счёт":{percent:70,level:"Растёт"}},reviewOrigins:[1]})};
 if(url.startsWith("/api/math/adaptive"))return {ok:true,json:async()=>({skill:"Счёт",level:2,review:url.includes("review=1"),questions:[
  {q:"Сколько будет 2 + 3?",options:[4,5,6,7],origin:0,why:"2 + 3 = 5"},
  {q:"Сколько будет 3 + 4?",options:[6,7,8,9],origin:1,why:"3 + 4 = 7"}]})};
 if(url==="/api/math/attempts"){
  const body=JSON.parse(opts.body);window.__posts.push(body);
  if(window.__failSave)return {ok:false};
  return {ok:true,json:async()=>({attempt:{correct:body.answers.length,total:body.answers.length}})};
 }
 throw Error("Unexpected endpoint "+url);
};</script>`;
const html=read("math-academy.html").replace("</head>",mocks+"</head>")
 .replace(/<script src="\/(skill-map|math-academy|adaptive-practice)\.js"><\/script>/g,(tag,name)=>"<script>"+read(name+".js")+"</script>");
const fixture=path.join(os.tmpdir(),"school-math-full-e2e.html");fs.writeFileSync(fixture,html);
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu"]});
const page=await browser.newPage();await page.setViewport({width:412,height:915});
try{
 await page.goto(pathToFileURL(fixture).href,{waitUntil:"load"});
 await page.waitForFunction(()=>document.querySelector("#skillMap .skill")!==null);
 assert.match(await page.$eval("#skillMapStatus",e=>e.textContent),/30 занятий/);
 await page.click("#start");
 await page.waitForFunction(()=>document.querySelector("#progress").textContent.includes("15–25"));
 assert.match(await page.$eval("#question",e=>e.textContent),/2 \+ 3/);
 await page.$eval("#options input",el=>el.value="5");
 await page.evaluate(()=>window.__v2Fail=true);
 await page.click("#options button");
 await page.waitForFunction(()=>document.querySelector("#feedback").textContent.includes("Ошибка сохранения"));
 assert.equal(await page.evaluate(()=>window.__v2Count),0);
 await page.evaluate(()=>window.__v2Fail=false);
 await page.click("#options button");
 await page.waitForFunction(()=>window.__v2Count===1);
 await page.reload({waitUntil:"load"});
 await page.click("#start");
 await page.waitForFunction(()=>document.querySelector("#progress").textContent.includes("1 / 15–25"));
 for(let i=1;i<19;i++){
  await page.$eval("#options input",el=>el.value="5");
  await page.click("#options button");
  await page.waitForFunction(expected=>window.__v2Count===expected,i+1);
 }
 await page.waitForFunction(()=>document.querySelector("#resultLead").textContent.includes("19 заданий"));
 assert.match(await page.$eval("#adventureAssessment",e=>e.textContent),/42 из 100/);
 await page.click("#repeat");
 await page.waitForFunction(()=>document.querySelector("#progress").textContent.includes("0 / 15–25"));
 assert.equal(await page.evaluate(()=>window.__v2Count),0);
 await page.click("#adaptiveStart");
 await page.waitForFunction(()=>document.querySelector("#adaptivePanel").hidden===false);
 assert.match(await page.$eval("#adaptiveTitle",e=>e.textContent),/уровень 2/);
 await page.$eval("#adaptiveOptions button:nth-child(2)",b=>b.click());
 assert.equal(await page.$eval("#adaptiveNext",e=>e.hidden),false);
 await page.click("#adaptiveNext");
 assert.match(await page.$eval("#adaptiveQuestion",e=>e.textContent),/3 \+ 4/);
 await page.$eval("#adaptiveOptions button:nth-child(2)",b=>b.click());
 await page.click("#adaptiveNext");
 await page.waitForFunction(()=>window.__posts.length===2);
 const adaptive=await page.evaluate(()=>window.__posts[1]);
 assert.equal(adaptive.mode,"adaptive");assert.deepEqual(adaptive.answers,[{origin:0,value:5},{origin:1,value:7}]);
 assert.match(await page.$eval("#adaptiveSummary",e=>e.textContent),/Прогресс сохранён/);
 await page.click("#reviewStart");
 await page.waitForFunction(()=>document.querySelector("#adaptiveTitle").textContent.includes("Работа над ошибками"));
 await page.evaluate(()=>window.__failSave=true);
 await page.$eval("#adaptiveOptions button",b=>b.click());await page.click("#adaptiveNext");
 await page.$eval("#adaptiveOptions button",b=>b.click());await page.click("#adaptiveNext");
 await page.waitForFunction(()=>document.querySelector("#adaptiveFeedback").textContent.includes("Не получилось сохранить"));
 await page.evaluate(()=>window.__failSave=false);
 await page.click("#adaptiveNext");
 await page.waitForFunction(()=>document.querySelector("#adaptiveSummary").textContent.includes("Прогресс сохранён"));
 console.log("✓ Adaptive diagnostic 19 questions, retry, reload/resume, restart, placement; skill map and practice");
}finally{await browser.close();}
