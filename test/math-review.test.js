"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildReviewSession,QUESTIONS}=require("../lib/math-adaptive");
test("review selects a missed skill and does not leak correct answer",()=>{
 const q=QUESTIONS[6];const session=buildReviewSession([{answers:[{origin:q.origin,correct:false}]}]);
 assert.equal(session.review,true);assert.equal(session.skill,q.skill);assert.equal(session.questions.length,2);
 assert.ok(session.questions.every(x=>!Object.hasOwn(x,"a")));
});
test("review falls back safely without mistakes",()=>{
 const session=buildReviewSession([]);
 assert.equal(session.review,false);assert.equal(session.questions.length,2);
});
