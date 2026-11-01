// API, worker and supporting assets come from one pinned npm package.
// The legacy build includes PDF.js compatibility polyfills for older browsers.
import "./pdf-compat.mjs";
import * as pdfjsLib from "/vendor/pdfjs/legacy/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf-worker.mjs";

export const pdfDocumentOptions = Object.freeze({
  cMapUrl: "/vendor/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
  wasmUrl: "/vendor/pdfjs/wasm/",
});

export { pdfjsLib };
