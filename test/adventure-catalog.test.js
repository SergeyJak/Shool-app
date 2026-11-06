const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../public/adventure/catalog');
const fs = require('node:fs');
const vm = require('node:vm');

test('every unfinished level opens a distinct named five-round teaching game', () => {
  assert.equal(catalog.all.length, 94);
  for (let number = 7; number <= 100; number++) {
    const game = catalog.get(number);
    assert.ok(game, `Missing game ${number}`);
    assert.equal(game.level, number);
    assert.equal(game.chapter, Math.ceil(number / 5));
    assert.equal(game.rounds.length, 5);
    assert.ok(game.intro && game.success && game.skill && game.icon);
    for (const task of game.rounds) assert.ok(task.prompt && task.hint && task.explanation);
  }
  assert.equal(new Set(catalog.all.map(game => game.title)).size, 94);
  assert.equal(catalog.get(7).title, 'Магазин монет');
  assert.equal(catalog.get(100).title, 'Финальное приключение');
});

test('the actual browser scripts register the same complete curriculum', () => {
  const browser = vm.createContext({});
  for (const script of ['levels-007-030', 'levels-031-055', 'levels-056-080', 'levels-081-100', 'catalog']) {
    vm.runInContext(fs.readFileSync(require.resolve('../public/adventure/' + script), 'utf8'), browser);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(browser.AdventureLevels.all)), catalog.all);
  assert.equal(browser.AdventureLevels.get(100).title, 'Финальное приключение');
});
