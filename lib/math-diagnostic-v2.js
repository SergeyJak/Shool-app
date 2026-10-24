"use strict";
// Diagnostic v2 is independent from the legacy 12-question placement test.
const SKILLS=["numbers","arithmetic","wordProblems","fractions","geometry","measurements","patterns"];
function makeBank(){
 const bank=[];
 const add=(skill,difficulty,prompt,answer,explanation)=>bank.push({id:"d2-"+String(bank.length+1).padStart(3,"0"),skill,difficulty,prompt,answer:String(answer),explanation});
 for(let i=0;i<30;i++){
  const a=5+i*3,b=2+(i%9);
  add("numbers",Math.min(95,5+i*3),`Какое число больше: ${a} или ${a+b}?`,a+b,`${a+b} больше ${a}.`);
  add("arithmetic",Math.min(95,5+i*3),`Сколько будет ${a+b} − ${b}?`,a,`${a+b} − ${b} = ${a}.`);
  add("wordProblems",Math.min(95,8+i*3),`Было ${a+b} карандашей, ${b} отдали. Сколько осталось?`,a,`${a+b} − ${b} = ${a}.`);
  const den=2+(i%7),mult=2+(i%6);
  add("fractions",Math.min(95,10+i*3),`Чему равна 1/${den} от ${den*mult}?`,mult,`${den*mult} ÷ ${den} = ${mult}.`);
  const w=2+i,h=3+(i%9);
  add("geometry",Math.min(95,10+i*3),`Периметр прямоугольника со сторонами ${w} см и ${h} см?`,2*(w+h),`2 × (${w} + ${h}) = ${2*(w+h)} см.`);
  add("measurements",Math.min(95,8+i*3),`Сколько минут в ${i+1} часах?`,60*(i+1),`1 час = 60 минут.`);
  const step=2+(i%8),start=1+i;
  add("patterns",Math.min(95,8+i*3),`Продолжи ряд: ${start}, ${start+step}, ${start+2*step}, ...`,start+3*step,`Шаг последовательности равен ${step}.`);
 }
 return Object.freeze(bank.map(q=>Object.freeze(q)));
}
const BANK=makeBank();
function createSession(){return {answers:[],asked:[],finished:false};}
function skillStats(session,skill){
 const items=session.answers.filter(a=>a.skill===skill);
 const weighted=items.reduce((s,a)=>s+(a.correct?1:-1)*Math.max(0.5,a.difficulty/50),0);
 return {count:items.length,estimate:Math.max(1,Math.min(100,Math.round(45+weighted*12)))};
}
function nextQuestion(session){
 if(session.finished)return null;
 const used=new Set(session.asked);
 const skill=SKILLS.slice().sort((a,b)=>skillStats(session,a).count-skillStats(session,b).count)[0];
 const target=skillStats(session,skill).estimate;
 return BANK.filter(q=>q.skill===skill&&!used.has(q.id)).sort((a,b)=>Math.abs(a.difficulty-target)-Math.abs(b.difficulty-target)||a.id.localeCompare(b.id))[0]||null;
}
function submitAnswer(session,id,value){
 if(session.finished||session.asked.includes(id))throw new Error("Invalid diagnostic answer");
 const expected=nextQuestion(session);
 if(!expected||expected.id!==id)throw new Error("Unexpected question");
 const correct=String(value).trim()===expected.answer;
 const answers=[...session.answers,{id,skill:expected.skill,difficulty:expected.difficulty,correct}];
 const asked=[...session.asked,id];
 return {answers,asked,finished:answers.length>=25||(answers.length>=15&&SKILLS.every(s=>answers.filter(a=>a.skill===s).length>=2)&&confidence(answers)>=0.75)};
}
function confidence(answers){
 const covered=SKILLS.filter(s=>answers.filter(a=>a.skill===s).length>=2).length;
 return Math.min(0.95,(covered/SKILLS.length)*Math.min(1,answers.length/25));
}
function result(session){
 const skills=Object.fromEntries(SKILLS.map(s=>[s,skillStats(session,s)]));
 const values=Object.values(skills);
 return {level:Math.round(values.reduce((sum,v)=>sum+v.estimate,0)/values.length),confidence:confidence(session.answers),provisional:confidence(session.answers)<0.75,skills,answered:session.answers.length};
}
module.exports={BANK,SKILLS,createSession,nextQuestion,submitAnswer,result,confidence};
