const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const page of ["public/teacher.html", "public/student.html"]) {
  test(`${page} exposes drawing, erasing, hand, zoom and page navigation controls`, () => {
    const html = read(page);
    for (const id of [
      "penBtn", "eraserBtn", "handBtn", "lineBtn", "arrowBtn", "circleBtn", "ovalBtn", "undoBtn",
      "zoomOutBtn", "zoomResetBtn", "zoomInBtn",
      "firstBtn", "prevBtn", "pageInput", "nextBtn", "lastBtn",
      "pdfCanvas", "drawCanvas",
    ]) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, /School App/);
  });
}

test("teacher alone gets teacher-only controls", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");
  assert.match(teacher, /id="pdfUpload"/);
  assert.doesNotMatch(student, /id="pdfUpload"/);
  assert.match(teacher, /id="followBtn"/);
  assert.doesNotMatch(student, /id="followBtn"/);
  assert.match(teacher, /id="textBtn"/);
  assert.match(teacher, /id="textSizeSelect"/);
  assert.doesNotMatch(student, /id="textBtn"/);
  assert.doesNotMatch(student, /id="textSizeSelect"/);
  assert.match(student, /id="followStatus"/);
  assert.doesNotMatch(teacher, /id="perfLogButton"/);
  assert.doesNotMatch(student, /id="perfLogButton"/);
});

test("landing page links to both roles, help, and owner performance dashboard", () => {
  const html = read("public/index.html");
  assert.match(html, /href="\/teacher"/);
  assert.match(html, /href="\/student"/);
  assert.match(html, /id="infoBtn"/);
  assert.match(html, /id="perfLogButton"/);
  assert.match(html, /href="\/performance"/);
  assert.match(html, /Как пользоваться/);
  assert.match(html, /School App/);
});

test("client keeps PDF cache versioning, loading progress and page persistence", () => {
  const js = read("public/app.js");
  assert.match(js, /document\/file\?id=/);
  assert.match(js, /loadingTask\.onProgress/);
  assert.match(js, /pageStorageKey/);
  assert.match(js, /legacyPageStorageKey/);
  assert.match(js, /erase:path/);
  assert.match(js, /stroke:preview/);
  assert.match(js, /teacher:follow:state/);
  assert.match(js, /teacher:page/);
  assert.match(js, /forcedByTeacher/);
});

