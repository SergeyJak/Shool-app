import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Chrome/Chromium required for adventure tests");
const html=fs.readFileSync(path.join(pub,"math-adventure.html"),"utf8").replace('<script src="/math-adventure.js"></script>',"<script>"+fs.readFileSync(path.join(pub,"math-adventure.js"),"utf8")+"</script>");
const file=path.join(os.tmpdir(),"school-math-adventure-test.html");fs.writeFileSync(file,html);
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu"]});
try{
 const page=await browser.newPage();await page.goto(pathToFileURL(file).href);
 assert.equal(await page.$$eval(".node",els=>els.length),5);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),1);
 await page.$eval(".node",el=>el.click());
 for(let i=0;i<10;i++){
  const prompt=await page.$eval("#question",el=>el.textContent);
  const answer=prompt.includes("−")?Number(prompt.match(/^(\\d+)/)[1])-Number(prompt.match(/− (\\d+)/)[1]):Number(prompt.match(/^(\\d+)/)[1])+Number(prompt.match(/\\+ (\\d+)/)[1]);
  const clicked=await page.$$eval("#choices button",(els,expected)=>{const el=els.find(e=>Number(e.textContent)===expected);if(!el)return false;el.click();return true},answer);
  assert.ok(clicked,"Correct answer must be available");
  await page.$eval("#next",el=>el.click());
 }
 assert.match(await page.$eval("#resultTitle",el=>el.textContent),/пройден/);
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),2);
 await page.$eval("#return",el=>el.click());
 assert.match(await page.$eval("#summary",el=>el.textContent),/Звёзд: 3/);
 await page.reload();
 assert.equal(await page.$$eval(".node:not(:disabled)",els=>els.length),2);
 assert.match(await page.$eval("#summary",el=>el.textContent),/Звёзд: 3/);
 console.log("✓ adventure: locked nodes, 10 correct answers, unlock, stars, persisted progress");
 await page.close();
}finally{await browser.close();}
