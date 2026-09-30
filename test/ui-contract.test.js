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
      "penBtn", "eraserBtn", "handBtn", "undoBtn",
      "zoomOutBtn", "zoomResetBtn", "zoomInBtn",
      "firstBtn", "prevBtn", "pageInput", "nextBtn", "lastBtn",
      "pdfCanvas", "drawCanvas",
    ]) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, /School App/);
  });
}

test("teacher alone gets the PDF upload control", () => {
  assert.match(read("public/teacher.html"), /id="pdfUpload"/);
  assert.doesNotMatch(read("public/student.html"), /id="pdfUpload"/);
});

test("landing page links to both roles and contains help instructions", () => {
  const html = read("public/index.html");
  assert.match(html, /href="\/teacher"/);
  assert.match(html, /href="\/student"/);
  assert.match(html, /id="infoBtn"/);
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
});

test("server protects the PDF role gate, versioned cache and health route", () => {
  const js = read("server.js");
  assert.match(js, /TEACHER_ONLY/);
  assert.match(js, /Cache-Control", "public, max-age=31536000, immutable"/);
  assert.match(js, /app\.get\("\/health"/);
  assert.match(js, /db = client\.db\("school_app"\)/);
});
