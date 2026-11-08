"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../lib/math-diagnostic-v2');
function run(answer=q=>q.answer,initial=d.createSession()) {
 let session=initial;
 while(!session.finished){assert.ok(session.answers.length<42,'bounded attempt');const q=d.nextQuestion(session);assert.ok(q);session=d.submitAnswer(session,q.id,answer(q,session));}
 return session;
}
test('new attempts screen actual curriculum topics through twenty maps',()=>{
 const session=run(),r=d.result(session);
 assert.equal(session.version,3);
 assert.equal(session.answers.length,40);
 assert.equal(new Set(session.answers.map(a=>a.chapter)).size,20);
 assert.equal(r.startingLevel,96);assert.equal(r.level,96);assert.equal(r.provisional,true);
 assert.equal(Object.keys(r.topics).length,20);
 assert.ok(Object.values(r.topics).every(t=>t.status==='sampled'&&t.screened));
 assert.equal(r.correct,40);
});
test('all wrong, skipped and misunderstood attempts recommend first map after six questions',()=>{
 for(const answer of ['wrong',null,'__MISUNDERSTOOD__']){
  const session=run(()=>answer),r=d.result(session);
  assert.equal(r.answered,6);assert.equal(r.startingLevel,1);assert.equal(r.correct,0);
  assert.equal(Object.values(r.topics).find(t=>t.chapter===20).status,'unknown');
  assert.equal(r.incorrect,answer==='wrong'?6:0);
  assert.equal(r.skipped,answer==='wrong'?0:6);
  assert.equal(r.misunderstood,answer==='__MISUNDERSTOOD__'?6:0);
 }
});
test('first prerequisite gap controls placement despite later correct answers',()=>{
 const session=run(q=>q.chapter===2?'wrong':q.answer),r=d.result(session);
 assert.equal(r.startingLevel,6);assert.equal(r.answered,6);
 assert.equal(Object.values(r.topics).find(t=>t.chapter===2).status,'needs-practice');
 assert.equal(Object.values(r.topics).find(t=>t.chapter===3).status,'sampled');
});
test('a learner who cannot subtract is not placed beyond the first map',()=>{
 const session=run(q=>q.kind.includes('subtraction')?'wrong':q.answer);
 assert.equal(d.result(session).startingLevel,1);
 assert.ok(session.answers.some(a=>a.chapter===1&&a.kind.includes('subtraction')));
});
test('conflicting probes ask a distinct confirmation before deciding a topic',()=>{
 const session=run((q,s)=>q.chapter===3&&s.answers.filter(a=>a.chapter===3).length===1?'wrong':q.answer),r=d.result(session);
 assert.equal(session.answers.filter(a=>a.chapter===3).length,3);
 assert.equal(r.startingLevel,96);assert.equal(r.answered,41);
 const failed=run((q,s)=>q.chapter===3&&s.answers.filter(a=>a.chapter===3).length!==0?'wrong':q.answer);
 assert.equal(failed.answers.length,7);assert.equal(d.result(failed).startingLevel,11);
});
test('many conflicting topics stop at cap and recommend first unresolved map',()=>{
 const session=run((q,s)=>s.answers.filter(a=>a.chapter===q.chapter).length===1?'wrong':q.answer);
 const r=d.result(session);assert.equal(r.answered,42);assert.equal(r.startingLevel,71);
 assert.equal(new Set(session.asked).size,42);assert.equal(d.nextQuestion(session),null);
});
test('version survives serialization, submissions reject replay and wrong order',()=>{
 let s=d.createSession(),q=d.nextQuestion(s);s=d.submitAnswer(s,q.id,q.answer);
 const restored=JSON.parse(JSON.stringify(s));assert.equal(restored.version,3);
 assert.deepEqual(d.nextQuestion(restored),d.nextQuestion(s));
 assert.throws(()=>d.submitAnswer(restored,q.id,q.answer));
 assert.throws(()=>d.submitAnswer(restored,'d3-forged','1'));
 const done=run(undefined,restored);assert.throws(()=>d.submitAnswer(done,q.id,q.answer));
 assert.throws(()=>d.nextQuestion({...s,version:99}),/version/i);
});
test('public questions cannot reveal canonical answers or explanations',()=>{
 const q=d.nextQuestion(d.createSession()),safe=d.publicQuestion(q);
 assert.equal(safe.id,q.id);assert.equal(safe.chapter,1);assert.ok(safe.answerFormat);
 assert.ok(!Object.hasOwn(safe,'answer'));assert.ok(!Object.hasOwn(safe,'explanation'));
 assert.equal(d.publicQuestion(null),null);
 assert.deepEqual(d.progress(d.createSession()),{answered:0,maxQuestions:42,minQuestions:6,version:3});
});
test('confidence accepts both saved sessions and the original legacy answer-array API',()=>{
 const legacy=require('../lib/math-diagnostic-legacy');
 const unversioned={answers:[],asked:[],finished:false};
 assert.equal(d.confidence(unversioned),legacy.confidence(unversioned.answers));
 assert.equal(d.confidence(unversioned.answers),legacy.confidence(unversioned.answers));
 assert.equal(d.confidence(d.createSession()),d.result(d.createSession()).confidence);
});
test('decimal answers accept comma and dot, while blanks and expressions do not count as numbers',()=>{
 const decimal=d.BANK.find(q=>q.answerFormat?.kind==='decimal'&&q.answer.includes('.'));
 assert.ok(decimal);
 let s=d.createSession();while(d.nextQuestion(s).id!==decimal.id){const q=d.nextQuestion(s);s=d.submitAnswer(s,q.id,q.answer);}
 assert.equal(d.submitAnswer(s,decimal.id,decimal.answer.replace('.',',')).answers.at(-1).correct,true);
 assert.equal(d.submitAnswer(s,decimal.id,' '+decimal.answer+' ').answers.at(-1).correct,true);
 for(const value of ['', '   ', 'Infinity', '1+1', '0x10', {}])assert.equal(d.submitAnswer(s,decimal.id,value).answers.at(-1).correct,false);
});
test('review stores the answered question snapshot and does not mutate earlier sessions',()=>{
 const s=d.createSession(),q=d.nextQuestion(s),updated=d.submitAnswer(s,q.id,'wrong');
 assert.deepEqual(s.answers,[]);assert.deepEqual(s.asked,[]);
 const restored=JSON.parse(JSON.stringify(updated));restored.answers[0].prompt='Archived prompt';restored.answers[0].expectedAnswer='77';restored.answers[0].explanation='Archived explanation';
 const review=d.result(restored).review[0];assert.equal(review.prompt,'Archived prompt');assert.equal(review.expectedAnswer,'77');assert.equal(review.explanation,'Archived explanation');
});

