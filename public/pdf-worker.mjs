// Compatibility must run before the worker module's initialization.
import "./pdf-compat.mjs";
export * from "/vendor/pdfjs/legacy/build/pdf.worker.mjs";
