const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
test("pinned PDF.js includes the CVE-2026-16633 fix", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const [major, minor, patch] = pkg.dependencies["pdfjs-dist"].split(".").map(Number);
  assert.ok(major > 6 || (major === 6 && (minor > 2 || (minor === 2 && patch >= 108))),
    "Use a patched supported release (6.2.108 or later), not the vulnerable Node 20 branch");
});
const appSource = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
// Execute the real loader with only its browser/network boundaries substituted.
const loadDocumentSource = appSource.slice(
  appSource.indexOf("async function loadDocument()"),
  appSource.indexOf("function syncPageControls()")
);

async function openDocument({ fallback = false } = {}) {
  const calls = [];
  const errors = [];
  let rendered = false;
  const element = () => ({ hidden: false, textContent: "", removeAttribute() {} });
  const context = {
    pdfDoc: null, pdfDocumentOptions: {},
    downloadPdfBtn: element(),
    stage: element(), emptyState: element(), loadingState: element(), loadingText: element(),
    syncPageControls() {}, lessonParam: "test-lesson", currentDocumentId: null,
    pageNumber: 1, role: "observer", teacherFollowEnabled: false,
    pageStorageKey: () => "page", legacyPageStorageKey: () => "legacy-page",
    localStorage: { getItem: () => null }, TextDecoder, Uint8Array,
    console: { warn() {}, error: (...args) => errors.push(args) },
    fetch: async (url) => url.startsWith("/api/document?")
      ? { ok: true, status: 200, json: async () => ({ id: "document-1" }) }
      : { ok: true, arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7\n").buffer },
    pdfjsLib: {
      getDocument(options) {
        calls.push(options);
        return { promise: fallback && calls.length === 1
          ? Promise.reject(new Error("simulate interrupted streaming response"))
          : Promise.resolve({ numPages: 1 }) };
      },
    },
    renderPage: async () => { rendered = true; },
  };
  await vm.runInNewContext(`${loadDocumentSource}\nloadDocument();`, context);
  assert.deepEqual(errors, [], "PDF load should succeed");
  assert.equal(rendered, true);
  return { calls, context };
}

test("direct PDF loading disables eval while preserving the authorized file URL", async () => {
  const { calls } = await openDocument();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].isEvalSupported, false);
  assert.equal(calls[0].url, "/api/document/file?id=document-1&lesson=test-lesson");
});

test("full-download PDF fallback also disables eval", async () => {
  const { calls } = await openDocument({ fallback: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].isEvalSupported, false);
  assert.ok(calls[1].data instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(calls[1].data).slice(0, 5), "%PDF-");
});

for (const page of ["teacher", "student", "monitor"]) {
  test(`${page} loads the shared application without a separate CDN PDF.js`, () => {
    const html = fs.readFileSync(path.join(root, `public/${page}.html`), "utf8");
    assert.match(html, /type="module" src="\/app\.js/);
    assert.doesNotMatch(html, /<script[^>]+(?:cdnjs|pdf\.min|pdf\.worker)/);
  });
}
