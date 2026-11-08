import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import puppeteer from "puppeteer-core";
const root=path.resolve(import.meta.dirname,".."),pub=path.join(root,"public");
const read=(name)=>fs.readFileSync(path.join(pub,name),"utf8");
const screens=[
 {name:"fractions",html:"fraction-builder.html",css:"fraction-storybook.css",back:"/cabinet#studentMathPanel",selectors:[".fraction-hero",".fraction-game","#pizza","#check",".choices"]},
 {name:"numbers",html:"number-lab.html",css:"number-storybook.css",back:"/cabinet#studentMathPanel",selectors:[".trail-hero",".trail-game","#line","#check",".levels"]},
 {name:"academy",html:"math-academy.html",css:"math-diagnostic.css",back:"/cabinet#studentMathPanel",selectors:[".academy-tools-intro","#progress-map","#practice-tools","#intro"]},
];
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Headless Chrome is required for student game regression tests");
const fixtures=new Map();
const server=http.createServer((req,res)=>{
 const route=new URL(req.url,"http://fixture").pathname;
 if(fixtures.has(route)){res.writeHead(200,{"Content-Type":"text/html"});res.end(fixtures.get(route));return;}
 const file=path.resolve(pub,"."+route);
 if(!file.startsWith(pub+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{"Content-Type":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".js")?"application/javascript":"application/octet-stream"});res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu","--force-device-scale-factor=1"]});
const out=path.join(os.tmpdir(),"school-student-games");fs.mkdirSync(out,{recursive:true});
try{
 for(const screen of screens){
  const source=read(screen.html);
  assert.ok(source.includes('href="'+screen.back+'"'),screen.name+" lost return link");
  if(screen.name==="academy") assert.doesNotMatch(source,/academy-world-grid/,"Academy must not create a second world menu");
  const css=read(screen.css);
  // Local fixture uses the same production markup and both stylesheets, without API data or login.
  const fixture=source.replace(/<script src="[^"]+"><\/script>/g,"")
    .replace("</head>","<style>"+css+"</style></head>");
  const route="/student-fixture-"+screen.name;fixtures.set(route,fixture);
  for(const width of [360,412,768]){
   const page=await browser.newPage();await page.setViewport({width,height:915,deviceScaleFactor:1});
   await page.goto(base+route,{waitUntil:"load"});
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
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
