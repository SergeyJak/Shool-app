import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const read=n=>fs.readFileSync(path.join(pub,n),"utf8");
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Chrome/Chromium required for student game interaction tests");
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu"]});
async function openGame(name) {
 const html=read(name+".html").replace('<script src="/'+name+'.js"></script>',"<script>"+read(name+".js")+"</script>");
 const file=path.join(os.tmpdir(),"school-interaction-"+name+".html");fs.writeFileSync(file,html);
 const page=await browser.newPage();await page.setViewport({width:412,height:915});await page.goto(pathToFileURL(file).href,{waitUntil:"load"});return page;
}
try{
 const fractions=await openGame("fraction-builder");
 assert.equal(await fractions.$eval("#task",el=>el.textContent),"Выбери 1 из 2 равных кусочков");
 assert.equal(await fractions.$$eval(".slice",els=>els.length),2);
 await fractions.$eval(".slice",el=>el.click());
 assert.equal(await fractions.$eval("#selected",el=>el.textContent),"Выбрано: 1/2");
 await fractions.$eval("#check",el=>el.click());
 assert.match(await fractions.$eval("#feedback",el=>el.textContent),/Правильно/);
 assert.equal(await fractions.$eval("#next",el=>el.hidden),false);
 await fractions.$eval("#next",el=>el.click());
 assert.equal(await fractions.$eval("#round",el=>el.textContent),"Задание 2 / 5");
 await fractions.$eval('[data-size="4"]',el=>el.click());
 assert.equal(await fractions.$$eval(".slice",els=>els.length),4);
 assert.equal(await fractions.$eval('[data-size="4"]',el=>el.getAttribute("aria-pressed")),"true");
 // Complete all five rounds at quarter difficulty and verify restart.
 for(let round=1;round<=5;round++){
  assert.equal(await fractions.$eval("#round",el=>el.textContent),"Задание "+round+" / 5");
  await fractions.$eval(".slice",el=>el.click());
  await fractions.$eval("#check",el=>el.click());
  assert.equal(await fractions.$eval("#next",el=>el.hidden),false);
  await fractions.$eval("#next",el=>el.click());
 }
 assert.match(await fractions.$eval("#task",el=>el.textContent),/Уровень завершён/);
 assert.match(await fractions.$eval("#feedback",el=>el.textContent),/Результат: 2 из 5/);
 await fractions.$eval("#next",el=>el.click());
 assert.equal(await fractions.$eval("#round",el=>el.textContent),"Задание 1 / 5");
 await fractions.$eval("#check",el=>el.click());
 assert.match(await fractions.$eval("#feedback",el=>el.textContent),/Нужно 1 кусочков/);
 await fractions.close();
 console.log("✓ fractions: select → check → feedback → next → difficulty");
 const numbers=await openGame("number-lab");
 assert.match(await numbers.$eval("#task",el=>el.textContent),/Найди число 3/);
 await numbers.focus("#marker");
 for(let i=0;i<3;i++)await numbers.keyboard.press("ArrowRight");
 assert.equal(await numbers.$eval("#marker",el=>el.getAttribute("aria-valuenow")),"3");
 await numbers.$eval("#check",el=>el.click());
 assert.match(await numbers.$eval("#feedback",el=>el.textContent),/Точно в цель/);
 assert.equal(await numbers.$eval("#score",el=>el.textContent),"Правильно: 1");
 await numbers.$eval("#next",el=>el.click());
 assert.equal(await numbers.$eval("#round",el=>el.textContent),"Задание 2 / 5");
 await numbers.$eval('[data-level="medium"]',el=>el.click());
 assert.match(await numbers.$eval("#task",el=>el.textContent),/4 \+ 3/);
 assert.equal(await numbers.$eval("#score",el=>el.textContent),"Правильно: 0");
 await numbers.$eval("#marker",el=>el.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true})));
 assert.equal(await numbers.$eval("#marker",el=>el.getAttribute("aria-valuenow")),"20");
 // Wrong answer should show the correct value without incrementing score.
 await numbers.$eval("#check",el=>el.click());
 assert.match(await numbers.$eval("#feedback",el=>el.textContent),/Правильная точка: 7/);
 assert.equal(await numbers.$eval("#score",el=>el.textContent),"Правильно: 0");
 await numbers.$eval('[data-level="easy"]',el=>el.click());
 for(const [i,target] of [3,7,5,9,2].entries()){
  assert.equal(await numbers.$eval("#round",el=>el.textContent),"Задание "+(i+1)+" / 5");
  await numbers.focus("#marker");await numbers.keyboard.press("Home");
  for(let k=0;k<target;k++) await numbers.keyboard.press("ArrowRight");
  assert.equal(await numbers.$eval("#marker",el=>el.getAttribute("aria-valuenow")),String(target));
  await numbers.$eval("#check",el=>el.click());
  assert.match(await numbers.$eval("#feedback",el=>el.textContent),/Точно в цель/);
  await numbers.$eval("#next",el=>el.click());
 }
 assert.match(await numbers.$eval("#task",el=>el.textContent),/Уровень завершён/);
 assert.match(await numbers.$eval("#feedback",el=>el.textContent),/Результат: 5 из 5/);
 await numbers.$eval("#next",el=>el.click());
 assert.equal(await numbers.$eval("#round",el=>el.textContent),"Задание 1 / 5");
 assert.equal(await numbers.$eval("#score",el=>el.textContent),"Правильно: 0");
 await numbers.close();
 console.log("✓ numbers: keyboard → score → next → difficulty → slider bounds");
}finally{await browser.close();}
