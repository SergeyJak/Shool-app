"use strict";
const catalog=require("./math-game-catalog.json");
const games=Object.freeze(catalog.games.map(g=>Object.freeze({...g,skillIds:Object.freeze(g.skillIds),prerequisites:Object.freeze(g.prerequisites)})));
const maps=Object.freeze(catalog.maps.map(m=>Object.freeze(m)));
const VALID_STATES=new Set(["unknown","needs-practice","learning","mastered"]);
function chooseStartingGame(skillStates={}){
 for(const game of games){
  const states=game.skillIds.map(id=>VALID_STATES.has(skillStates[id])?skillStates[id]:"unknown");
  if(states.some(state=>state!=="mastered"))return {game,reason:states.includes("needs-practice")?"needs-practice":states.includes("learning")?"learning":"unverified"};
 }
 return {game:games.at(-1),reason:"all-mastered"};
}
function recommendReview(mapNumber,skillStates={}){
 const map=maps.find(m=>m.id===mapNumber);
 if(!map)throw new RangeError("Unknown map");
 return games.filter(g=>g.map===mapNumber&&g.skillIds.some(id=>skillStates[id]!=="mastered"));
}
function diagnosticEvidenceForGame(level){
 const game=games.find(g=>g.level===level);
 if(!game)throw new RangeError("Unknown game");
 return maps[game.map-1].diagnosticEvidence;
}
module.exports={maps,games,chooseStartingGame,recommendReview,diagnosticEvidenceForGame};
