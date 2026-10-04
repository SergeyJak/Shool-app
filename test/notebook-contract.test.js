const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("lesson pages expose textbook/notebook switch and lined notebook canvas", () => {
  for (const file of ["public/teacher.html", "public/student.html"]) {
    const html = read(file);
    assert.match(html, /id="viewPdfBtn"/);
    assert.match(html, /id="viewNotebookBtn"/);
    assert.match(html, /id="lessonPdfMain"/);
    assert.match(html, /id="lessonNotebookView"/);
    assert.match(html, /id="notebookPaperCanvas"/);
    assert.match(html, /id="notebookInkCanvas"/);
    assert.match(html, /id="notebookAddPageBtn"/);
    assert.match(html, /notebook\.mjs\?v=20261004-notebook2/);
    assert.match(html, /notebook\.css\?v=20261004-notebook2/);
  }
});

test("notebook client supports unlimited pages, drawing, erasing, undo and persistence", () => {
  const client = read("public/notebook.mjs");
  assert.match(client, /\/api\/notebook\/pages/);
  assert.match(client, /\/api\/notebook\/strokes/);
  assert.match(client, /\/api\/notebook\/erase/);
  assert.match(client, /\/api\/notebook\/undo/);
  assert.match(client, /crypto\.randomUUID\(\)/);
  assert.match(client, /drawPaper/);
  assert.match(client, /lineGap/);
  assert.match(client, /localStorage\.setItem/);
});

test("notebook data is scoped by lesson and user on the server", () => {
  const server = read("server.js");
  assert.match(server, /notebooks = db\.collection/);
  assert.match(server, /notebookAnnotations = db\.collection/);
  assert.match(server, /app\.get\("\/api\/notebook"/);
  assert.match(server, /app\.post\("\/api\/notebook\/pages"/);
  assert.match(server, /app\.get\("\/api\/notebook\/:page"/);
  assert.match(server, /app\.post\("\/api\/notebook\/strokes"/);
  assert.match(server, /app\.post\("\/api\/notebook\/erase"/);
  assert.match(server, /app\.post\("\/api\/notebook\/undo"/);
  assert.match(server, /lessonId: req\.lessonId, userId/);
  assert.match(server, /notebookAnnotations\.createIndex\(\{ lessonId: 1, userId: 1, page: 1, createdAt: 1 \}\)/);
});

test("notebook module has valid JavaScript syntax", () => {
  const result = spawnSync(process.execPath, ["--check", path.join(root, "public/notebook.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("teacher notebook supports typed text with font sizes while student notebook stays drawing-only", () => {
  const teacher = read("public/teacher.html");
  const student = read("public/student.html");
  const client = read("public/notebook.mjs");
  const server = read("server.js");

  assert.match(teacher, /id="notebookTextBtn"/);
  assert.match(teacher, /id="notebookTextSizeSelect"/);
  assert.doesNotMatch(student, /id="notebookTextBtn"/);
  assert.doesNotMatch(student, /id="notebookTextSizeSelect"/);

  assert.match(client, /function openTextEditor/);
  assert.match(client, /function drawTextAnnotation/);
  assert.match(client, /function textAtPoint/);
  assert.match(client, /\/api\/notebook\/text/);
  assert.match(client, /fontScale/);
  assert.match(client, /notebook-text-editor/);

  assert.match(server, /app\.post\("\/api\/notebook\/text", requireApiRole\("teacher"\)/);
  assert.match(server, /type: "text"/);
  assert.match(server, /isValidTextAnnotation\(item\)/);
  assert.match(server, /erasePathHitsBox\(erase, stroke\.box\)/);
});
