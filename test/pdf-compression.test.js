const test = require("node:test");
const assert = require("node:assert/strict");
const {
  COMPRESSION_THRESHOLD_BYTES,
  shouldCompress,
  ghostscriptArgs,
} = require("../lib/pdf-compression");

test("compresses only PDFs larger than 10 MiB", () => {
  assert.equal(shouldCompress(COMPRESSION_THRESHOLD_BYTES), false);
  assert.equal(shouldCompress(COMPRESSION_THRESHOLD_BYTES + 1), true);
});

test("Ghostscript profile downsamples scans to sensible lesson quality", () => {
  const args = ghostscriptArgs("/tmp/in.pdf", "/tmp/out.pdf");
  assert.ok(args.includes("-dColorImageResolution=150"));
  assert.ok(args.includes("-dGrayImageResolution=150"));
  assert.ok(args.includes("-dMonoImageResolution=300"));
  assert.ok(args.includes("-dDetectDuplicateImages=true"));
  assert.ok(args.includes("-sOutputFile=/tmp/out.pdf"));
});
