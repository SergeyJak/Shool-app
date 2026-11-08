"use strict";
(() => {
const $=id=>document.getElementById(id);
async function loadProgress(){
 try {const res=await fetch("/api/math/progress",{credentials:"same-origin"});if(!res.ok)return;const data=await res.json();
 const history=document.getElementById("history");if(history){const attempts=data.attempts||[];history.textContent=attempts.length?`История: ${attempts.length} последних попыток. Последняя: ${attempts[0].correct} из ${attempts[0].total}.`:"Результатов пока нет. Начнём с диагностики!";}
 }catch(_){const history=document.getElementById("history");if(history)history.textContent="История временно недоступна";}
}
function show(id){["intro","play","results"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}

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
  return;
 }
 show("play");const q=diagnosticV2.question;if(!q)return;
 $("mode").textContent=q.topicTitle||skillLabels[q.skill]||q.skill;
 const max=diagnosticV2.maxQuestions||42;
 $("progress").textContent=diagnosticV2.answered+" · до "+max+" вопросов";
 $("progressFill").style.width=(diagnosticV2.answered/max*100)+"%";
 $("question").textContent=q.prompt;$("feedback").textContent="";renderVisual(q.visual);
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
$("start").addEventListener("click",()=>void startDiagnosticV2());
$("repeat").addEventListener("click",()=>void startDiagnosticV2(true));
void loadProgress();
if(new URLSearchParams(location.search).get("start")==="1")void startDiagnosticV2();

})();
