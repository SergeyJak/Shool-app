"use strict";
(() => {
const QUESTIONS=[
{skill:"Счёт",q:"Сколько будет 48 + 27?",a:75,options:[65,75,85,74],why:"48 + 20 = 68, ещё 7 = 75."},
{skill:"Счёт",q:"Сколько будет 90 − 36?",a:54,options:[64,54,46,56],why:"90 − 30 = 60, затем − 6 = 54."},
{skill:"Счёт",q:"Сколько будет 7 × 8?",a:56,options:[48,54,56,64],why:"7 × 8 = 56."},
{skill:"Задачи",q:"У Алисы 24 наклейки. Она подарила 9. Сколько осталось?",a:15,options:[13,15,16,33],why:"24 − 9 = 15 наклеек."},
{skill:"Задачи",q:"3 коробки по 6 карандашей. Сколько всего карандашей?",a:18,options:[9,12,18,24],why:"3 × 6 = 18."},
{skill:"Задачи",q:"Билет стоит 4 €. Сколько стоят 5 билетов?",a:20,options:[9,16,20,25],why:"5 × 4 = 20 €."},
{skill:"Дроби",q:"Половина от 18 — это…",a:9,options:[6,8,9,12],why:"18 ÷ 2 = 9."},
{skill:"Дроби",q:"Какая дробь равна половине?",a:"2/4",options:["1/3","2/4","3/4","1/4"],why:"2 из 4 равных частей — это половина."},
{skill:"Дроби",q:"Что больше: 1/2 или 1/4?",a:"1/2",options:["1/4","1/2","Равны","Не сравнить"],why:"Если делим целое на 2 части, каждая больше четвертинки."},
{skill:"Геометрия",q:"Сколько углов у прямоугольника?",a:4,options:[3,4,5,6],why:"У прямоугольника 4 прямых угла."},
{skill:"Геометрия",q:"Периметр квадрата со стороной 5 см?",a:20,options:[10,15,20,25],why:"5 + 5 + 5 + 5 = 20 см."},
{skill:"Геометрия",q:"Сколько сантиметров в 2 метрах?",a:200,options:[20,100,200,2000],why:"В 1 метре 100 см, значит в 2 метрах 200 см."}
];
const KEY="school-math-diagnostic-v1";
const $=id=>document.getElementById(id);
let state=null;
let latestRemote=null;
let submitting=false;
async function loadProgress(){
 try {const res=await fetch("/api/math/progress",{credentials:"same-origin"});if(!res.ok)return;const data=await res.json();latestRemote=data.attempts?.[0]||null;
 const history=document.getElementById("history");if(history){const attempts=data.attempts||[];history.textContent=attempts.length?`История: ${attempts.length} последних попыток. Последняя: ${attempts[0].correct} из ${attempts[0].total}.`:"Результатов пока нет. Начнём с диагностики!";}
 }catch(_){const history=document.getElementById("history");if(history)history.textContent="История временно недоступна";}
}
async function submitAttempt(){
 if(submitting||state.submitted)return;submitting=true;
 try{const res=await fetch("/api/math/attempts",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:state.mode,answers:state.answers.map(a=>({origin:a.origin,value:a.value}))})});
 if(!res.ok)throw Error("SAVE_FAILED");state.submitted=true;save();await loadProgress();window.dispatchEvent(new Event("math-attempt-saved"));
 const info=document.getElementById("syncStatus");if(info)info.textContent="Результат сохранён в кабинете ученика.";
 }catch(_){const info=document.getElementById("syncStatus");if(info)info.textContent="Не удалось сохранить в облаке. Проверь соединение и нажми «Повторить сохранение».";const retry=document.getElementById("retrySync");if(retry)retry.hidden=false;}
 finally{submitting=false;}
}

