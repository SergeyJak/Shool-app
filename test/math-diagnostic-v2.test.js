"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const d=require("../lib/math-diagnostic-v2");
test("bank has 230 unique, answerable questions across seven skills",()=>{
 assert.equal(d.BANK.length,230);assert.equal(new Set(d.BANK.map(q=>q.id)).size,230);
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

test("diagnostic review exposes only missed questions with verified answers",()=>{
 let session=d.createSession();
 const first=d.nextQuestion(session);session=d.submitAnswer(session,first.id,"not an answer");
 const second=d.nextQuestion(session);session=d.submitAnswer(session,second.id,second.answer);
 const third=d.nextQuestion(session);session=d.submitAnswer(session,third.id,null);
 const summary=d.result(session);
 assert.equal(summary.correct,1);assert.equal(summary.incorrect,1);assert.equal(summary.skipped,1);
 assert.equal(summary.review.length,2);
 assert.equal(summary.review[0].prompt,first.prompt);
 assert.equal(summary.review[0].answer,"not an answer");
 assert.equal(summary.review[0].expectedAnswer,first.answer);
 assert.equal(summary.review[0].explanation,first.explanation);
 assert.equal(summary.review[1].skipped,true);
 assert.equal(summary.review[1].expectedAnswer,third.answer);
 assert.equal(summary.correct+summary.incorrect+summary.skipped,summary.answered);
});

test("diagnostic asks at least two multiplication and division questions",()=>{
 let s=d.createSession();while(!s.finished){const q=d.nextQuestion(s);s=d.submitAnswer(s,q.id,q.answer);}
 const arithmetic=s.answers.filter(a=>a.skill==="arithmetic");
 assert.ok(arithmetic.filter(a=>a.prompt.includes("×")).length>=2);
 assert.ok(arithmetic.filter(a=>a.prompt.includes("Раздели")).length>=2);
});