test("server protects the PDF role gate, versioned cache and health route", () => {
  const js = read("server.js");
  assert.match(js, /TEACHER_ONLY/);
  assert.match(js, /Cache-Control", "public, max-age=31536000, immutable"/);
  assert.match(js, /Accept-Ranges", "bytes"/);
  assert.match(js, /Content-Range/);
  assert.match(js, /status\(206\)/);
  assert.match(js, /status\(416\)/);
  assert.match(js, /app\.get\("\/health"/);
  assert.match(js, /db = client\.db\("school_app"\)/);
  assert.match(js, /teacher:follow:start/);
  assert.match(js, /teacher:follow:stop/);
  assert.match(js, /teacher:page/);
});

test("teacher follow button stays clickable and reports failures instead of remaining disabled", () => {
  const js = read("public/app.js");
  assert.match(js, /followBtn\.disabled = false/);
  assert.match(js, /teacher:follow:start/);
  assert.match(js, /teacher:follow:stop/);
  assert.match(js, /Не удалось связать страницы/);
});

test("live drawing uses throttled preview chunks", () => {
  const js = read("public/app.js");
  assert.match(js, /PREVIEW_INTERVAL_MS/);
  assert.match(js, /buildPreviewChunk/);
  assert.match(js, /mergePreviewStroke/);
  assert.match(js, /scheduleStrokePreview/);
  assert.match(js, /flushStrokePreview/);
});

test("live performance metrics cover RTT page render and remote stroke latency", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const dashboard = read("public/performance.html");

  assert.match(dashboard, /id="rttAvg"/);
  assert.match(dashboard, /id="pageAvg"/);
  assert.match(dashboard, /id="strokeAvg"/);
  assert.match(client, /perf:ping/);
  assert.match(client, /perf:preview:seen/);
  assert.match(client, /perfMetrics\.rtt/);
  assert.match(client, /perfMetrics\.page/);
  assert.match(client, /perfMetrics\.stroke/);
  assert.match(client, /renderStarted = performance\.now\(\)/);
  assert.match(server, /socket\.on\("perf:ping"/);
  assert.match(server, /socket\.on\("perf:preview:seen"/);
  assert.match(server, /perfOriginId/);
});

test("performance logging is isolated from the lesson and persisted separately", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const dashboard = read("public/performance.html");

  assert.match(client, /setInterval\(sendPerformanceLog, 20000\)/);
  assert.match(client, /fetch\("\/api\/performance"/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /Diagnostics must never disturb the lesson/);
  assert.match(server, /performance_logs/);
  assert.match(server, /app\.post\("\/api\/performance"/);
  assert.match(server, /app\.get\("\/api\/performance"/);
  assert.match(server, /expireAfterSeconds: 30 \* 24 \* 60 \* 60/);
  assert.match(server, /app\.get\("\/performance"/);
  assert.match(dashboard, /Последние замеры/);
  assert.match(dashboard, /Штрих round-trip/);
});

test("lesson pages hide owner performance navigation and inline metrics", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");

  assert.doesNotMatch(teacher, /id="perfStats"/);
  assert.doesNotMatch(student, /id="perfStats"/);
  assert.doesNotMatch(teacher, /id="perfLogButton"/);
  assert.doesNotMatch(student, /id="perfLogButton"/);
});

test("teacher keyboard text annotations can be selected, saved, synced and erased", () => {
  const client = read("public/app.js");
  const server = read("server.js");
  const teacher = read("public/teacher.html");

  assert.match(teacher, /id="textBtn"/);
  assert.match(client, /openTextEditor/);
  assert.match(client, /syncTextEditorGeometry/);
  assert.match(client, /textSizeSelect/);
  assert.match(client, /textFontSize/);
  assert.match(client, /editor\.style\.fontSize/);
  assert.match(client, /fontScale/);
  assert.match(client, /drawCanvas\.getBoundingClientRect\(\)\.width/);
  assert.match(client, /tool === "text"[\s\S]*textAtPoint\(point\)[\s\S]*openTextEditor\(point\)/);
  assert.match(client, /activeTextMove/);
  assert.match(client, /remainingWidthPx/);
  assert.match(client, /const leftPx = clickX/);
  assert.match(client, /socket\.emit\("text:commit", item\)/);
  assert.doesNotMatch(client, /activeTextBox/);
  assert.match(client, /text:commit/);
  assert.match(client, /text:committed/);
  assert.match(client, /drawTextAnnotation/);
  assert.match(client, /erasePathHitsTextBox/);
  assert.match(client, /Ctrl|ctrlKey|metaKey/);
  assert.match(server, /isValidTextAnnotation/);
  assert.match(server, /socket\.on\("text:commit"/);
  assert.match(server, /type: "text"/);
  assert.match(server, /fontScale/);
  assert.match(server, /erasePathHitsBox/);
});

test("desktop swaps Hand for precision shape tools while touch layouts keep them hidden", () => {
  const css = read("public/styles.css");
  const client = read("public/app.js");
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");

  for (const html of [teacher, student]) {
    for (const id of ["lineBtn", "arrowBtn", "circleBtn", "ovalBtn"]) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
      assert.match(html, new RegExp(`id=["']${id}["'][^>]*desktop-shape-tool`));
    }
  }

  assert.match(css, /\.desktop-shape-tool\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /#handBtn\s*\{\s*display:\s*none/);
  assert.match(css, /\.desktop-shape-tool\s*\{\s*display:\s*inline-flex/);

  assert.match(client, /shapeToolActive/);
  assert.match(client, /buildShapeStroke/);
  assert.match(client, /\["line", "arrow", "circle", "oval"\]/);
  assert.match(client, /activeShape/);
  assert.match(client, /socket\.emit\("stroke:commit", finished\)/);
});
