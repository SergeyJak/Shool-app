const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, '../public/adventure/levels-031-055.js');
const catalog = require('../lib/math-game-catalog.json').games;

test('chapter 7–11 teaching pack exists', () => {
  assert.ok(fs.existsSync(filename), 'the authored levels 31–55 pack must exist');
});

function pack() { return require(filename); }

test('levels 31–55 preserve approved catalog and contain five authored rounds each', () => {
  const levels = pack();
  assert.deepEqual(levels.map(level => level.level), Array.from({length:25}, (_, i) => i + 31));
  for (const level of levels) {
    const entry = catalog.find(entry => entry.level === level.level);
    assert.equal(level.title, entry.title);
    assert.equal(level.chapter, Math.ceil(level.level / 5));
    assert.equal(level.skill, entry.skillIds[0]);
    for (const key of ['icon', 'scene', 'intro', 'success']) assert.ok(level[key]?.length, `${level.level}: ${key}`);
    assert.equal(level.rounds.length, 5);
    assert.equal(new Set(level.rounds.map(round => round.prompt)).size, 5);
    for (const round of level.rounds) {
      for (const key of ['prompt', 'hint', 'explanation']) assert.match(round[key], /[А-Яа-яЁё]/);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(levels)), levels, 'curriculum is serializable data');
});

test('each manipulation is valid, small and mathematically reachable', () => {
  for (const level of pack()) for (const round of level.rounds) {
    const note = `level ${level.level}: ${round.prompt}`;
    switch (round.mechanic) {
      case 'compose': {
        assert.ok(Number.isInteger(round.target) && round.target > 0, note);
        const reachable = new Set([0]);
        let frontier = [0];
        for (let press = 0; press < Math.min(25, round.maxPieces || 25); press++) {
          const next = [];
          for (const value of frontier) for (const piece of round.pieces) {
            assert.ok(Number.isInteger(piece.value) && piece.value > 0, note);
            const sum = value + piece.value;
            if (sum <= round.target && !reachable.has(sum)) { reachable.add(sum); next.push(sum); }
          }
          frontier = next;
        }
        assert.ok(reachable.has(round.target), note); break;
      }
      case 'route': {
        let reachable = new Set([round.start]);
        let solved = reachable.has(round.target);
        for (let press = 0; press < 12 && !solved; press++) {
          const next = new Set();
          for (const value of reachable) for (const step of round.steps) next.add(value + step);
          reachable = next; solved = reachable.has(round.target);
        }
        assert.ok(solved, note); break;
      }
      case 'order':
        assert.ok(round.items.length <= 7, note);
        assert.equal(new Set(round.items.map(item => item.id)).size, round.items.length, note);
        assert.deepEqual([...round.solution].sort(), round.items.map(item => item.id).sort(), note); break;
      case 'share':
        assert.equal(round.total, round.groups * round.each, note);
        assert.ok(round.groups >= 2 && round.groups <= 6 && round.total <= 36, note); break;
      case 'rectangle': {
        assert.ok(round.cols >= 2 && round.cols <= 10 && round.rows >= 2 && round.rows <= 10, note);
        assert.ok(round.targetArea || round.targetPerimeter, note);
        let feasible = false;
        for (let width = 1; width <= round.cols; width++) for (let height = 1; height <= round.rows; height++) {
          if ((!round.targetArea || width * height === round.targetArea) && (!round.targetPerimeter || 2 * (width + height) === round.targetPerimeter)) feasible = true;
        }
        if (!round.requireRectangle) feasible = round.targetArea <= round.cols * round.rows;
        assert.ok(feasible && (round.targetArea || 0) <= 60, note); break;
      }
      case 'clock':
        assert.ok(round.hour >= 0 && round.hour <= 23 && round.minute >= 0 && round.minute <= 55 && round.minute % 5 === 0, note); break;
      case 'calendar': {
        const date = new Date(Date.UTC(round.year, round.month - 1, round.day));
        assert.equal(date.getUTCFullYear(), round.year, note);
        assert.equal(date.getUTCMonth(), round.month - 1, note);
        assert.equal(date.getUTCDate(), round.day, note); break;
      }
      case 'match':
        assert.ok(round.pairs.length >= 2 && round.pairs.length <= 4, note);
        for (const key of ['id', 'left', 'right']) assert.equal(new Set(round.pairs.map(pair => pair[key])).size, round.pairs.length, note); break;
      case 'sort':
        assert.ok(round.bins.length >= 2 && round.bins.length <= 3 && round.items.length >= 3 && round.items.length <= 6, note);
        assert.equal(new Set(round.items.map(item => item.id)).size, round.items.length, note);
        for (const item of round.items) assert.ok(round.bins.some(bin => bin.id === item.bin), note); break;
      case 'measure':
        assert.ok(round.min < round.max && round.step > 0 && round.target >= round.min && round.target <= round.max, note);
        assert.ok(Math.abs((round.target - round.min) / round.step - Math.round((round.target - round.min) / round.step)) < 1e-8, note); break;
      default: assert.fail(`unsupported mechanic: ${round.mechanic}`);
    }
  }
});

