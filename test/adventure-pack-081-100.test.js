'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const catalog = require('../lib/math-game-catalog.json');
const filename = path.join(__dirname, '../public/adventure/levels-081-100.js');
const pack = fs.existsSync(filename) ? require(filename) : [];
const round = (level, index) => pack.find(item => item.level === level).rounds[index];

function reachable(start, target, steps, limit) {
  let seen = new Set([start]);
  for (let n = 0; n <= limit; n++) {
    if (seen.has(target)) return true;
    seen = new Set([...seen].flatMap(value => steps.map(step => value + step)));
  }
  return false;
}

test('last twenty games have the catalog identities and five teaching rounds', () => {
  assert.deepEqual(pack.map(item => item.level), Array.from({ length: 20 }, (_, i) => 81 + i));
  const scenes = new Set('shop train forest balloon city island cave castle workshop clock geometry fractions river market mountain laboratory space logic'.split(' '));
  for (const level of pack) {
    const identity = catalog.games.find(item => item.level === level.level);
    assert.equal(level.title, identity.title);
    assert.equal(level.skill, identity.skillIds[0]);
    assert.equal(level.chapter, identity.map);
    assert.ok(scenes.has(level.scene));
    assert.equal(level.rounds.length, 5);
    for (const text of [level.intro, level.success, ...level.rounds.flatMap(r => [r.prompt, r.hint, r.explanation])]) {
      assert.match(text, /[А-Яа-яЁё]/);
      assert.doesNotMatch(text, /<\/?\w/);
    }
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(level))), JSON.stringify(level));
  }
});

test('every construction has a reachable answer within the mobile board limits', () => {
  assert.equal(pack.length, 20);
  const mechanics = new Set();
  for (const level of pack) for (const r of level.rounds) {
    mechanics.add(r.mechanic);
    const note = `level ${level.level}: ${r.prompt}`;
    switch (r.mechanic) {
      case 'compose':
        assert.ok(Number.isInteger(r.target) && r.target > 0, note);
        assert.ok(r.pieces.every(piece => Number.isInteger(piece.value) && piece.value > 0), note);
        assert.ok(reachable(0, r.target, r.pieces.map(piece => piece.value), r.maxPieces || 25), note);
        break;
      case 'route':
        assert.ok(r.steps.every(Number.isInteger), note);
        assert.ok(reachable(r.start, r.target, r.steps, 12), note);
        break;
      case 'share':
        assert.equal(r.total, r.groups * r.each, note);
        assert.ok(r.groups >= 2 && r.groups <= 6 && r.total <= 36, note);
        break;
      case 'rectangle': {
        assert.ok(r.cols >= 2 && r.cols <= 10 && r.rows >= 2 && r.rows <= 10, note);
        let possible = false;
        for (let x = 1; x <= r.cols; x++) for (let y = 1; y <= r.rows; y++) {
          if ((!r.targetArea || x * y === r.targetArea) && (!r.targetPerimeter || 2 * (x + y) === r.targetPerimeter)) possible = true;
        }
        assert.ok(possible && (!r.targetArea || r.targetArea <= 60), note);
        break;
      }
      case 'fraction':
        assert.ok(r.parts >= 2 && r.parts <= 16, note);
        assert.ok(r.target.n > 0 && r.target.n <= r.target.d, note);
        assert.ok(Number.isInteger(r.parts * r.target.n / r.target.d), note);
        break;
      case 'order':
        assert.ok(r.items.length <= 7, note);
        assert.deepEqual([...r.solution].sort(), r.items.map(item => item.id).sort(), note);
        assert.equal(new Set(r.solution).size, r.items.length, note);
        break;
      case 'sequence':
        assert.equal(r.terms.length, r.solution.length, note);
        assert.ok(r.terms.length <= 7 && r.terms.filter(term => term === null).length >= 2, note);
        r.terms.forEach((term, i) => term === null ? assert.ok(r.choices.includes(r.solution[i]), note) : assert.equal(term, r.solution[i], note));
        break;
      case 'match':
        assert.ok(r.pairs.length >= 2 && r.pairs.length <= 4, note);
        assert.equal(new Set(r.pairs.map(p => p.id)).size, r.pairs.length, note);
        assert.equal(new Set(r.pairs.map(p => p.right)).size, r.pairs.length, note);
        break;
      case 'sort':
        assert.ok(r.bins.length >= 2 && r.bins.length <= 3 && r.items.length >= 3 && r.items.length <= 6, note);
        assert.equal(new Set(r.items.map(item => item.id)).size, r.items.length, note);
        assert.ok(r.items.every(item => r.bins.some(bin => bin.id === item.bin)), note);
        break;
      case 'coordinate': {
        assert.ok(r.xMax - r.xMin <= 8 && r.yMax - r.yMin <= 8, note);
        assert.ok(r.targets.length >= 1 && r.targets.length <= 4, note);
        assert.ok(['point', 'robot'].includes(r.mode), note);
        for (const p of [...r.targets, ...(r.start ? [r.start] : [])]) {
          assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), note);
          assert.ok(p.x >= r.xMin && p.x <= r.xMax && p.y >= r.yMin && p.y <= r.yMax, note);
        }
        if (r.mode === 'robot') {
          assert.ok(r.start, note);
          const route = [r.start, ...r.targets];
          assert.ok(route.slice(1).every((p, i) => Math.abs(p.x - route[i].x) + Math.abs(p.y - route[i].y) <= 12), note);
        }
        break;
      }
      case 'bars':
        assert.ok(r.labels.length >= 2 && r.labels.length <= 4, note);
        assert.equal(r.labels.length, r.values.length, note);
        assert.ok(r.maxValue <= 12 && r.values.every(v => Number.isInteger(v) && v >= 0 && v <= r.maxValue), note);
        break;
      case 'measure':
        assert.ok(r.min <= r.target && r.target <= r.max && r.step > 0, note);
        assert.ok(Math.abs((r.target - r.min) / r.step - Math.round((r.target - r.min) / r.step)) < 1e-9, note);
        break;
      case 'clock':
        assert.ok(r.hour >= 0 && r.hour <= 23 && r.minute >= 0 && r.minute <= 55 && r.minute % 5 === 0, note);
        break;
      case 'calendar':
        assert.equal(new Date(Date.UTC(r.year, r.month - 1, r.day)).getUTCMonth(), r.month - 1, note);
        break;
      default: assert.fail(`Unsupported mechanic ${r.mechanic}: ${note}`);
    }
  }
  assert.ok(mechanics.size >= 12, 'the final chapters require varied manipulation');
  for (const level of pack.filter(item => item.level >= 96)) assert.ok(new Set(level.rounds.map(r => r.mechanic)).size >= 4);
});

