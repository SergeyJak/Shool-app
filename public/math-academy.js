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
function render(){diagnosticRequest++;$("diagnosticVisual").hidden=true;$("diagnosticVisual").replaceChildren();if(state.index>=state.questions.length)return finish();show("play");const q=state.questions[state.index];$("mode").textContent=state.mode==="practice"?"ТРЕНИРОВКА · "+state.skill:"ДИАГНОСТИКА · "+(skillLabels[q.skill]||q.skill);$("progress").textContent=(state.index+1)+" / "+state.questions.length;$("progressFill").style.width=(state.index/state.questions.length*100)+"%";$("question").textContent=q.q;$("feedback").textContent="";$("next").classList.add("hidden");const options=$("options");options.replaceChildren();for(const val of q.options){const b=document.createElement("button");b.className="option";b.textContent=val;b.addEventListener("click",()=>answer(val));options.append(b)}}
function answer(value){const q=state.questions[state.index];if(state.answers.length>state.index)return;const correct=String(value)===String(q.a);state.answers.push({origin:q.origin,correct,value});save();for(const b of $("options").children){b.disabled=true;if(b.textContent===String(q.a))b.classList.add("correct");else if(b.textContent===String(value))b.classList.add("wrong")} $("feedback").textContent=(correct?"Верно! ":"Хорошая попытка! ")+q.why;$("next").classList.remove("hidden");$("progressFill").style.width=((state.index+1)/state.questions.length*100)+"%"}
function finish(){$("resultStats").replaceChildren();$("resultHighlights").textContent="";$("diagnosticReview").hidden=true;show("results");if(!state.submitted)void submitAttempt();const scores=compute(state.answers);const total=state.answers.filter(x=>x.correct).length;$("resultTitle").textContent=state.mode==="practice"?"Тренировка завершена!":"Твоя карта знаний";$("resultLead").textContent="Верных ответов: "+total+" из "+state.answers.length+". Каждая задача помогает прокачать навыки.";if(state.mode==="diagnostic"){const rank=Math.max(1,Math.min(100,Math.round(total/state.answers.length*99)+1));$("adventureAssessment").textContent=`Твой стартовый уровень приключения: ${rank} из 100`;$("adventureLaunch").classList.remove("hidden")}else{$("adventureAssessment").textContent="";$("adventureLaunch").classList.add("hidden")};$("skills").replaceChildren();for(const [name,s] of Object.entries(scores)){if(!s.total)continue;const item=document.createElement("div");item.className="skill";const percent=Math.round(s.correct/s.total*100);const label=percent>=80?"Сильная сторона":percent>=50?"Продолжаем учиться":"Потренируем вместе";const title=document.createElement("strong");title.textContent=skillLabels[name]||name;const progress=document.createElement("span");progress.textContent=percent+"% · "+label;item.append(title,progress);$("skills").append(item)}save();}

