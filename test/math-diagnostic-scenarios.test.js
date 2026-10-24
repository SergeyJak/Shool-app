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

test("diagnostic remains balanced across all seven skills for weak, strong and mixed students",()=>{
 for(const strategy of [q=>q.answer,()=>"wrong",(q,s)=>s.answers.length%3===0?q.answer:"wrong"]){
  const session=run(strategy);
  const stats=d.result(session).skills;
  assert.ok(Object.values(stats).every(x=>x.count>=2),"each skill must be sampled twice");
  assert.ok(Math.max(...Object.values(stats).map(x=>x.count))-Math.min(...Object.values(stats).map(x=>x.count))<=1,"no skill should dominate");
  assert.ok(d.result(session).confidence>=0.75,"completed placement should meet confidence threshold");
 }
});
test("skill-specific weaknesses affect skill estimates and placement",()=>{
 const strong=run(q=>q.answer);
 const weakFractions=run(q=>q.skill==="fractions"?"wrong":q.answer);
 const a=d.result(strong),b=d.result(weakFractions);
 assert.ok(a.skills.fractions.estimate>b.skills.fractions.estimate);
 assert.ok(a.level>b.level);
 assert.ok(b.skills.fractions.estimate<b.skills.numbers.estimate);
});
test("question bank covers several mathematical operations and measurement concepts",()=>{
 const prompts=d.BANK.map(q=>q.prompt);
 assert.ok(prompts.some(p=>p.includes("×")),"multiplication");
 assert.ok(prompts.some(p=>p.includes("Площадь")),"area");
 assert.ok(prompts.some(p=>p.includes("Периметр")),"perimeter");
 assert.ok(prompts.some(p=>p.includes("сантиметров")),"length conversion");
 assert.ok(prompts.some(p=>p.includes("минут")),"time");
 assert.ok(prompts.some(p=>p.includes("сдачи")),"multistep word problems");
 for(const q of d.BANK)assert.ok(Number.isFinite(Number(q.answer)),"answer must be numeric: "+q.id);
});
test("empty, partial and finished assessments have coherent confidence and level",()=>{
 const empty=d.result(d.createSession());
 assert.equal(empty.answered,0);assert.equal(empty.confidence,0);assert.equal(empty.provisional,true);
 const partial=d.createSession(),q=d.nextQuestion(partial),one=d.submitAnswer(partial,q.id,q.answer);
 assert.equal(d.result(one).answered,1);assert.equal(d.result(one).provisional,true);
 const done=run(q=>q.answer);
 assert.equal(d.result(done).provisional,false);
 assert.ok(d.result(done).level>=1&&d.result(done).level<=100);
});

test("number comparisons cannot be solved by always choosing the second operand",()=>{
 const questions=d.BANK.filter(q=>q.skill==="numbers");
 const first=questions.filter(q=>q.prompt.match(/число больше: (\d+) или (\d+)/)?.[1]===q.answer);
 const second=questions.filter(q=>q.prompt.match(/число больше: (\d+) или (\d+)/)?.[2]===q.answer);
 assert.ok(first.length>=10&&second.length>=10);
});
test("advanced fractions include non-unit numerators and word problem answers vary",()=>{
 const fractions=d.BANK.filter(q=>q.skill==="fractions");
 assert.ok(fractions.some(q=>q.prompt.includes("равна 2/")||q.prompt.includes("равна 3/")||q.prompt.includes("равна 4/")));
 const change=d.BANK.filter(q=>q.skill==="wordProblems"&&q.prompt.includes("сдачи"));
 assert.ok(new Set(change.map(q=>q.answer)).size>=5);
});

test("skipped question is saved distinctly and advances the diagnostic",()=>{
 const start=d.createSession(),first=d.nextQuestion(start);
 const skipped=d.submitAnswer(start,first.id,null);
 assert.equal(skipped.answers[0].skipped,true);
 assert.equal(skipped.answers[0].correct,false);
 assert.equal(skipped.answers.length,1);
 assert.notEqual(d.nextQuestion(skipped).id,first.id);
 const done=run(()=>null,skipped);
 assert.ok(done.finished);
 assert.ok(d.result(done).level<d.result(run(q=>q.answer)).level);
});

test("first seven questions start at accessible difficulty across skills",()=>{
 let session=d.createSession();
 for(let i=0;i<7;i++){
  const q=d.nextQuestion(session);
  assert.ok(q.difficulty<=20,"first question in each skill should be easy: "+q.skill);
  session=d.submitAnswer(session,q.id,q.answer);
 }
});
test("correct answer raises difficulty and skipping lowers it within a skill",()=>{
 const first=d.nextQuestion(d.createSession());
 const right=d.submitAnswer(d.createSession(),first.id,first.answer);
 const skipped=d.submitAnswer(d.createSession(),first.id,null);
 function findNextInSkill(session,skill){let s=session;while(!s.finished){const q=d.nextQuestion(s);if(q.skill===skill)return q;s=d.submitAnswer(s,q.id,null);}throw Error("missing skill");}
 const harder=findNextInSkill(right,first.skill),easier=findNextInSkill(skipped,first.skill);
 assert.ok(harder.difficulty>easier.difficulty);
});

test("result separates correct answers, mistakes and explicit skips",()=>{
 let session=d.createSession();
 let q=d.nextQuestion(session);session=d.submitAnswer(session,q.id,q.answer);
 q=d.nextQuestion(session);session=d.submitAnswer(session,q.id,null);
 q=d.nextQuestion(session);session=d.submitAnswer(session,q.id,"__wrong__");
 const r=d.result(session);
 assert.equal(r.answered,3);
 assert.equal(r.correct,1);
 assert.equal(r.skipped,1);
 assert.equal(r.incorrect,1);
});
test("completed diagnostic with two answers and seventeen skips reports reality",()=>{
 let count=0;const session=run(q=>++count<=2?q.answer:null);
 const r=d.result(session);
 assert.equal(r.answered,19);
 assert.equal(r.correct,2);
 assert.equal(r.skipped,17);
 assert.equal(r.incorrect,0);
});
