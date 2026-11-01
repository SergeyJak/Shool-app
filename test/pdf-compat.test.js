const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const compatibilityFile = path.resolve(__dirname, "../public/pdf-compat.mjs");
function compatibilitySource() {
  assert.ok(fs.existsSync(compatibilityFile), "PDF compatibility module must exist");
  return fs.readFileSync(compatibilityFile, "utf8");
}

test("PDF compatibility restores Promise.withResolvers with resolution and rejection", async () => {
  const context = vm.createContext();
  vm.runInContext("Promise.withResolvers = undefined", context);
  vm.runInContext(compatibilitySource(), context);
  const result = vm.runInContext("Promise.withResolvers()", context);
  assert.equal(typeof result.resolve, "function");
  assert.equal(typeof result.reject, "function");
  result.resolve("loaded");
  assert.equal(await result.promise, "loaded");
  const rejected = vm.runInContext("Promise.withResolvers()", context);
  rejected.reject(new Error("PDF download interrupted"));
  await assert.rejects(rejected.promise, /PDF download interrupted/);
});

test("PDF compatibility preserves native Promise.withResolvers", () => {
  const context = vm.createContext();
  vm.runInContext("Promise.withResolvers = function nativeSentinel() {}; var original = Promise.withResolvers", context);
  vm.runInContext(compatibilitySource(), context);
  assert.equal(vm.runInContext("Promise.withResolvers === original", context), true);
});

test("PDF Promise.withResolvers compatibility uses the requested Promise constructor", async () => {
  const context = vm.createContext();
  vm.runInContext("Promise.withResolvers = undefined", context);
  vm.runInContext(compatibilitySource(), context);
  const result = vm.runInContext("class PdfPromise extends Promise {}; var task = PdfPromise.withResolvers(); task.resolve(task.promise instanceof PdfPromise); task.promise", context);
  assert.equal(await result, true);
});
