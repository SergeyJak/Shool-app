'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const catalog = require('../lib/math-game-catalog.json');
const file = path.join(__dirname, '../public/adventure/levels-007-030.js');
const levels = fs.existsSync(file) ? require(file) : [];

// Removing a game, changing its curriculum skill or shipping an empty mission
// would otherwise leave a learner at a dead end in the shared runner.
test('pack gives every curriculum mission from 7 to 30 five playable rounds', () => {
  assert.deepEqual(levels.map(level => level.level), Array.from({ length: 24 }, (_, i) => i + 7));
  for (const level of levels) {
    const approved = catalog.games.find(game => game.level === level.level);
    assert.equal(level.title, approved.title);
    assert.equal(level.chapter, approved.map);
    assert.ok(approved.skillIds.includes(level.skill));
    assert.equal(level.rounds.length, 5, `level ${level.level}`);
    assert.deepEqual(Object.keys(level).sort(), ['level', 'title', 'chapter', 'skill', 'icon', 'scene', 'intro', 'success', 'rounds'].sort());
    for (const round of level.rounds) {
      for (const field of ['prompt', 'hint', 'explanation']) assert.ok(round[field]?.trim(), `${level.level}: ${field}`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(levels)), levels, 'all curriculum data must be serializable');
});

function shortestPath(start, target, steps, limit) {
  let frontier = new Set([start]);
  const seen = new Set(frontier);
  for (let depth = 0; depth <= limit; depth++) {
    if (frontier.has(target)) return depth;
    const next = new Set();
    for (const value of frontier) for (const step of steps) {
      const result = value + step;
      if (!seen.has(result)) { seen.add(result); next.add(result); }
    }
    frontier = next;
  }
  return Infinity;
}

// This searches the child's available moves independently of the authored
// explanations. A wrong coin, route step, total or grid makes a task impossible.
test('all counting, routing, sharing and building missions can actually be solved', () => {
  assert.ok(levels.length > 0, 'curriculum pack is present');
  const supported = new Set(['compose', 'route', 'share', 'rectangle', 'match', 'sort', 'sequence', 'order']);
  for (const level of levels) for (const round of level.rounds) {
    const context = `level ${level.level}: ${round.prompt}`;
    assert.ok(supported.has(round.mechanic), context);
    if (round.mechanic === 'compose') {
      assert.ok(Number.isInteger(round.target) && round.target > 0, context);
      assert.ok(round.pieces.every(piece => Number.isInteger(piece.value) && piece.value > 0), context);
      const clicks = shortestPath(0, round.target, round.pieces.map(piece => piece.value), round.maxPieces || 25);
      assert.ok(clicks <= Math.min(round.maxPieces || 25, 25), context);
    } else if (round.mechanic === 'route') {
      assert.ok(Number.isInteger(round.start) && Number.isInteger(round.target), context);
      assert.ok(round.steps.every(step => Number.isInteger(step) && step !== 0), context);
      assert.ok(shortestPath(round.start, round.target, round.steps, 12) <= 12, context);
    } else if (round.mechanic === 'share') {
      assert.equal(round.groups * round.each, round.total, context);
      assert.ok(round.groups >= 2 && round.groups <= 6 && round.total <= 36, context);
    } else if (round.mechanic === 'rectangle') {
      assert.ok(round.cols >= 2 && round.cols <= 10 && round.rows >= 2 && round.rows <= 10, context);
      let feasible = false;
      for (let w = 1; w <= round.cols; w++) for (let h = 1; h <= round.rows; h++) {
        if ((round.targetArea === undefined || w * h === round.targetArea)
          && (round.targetPerimeter === undefined || 2 * (w + h) === round.targetPerimeter)) feasible = true;
      }
      assert.ok(feasible && round.targetArea <= 60, context);
    } else if (round.mechanic === 'sequence') {
      assert.ok(round.terms.length <= 7 && round.terms.filter(value => value === null).length >= 2, context);
      assert.equal(round.solution.length, round.terms.length, context);
      round.terms.forEach((value, i) => {
        if (value === null) assert.ok(round.choices.includes(round.solution[i]), context);
        else assert.equal(value, round.solution[i], context);
      });
    } else if (round.mechanic === 'order') {
      assert.ok(round.items.length <= 7, context);
      assert.equal(new Set(round.items.map(item => item.id)).size, round.items.length, context);
      assert.deepEqual([...round.solution].sort(), round.items.map(item => item.id).sort(), context);
      const values = round.solution.map(id => round.items.find(item => item.id === id).value);
      const direction = Math.sign(values[1] - values[0]);
      assert.ok(direction !== 0 && values.every((value, i) => i === 0 || Math.sign(value - values[i - 1]) === direction), context);
    } else if (round.mechanic === 'sort') {
      assert.ok(round.bins.length >= 2 && round.bins.length <= 3, context);
      assert.ok(round.items.length >= 3 && round.items.length <= 6, context);
      assert.equal(new Set(round.items.map(item => item.id)).size, round.items.length, context);
      assert.ok(round.items.every(item => round.bins.some(bin => bin.id === item.bin)), context);
    } else if (round.mechanic === 'match') {
      assert.ok(round.pairs.length >= 2 && round.pairs.length <= 4, context);
      assert.equal(new Set(round.pairs.map(pair => pair.id)).size, round.pairs.length, context);
      assert.equal(new Set(round.pairs.map(pair => pair.right)).size, round.pairs.length, `ambiguous matching: ${context}`);
    }
  }
});

test('representative stories teach the stated arithmetic and inverse operations', () => {
  const at = (level, round) => levels.find(entry => entry.level === level)?.rounds[round - 1];
  assert.equal(at(7, 1)?.target, 12); // A 12-ruble notebook.
  assert.equal(at(10, 5)?.target, 49); // Descend from 100 by 51.
  assert.equal(at(11, 3)?.target, 305); // Three hundreds, no tens, five units.
  assert.equal(at(14, 4)?.target, 647); // 810 - 100 - 60 - 3.
  assert.equal(at(16, 5)?.lesson, 'transfer');
  assert.equal(at(16, 5)?.targetArea, 2 * 5); // Two baskets, five apples in each.
  assert.equal(at(18, 5)?.target, 7 * 7);
  assert.equal(at(21, 5)?.each, 36 / 6);
  assert.equal(at(22, 3)?.target, 24 / 4); // Build one animal's portion, not the whole meal.
  assert.equal(at(22, 5)?.each, 35 / 5);
  assert.equal(at(25, 3)?.target, 24 - 4 * 6);
  assert.equal(at(26, 5)?.target, 2 * 240 + 3 * 35);
  assert.equal(at(27, 5)?.target, 1478 + 365);
  assert.equal(at(30, 5)?.target, 135 * 4 + 260);
});

test('multiplication support fades across five different objectives and transfers to new groups', () => {
  const rounds = levels.find(level => level.level === 16)?.rounds;
  assert.ok(rounds, 'the multiplication lesson exists');
  assert.deepEqual(rounds.map(round => round.lesson), ['row-count', 'build-groups', 'total', 'addition', 'transfer']);
  assert.deepEqual(rounds.map(round => [round.cols, round.rows, round.targetArea]), [[3, 2, 6], [4, 3, 12], [5, 4, 20], [4, 3, 12], [5, 2, 10]]);
  for (const round of rounds) {
    assert.equal(round.mechanic, 'rectangle');
    assert.equal(round.visual, 'treasures');
    assert.equal(round.cols * round.rows, round.targetArea, `${round.lesson}: pictured groups agree with the product`);
  }
  assert.equal(rounds[3].rows * rounds[3].cols, 4 + 4 + 4, 'addition uses one equal term per pictured row');
  assert.notEqual(rounds[4].cols, rounds[3].cols, 'transfer requires reading a new group size');
});

// A small independent arithmetic reader checks task data rather than source
// spelling. Wrong products, matching targets or filled equation slots fail here.
function calculate(expression) {
  const tokens = expression.match(/\d+|[()+×:−-]/g) || [];
  let cursor = 0;
  function atom() {
    if (tokens[cursor] === '(') {
      cursor++;
      const value = sum();
      assert.equal(tokens[cursor++], ')');
      return value;
    }
    const token = tokens[cursor++];
    assert.ok(/^\d+$/.test(token), `expected a number in ${expression}`);
    return Number(token);
  }
  function product() {
    let value = atom();
    while (tokens[cursor] === '×' || tokens[cursor] === ':') {
      const operator = tokens[cursor++];
      const next = atom();
      value = operator === '×' ? value * next : value / next;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (['+', '−', '-'].includes(tokens[cursor])) {
      const operator = tokens[cursor++];
      const next = product();
      value = operator === '+' ? value + next : value - next;
    }
    return value;
  }
  const result = sum();
  assert.equal(cursor, tokens.length, expression);
  return result;
}

test('matching expressions and every filled equation have mathematically equal sides', () => {
  assert.ok(levels.length > 0);
  let checked = 0;
  const expressionOnly = /^[\d\s()+×:−-]+$/;
  for (const level of levels) for (const round of level.rounds) {
    if (round.mechanic === 'match') for (const pair of round.pairs) {
      if (expressionOnly.test(pair.left) && expressionOnly.test(pair.right)) {
        assert.equal(calculate(pair.left), calculate(pair.right), `level ${level.level}: ${pair.left} → ${pair.right}`);
        checked++;
      }
    }
    if (round.mechanic === 'sequence') {
      const completed = round.solution.join(' ');
      for (const equation of completed.matchAll(/(\d+\s*[+×:−-]\s*\d+)\s*=\s*(\d+)/g)) {
        assert.equal(calculate(equation[1]), Number(equation[2]), `level ${level.level}: ${equation[0]}`);
        checked++;
      }
      if (round.solution.every(value => typeof value === 'number')) {
        const differences = round.solution.slice(1).map((value, i) => value - round.solution[i]);
        assert.ok(differences.every(value => value === differences[0]), `uneven counting sequence in level ${level.level}`);
      }
    }
  }
  assert.ok(checked >= 65, 'cover arithmetic matches and equations across the pack');
});

test('browser pack appends missions without replacing an already loaded pack', () => {
  assert.ok(fs.existsSync(file), 'browser curriculum file exists');
  const context = { AdventureLevelPacks: [{ level: 6, title: 'Existing' }] };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  assert.equal(context.AdventureLevelPacks[0].level, 6);
  assert.deepEqual(Array.from(context.AdventureLevelPacks.slice(1), level => level.level), levels.map(level => level.level));
});
