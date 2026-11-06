const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const filename = path.join(__dirname, '../public/adventure/levels-056-080.js');
const load = () => require(filename);
const catalog = require('../lib/math-game-catalog.json');

test('pack covers the agreed fractions, decimal, percentage and ratio curriculum', () => {
  const pack = load();
  assert.deepEqual(pack.map(level => level.level), Array.from({length: 25}, (_, i) => i + 56));
  const games = catalog.games || catalog.levels;
  for (const level of pack) {
    const expected = games.find(game => game.level === level.level);
    assert.equal(level.title, expected.title);
    assert.equal(level.skill, expected.skillIds[0]);
    assert.equal(level.chapter, Math.ceil(level.level / 5));
    assert.deepEqual(Object.keys(level).sort(), ['level','title','chapter','skill','icon','scene','intro','success','rounds'].sort());
    assert.equal(level.rounds.length, 5);
    for (const field of ['title','intro','success']) assert.match(level[field], /[А-Яа-яЁё]/);
    assert.equal(new Set(level.rounds.map(round => round.prompt)).size, 5);
  }
});

test('all scenes contain feasible concrete teaching tasks with explanations', () => {
  for (const level of load()) for (const round of level.rounds) {
    const where = `level ${level.level}: ${round.prompt}`;
    for (const field of ['prompt','hint','explanation']) assert.match(round[field], /[А-Яа-яЁё]/, where);
    assert.ok(!JSON.stringify(round).includes('<'), where);
    switch (round.mechanic) {
      case 'fraction':
        assert.ok(Number.isInteger(round.parts) && round.parts >= 2 && round.parts <= 16, where);
        assert.ok(round.target.n > 0 && round.target.n <= round.target.d, where);
        assert.equal(round.parts * round.target.n % round.target.d, 0, where);
        break;
      case 'compose': {
        assert.ok(Number.isInteger(round.target) && round.target > 0, where);
        const counts = Array(round.target + 1).fill(Infinity); counts[0] = 0;
        for (const piece of round.pieces) assert.ok(Number.isInteger(piece.value) && piece.value > 0, where);
        for (let sum = 1; sum <= round.target; sum++) for (const piece of round.pieces) {
          if (piece.value <= sum) counts[sum] = Math.min(counts[sum], counts[sum - piece.value] + 1);
        }
        assert.ok(counts[round.target] <= (round.maxPieces || 25), where);
        break;
      }
      case 'measure':
        assert.ok(round.min <= round.target && round.target <= round.max && round.step > 0, where);
        assert.ok(Math.abs((round.target - round.min) / round.step - Math.round((round.target - round.min) / round.step)) < 1e-9, where);
        break;
      case 'order':
        assert.ok(round.items.length >= 2 && round.items.length <= 7, where);
        assert.deepEqual([...round.solution].sort(), round.items.map(item => item.id).sort(), where);
        assert.equal(new Set(round.solution).size, round.items.length, where);
        break;
      case 'match':
        assert.ok(round.pairs.length >= 2 && round.pairs.length <= 4, where);
        assert.equal(new Set(round.pairs.map(pair => pair.id)).size, round.pairs.length, where);
        assert.equal(new Set(round.pairs.map(pair => pair.right)).size, round.pairs.length, where);
        break;
      case 'sequence':
        assert.equal(round.terms.length, round.solution.length, where);
        assert.ok(round.terms.length <= 7 && round.terms.filter(term => term === null).length >= 2, where);
        round.terms.forEach((term, index) => {
          if (term === null) assert.ok(round.choices.includes(round.solution[index]), where);
          else assert.equal(term, round.solution[index], where);
        });
        break;
      case 'share':
        assert.equal(round.total, round.groups * round.each, where);
        assert.ok(round.groups >= 2 && round.groups <= 6 && round.total <= 36, where);
        break;
      case 'rectangle':
        assert.ok(round.cols >= 2 && round.cols <= 10 && round.rows >= 2 && round.rows <= 10, where);
        assert.ok(round.targetArea <= round.cols * round.rows, where);
        assert.equal(round.requireRectangle, false, where);
        break;
      case 'route': {
        let reached = new Set([round.start]);
        for (let i = 0; i < 12 && !reached.has(round.target); i++) {
          reached = new Set([...reached, ...[...reached].flatMap(value => round.steps.map(step => value + step))]);
        }
        assert.ok(reached.has(round.target), where);
        break;
      }
      case 'bars':
        assert.equal(round.labels.length, round.values.length, where);
        assert.ok(round.values.every(value => Number.isInteger(value) && value >= 0 && value <= round.maxValue), where);
        assert.ok(round.maxValue <= 12, where);
        break;
      default: assert.fail(`Unsupported mechanic: ${round.mechanic}`);
    }
  }
});