test('representative equations, graph coordinates and deductions are mathematically correct', () => {
  assert.equal(pack.length, 20);
  // x + 7 = 19; 3x = 24; 2x + 4 = 18.
  assert.equal(round(82, 0).target + 7, 19);
  assert.equal(round(85, 1).each * 3, 24);
  assert.equal(round(85, 4).target * 2 + 4, 18);
  // A graph at 2 km per hour passes (1,2), (2,4), (3,6).
  assert.deepEqual(round(89, 3).targets, [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]);
  // Increases are +1, +2, +3, +4, +5; the final two are 11 and 16.
  assert.deepEqual(round(91, 4).solution, [1, 2, 4, 7, 11, 16]);
  assert.deepEqual(round(93, 2).values, [6, 4, 8]);
  assert.deepEqual(round(94, 0).pairs.map(p => [p.left, p.right]), [['Аня', 'Лиса'], ['Боря', 'Сова'], ['Вера', 'Заяц']]);
  // 200 rubles minus 75 and 45 leaves 80, then a quarter of 80 is 20.
  assert.equal(round(97, 0).target, 80);
  assert.equal(round(97, 1).target, 20);
  assert.equal(round(98, 0).hour * 60 + round(98, 0).minute, 10 * 60 + 5);
});

test('browser registration appends a pack without replacing existing packs', () => {
  assert.ok(fs.existsSync(filename), 'browser curriculum must exist');
  const context = vm.createContext({ AdventureLevelPacks: [['existing']] });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  assert.equal(context.AdventureLevelPacks.length, 2);
  assert.equal(context.AdventureLevelPacks[0][0], 'existing');
  assert.equal(context.AdventureLevelPacks[1].length, 20);
  assert.equal(context.AdventureLevelPacks[1][19].level, 100);
});
