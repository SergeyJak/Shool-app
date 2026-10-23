import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const root=path.resolve(import.meta.dirname,"..");
const publicDir=path.join(root,"public");
const html=fs.readFileSync(path.join(publicDir,"dashboard.html"),"utf8");
const css=fs.readFileSync(path.join(publicDir,"dashboard.css"),"utf8");
const landing=fs.readFileSync(path.join(publicDir,"landing.css"),"utf8");
const outDir=path.join(root,"artifacts","student-dashboard");
fs.mkdirSync(outDir,{recursive:true});
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
assert.ok(chrome,"Headless Chrome is required");

const assetData=(url)=>{
 const p=path.resolve(publicDir,"."+url);
 if(!p.startsWith(publicDir+path.sep)||!fs.existsSync(p))return null;
 const ext=path.extname(p).slice(1);
 const type=ext==="svg"?"image/svg+xml":ext==="webp"?"image/webp":ext==="png"?"image/png":null;
 return type?"data:"+type+";base64,"+fs.readFileSync(p).toString("base64"):null;
};
const mergedCSS=(landing+"\n"+css).replace(/url\(["']?(\/assets\/[^)"']+)["']?\)/g,(whole,url)=>'url("'+(assetData(url)||url)+'")');
const documentHtml=html
 .replace('<body class="landing-body dashboard-page">','<body class="landing-body dashboard-page" data-role="student">')
 .replace('<section id="studentMathPanel" class="student-world" hidden','<section id="studentMathPanel" class="student-world"')
 .replace('</head>','<style>'+mergedCSS+'</style></head>')
 .replace(/<script src="\/cabinet\.js[^"]*"><\/script>/,'')
 .replace(/<img([^>]*?)src="(\/assets\/[^"]+)"([^>]*)>/g,(whole,a,url,b)=>'<img'+a+'src="'+(assetData(url)||url)+'"'+b+'>');
const file=path.join(os.tmpdir(),"school-student-visual-fixture.html");
fs.writeFileSync(file,documentHtml);
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-gpu","--force-device-scale-factor=1"]});
try {
 for(const width of [360,412,768]){
  const page=await browser.newPage();
  await page.setViewport({width,height:900,deviceScaleFactor:1});
  await page.goto(pathToFileURL(file).href,{waitUntil:"load"});
  await page.evaluate(async()=>{await document.fonts.ready;document.getElementById("studentFirstName").textContent="Алиса";});
  const metrics=await page.evaluate(()=>{
   const rect=(el)=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height}};
   const cards=[...document.querySelectorAll(".student-world-card")];
   return {width:innerWidth,bodyWidth:document.documentElement.scrollWidth,
    header:rect(document.querySelector(".dashboard-header")),
    cards:cards.map(rect),
    buttons:cards.map(c=>{const el=c.querySelector(".student-world-action"),s=getComputedStyle(el),before=getComputedStyle(el,"::before");
     return{...rect(el),background:s.backgroundImage,shadow:s.boxShadow,pseudo:before.content,text:el.textContent.trim()};})};
  });
  assert.equal(metrics.cards.length,4,"World card count changed");
  assert.ok(metrics.bodyWidth<=width+2,`Horizontal overflow at ${width}px`);
  for(const [index,c] of metrics.cards.entries())assert.ok(c.left>=-2&&c.right<=width+2,`Card ${index} escapes ${width}px viewport`);
  const labels=["В путь","Играть","Исследовать","Открыть"];
  for(const [index,b] of metrics.buttons.entries()){
   assert.equal(b.text,labels[index]);
   assert.ok(b.background.includes("data:image/webp;base64,") || b.background.includes("btn-"),"Glossy asset missing");
   assert.equal(b.shadow,"none","Unexpected CSS shadow under glossy art");
   assert.ok(["none","normal"].includes(b.pseudo),"Extra button layer");
   assert.ok(Math.abs(b.width-metrics.buttons[0].width)<2&&Math.abs(b.height-metrics.buttons[0].height)<2,"Unequal game buttons");
  }
  await page.screenshot({path:path.join(outDir,`student-${width}.png`),fullPage:true,animations:"disabled"});
  // Compare the painted assets independently of text antialiasing/font changes.
  // A source-art regression is a visual change even if geometry remains correct.
  const baselinePath=path.join(root,"tests","student-art-baselines.json");
  const baselines=JSON.parse(fs.readFileSync(baselinePath,"utf8"));
  for(const [label,relativePath] of Object.entries(baselines.assets)){
    const asset=path.join(publicDir,relativePath);
    assert.ok(fs.existsSync(asset),`Missing visual asset ${label}`);
    const bytes=fs.readFileSync(asset); const digest=createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\\0`.replace("\\0","\0")),bytes])).digest("hex");
    assert.equal(digest,baselines.gitSha1[label],`Artwork changed for ${label}; review and update its approved baseline intentionally`);
  }
  fs.writeFileSync(path.join(outDir,`student-${width}.json`),JSON.stringify(metrics,null,2));
  console.log(`✓ Screenshot and rendered checks: ${width}px`);
  await page.close();
 }
}finally{await browser.close();}
