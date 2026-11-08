"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bankPath = path.join(__dirname, "../lib/math-diagnostic-bank-v3.js");
function loadBank() {
  assert.ok(fs.existsSync(bankPath), "the curriculum diagnostic bank must exist");
  return require(bankPath);
}

test("curriculum bank gives every actual map three distinct numeric probes", () => {
  const { BANK, TOPICS } = loadBank();
  const catalog = require("../lib/math-game-catalog.json");
  const skills = ["numbers", "arithmetic", "wordProblems", "fractions", "geometry", "measurements", "patterns"];
  assert.equal(TOPICS.length, 20);
  assert.equal(BANK.length, 60);
  assert.equal(new Set(BANK.map(q => q.id)).size, 60);
  for (const map of catalog.maps) {
    const topic = TOPICS.find(t => t.chapter === map.id);
    assert.equal(topic.title, map.topic);
    assert.ok(skills.includes(topic.skill));
    const questions = BANK.filter(q => q.chapter === map.id);
    assert.deepEqual(questions.map(q => q.id), ["a", "b", "c"].map(part => `d3-${map.id}-${part}`));
    assert.equal(new Set(questions.map(q => q.kind)).size, 3, `chapter ${map.id} must probe different concepts`);
    assert.ok(questions.every(q => q.skill === topic.skill));
  }
  for (const q of BANK) {
    assert.ok(q.topic && q.prompt && q.explanation && q.kind);
    assert.equal(typeof q.answer, "string");
    assert.match(q.answer, /^-?\d+(?:\.\d+)?$/);
    assert.ok(["integer", "decimal"].includes(q.answerFormat.kind));
    if (q.answerFormat.kind === "integer") assert.ok(Number.isInteger(Number(q.answer)));
    assert.doesNotMatch(q.prompt, /ответ.*(?:см²|число с единицей)/i);
  }
});

test("representative answers agree with independent arithmetic and curriculum reasoning", () => {
  const { BANK } = loadBank();
  const expected = [
    [5, 9 - 4, 8 - 2],
    [4 * 10 + 7, 38 + 7, 62 - 8],
    [400 + 7, 0, 530 + 260],
    [4 * 3, 7 * 8, 54 / 6],
    [18 / 3, 24 / 6, 35 / 5],
    [347 + 286, (84 - 36) / 6, 96 / 8 + 7 * 3],
    [12 - 5, 3 * 6 + 4, 25 - 9 - 7],
    [2 * 100 + 35, 2 * 1000 + 300, 3 * 1000 - 750],
    [35, 24 * 60 + 30, 9 + 7],
    [5, 2 * (6 + 4), 8 + 7 + 7],
    [3 * 4, 24 / 6, 5 * 4 - 2 * 2],
    [3, 8 / 4 * 3, 6 / 3],
    [3, 1 + 2, 12 - 5],
    [125, (120 + 55) / 100, (200 - 135) / 100],
    [25, 80 * 25 / 100, 200 * (1 - 25 / 100)],
    [2 * 3, 250 * 3, 12 * 3],
    [14 - 6, (26 - 5) / 3, 20 - 11],
    [-2, 4 - 3, 3 * 2],
    [16 / 2, 7 - 4, 3],
    [200 - 80 - 45, 20 / 4 * 3, 60 + 25]
  ];
  for (let chapter = 1; chapter <= 20; chapter++) {
    for (const [index, suffix] of ["a", "b", "c"].entries()) {
      const q = BANK.find(q => q.id === `d3-${chapter}-${suffix}`);
      assert.equal(Number(q.answer), expected[chapter - 1][index], q.id);
    }
  }
});

test("bank and nested visual models cannot be mutated between student sessions", () => {
  const { BANK, TOPICS } = loadBank();
  function frozen(value) {
    if (!value || typeof value !== "object") return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
  frozen(BANK);
  frozen(TOPICS);
  for (const q of BANK.filter(q => q.visual)) {
    assert.ok(["items", "groups", "fraction", "bars", "place-value", "equation"].includes(q.visual.type));
    assert.equal(q.visual.answer, undefined);
    assert.equal(q.visual.solution, undefined);
    if (q.visual.type === "fraction") {
      assert.ok(q.visual.parts > 0);
      assert.ok(q.visual.filled >= 0 && q.visual.filled <= q.visual.parts);
    }
    if (q.visual.type === "bars") assert.equal(q.visual.labels.length, q.visual.values.length);
  }
});
