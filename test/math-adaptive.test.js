"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {QUESTIONS,chooseSkill,chooseLevel,buildSession}=require("../lib/math-adaptive");
const {validateAttempt}=require("../lib/math-assessment");
test("question bank contains 36 unique extra questions, 3 levels in 4 skills",()=>{
 assert.equal(QUESTIONS.length,36);assert.equal(new Set(QUESTIONS.map(q=>q.origin)).size,36);
 for(const q of QUESTIONS){assert.equal(q.options.filter(v=>String(v)===String(q.a)).length,1);assert.ok(q.level>=1&&q.level<=3);}
});
test("adaptive selection prioritizes weak skills and increases difficulty",()=>{
 const scores={"Счёт":{correct:3,total:3},"Задачи":{correct:1,total:3},"Дроби":{correct:3,total:3},"Геометрия":{correct:3,total:3}};
 const attempts=[{scores}];assert.equal(chooseSkill(attempts),"Задачи");assert.equal(chooseLevel(attempts,"Задачи"),1);
 assert.equal(buildSession(attempts).questions.length,2);
 assert.equal(chooseLevel([{scores:{"Дроби":{correct:3,total:3}}}],"Дроби"),3);
});
test("server validates two same-level adaptive answers against answer key",()=>{
 const q=QUESTIONS.filter(q=>q.skill==="Счёт"&&q.level===1).slice(0,2);
 const result=validateAttempt({mode:"adaptive",answers:q.map(x=>({origin:x.origin,value:x.a,correct:false}))});
 assert.equal(result.correct,2);
 assert.equal(result.scores["Счёт"].total,2);
 assert.equal(validateAttempt({mode:"adaptive",answers:[{origin:q[0].origin,value:q[0].a},{origin:QUESTIONS[8].origin,value:QUESTIONS[8].a}]}),null);
});
