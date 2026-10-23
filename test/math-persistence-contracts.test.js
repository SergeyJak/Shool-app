"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {validateAttempt}=require("../lib/math-assessment");
const {QUESTIONS,buildSession,buildReviewSession}=require("../lib/math-adaptive");
const {summarizeSkills,mistakes}=require("../lib/math-progress");
test("diagnostic scoring is canonical, not supplied by the browser",()=>{
 const values=[75,54,56,15,18,20,9,"2/4","1/2",4,20,200];
 const attempt=validateAttempt({mode:"diagnostic",correct:999,scores:{"Счёт":{correct:99,total:99}},answers:values.map((value,origin)=>({origin,value,correct:false}))});
 assert.ok(attempt);assert.equal(attempt.total,12);assert.equal(attempt.correct,12);
 assert.equal(attempt.scores["Счёт"].correct,3);
 assert.equal(attempt.scores["Геометрия"].correct,3);
 assert.equal(attempt.answers[0].correct,true);
});
test("reject invalid, duplicate, incomplete, foreign or manipulated attempts",()=>{
 const valid=Array.from({length:12},(_,origin)=>({origin,value:0}));
 for(const invalid of [
  {mode:"hacked",answers:valid},
  {mode:"diagnostic",answers:valid.slice(0,11)},
  {mode:"diagnostic",answers:[...valid.slice(0,11),valid[0]]},
  {mode:"diagnostic",answers:valid.map((a,i)=>i===3?{origin:9999,value:3}:a)},
  {mode:"diagnostic",answers:valid.map((a,i)=>i===3?{origin:3,value:{a:1}}:a)},
  {mode:"adaptive",answers:[{origin:12,value:29},{origin:30,value:21}]},
  {mode:"practice",answers:valid.slice(0,2)},
  {mode:"diagnostic",answers:valid.slice().reverse()},
 ])assert.equal(validateAttempt(invalid),null,JSON.stringify(invalid).slice(0,100));
});
test("adaptive answer saving and skill-map calculations remain compatible",()=>{
 const first=QUESTIONS.filter(q=>q.skill==="Счёт"&&q.level===1).slice(0,2);
 const attempt=validateAttempt({mode:"adaptive",answers:first.map(q=>({origin:q.origin,value:q.a}))});
 assert.equal(attempt.total,2);assert.equal(attempt.correct,2);
 assert.equal(attempt.scores["Счёт"].correct,2);
 const map=summarizeSkills([attempt]);assert.equal(map["Счёт"].percent,100);
 assert.equal(map["Геометрия"].percent,null);
 const wrong=validateAttempt({mode:"adaptive",answers:first.map(q=>({origin:q.origin,value:"wrong"}))});
 assert.equal(wrong.correct,0);
 assert.deepEqual(mistakes([wrong],QUESTIONS),first.map(q=>q.origin));
 const review=buildReviewSession([wrong]);
 assert.equal(review.review,true);assert.ok(review.questions.some(q=>q.origin===first[0].origin));
 const fresh=buildSession([wrong]);assert.equal(fresh.questions.length,2);
 for(const q of fresh.questions)assert.equal(q.a,undefined,"Server must not expose answers");
});
test("different learners' history must not be mixed during skill calculation",()=>{
 const top=validateAttempt({mode:"adaptive",answers:QUESTIONS.slice(0,2).map(q=>({origin:q.origin,value:q.a}))});
 const bottom=validateAttempt({mode:"adaptive",answers:QUESTIONS.slice(0,2).map(q=>({origin:q.origin,value:"invalid"}))});
 assert.equal(summarizeSkills([top])["Счёт"].percent,100);
 assert.equal(summarizeSkills([bottom])["Счёт"].percent,0);
});