test('representative fraction equivalence and addition have independently checked answers', () => {
  const get = n => load().find(level => level.level === n);
  assert.deepEqual(get(61).rounds[0].target, {n:1,d:2});
  assert.equal(get(61).rounds[0].parts, 4); // 1/2 = 2/4.
  assert.deepEqual(get(64).rounds[4].target, {n:5,d:6}); // 1/2 + 1/3 = 5/6.
  assert.equal(get(64).rounds[4].parts * 5 / 6, 10);
  assert.deepEqual(get(65).rounds[4].target, {n:7,d:8}); // 1/2 + 3/8 = 7/8.
});

test('fraction domino pairs have correct results and unambiguous mathematical matches', () => {
  const evaluate = expression => expression.split(' + ').reduce((sum, plus) => {
    const pieces = plus.split(' − ').map(part => {
      const [n,d = 1] = part.split('/').map(Number);
      return n / d;
    });
    return sum + pieces.slice(1).reduce((result, value) => result - value, pieces[0]);
  }, 0);
  for (const level of load().filter(level => level.level >= 61 && level.level <= 65)) {
    for (const round of level.rounds.filter(round => round.mechanic === 'match')) {
      if (!round.pairs.every(pair => /^[\d/ +−]+$/.test(pair.left))) continue;
      const results = round.pairs.map(pair => evaluate(pair.right));
      round.pairs.forEach((pair, i) => assert.ok(Math.abs(evaluate(pair.left) - results[i]) < 1e-9, pair.left));
      assert.equal(new Set(results.map(value => value.toFixed(8))).size, results.length, round.prompt);
    }
  }
});

test('decimal money is backed by integer cents and percentage discounts use the remaining price', () => {
  const get = n => load().find(level => level.level === n);
  assert.equal(get(68).rounds[4].target, 426); // 2.75 + 1.51 = 4.26.
  assert.equal(get(68).rounds[4].displayScale, 100);
  assert.equal(get(72).rounds[4].target, 150); // 200 - 25% of 200 = 150.
  assert.equal(get(75).rounds[4].target, 210); // 300 - 30% of 300 = 210.
  assert.equal(get(71).rounds[4].targetArea, 80); // 80 of 100 cells = 80%.
  assert.equal(get(70).rounds[4].target, 134); // 5.00 - (2.35 + 1.06 + .25) = 1.34.
});

test('ratio and map scale tasks preserve multiplicative relationships', () => {
  const get = n => load().find(level => level.level === n);
  assert.deepEqual(get(76).rounds[4].values, [4, 6]); // 2:3 doubled.
  assert.deepEqual(get(77).rounds[4].values, [6, 9, 3]); // 2:3:1 tripled.
  assert.equal(get(78).rounds[4].target, 1500); // 6 cm at 250 m per cm.
  assert.deepEqual(get(79).rounds[4].values, [8, 12]); // 2 by 3, scale factor 4.
});

test('browser script appends one serializable pack without replacing existing packs', () => {
  const existing = [{level: 1}];
  const context = vm.createContext({AdventureLevelPacks: [existing]});
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  assert.equal(context.AdventureLevelPacks.length, 2);
  assert.equal(context.AdventureLevelPacks[0], existing);
  assert.deepEqual(JSON.parse(JSON.stringify(context.AdventureLevelPacks[1])), load());
});
