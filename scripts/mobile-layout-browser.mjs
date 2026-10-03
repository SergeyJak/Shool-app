import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const pdfStyles = fs.readFileSync(path.join(root, "public", "pdf-view.css"), "utf8");

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("Headless Chrome/Chromium is required for layout regression tests");

const viewports = [
  { name: "phone portrait", width: 412, height: 915 },
  { name: "tablet portrait", width: 800, height: 1200 },
];

for (const viewport of viewports) {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PENDING</title>
<style>${styles}\n${pdfStyles}</style>
</head>
<body data-role="teacher" class="pdf-view-page">
<header class="pdf-header">
  <a class="pdf-back">‹</a>
  <a class="pdf-brand"><span class="pdf-brand-owl">🦉</span></a>
  <div class="pdf-lesson-title"><strong>Занятие</strong><span>онлайн</span></div>
  <div class="pdf-header-actions"><a class="pdf-action">↓ PDF</a><label class="pdf-action compact-upload">+ PDF</label></div>
</header>
<main>
  <div class="lesson-sync-row compact-sync">
    <button id="followBtn" class="follow-button" type="button">🔗 Вести ученика</button>
  </div>
  <div class="toolbar">
    <button id="penBtn">✎</button>
    <button id="eraserBtn">⌫</button>
    <button id="handBtn">Рука</button>
    <div class="zoom-controls"><button>−</button><button id="zoomResetBtn">100%</button><button>+</button></div>
    <button id="undoBtn">↶ Отменить</button>
    <button id="firstBtn">«</button><button id="prevBtn">‹</button>
    <span id="pageInfo" class="page-jump"><input id="pageInput" value="1"><span>/ 138</span></span>
    <button id="nextBtn">›</button><button id="lastBtn">»</button>
  </div>
</main>
<script>
  const sync = document.querySelector(".compact-sync");
  const toolbar = document.querySelector(".toolbar");
  const a = sync.getBoundingClientRect();
  const b = toolbar.getBoundingClientRect();
  const result = {
    sync: { top:a.top, bottom:a.bottom, left:a.left, right:a.right },
    toolbar: { top:b.top, bottom:b.bottom, left:b.left, right:b.right },
    verticalOverlap: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
    syncPosition: getComputedStyle(sync).position,
  };
  document.title = "LAYOUT:" + encodeURIComponent(JSON.stringify(result));
</script>
</body>
</html>`;

  const file = path.join(os.tmpdir(), `school-layout-${viewport.width}x${viewport.height}.html`);
  fs.writeFileSync(file, html);

  const run = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--run-all-compositor-stages-before-draw",
    `--window-size=${viewport.width},${viewport.height}`,
    "--virtual-time-budget=1500",
    "--dump-dom",
    `file://${file}`,
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  if (run.status !== 0) {
    throw new Error(`${viewport.name}: Chrome failed: ${run.stderr || run.stdout}`);
  }

  const match = run.stdout.match(/<title>LAYOUT:([^<]+)<\/title>/);
  if (!match) {
    throw new Error(`${viewport.name}: Chrome returned no layout result; stdout=${run.stdout.slice(0, 800)}`);
  }

  const result = JSON.parse(decodeURIComponent(match[1]));

  if (result.syncPosition !== "static") {
    throw new Error(`${viewport.name}: compact-sync position is ${result.syncPosition}, expected static`);
  }
  if (result.verticalOverlap > 0.5) {
    throw new Error(
      `${viewport.name}: follow control overlaps toolbar by ${result.verticalOverlap}px; ` +
      `sync=${JSON.stringify(result.sync)} toolbar=${JSON.stringify(result.toolbar)}`
    );
  }

  console.log(`✓ ${viewport.name}: follow row and toolbar do not overlap`);
}