test('railway arrivals include noon and midnight wraps', () => {
  const rounds = pack().find(level => level.level === 42).rounds;
  assert.deepEqual(rounds.map(({hour, minute}) => [hour, minute]), [[8,20],[10,0],[12,15],[0,10],[1,5]]);
  assert.match(rounds[3].prompt, /23:50/);
  assert.match(rounds[3].prompt, /20/);
  assert.match(rounds[4].prompt, /23:45/);
  assert.match(rounds[4].prompt, /80/);
});

test('calendar missions cover leap day, month end, year end and Monday-first weekday reasoning', () => {
  const rounds = pack().find(level => level.level === 43).rounds;
  assert.deepEqual(rounds.map(({year,month,day}) => [year,month,day]), [[2026,11,9],[2026,11,16],[2028,2,29],[2026,5,1],[2027,1,3]]);
  assert.equal(new Date(Date.UTC(2026,10,9)).getUTCDay(), 1);
  assert.match(rounds[2].prompt, /28 февраля 2028/);
  assert.match(rounds[3].prompt, /30 апреля/);
  assert.match(rounds[4].prompt, /31 декабря 2026/);
});

test('independently checked measurement and geometry challenges retain exact targets', () => {
  const by = number => pack().find(level => level.level === number).rounds;
  assert.equal(by(36)[4].target, 135, '1 m 35 cm = 135 cm');
  assert.equal(by(37)[4].target, 1750, '1 kg + 500 g + 250 g = 1750 g');
  assert.equal(by(38)[4].target, 2250, '3 litres minus 750 ml = 2250 ml');
  assert.equal(by(47)[4].targetPerimeter, 26, '2 × (8 + 5) = 26');
  assert.deepEqual(by(55).map(({targetArea,targetPerimeter}) => [targetArea,targetPerimeter]), [[6,10],[12,14],[20,18],[30,22],[48,28]]);
});

test('shape descriptions explicitly distinguish a non-square rectangle from a square', () => {
  const pairs = pack().find(level => level.level === 46).rounds[3].pairs;
  const square = pairs.find(pair => pair.left === 'Квадрат');
  const rectangle = pairs.find(pair => pair.left.startsWith('Прямоугольник'));
  assert.match(square.right, /4 равные стороны/);
  assert.match(rectangle.left, /5\s*×\s*3/, 'the rectangle must be a concrete non-square example');
  assert.match(rectangle.right, /соседние стороны не равны/, 'a square must not satisfy the other property card');
});

test('polygon perimeter cards have correct and distinct numeric answers', () => {
  const pairs = pack().find(level => level.level === 48).rounds[3].pairs;
  const sideCounts = {треугольник:3, пятиугольник:5, шестиугольник:6};
  const perimeters = pairs.map(pair => {
    const shape = Object.keys(sideCounts).find(name => pair.left.includes(name));
    const side = Number(pair.left.match(/сторона (\d+) см/)[1]);
    const [,count,factor,result] = pair.right.match(/^(\d+) × (\d+) = (\d+) см$/).map(Number);
    assert.equal(count, sideCounts[shape]);
    assert.equal(factor, side);
    assert.equal(result, sideCounts[shape] * side);
    return result;
  });
  assert.equal(new Set(perimeters).size, perimeters.length, 'equal perimeter values allow valid swaps that ID matching rejects');
});

test('browser script appends a pack without discarding previously registered packs', () => {
  const existing = [{level:7}];
  const context = vm.createContext({AdventureLevelPacks:[existing]});
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  assert.equal(context.AdventureLevelPacks.length, 2);
  assert.equal(context.AdventureLevelPacks[0], existing);
  assert.equal(context.AdventureLevelPacks[1].length, 25);
});
