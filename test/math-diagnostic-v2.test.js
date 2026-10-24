"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const d=require("../lib/math-diagnostic-v2");
test("bank has 210 unique, answerable questions across seven skills",()=>{
 assert.equal(d.BANK.length,210);assert.equal(new Set(d.BANK.map(q=>q.id)).size,210);
 assert.equal(new Set(d.BANK.map(q=>q.skill)).size,7);
 assert.ok(d.BANK.every(q=>q.explanation&&q.difficulty>=1&&q.difficulty<=100));
});
test("diagnostic never repeats and ends after at most 42 questions",()=>{
 let s=d.createSession();
 while(!s.finished){const q=d.nextQuestion(s);assert.ok(q);s=d.submitAnswer(s,q.id,q.answer);}
 assert.ok(s.answers.length>=14&&s.answers.length<=42);assert.equal(new Set(s.asked).size,s.asked.length);
 assert.equal(d.nextQuestion(s),null);
});
test("incorrect answers lower placement relative to correct answers",()=>{
 function run(right){let s=d.createSession();while(!s.finished){const q=d.nextQuestion(s);s=d.submitAnswer(s,q.id,right?q.answer:"wrong");}return d.result(s).level;}
 assert.ok(run(true)>run(false));
});
test("rejects replayed or out-of-order answers",()=>{
 const s=d.createSession();assert.throws(()=>d.submitAnswer(s,"fake",3));
 const q=d.nextQuestion(s),next=d.submitAnswer(s,q.id,q.answer);
 assert.throws(()=>d.submitAnswer(next,q.id,q.answer));
});