function show(id){["intro","play","results"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_){}}
function start(mode="diagnostic"){state={mode,index:0,answers:[],skill:null};if(mode==="practice"){const saved=load(); const scores=compute(saved?.answers||[]);state.skill=Object.keys(scores).sort((a,b)=>scores[a].correct/scores[a].total-scores[b].correct/scores[b].total)[0]||"Счёт";}state.questions=mode==="practice"?QUESTIONS.map((q,i)=>({...q,origin:i})).filter(q=>q.skill===state.skill):QUESTIONS.map((q,i)=>({...q,origin:i}));save();render();}
function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||"null");return x&&Array.isArray(x.answers)?x:null}catch(_){return null}}
function compute(answers){const scores={};for(const skill of ["Счёт","Задачи","Дроби","Геометрия"])scores[skill]={correct:0,total:0};for(const v of answers){const skill=QUESTIONS[v.origin]?.skill;if(!scores[skill])continue;scores[skill].total++;if(v.correct)scores[skill].correct++;}return scores}
function render(){if(state.index>=state.questions.length)return finish();show("play");const q=state.questions[state.index];$("mode").textContent=state.mode==="practice"?"ТРЕНИРОВКА · "+state.skill:"ДИАГНОСТИКА · "+(skillLabels[q.skill]||q.skill);$("progress").textContent=(state.index+1)+" / "+state.questions.length;$("progressFill").style.width=(state.index/state.questions.length*100)+"%";$("question").textContent=q.q;$("feedback").textContent="";$("next").classList.add("hidden");const options=$("options");options.replaceChildren();for(const val of q.options){const b=document.createElement("button");b.className="option";b.textContent=val;b.addEventListener("click",()=>answer(val));options.append(b)}}
function answer(value){const q=state.questions[state.index];if(state.answers.length>state.index)return;const correct=String(value)===String(q.a);state.answers.push({origin:q.origin,correct,value});save();for(const b of $("options").children){b.disabled=true;if(b.textContent===String(q.a))b.classList.add("correct");else if(b.textContent===String(value))b.classList.add("wrong")} $("feedback").textContent=(correct?"Верно! ":"Хорошая попытка! ")+q.why;$("next").classList.remove("hidden");$("progressFill").style.width=((state.index+1)/state.questions.length*100)+"%"}
function finish(){show("results");if(!state.submitted)void submitAttempt();const scores=compute(state.answers);const total=state.answers.filter(x=>x.correct).length;$("resultTitle").textContent=state.mode==="practice"?"Тренировка завершена!":"Твоя карта знаний";$("resultLead").textContent="Верных ответов: "+total+" из "+state.answers.length+". Каждая задача помогает прокачать навыки.";if(state.mode==="diagnostic"){const rank=Math.max(1,Math.min(100,Math.round(total/state.answers.length*99)+1));$("adventureAssessment").textContent=`Твой стартовый уровень приключения: ${rank} из 100`;$("adventureLaunch").classList.remove("hidden")}else{$("adventureAssessment").textContent="";$("adventureLaunch").classList.add("hidden")};$("skills").replaceChildren();for(const [name,s] of Object.entries(scores)){if(!s.total)continue;const item=document.createElement("div");item.className="skill";const percent=Math.round(s.correct/s.total*100);const label=percent>=80?"Сильная сторона":percent>=50?"Продолжаем учиться":"Потренируем вместе";const title=document.createElement("strong");title.textContent=skillLabels[name]||name;const progress=document.createElement("span");progress.textContent=percent+"% · "+label;item.append(title,progress);$("skills").append(item)}save();}

