import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const read=(name)=>fs.readFileSync(path.join(pub,name),"utf8");
const screens=[
 {name:"fractions",html:"fraction-builder.html",css:"fraction-storybook.css",back:"/cabinet#studentMathPanel",selectors:[".fraction-hero",".fraction-game","#pizza","#check",".choices"]},
 {name:"numbers",html:"number-lab.html",css:"number-storybook.css",back:"/cabinet#studentMathPanel",selectors:[".trail-hero",".trail-game","#line","#check",".levels"]},
 {name:"academy",html:"math-academy.html",css:"math-storybook.css",back:"/cabinet#studentMathPanel",selectors:[".academy-tools-intro","#progress-map","#practice","#intro"]},
];
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Headless Chrome is required for student game regression tests");
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu","--force-device-scale-factor=1"]});
const out=path.join(root,"artifacts","student-games");fs.mkdirSync(out,{recursive:true});
try{
 for(const screen of screens){
  const source=read(screen.html);
  assert.match(source,new RegExp('href="'+screen.back.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+'"'),screen.name+" lost return link");
  if(screen.name==="academy") assert.doesNotMatch(source,/academy-world-grid/,"Academy must not create a second world menu");
  const css=read(screen.css);
  // Local fixture uses the same production markup and both stylesheets, without API data or login.
  const fixture=source.replace(/<script src="[^"]+"><\/script>/g,"")
    .replace("</head>","<style>"+css+"</style></head>");
  const file=path.join(os.tmpdir(),"school-student-"+screen.name+".html");fs.writeFileSync(file,fixture);
  for(const width of [360,412,768]){
   const page=await browser.newPage();await page.setViewport({width,height:915,deviceScaleFactor:1});
   await page.goto(pathToFileURL(file).href,{waitUntil:"load"});
   await page.evaluate(()=>document.fonts.ready);
   const measured=await page.evaluate((selectors)=>({
    viewport:innerWidth,
    overflow:document.documentElement.scrollWidth-innerWidth,
    header:[...document.querySelectorAll("header a")].map(a=>({text:a.textContent.trim(),href:a.getAttribute("href")})),
    rects:selectors.map(selector=>{const el=document.querySelector(selector);if(!el)return{selector,missing:true};const r=el.getBoundingClientRect();return{selector,left:r.left,right:r.right,width:r.width,height:r.height};}),
   }),screen.selectors);
   assert.ok(measured.overflow<=2,`${screen.name} ${width}: horizontal scrolling (${measured.overflow}px)`);
   assert.ok(measured.header.some(link=>link.href===screen.back),screen.name+" incorrect back navigation");
   for(const rect of measured.rects){
    assert.ok(!rect.missing,`${screen.name} missing ${rect.selector}`);
    assert.ok(rect.width>0&&rect.height>0,`${screen.name} invisible ${rect.selector}`);
    assert.ok(rect.left>=-2&&rect.right<=width+2,`${screen.name} ${width}: ${rect.selector} escapes viewport`);
   }
   await page.screenshot({path:path.join(out,screen.name+"-"+width+".png"),fullPage:true,animations:"disabled"});
   console.log("✓",screen.name,width+"px","navigation + layout + screenshot");
   await page.close();
  }
 }
}finally{await browser.close();}
