"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {QUESTIONS,selectFreshPair,buildReviewSession}=require("../lib/math-adaptive");
test("next adaptive pair favors unpracticed questions",()=>{
 const pool=QUESTIONS.filter(q=>q.skill==="Счёт"&&q.level===1);
 assert.equal(pool.length,3);
 const first=selectFreshPair(pool,[]);
 const next=selectFreshPair(pool,[{answers:first.map(q=>({origin:q.origin,correct:true}))}]);
 assert.ok(next.some(q=>!first.some(old=>old.origin===q.origin)));
});
test("review session keeps a missed question while varying its partner",()=>{
 const pool=QUESTIONS.filter(q=>q.skill==="Дроби"&&q.level===2);
 const missed=pool[0];
 const session=buildReviewSession([{answers:[{origin:missed.origin,correct:false}]}]);
 assert.equal(session.review,true);
 assert.equal(session.questions.length,2);
 assert.ok(session.questions.some(q=>q.origin===missed.origin));
});
