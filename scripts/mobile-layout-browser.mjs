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
  { name: "phone portrait", width: 412, height: 915, expectStaticSync: true },
  { name: "tablet portrait", width: 800, height: 1200, expectStaticSync: true },
  { name: "desktop 1366", width: 1366, height: 768, expectStaticSync: false },
  { name: "desktop 1920", width: 1920, height: 1080, expectStaticSync: false },
];

function rectData(rect) {
  return { top:rect.top, bottom:rect.bottom, left:rect.left, right:rect.right, width:rect.width, height:rect.height };
}

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
  <a class="pdf-brand"><span class="pdf-brand-owl">🦉</span><span>School <b>App</b></span></a>
  <div class="pdf-lesson-title"><strong>Занятие</strong><span>онлайн</span></div>
  <div class="pdf-header-actions"><a class="pdf-action">↓ PDF</a><label class="pdf-action compact-upload">+ PDF</label></div>
</header>
<main>
  <div class="lesson-sync-row compact-sync">
    <button id="followBtn" class="follow-button" type="button">🔗 Вести ученика</button>
  </div>
  <div class="toolbar">
    <button id="penBtn" class="active tool-icon-btn">✎</button>
    <button id="eraserBtn" class="tool-icon-btn">⌫</button>
    <button id="handBtn">Рука</button>
    <div class="desktop-shape-group">
      <button class="desktop-shape-tool">╱</button>
      <button class="desktop-shape-tool">→</button>
      <button class="desktop-shape-tool">○</button>
      <button class="desktop-shape-tool">⬭</button>
    </div>
    <button id="textBtn">Текст</button>
    <label class="text-size-control"><span>Шрифт</span><select><option>18</option></select></label>
    <div class="zoom-controls"><button>−</button><button id="zoomResetBtn">100%</button><button>+</button></div>
    <button id="undoBtn">↶ Отменить</button>
    <span class="spacer"></span>
    <button id="firstBtn">«</button><button id="prevBtn">‹</button>
    <span id="pageInfo" class="page-jump"><input id="pageInput" value="1"><span>/ 138</span></span>
    <button id="nextBtn">›</button><button id="lastBtn">»</button>
  </div>
  <div id="stage"><div id="pageShell" style="width:900px;height:1200px"></div></div>
</main>
<script>
  const sync = document.querySelector(".compact-sync");
  const toolbar = document.querySelector(".toolbar");
  const header = document.querySelector(".pdf-header");
  const headerActions = document.querySelector(".pdf-header-actions");
  const stage = document.getElementById("stage");
  const a = sync.getBoundingClientRect();
  const b = toolbar.getBoundingClientRect();
  const h = header.getBoundingClientRect();
  const ha = headerActions.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const result = {
    viewport: { width: innerWidth, height: innerHeight },
    sync: { top:a.top, bottom:a.bottom, left:a.left, right:a.right, width:a.width, height:a.height },
    toolbar: { top:b.top, bottom:b.bottom, left:b.left, right:b.right, width:b.width, height:b.height },
    header: { top:h.top, bottom:h.bottom, left:h.left, right:h.right, width:h.width, height:h.height },
    headerActions: { top:ha.top, bottom:ha.bottom, left:ha.left, right:ha.right, width:ha.width, height:ha.height },
    stage: { top:s.top, bottom:s.bottom, left:s.left, right:s.right, width:s.width, height:s.height },
    overlapArea: overlapX * overlapY,
    syncPosition: getComputedStyle(sync).position,
    toolbarOverflowX: toolbar.scrollWidth > toolbar.clientWidth + 1,
    bodyOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
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

  if (viewport.expectStaticSync && result.syncPosition !== "static") {
    throw new Error(`${viewport.name}: compact-sync position is ${result.syncPosition}, expected static`);
  }
  if (result.overlapArea > 0.5) {
    throw new Error(
      `${viewport.name}: follow control overlaps toolbar; sync=${JSON.stringify(result.sync)} toolbar=${JSON.stringify(result.toolbar)}`
    );
  }
  if (result.toolbar.left < -0.5 || result.toolbar.right > result.viewport.width + 0.5) {
    throw new Error(`${viewport.name}: toolbar escapes viewport: ${JSON.stringify(result.toolbar)}`);
  }
  if (result.headerActions.right > result.viewport.width + 0.5 || result.headerActions.left < -0.5) {
    throw new Error(`${viewport.name}: header actions escape viewport: ${JSON.stringify(result.headerActions)}`);
  }
  if (result.bodyOverflowX) {
    throw new Error(`${viewport.name}: page has horizontal body overflow`);
  }
  if (result.stage.top < result.toolbar.bottom - 0.5) {
    throw new Error(
      `${viewport.name}: PDF stage starts under toolbar; stage.top=${result.stage.top}, toolbar.bottom=${result.toolbar.bottom}`
    );
  }
  if (viewport.width >= 1200 && result.toolbarOverflowX) {
    throw new Error(`${viewport.name}: desktop toolbar unexpectedly needs horizontal scrolling`);
  }

  console.log(
    `✓ ${viewport.name}: toolbar/header/stage are inside viewport and follow control does not overlap`
  );
}
