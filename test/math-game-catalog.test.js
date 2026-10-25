"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {maps,games,chooseStartingGame,recommendReview,diagnosticEvidenceForGame}=require("../lib/math-game-catalog");
test("catalog has twenty maps and one hundred distinct sequential games",()=>{
 assert.equal(maps.length,20);assert.equal(games.length,100);
 assert.deepEqual(games.map(g=>g.level),Array.from({length:100},(_,i)=>i+1));
 assert.equal(new Set(games.map(g=>g.title)).size,100);
 for(const map of maps){
  const group=games.filter(g=>g.map===map.id);
  assert.equal(group.length,5);
  assert.deepEqual(group.at(-1).checkpointSkillIds,map.skillIds);
  assert.ok(group.every(g=>g.skillIds.length&&g.gameType==="interactive-training"));
 }
});
test("placement never infers mastery from a high aggregate score",()=>{
 assert.equal(chooseStartingGame({}).game.level,1);
 assert.equal(chooseStartingGame({"numbers-to-20":"mastered"}).game.level,6);
 assert.equal(chooseStartingGame({"numbers-to-20":"needs-practice"}).reason,"needs-practice");
 assert.equal(chooseStartingGame({"numbers-to-20":"unknown"}).game.level,1);
});
test("review recommends training in skills not yet mastered",()=>{
 assert.equal(recommendReview(1,{}).length,5);
 assert.equal(recommendReview(1,{"numbers-to-20":"mastered"}).length,0);
 assert.deepEqual(diagnosticEvidenceForGame(21),[]);
 assert.throws(()=>recommendReview(21,{}),RangeError);
 assert.throws(()=>diagnosticEvidenceForGame(101),RangeError);
});
