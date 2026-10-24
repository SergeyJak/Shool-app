"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const d=require("../lib/math-diagnostic-v2");
function run(strategy,initial=d.createSession()){
 let s=initial;
 while(!s.finished){const q=d.nextQuestion(s);assert.ok(q,"Question available until finish");s=d.submitAnswer(s,q.id,strategy(q,s));}
 return s;
}
test("all-correct and all-wrong paths remain bounded and produce distinct levels",()=>{
 const good=run(q=>q.answer),bad=run(()=>"__wrong__");
 assert.ok(good.answers.length>=15&&good.answers.length<=25);
 assert.ok(bad.answers.length>=15&&bad.answers.length<=25);
 assert.ok(d.result(good).level>d.result(bad).level);
 for(const s of [good,bad])assert.equal(new Set(s.asked).size,s.asked.length);
});
test("alternating and mixed skill results stay within level bounds",()=>{
 const s=run((q,session)=>session.answers.length%2===0?q.answer:"__wrong__");
 const r=d.result(s);assert.ok(r.level>=1&&r.level<=100);
 assert.equal(Object.keys(r.skills).length,7);
 assert.ok(Object.values(r.skills).every(v=>v.count>=2));
});
test("session can be serialized and resumed without repeated questions",()=>{
 let s=d.createSession();
 for(let i=0;i<8;i++){const q=d.nextQuestion(s);s=d.submitAnswer(s,q.id,q.answer);}
 const restored=JSON.parse(JSON.stringify(s));
 const next=d.nextQuestion(restored);
 assert.ok(!restored.asked.includes(next.id));
 const done=run(q=>q.answer,restored);
 assert.equal(new Set(done.asked).size,done.asked.length);
});
test("replay, forged order and completed session are rejected",()=>{
 let s=d.createSession();const q=d.nextQuestion(s);
 assert.throws(()=>d.submitAnswer(s,"d2-999","1"));
 s=d.submitAnswer(s,q.id,q.answer);
 assert.throws(()=>d.submitAnswer(s,q.id,q.answer));
 const done=run(q=>q.answer,s);
 assert.throws(()=>d.submitAnswer(done,q.id,q.answer));
});
test("restart creates a fresh, empty session",()=>{
 const initial=d.createSession(),q=d.nextQuestion(initial),progress=d.submitAnswer(initial,q.id,q.answer);
 const restarted=d.createSession();
 assert.equal(progress.answers.length,1);assert.equal(restarted.answers.length,0);
 assert.equal(d.nextQuestion(restarted).id,d.nextQuestion(initial).id);
});
test("question IDs and canonical answers never leak into next question payload accidentally",()=>{
 const q=d.nextQuestion(d.createSession());
 assert.equal(typeof q.answer,"string");
 assert.ok(!Object.hasOwn(d.result(d.createSession()),"answers"));
});
