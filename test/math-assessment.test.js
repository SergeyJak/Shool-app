"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateAttempt}=require("../lib/math-assessment");
const correct=[75,54,56,15,18,20,9,"2/4","1/2",4,20,200];
test("diagnostic validates canonical answers and per-topic scores",()=>{
 const attempt=validateAttempt({mode:"diagnostic",answers:correct.map((value,origin)=>({origin,value,correct:false}))});
 assert.equal(attempt.correct,12);
 assert.deepEqual(attempt.scores["Дроби"],{correct:3,total:3});
 assert.equal(attempt.answers[0].correct,true);
});
test("wrong answers reduce score and cannot be forged",()=>{
 const attempt=validateAttempt({mode:"diagnostic",answers:correct.map((value,origin)=>({origin,value:origin===0?0:value,correct:true}))});
 assert.equal(attempt.correct,11);assert.deepEqual(attempt.scores["Счёт"],{correct:2,total:3});
});
test("rejects duplicate, missing, invalid and mismatched attempts",()=>{
 const all=correct.map((value,origin)=>({origin,value}));
 assert.equal(validateAttempt({mode:"diagnostic",answers:all.slice(1)}),null);
 assert.equal(validateAttempt({mode:"diagnostic",answers:[...all.slice(1),all[1]]}),null);
 assert.equal(validateAttempt({mode:"practice",answers:all.slice(2,5)}),null);
 assert.equal(validateAttempt({mode:"practice",answers:all.slice(0,3)})?.correct,3);
 assert.equal(validateAttempt({mode:"practice",answers:[{origin:0,value:{danger:true}}]}),null);
 assert.equal(validateAttempt({mode:"test",answers:all}),null);
});
