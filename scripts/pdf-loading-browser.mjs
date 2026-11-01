import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import express from "express";
import puppeteer from "puppeteer-core";

// Browser plugin is not available; use the project's existing Puppeteer setup.
// Exercise real pages, PDF.js API, worker, HTTP transfer and canvas rendering.
const root = path.resolve(import.meta.dirname, "..");
const chrome = [process.env.CHROME_BIN, "/usr/bin/chromium", "/usr/bin/google-chrome"]
  .filter(Boolean).find(fs.existsSync);
assert.ok(chrome, "Chromium/Chrome is required for PDF browser checks");
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules/pdfjs-dist/package.json"))).version;

function createPdf() {
  const content = (color, label) => `${color} rg 20 20 100 100 re f\n0 0 0 rg BT /F1 18 Tf 20 160 Td (${label}) Tj ET\n`;
  const stream = (text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream(content("1 0 0", "First page")),
    stream(content("0 0 1", "Second page")),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const pdf = createPdf();
const attempts = new Map();
let httpRequests = [];
const app = express();
app.use((req, _res, next) => { httpRequests.push(req.path); next(); });
app.get("/socket.io/socket.io.js", (_req, res) => res.type("js").send(
  "window.io = () => ({ connected: false, on() { return this; }, emit() { return this; } });"
));
app.get("/api/document", (_req, res) => res.json({ id: "browser-pdf" }));
app.get("/api/document/file", (req, res) => {
  const lesson = req.query.lesson;
  const count = (attempts.get(lesson) || 0) + 1;
  attempts.set(lesson, count);
  if (lesson.includes("fallback") && count === 1) return res.status(503).send("Interrupted PDF stream");
  res.set("Cache-Control", "private, no-store").type("pdf").send(pdf);
});
app.get("/api/notebook", (_req, res) => res.json({ pageCount: 1 }));
app.get(["/api/annotations/:page", "/api/notebook/:page"], (_req, res) => res.json([]));
app.get("/api/lessons", (_req, res) => res.json({ lessons: [] }));
app.get("/api/webrtc/config", (_req, res) => res.json({ enabled: false, iceServers: [] }));
app.get("/favicon.ico", (_req, res) => res.sendStatus(204));
app.use("/vendor/pdfjs", express.static(path.join(root, "node_modules/pdfjs-dist")));
app.use(express.static(path.join(root, "public")));

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const scenarios = ["teacher", "student", "monitor"].flatMap((rolePage) =>
    ["direct", "fallback"].flatMap((mode) =>
      [false, true].map((legacyPromises) => ({ rolePage, mode, legacyPromises }))));
  for (const { rolePage, mode, legacyPromises } of scenarios) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    const warnings = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
      if (message.type() === "warn") warnings.push(message.text());
    });
    page.on("request", (request) => requests.push(request.url()));
    page.on("response", (response) => {
      if (response.status() >= 400 && !(mode === "fallback" && response.status() === 503 && response.url().includes("/api/document/file"))) {
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });
    // Exercise missing Promise.withResolvers in both realms. The worker test
    // bootstrap removes it before importing the real application worker.
    if (legacyPromises) await page.evaluateOnNewDocument(() => {
      Promise.withResolvers = undefined;
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(script, options) {
          const target = new URL(script, location.href).href;
          const bootstrap = new Blob([
            `Promise.withResolvers = undefined; await import(${JSON.stringify(target)});`,
          ], { type: "text/javascript" });
          super(URL.createObjectURL(bootstrap), options);
        }
      };
    });
    await page.setViewport(rolePage === "student" ? { width: 412, height: 915 } : { width: 1280, height: 900 });
    const lesson = `${rolePage}-${mode}${legacyPromises ? "-legacy-promises" : ""}`;
    httpRequests = [];
    await page.goto(`${origin}/${rolePage}.html?lesson=${lesson}`, { waitUntil: "networkidle0" });
    try {
      await page.waitForFunction(() => !document.querySelector("#stage").hidden, { timeout: 15000 });
    } catch (cause) {
      const state = await page.evaluate(() => ({
        loading: document.querySelector("#loadingText")?.textContent,
        empty: document.querySelector("#emptyState")?.textContent,
      }));
      throw new Error(`${lesson} failed to render: ${JSON.stringify({ errors, warnings, state, requests })}`, { cause });
    }
    assert.equal(await page.$eval("#pageTotal", (element) => element.textContent), "/ 2");
    assert.equal(await page.$eval("#pageInput", (element) => element.value), "1");
    assert.deepEqual(await page.$eval("#pdfCanvas", (canvas) => [...canvas.getContext("2d").getImageData(canvas.width * 0.3, canvas.height * 0.65, 1, 1).data]), [255, 0, 0, 255], "first PDF page renders its red rectangle");
    await page.click("#nextBtn");
    await page.waitForFunction(() => document.querySelector("#pageInput").value === "2");
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#pdfCanvas");
      const [red, green, blue, alpha] = canvas.getContext("2d").getImageData(canvas.width * 0.3, canvas.height * 0.65, 1, 1).data;
      return red === 0 && green === 0 && blue === 255 && alpha === 255;
    });
    const configuration = await page.evaluate(async () => {
      const { pdfjsLib } = await import("/pdf-loader.mjs");
      return { version: pdfjsLib.version, worker: pdfjsLib.GlobalWorkerOptions.workerSrc };
    });
    assert.equal(configuration.version, packageVersion);
    assert.equal(configuration.worker, "/pdf-worker.mjs");
    assert.ok(requests.includes(`${origin}/vendor/pdfjs/legacy/build/pdf.mjs`), "local legacy API requested");
    assert.ok(httpRequests.includes("/pdf-worker.mjs"), "local worker compatibility bootstrap requested");
    assert.ok(httpRequests.includes("/vendor/pdfjs/legacy/build/pdf.worker.mjs"), "matching local package worker requested");
    assert.ok(requests.every((url) => url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:")), "no CDN requests");
    assert.equal(attempts.get(lesson), mode === "fallback" ? 2 : 1);
    assert.equal(warnings.some((message) => message.includes("retrying as a full download")), mode === "fallback");
    // Chromium's readback advisory is caused by these pixel assertions.
    assert.deepEqual(warnings.filter((message) => !message.includes("retrying as a full download") && !message.startsWith("Canvas2D:")), [], "no unexpected PDF warnings");
    assert.deepEqual(errors, [], `${lesson} has no application errors`);
    if (rolePage === "monitor" && mode === "direct") {
      const screenshot = path.join(os.tmpdir(), "school-pdf-monitor.png");
      await page.screenshot({ path: screenshot });
      console.log(`Observer screenshot: ${screenshot}`);
    }
    console.log(`PASS ${lesson}: PDF.js ${configuration.version}, 2 pages rendered and navigated`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
