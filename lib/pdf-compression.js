const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const MB = 1024 * 1024;
const COMPRESSION_THRESHOLD_BYTES = 10 * MB;

function shouldCompress(size) {
  return Number.isFinite(size) && size > COMPRESSION_THRESHOLD_BYTES;
}

function ghostscriptArgs(inputPath, outputPath) {
  return [
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.6",
    "-dPDFSETTINGS=/ebook",
    "-dNOPAUSE",
    "-dQUIET",
    "-dBATCH",
    "-dDetectDuplicateImages=true",
    "-dCompressFonts=true",
    "-dDownsampleColorImages=true",
    "-dColorImageResolution=150",
    "-dDownsampleGrayImages=true",
    "-dGrayImageResolution=150",
    "-dDownsampleMonoImages=true",
    "-dMonoImageResolution=300",
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
}

async function optimizePdfBuffer(buffer) {
  const originalSize = buffer.length;
  if (!shouldCompress(originalSize)) {
    return { buffer, originalSize, finalSize: originalSize, compressed: false };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shool-pdf-"));
  const inputPath = path.join(dir, "input.pdf");
  const outputPath = path.join(dir, "output.pdf");

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync("gs", ghostscriptArgs(inputPath, outputPath), {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });

    const optimized = await fs.readFile(outputPath);

    // Never replace the original with a larger or suspiciously tiny result.
    if (optimized.length >= originalSize || optimized.length < 1024) {
      return { buffer, originalSize, finalSize: originalSize, compressed: false };
    }

    return {
      buffer: optimized,
      originalSize,
      finalSize: optimized.length,
      compressed: true,
    };
  } catch (error) {
    console.error("PDF compression failed; storing original:", error.message);
    return { buffer, originalSize, finalSize: originalSize, compressed: false };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = {
  COMPRESSION_THRESHOLD_BYTES,
  shouldCompress,
  ghostscriptArgs,
  optimizePdfBuffer,
};
