const test = require("node:test");
const assert = require("node:assert/strict");

let utils;
test.before(async () => {
  utils = await import("../public/app-utils.mjs");
});

test("page navigation clamps to valid PDF pages", () => {
  assert.equal(utils.clampPage(-5, 138), 1);
  assert.equal(utils.clampPage(73, 138), 73);
  assert.equal(utils.clampPage(999, 138), 138);
  assert.equal(utils.clampPage("12", 138), 12);
});

test("zoom is limited to 75%-300%", () => {
  assert.equal(utils.clampZoom(0.2), 0.75);
  assert.equal(utils.clampZoom(1), 1);
  assert.equal(utils.clampZoom(4), 3);
});

test("current-page storage uses corrected School App key and keeps legacy fallback key", () => {
  assert.equal(utils.pageStorageKey("doc1", "teacher"), "school:lastPage:doc1:teacher");
  assert.equal(utils.legacyPageStorageKey("doc1", "teacher"), "shool:lastPage:doc1:teacher");
});
