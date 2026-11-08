"use strict";
// Unversioned saved attempts retain their original questions, scoring and order.
const legacy=require('./math-diagnostic-legacy');
const {BANK,TOPICS}=require('./math-diagnostic-bank-v3');
const SKILLS=legacy.SKILLS;
const VERSION=3,MIN_QUESTIONS=6,MAX_QUESTIONS=42;
function isLegacy(session){
 if(session.version===undefined)return true;
 if(session.version!==VERSION)throw new Error('Unsupported diagnostic version');
 return false;
}
function createSession(){return {version:VERSION,answers:[],asked:[],finished:false};}
function topicStats(session,topic){
 const answers=session.answers.filter(a=>a.chapter===topic.chapter);
 const correct=answers.filter(a=>a.correct).length;
 const failed=answers.length-correct;
 return {...topic,count:answers.length,correct,screened:correct>=2,
  status:failed>=2?'needs-practice':answers.length?'sampled':'unknown',
  resolved:correct>=2||failed>=2};
}
function curriculumStats(session){return TOPICS.map(topic=>topicStats(session,topic));}
function nextQuestion(session){
 if(isLegacy(session))return legacy.nextQuestion(session);
 if(session.finished||session.answers.length>=MAX_QUESTIONS)return null;
 const topic=curriculumStats(session).find(t=>!t.resolved);
 if(!topic)return null;
 const used=new Set(session.asked);
 return BANK.find(q=>q.chapter===topic.chapter&&!used.has(q.id))||null;
}
function numericAnswer(value){
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const text=String(value).trim().replace(',','.');
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))return null;
 const number=Number(text);
 return Number.isFinite(number)?number:null;
}
function submitAnswer(session,id,value){
 if(isLegacy(session))return legacy.submitAnswer(session,id,value);
 if(session.finished||session.asked.includes(id))throw new Error('Invalid diagnostic answer');
 const q=nextQuestion(session);
 if(!q||q.id!==id)throw new Error('Unexpected question');
 const misunderstood=value==='__MISUNDERSTOOD__',skipped=value===null||misunderstood;
 const normalized=numericAnswer(value);
 const correct=!skipped&&normalized!==null&&normalized===numericAnswer(q.answer);
 const answer={id:q.id,chapter:q.chapter,topic:q.topic,skill:q.skill,kind:q.kind,
  correct,skipped,misunderstood,answer:skipped?null:String(value).trim(),
  expectedAnswer:q.answer,prompt:q.prompt,explanation:q.explanation,
  answerFormat:structuredClone(q.answerFormat),answeredAt:new Date().toISOString()};
 if(q.visual)answer.visual=structuredClone(q.visual);
 const updated={...session,answers:[...session.answers,answer],asked:[...session.asked,id]};
 const topics=curriculumStats(updated),current=topics.find(t=>t.chapter===q.chapter);
 updated.finished=updated.answers.length>=MAX_QUESTIONS||topics.every(t=>t.resolved)||
  (updated.answers.length>=MIN_QUESTIONS&&current.resolved&&topics.some(t=>t.status==='needs-practice'));
 return updated;
}
function result(session){
 if(isLegacy(session))return legacy.result(session);
 const stats=curriculumStats(session),firstGap=stats.find(t=>!t.screened);
 const startingLevel=firstGap?(firstGap.chapter-1)*5+1:96;
 const topics=Object.fromEntries(stats.map(({resolved,...topic})=>[BANK.find(q=>q.chapter===topic.chapter).topic,topic]));
 const skills=Object.fromEntries(SKILLS.map(skill=>{
  const answers=session.answers.filter(a=>a.skill===skill),correct=answers.filter(a=>a.correct).length;
  return [skill,{count:answers.length,correct,estimate:answers.length?Math.round(correct/answers.length*100):0}];
 }));
 const correct=session.answers.filter(a=>a.correct).length;
 const skipped=session.answers.filter(a=>a.skipped).length;
 const misunderstood=session.answers.filter(a=>a.misunderstood).length;
 const review=session.answers.filter(a=>!a.correct).map(a=>({id:a.id,skill:a.skill,chapter:a.chapter,topic:a.topic,
  prompt:a.prompt,answer:a.answer??null,expectedAnswer:a.expectedAnswer,explanation:a.explanation,
  answerFormat:structuredClone(a.answerFormat),...(a.visual?{visual:structuredClone(a.visual)}:{}),
  skipped:Boolean(a.skipped),misunderstood:Boolean(a.misunderstood)}));
 return {version:VERSION,review,startingLevel,level:startingLevel,
  confidence:Math.min(0.85,stats.filter(t=>t.resolved).length/TOPICS.length*0.85),
  provisional:true,topics,skills,answered:session.answers.length,correct,
  incorrect:session.answers.length-correct-skipped,skipped,misunderstood};
}
function publicQuestion(question){
 if(!question)return null;
 const safe={};
 const descriptor=TOPICS.find(topic=>topic.chapter===question.chapter);
 if(descriptor)safe.topicTitle=descriptor.title;
 for(const key of ['id','skill','prompt','chapter','topic','answerFormat','visual']){
  if(question[key]!==undefined)safe[key]=structuredClone(question[key]);
 }
 return safe;
}
function progress(session){
 return {answered:session.answers.length,maxQuestions:MAX_QUESTIONS,minQuestions:isLegacy(session)?18:MIN_QUESTIONS,
  version:session.version??2};
}
module.exports={BANK,TOPICS,SKILLS,createSession,nextQuestion,submitAnswer,result,publicQuestion,progress,confidence:input=>Array.isArray(input)?legacy.confidence(input):isLegacy(input)?legacy.confidence(input.answers):result(input).confidence};
