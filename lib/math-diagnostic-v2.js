"use strict";
// Diagnostic v2 is independent from the legacy 12-question placement test.
const SKILLS=["numbers","arithmetic","wordProblems","fractions","geometry","measurements","patterns"];
function makeBank(){
 const bank=[];
 const add=(skill,difficulty,prompt,answer,explanation)=>bank.push({id:"d2-"+String(bank.length+1).padStart(3,"0"),skill,difficulty,prompt,answer:String(answer),explanation});
 for(let i=0;i<30;i++){
  const a=5+i*3,b=2+(i%9);
  if(i%2===0)add("numbers",Math.min(95,5+i*3),`Какое число больше: ${a} или ${a+b}?`,a+b,`${a+b} больше ${a}.`);
  else add("numbers",Math.min(95,5+i*3),`Какое число больше: ${a+b} или ${a}?`,a+b,`${a+b} больше ${a}.`);
  if(i<10)add("arithmetic",Math.min(95,5+i*3),`Сколько будет ${a+b} − ${b}?`,a,`${a+b} − ${b} = ${a}.`);
  else if(i<20)add("arithmetic",Math.min(95,5+i*3),`Сколько будет ${b} × ${i-5}?`,b*(i-5),`${b} × ${i-5} = ${b*(i-5)}.`);
  else add("arithmetic",Math.min(95,5+i*3),`Вычисли: (${a}+${b}) × ${2+i%4} − ${b}.`,(a+b)*(2+i%4)-b,`Сначала скобки и умножение, затем вычитание.`);
  if(i<10)add("wordProblems",Math.min(95,8+i*3),`Было ${a+b} карандашей, ${b} отдали. Сколько осталось?`,a,`${a+b} − ${b} = ${a}.`);
  else if(i<20)add("wordProblems",Math.min(95,8+i*3),`В ${b} коробках по ${i-6} карандашей. Сколько карандашей всего?`,b*(i-6),`${b} × ${i-6} = ${b*(i-6)}.`);
  else add("wordProblems",Math.min(95,8+i*3),`Купили ${b} тетрадей по ${i-12} евро. Заплатили ${b*(i-12)+i-9} евро. Сколько сдачи?`,i-9,`Стоимость покупки ${b*(i-12)} евро, сдача ${i-9} евро.`);
  if(i<10){const x=2+i%5,y=2+i%4;add("arithmetic",12+i*5,`Сколько будет ${x} × ${y}?`,x*y,`${x} × ${y} = ${x*y}.`);add("arithmetic",14+i*5,`Раздели ${x*y} поровну на ${x} группы. Сколько будет в каждой?`,y,`${x*y} ÷ ${x} = ${y}.`);}
 const den=2+(i%7),mult=2+(i%6);
  const numerator=i<12?1:2+(i%3);
  add("fractions",Math.min(95,10+i*3),`Чему равна ${numerator}/${den} от ${den*mult}?`,numerator*mult,`${den*mult} ÷ ${den} × ${numerator} = ${numerator*mult}.`);
  const w=2+i,h=3+(i%9);
  if(i<15)add("geometry",Math.min(95,10+i*3),`Сколько будет периметр прямоугольника, если его стороны ${w} см и ${h} см?`,2*(w+h),`2 × (${w} + ${h}) = ${2*(w+h)} см.`);
  else add("geometry",Math.min(95,10+i*3),`Сколько будет площадь прямоугольника, если его стороны ${w} см и ${h} см? Ответ запиши в см².`,w*h,`${w} × ${h} = ${w*h} см².`);
  if(i<10)add("measurements",Math.min(95,8+i*3),`Сколько минут в ${i+1} часах?`,60*(i+1),`1 час = 60 минут.`);
  else if(i<20)add("measurements",Math.min(95,8+i*3),`Сколько сантиметров в ${i-5} метрах?`,100*(i-5),`1 метр = 100 сантиметров.`);
  else add("measurements",Math.min(95,8+i*3),`Поезд отправился в 10:00 и ехал ${i+15} минут. Сколько минут осталось до 11:00?`,45-i,`До 11:00 всего 60 минут; вычти время поездки.`);
  const step=2+(i%8),start=1+i;
  add("patterns",Math.min(95,8+i*3),`Продолжи ряд: ${start}, ${start+step}, ${start+2*step}, __. Впиши только одно число вместо пропуска.`,start+3*step,`Шаг последовательности равен ${step}.`);
 }
 return Object.freeze(bank.map(q=>Object.freeze(q)));
}
const BANK=makeBank();
function createSession(){return {answers:[],asked:[],finished:false};}
function skillStats(session,skill){
 const items=session.answers.filter(a=>a.skill===skill);
 if(!items.length)return {count:0,estimate:20};
 if(items.every(a=>a.misunderstood))return {count:items.length,estimate:20};
 const passed=items.filter(a=>a.correct);
 const failed=items.filter(a=>!a.correct&&!a.misunderstood);
 const high=passed.length?Math.max(...passed.map(a=>a.difficulty)):0;
 const low=failed.length?Math.min(...failed.map(a=>a.difficulty)):100;
 const estimate=failed.length?Math.round((high+low)/2):Math.min(100,high+12);
 return {count:items.length,estimate:Math.max(1,Math.min(100,estimate))};
}
function nextQuestion(session){
 if(session.finished)return null;
 const used=new Set(session.asked);
 const skill=SKILLS.slice().sort((a,b)=>skillStats(session,a).count-skillStats(session,b).count)[0];
 if(skill==="arithmetic"){
  const arithmetic=session.answers.filter(a=>a.skill==="arithmetic");
  const kind=q=>q.prompt.includes("÷")||q.prompt.includes("Раздели")?"division":q.prompt.includes("×")?"multiplication":"other";
  const counts={multiplication:arithmetic.filter(a=>kind(a) ==="multiplication").length,division:arithmetic.filter(a=>kind(a)==="division").length};
  const needed=counts.multiplication<=counts.division?"multiplication":"division";
  if(counts[needed]<2){const candidates=BANK.filter(q=>q.skill===skill&&!used.has(q.id)&&kind(q)===needed);return candidates.sort((a,b)=>a.difficulty-b.difficulty||a.id.localeCompare(b.id))[0]||null;}
 }
 const previous=session.answers.filter(a=>a.skill===skill&&!a.misunderstood).at(-1);
 const target=previous?Math.max(5,Math.min(95,previous.difficulty+(previous.correct?24:-18))):12;
 return BANK.filter(q=>q.skill===skill&&!used.has(q.id)).sort((a,b)=>Math.abs(a.difficulty-target)-Math.abs(b.difficulty-target)||a.id.localeCompare(b.id))[0]||null;
}
function submitAnswer(session,id,value){
 if(session.finished||session.asked.includes(id))throw new Error("Invalid diagnostic answer");
 const expected=nextQuestion(session);
 if(!expected||expected.id!==id)throw new Error("Unexpected question");
 const misunderstood=value==="__MISUNDERSTOOD__";
 const skipped=value===null||misunderstood;
 const correct=!skipped&&String(value).trim()===expected.answer;
 const answers=[...session.answers,{id,skill:expected.skill,difficulty:expected.difficulty,correct,skipped,misunderstood,answer:skipped?null:String(value).trim(),expectedAnswer:expected.answer,prompt:expected.prompt,answeredAt:new Date().toISOString()}];
 const asked=[...session.asked,id];
 const arithmetic=answers.filter(a=>a.skill==="arithmetic");const operationCoverage=arithmetic.filter(a=>a.prompt.includes("×")).length>=2&&arithmetic.filter(a=>a.prompt.includes("Раздели")).length>=2;
 return {answers,asked,finished:answers.length>=42||(answers.length>=18&&operationCoverage&&SKILLS.every(s=>answers.filter(a=>a.skill===s).length>=2)&&((answers.filter(a=>a.correct).length/answers.length<=0.35)||(answers.length>=28&&SKILLS.every(s=>answers.filter(a=>a.skill===s).length>=4))))};
}
function confidence(answers){
 const covered=SKILLS.filter(s=>answers.filter(a=>a.skill===s).length>=2).length;
 return Math.min(0.95,(covered/SKILLS.length)*Math.min(1,answers.length/42));
}
function result(session){
 const skills=Object.fromEntries(SKILLS.map(s=>[s,skillStats(session,s)]));
 const values=Object.values(skills);
 const correct=session.answers.filter(a=>a.correct).length;
 const skipped=session.answers.filter(a=>a.skipped).length;
 const misunderstood=session.answers.filter(a=>a.misunderstood).length;
 const incorrect=session.answers.length-correct-skipped;
 const review=session.answers.filter(a=>!a.correct).map(a=>{const q=BANK.find(item=>item.id===a.id);return {id:a.id,skill:a.skill,prompt:q?.prompt||a.prompt||'',answer:a.answer??null,expectedAnswer:q?.answer||a.expectedAnswer||'',explanation:q?.explanation||'',skipped:Boolean(a.skipped),misunderstood:Boolean(a.misunderstood)};});
 return {review,level:Math.round(values.reduce((sum,v)=>sum+v.estimate,0)/values.length),confidence:confidence(session.answers),provisional:confidence(session.answers)<0.75,skills,answered:session.answers.length,correct,incorrect,skipped,misunderstood};
}
module.exports={BANK,SKILLS,createSession,nextQuestion,submitAnswer,result,confidence};
