import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "public", name), "utf8");
const html = read("dashboard.html");
const css = read("dashboard.css");
const academy = read("math-academy.html");

assert.equal((html.match(/id="studentMathPanel"/g) || []).length, 1, "Exactly one math-world hub");
assert.equal((html.match(/class="student-world-card /g) || []).length, 5, "Exactly five math-world cards");
assert.doesNotMatch(html, /id="studentMathNav"/, "No duplicate Math tab in student header");
assert.doesNotMatch(academy, /academy-world-grid/, "Academy cannot duplicate world-selection menu");
assert.match(html, /href="\/math-academy#progress-map"/, "Progress must have a destination");
assert.match(html, /href="\/math-academy#practice"/, "Training must have a destination");

const worldLabels = ["Играть", "В путь", "Играть", "Исследовать", "Открыть"];
for (const label of worldLabels) assert.ok(html.includes('class="student-world-action">' + label + "</span>"), "Missing arrow-free button " + label);
const links = [["number-lab", "number"], ["fraction-builder", "fraction"]];
for (const [game] of links) assert.match(read(game + ".html"), /href="\/cabinet#studentMathPanel">← К выбору игр/);
for (const name of ["hero-owl", "number-trail", "fraction-world", "geometry-world", "puzzle-world", "today-fraction"])
 assert.ok(fs.existsSync(path.join(root,"public/assets/student-worlds", name + ".webp")), "Missing student world image " + name);
for (const color of ["purple","pink","green","orange"])
 assert.ok(fs.existsSync(path.join(root,"public/assets/ui", "btn-" + color + ".webp")), "Missing glossy button " + color);

const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(fs.existsSync);
if (!chrome) throw new Error("Chrome required for visual layout regression checks");

for (const width of [360, 412, 768]) {
 const testHtml = html
   .replace('<body class="landing-body dashboard-page">', '<body class="landing-body dashboard-page" data-role="student">')
   .replace('<section id="studentMathPanel" class="student-world" hidden', '<section id="studentMathPanel" class="student-world"')
   .replace('</head>', '<style>' + css + '</style></head>')
   .replace('</body>', `<script>
    const rect = selector => {const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};
    const buttons = [...document.querySelectorAll(".student-world-action")].map(el=>{
      const s=getComputedStyle(el);const before=getComputedStyle(el,"::before");
      return {text:el.textContent.trim(),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,
      background:s.backgroundImage,backgroundColor:s.backgroundColor,borderRadius:s.borderRadius,
      shadow:s.boxShadow,pseudo:before.content};
    });
    document.title="STUDENT_TEST:"+encodeURIComponent(JSON.stringify({
      screen:innerWidth,header:rect(".dashboard-header"),brand:rect(".dashboard-brand"),
      account:rect(".account-strip"),cards:[...document.querySelectorAll(".student-world-card")].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}}),
      buttons,navVisible:getComputedStyle(document.querySelector(".dashboard-nav")).display
    }));
   </script></body>`);
 const filename=path.join(os.tmpdir(), "school-student-regression-" + width + ".html");
 fs.writeFileSync(filename,testHtml);
 const run=spawnSync(chrome,["--headless=new","--no-sandbox","--disable-gpu","--force-device-scale-factor=1",`--window-size=${width},920`,"--virtual-time-budget=1000","--dump-dom","file://" + filename],{encoding:"utf8",maxBuffer:12*1024*1024});
 assert.equal(run.status,0,"Chrome failed: "+(run.stderr||"").slice(0,200));
 const match=run.stdout.match(/<title>STUDENT_TEST:([^<]+)<\/title>/);
 assert.ok(match,"Chrome did not return dashboard metrics");
 const result=JSON.parse(decodeURIComponent(match[1]));
 const tolerance=1.5;
 for (const [name,r] of [["header",result.header],["brand",result.brand],["account",result.account],...result.cards.map((r,i)=>["card"+i,r])])
  assert.ok(r.left>=-tolerance&&r.right<=result.screen+tolerance, `${width}px: ${name} escapes viewport: ${JSON.stringify(r)}`);
 assert.equal(result.navVisible,"none","Student must not see duplicate header nav");
 assert.equal(result.buttons.length,5);
 const first=result.buttons[0];
 assert.ok(first.width>=110&&first.height>=38,`${width}px: game button shrank`);
 for (const [i,b] of result.buttons.entries()){
  assert.equal(b.text,worldLabels[i], "Button text or arrow changed");
  assert.ok(Math.abs(b.width-first.width)<=tolerance&&Math.abs(b.height-first.height)<=tolerance,`Unequal game buttons at ${width}px`);
  assert.ok(b.background.includes("btn-"),"Missing image background");
  assert.equal(b.shadow,"none","Unexpected flat CSS shadow under image");
  assert.ok(b.pseudo==="none"||b.pseudo==="normal","Unexpected second button layer");
 }
 console.log("✓ student dashboard",width,"px: header fits, worlds fit, five identical single-image buttons");
}