let diagnosticV2=null;
let diagnosticRequest=0;
async function diagnosticApi(path,options){
 const response=await fetch(path,{credentials:"same-origin",...options});
 if(!response.ok)throw Error("Diagnostic request failed");
 return response.json();
}
const skillLabels={numbers:"Числа",arithmetic:"Вычисления",wordProblems:"Задачи",fractions:"Дроби",geometry:"Геометрия",measurements:"Величины и время",patterns:"Закономерности"};
function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=String(text);return item;}
function renderVisual(visual,target=$("diagnosticVisual")){
 target.replaceChildren();target.hidden=true;
 if(!visual||typeof visual!=="object")return;
 const bounded=(value,max=30)=>Math.max(0,Math.min(max,Number.isFinite(Number(value))?Math.floor(Number(value)):0));
 if(visual.type==="items"&&Array.isArray(visual.items)){
  const items=node("div","visual-items");for(const item of visual.items.slice(0,24))items.append(node("span","",item));target.append(items);
 }else if(visual.type==="groups"){
  for(let group=0;group<bounded(visual.groups,6);group++){const items=node("div","visual-group");for(let item=0;item<bounded(visual.perGroup,12);item++)items.append(node("span","",visual.item||"●"));target.append(items);}
 }else if(visual.type==="fraction"){
  const fraction=node("div","visual-fraction");for(let part=0;part<bounded(visual.parts,16);part++)fraction.append(node("span",part<bounded(visual.filled,16)?"filled":""));target.append(fraction);
 }else if(visual.type==="bars"&&Array.isArray(visual.values)){
  const bars=node("div","visual-bars");const values=visual.values.slice(0,6).map(value=>bounded(value,10000));const max=Math.max(1,...values);
  values.forEach((value,index)=>{const row=node("div","visual-bar-row");const track=node("div");const bar=node("div","visual-bar");bar.style.width=(value/max*100)+"%";track.append(bar);row.append(node("span","",visual.labels?.[index]??String(index+1)),track,node("strong","",value));bars.append(row);});target.append(bars);
 }else if(visual.type==="place-value"){
  const places=node("div","visual-place");for(const [key,label] of [["hundreds","Сотни"],["tens","Десятки"],["ones","Единицы"]]){const cell=node("div","",label);cell.append(node("strong","",bounded(visual[key],9)));places.append(cell);}target.append(places);
 }else if(visual.type==="equation"&&typeof visual.text==="string")target.append(node("div","visual-equation",visual.text));
 target.hidden=target.childElementCount===0;
 if(!target.hidden){target.setAttribute("role","group");target.setAttribute("aria-label","Рисунок к заданию");}
}
function renderDiagnosticV2(){
 if(diagnosticV2.finished){
  show("results");
  const result=diagnosticV2.result;
  $("resultTitle").textContent="Подобрали тему для старта!";
  const stats=$("resultStats");stats.replaceChildren();
  for(const [number,label] of [[result.correct??0,"Получилось"],[Math.max(0,(result.skipped??0)-(result.misunderstood||0)),"Пока не знаю"],[result.misunderstood||0,"Не понял вопрос"],[result.incorrect??0,"Потренируем"]]){
   const tile=node("div","result-stat");tile.append(node("strong","",number),node("span","",label));stats.append(tile);
  }
  const topics=Object.values(result.topics||{});
  const review=Array.isArray(result.review)?result.review:[];
  $("diagnosticReview").hidden=review.length===0;$("diagnosticReview").open=false;
  $("diagnosticReviewTitle").textContent="Разобрать ответы ("+review.length+")";
  const reviewItems=$("diagnosticReviewItems");reviewItems.replaceChildren();
  for(const [index,item] of review.entries()){
   const card=node("div","diagnostic-review-item");
   card.append(node("strong","",(index+1)+". "+(topics.find(topic=>topic.chapter===item.chapter)?.title||skillLabels[item.skill]||item.skill)),node("span","",item.prompt));
   if(item.visual){const illustration=node("div");renderVisual(item.visual,illustration);card.append(illustration);}
   card.append(node("span","","Твой ответ: "+(item.misunderstood?"Не понял вопрос":item.skipped?"Не знаю":item.answer??"Нет ответа")),node("span","review-correct","Правильный ответ: "+item.expectedAnswer),node("span","",item.explanation));reviewItems.append(card);
  }
  const start=result.startingLevel??result.level;
  const chapter=Math.floor((start-1)/5)+1;const recommended=topics.find(topic=>topic.chapter===chapter);
  $("resultLead").textContent=topics.length?"Ответы сохранены.":"Ответы сохранены. Совёнок подберёт следующие задания.";
  $("practice").hidden=topics.length>0;
  $("adventureAssessment").textContent=topics.length?"Начнём: "+(recommended?.title||"карта "+chapter)+" · игра "+start:"Твой старт: уровень "+start;
  $("adventureLaunch").classList.remove("hidden");
  $("resultHighlights").textContent=topics.length?"Это ориентир для старта. Учиться будем в играх.":"Можно посмотреть ответы и повторить трудные темы. Игровой прогресс сохранён.";
  $("skills").replaceChildren();
  if(topics.length){
   const statusLabels={sampled:"Получилось в пробных заданиях",'needs-practice':"Начнём с повторения",unknown:"Ещё не проверяли"};
   for(const topic of topics){const item=node("div","skill");item.append(node("strong","",topic.chapter+". "+topic.title),node("span","",(topic.status==="sampled"&&!topic.screened?"Проверили частично":statusLabels[topic.status])||"Ещё не проверяли"));$("skills").append(item);}
  }else for(const [name,score] of Object.entries(result.skills||{})){
   const item=node("div","skill");item.append(node("strong","",skillLabels[name]||name),node("span","",score.count?"Заданий: "+score.count:"Ещё не проверяли"));$("skills").append(item);
  }
  $("syncStatus").textContent="";$("retrySync").hidden=true;
  return;
 }
 show("play");const q=diagnosticV2.question;if(!q)return;
 $("mode").textContent=q.topicTitle||skillLabels[q.skill]||q.skill;
 const max=diagnosticV2.maxQuestions||42;
 $("progress").textContent=diagnosticV2.answered+" · до "+max+" вопросов";
 $("progressFill").style.width=(diagnosticV2.answered/max*100)+"%";
 $("question").textContent=q.prompt;$("feedback").textContent="";$("next").classList.add("hidden");renderVisual(q.visual);
 const field=node("input","option");field.type="text";field.inputMode=q.answerFormat?.signed?"text":"decimal";field.setAttribute("aria-label","Твой ответ");field.placeholder="Число";field.autocomplete="off";field.maxLength=50;field.id="diagnostic-answer";
 const submit=node("button","option","Ответить");submit.type="button";submit.id="diagnosticSubmit";submit.disabled=true;
 const skip=node("button","secondary","Не знаю");skip.type="button";skip.id="diagnosticSkip";
 const unclear=node("button","secondary","Не понял вопрос");unclear.type="button";unclear.id="diagnosticUnclear";
 let pending=false;
 const syncSubmit=()=>{submit.disabled=pending||field.value.trim().length===0;};field.addEventListener("input",syncSubmit);
 const send=async value=>{
  if(pending)return;pending=true;const request=++diagnosticRequest;
  field.disabled=true;submit.disabled=true;skip.disabled=true;unclear.disabled=true;
  $("feedback").textContent="Сохраняем ответ…";
  try{
   const response=await diagnosticApi("/api/math/diagnostic-v2/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:q.id,value})});
   if(request!==diagnosticRequest)return;diagnosticV2=response;renderDiagnosticV2();
  }catch(_){if(request!==diagnosticRequest)return;pending=false;$("feedback").textContent="Не удалось сохранить. Ответ остался здесь — попробуй ещё раз.";field.disabled=false;syncSubmit();skip.disabled=false;unclear.disabled=false;}
 };
 submit.addEventListener("click",()=>{if(!submit.disabled)void send(field.value);});skip.addEventListener("click",()=>void send(null));unclear.addEventListener("click",()=>void send("__MISUNDERSTOOD__"));
 field.addEventListener("keydown",event=>{if(event.key==="Enter"&&!submit.disabled){event.preventDefault();void send(field.value);}});
 const label=node("label","diagnostic-answer-label","Твой ответ");label.htmlFor=field.id;
 const hint=node("span","",q.answerFormat?.kind==="decimal"?"Можно с запятой: 1,5":q.answerFormat?.unit?"Только число · "+q.answerFormat.unit:"Введи число");hint.id="answerFormatHint";label.append(hint);field.setAttribute("aria-describedby",hint.id);
 $("options").replaceChildren(label,field,submit,skip,unclear);
}
async function startDiagnosticV2(restart=false){
 const request=++diagnosticRequest;$("start").disabled=true;$("repeat").disabled=true;
 try{
  if(restart)await diagnosticApi("/api/math/diagnostic-v2/restart",{method:"POST"});
  if(request!==diagnosticRequest)return;
  const response=await diagnosticApi("/api/math/diagnostic-v2");if(request!==diagnosticRequest)return;
  diagnosticV2=response;document.documentElement.classList.add("journey-mode");$("intro").classList.remove("diagnostic-error");$("diagnosticV2Error")?.remove();$("diagnosticLoading")?.classList.add("hidden");renderDiagnosticV2();window.scrollTo({top:0,behavior:"instant"});
 }catch(_){
  if(request!==diagnosticRequest)return;$("diagnosticLoading")?.classList.add("hidden");$("intro").classList.add("diagnostic-error");show("intro");
  const note=$("diagnosticV2Error")||node("p","","Не удалось загрузить диагностику. Попробуй ещё раз.");note.id="diagnosticV2Error";note.setAttribute("role","alert");$("start").insertAdjacentElement("afterend",note);
 }finally{if(request===diagnosticRequest){$("start").disabled=false;$("repeat").disabled=false;}}
}
$("start").addEventListener("click",()=>void startDiagnosticV2());$("repeat").addEventListener("click",()=>void startDiagnosticV2(true));$("practice").addEventListener("click",()=>{const prev=state;state=null;try{localStorage.setItem(KEY,JSON.stringify(prev));}catch(_){} start("practice")});$("next").addEventListener("click",()=>{state.index++;save();render()});
document.getElementById("retrySync")?.addEventListener("click",()=>{document.getElementById("retrySync").hidden=true;void submitAttempt()});
void loadProgress();
if(new URLSearchParams(location.search).get("start")==="1")void startDiagnosticV2();

})();