let diagnosticV2=null;
async function diagnosticApi(path,options){
 const response=await fetch(path,{credentials:"same-origin",...options});
 if(!response.ok)throw Error("Diagnostic request failed");
 return response.json();
}
const skillLabels={numbers:"Числа",arithmetic:"Вычисления",wordProblems:"Задачи",fractions:"Дроби",geometry:"Геометрия",measurements:"Величины и время",patterns:"Закономерности"};
function renderDiagnosticV2(){
 if(diagnosticV2.finished){
  show("results");
  const result=diagnosticV2.result;
  $("resultTitle").textContent="Проверка закончена!";
  $("resultLead").textContent="Правильно: "+result.correct+" · Не знаю: "+result.skipped+" · Ошибки: "+result.incorrect+". Теперь подберём задания для тебя.";
  $("adventureAssessment").textContent="Твой старт: уровень "+result.level;
  $("adventureLaunch").classList.remove("hidden");
  const entries=Object.entries(result.skills);
  const strongest=entries.reduce((best,item)=>item[1].estimate>best[1].estimate?item:best,entries[0]);
  const weakest=entries.reduce((best,item)=>item[1].estimate<best[1].estimate?item:best,entries[0]);
  $("resultHighlights").textContent=result.correct===0?"Начнём с самых простых заданий. Всё получится!":result.correct<=3?"Начнём с простых заданий и будем учиться постепенно.":"Получается лучше всего: "+(skillLabels[strongest[0]]||strongest[0])+". Потренируем: "+(skillLabels[weakest[0]]||weakest[0])+".";
  $("skills").replaceChildren();
  for(const [name,score] of entries){
   const item=document.createElement("div");item.className="skill";
   const title=document.createElement("strong");title.textContent=skillLabels[name]||name;
   const value=document.createElement("span");value.textContent="Уровень "+score.estimate;
   item.append(title,value);$("skills").append(item);
  }
  return;
 }
 show("play");
 const q=diagnosticV2.question;
 $("mode").textContent="ДИАГНОСТИКА · "+(skillLabels[q.skill]||q.skill);
 $("progress").textContent=diagnosticV2.answered+" / 15–25";
 $("progressFill").style.width=(diagnosticV2.answered/25*100)+"%";
 $("question").textContent=q.prompt;$("feedback").textContent="";$("next").classList.add("hidden");
 const field=document.createElement("input");field.className="option";field.inputMode="decimal";field.setAttribute("aria-label","Твой ответ");field.placeholder="Ответ";field.autocomplete="off";
 const submit=document.createElement("button");submit.className="option";submit.textContent="Ответить";submit.disabled=true;
 const syncSubmit=()=>{submit.disabled=field.value.trim().length===0;};
 field.addEventListener("input",syncSubmit);
 const skip=document.createElement("button");skip.className="secondary";skip.type="button";skip.textContent="Не знаю";
 submit.addEventListener("click",async()=>{
  if(!field.value.trim())return;
  submit.disabled=true;skip.disabled=true;
  try{
   diagnosticV2=await diagnosticApi("/api/math/diagnostic-v2/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:q.id,value:field.value})});
   renderDiagnosticV2();
  }catch(_){$("feedback").textContent="Ошибка сохранения. Повтори попытку.";syncSubmit();skip.disabled=false;}
 });
 skip.addEventListener("click",async()=>{
  submit.disabled=true;skip.disabled=true;
  try{diagnosticV2=await diagnosticApi("/api/math/diagnostic-v2/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:q.id,value:null})});renderDiagnosticV2();}
  catch(_){$("feedback").textContent="Не удалось перейти дальше. Попробуй ещё раз.";submit.disabled=false;skip.disabled=false;}
 });
 field.addEventListener("keydown",event=>{if(event.key==="Enter"&&!submit.disabled)submit.click()});
 $("options").replaceChildren(field,submit,skip);
}
async function startDiagnosticV2(restart=false){
 try{
  if(restart)await diagnosticApi("/api/math/diagnostic-v2/restart",{method:"POST"});
  diagnosticV2=await diagnosticApi("/api/math/diagnostic-v2");document.getElementById("diagnosticV2Error")?.remove();document.getElementById("diagnosticLoading")?.classList.add("hidden");renderDiagnosticV2();document.getElementById(diagnosticV2.finished?"results":"play")?.scrollIntoView({block:"start",behavior:"instant"});
 }catch(_){document.getElementById("diagnosticLoading")?.classList.add("hidden");document.getElementById("intro")?.classList.add("diagnostic-error");document.documentElement.classList.remove("journey-mode");show("intro");$("feedback").textContent="Диагностика временно недоступна.";const note=document.getElementById("diagnosticV2Error")||document.createElement("p");note.id="diagnosticV2Error";note.textContent="Не удалось загрузить диагностику. Попробуй ещё раз.";note.setAttribute("role","alert");$("start").insertAdjacentElement("afterend",note);}
}
$("start").addEventListener("click",()=>void startDiagnosticV2());$("repeat").addEventListener("click",()=>void startDiagnosticV2(true));$("practice").addEventListener("click",()=>{const prev=state;state=null;try{localStorage.setItem(KEY,JSON.stringify(prev));}catch(_){} start("practice")});$("next").addEventListener("click",()=>{state.index++;save();render()});
document.getElementById("retrySync")?.addEventListener("click",()=>{document.getElementById("retrySync").hidden=true;void submitAttempt()});
void loadProgress();
if(new URLSearchParams(location.search).get("start")==="1")void startDiagnosticV2();

})();