test('unversioned persisted attempts keep their original questions and exact results',()=>{
 const legacy=require('../lib/math-diagnostic-legacy');
 let s={answers:[],asked:[],finished:false};
 assert.equal(d.nextQuestion(s).id,'d2-019');
 for(let i=0;i<8;i++){
  assert.deepEqual(d.nextQuestion(s),legacy.nextQuestion(s));
  const q=d.nextQuestion(s);s=d.submitAnswer(s,q.id,i%2?q.answer:null);
  assert.equal(Object.hasOwn(s,'version'),false);
 }
 const stored=JSON.parse(JSON.stringify(s));
 assert.deepEqual(d.result(stored),legacy.result(stored));
 const resumed=run(q=>q.answer,stored);
 assert.deepEqual(d.result(resumed),legacy.result(resumed));
 assert.equal(d.progress(stored).version,2);
 assert.equal(d.publicQuestion(d.nextQuestion(stored)).answer,undefined);
});

test('known early gap does not end at six while current topic needs a confirmation',()=>{
 const s=run((q,state)=>q.chapter===1?'wrong':q.chapter===3&&state.answers.filter(a=>a.chapter===3).length===1?'wrong':q.answer);
 assert.equal(s.answers.length,7);assert.equal(d.result(s).startingLevel,1);
 assert.equal(s.answers.at(-1).chapter,3);
});
