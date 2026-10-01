const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

for (const file of ["server.js", "public/cabinet.js"]) {
  test(`${file} passes Node syntax check`, () => {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["--check", path.join(root, file)], {
        stdio: "pipe",
      });
    });
  });
}
