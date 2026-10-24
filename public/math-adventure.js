"use strict";
(()=>{
const KEY="school-math-adventure-v1";
const levels=[{name:"Солнечная поляна",x:18,y:80,type:"numbers"},{name:"Мост примеров",x:38,y:60,type:"numbers"},{name:"Развилка задач",x:68,y:75,type:"word"},{name:"Тропа фигур",x:72,y:36,type:"geometry"},{name:"Дракон знаний",x:43,y:22,type:"boss"}];
const $=id=>document.getElementById(id);
let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(_){saved={}}
if(!saved||!Number.isInteger(saved.unlocked))saved={unlocked:0,stars:0,completed:[]};
saved.unlocked=Math.max(0,Math.min(levels.length-1,saved.unlocked));saved.completed=Array.isArray(saved.completed)?saved.completed.filter(x=>Number.isInteger(x)&&x>=0&&x<levels.length):[];
let current=-1,round=0,correct=0,answered=false,questions=[],assessed=false,startingLevel=1;
function persist(){try{localStorage.setItem(KEY,JSON.stringify(saved))}catch(_){}}
function mergeProgress(remote){
 if(!remote||!Array.isArray(remote.completed))return;
 saved.completed=[...new Set([...saved.completed,...remote.completed.filter(i=>Number.isInteger(i)&&i>=0&&i<levels.length)])];
 saved.unlocked=Math.max(saved.unlocked,Math.min(levels.length-1,remote.unlocked||0));
 saved.stars=Math.max(saved.stars,Number.isInteger(remote.stars)?remote.stars:0);
 persist();map();
}
async function loadCloud(){
 try{const response=await fetch("/api/math/adventure",{credentials:"same-origin"});
 if(response.ok)mergeProgress((await response.json()).progress);
 }catch(_){}
}
async function syncResult(level,score){
 try{const response=await fetch("/api/math/adventure",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,correct:score,total:10})});
 if(!response.ok)throw Error("SYNC_FAILED");
 mergeProgress((await response.json()).progress);
 $("resultText").textContent+=" Прогресс сохранён на сервере.";
 }catch(_){$("resultText").textContent+=" Прогресс сохранён на устройстве; синхронизация пока недоступна.";}
}
function task(type,i){
 const a=i+2,b=i%5+2;
 if(type==="geometry"){const data=[["Сколько сторон у треугольника?",3],["Сколько углов у квадрата?",4],["Сколько сторон у пятиугольника?",5],["Сколько углов у прямоугольника?",4],["Сколько сторон у шестиугольника?",6],["Сколько углов у треугольника?",3],["Сколько сторон у прямоугольника?",4],["Сколько углов у пятиугольника?",5],["Сколько сторон у квадрата?",4],["Сколько углов у шестиугольника?",6]];return data[i%data.length]}
 if(type==="word"){const data=[[`У совёнка ${a} яблока и ещё ${b}. Сколько всего?`,a+b],[`У дракона ${a+b} монет, ${b} он отдал. Сколько осталось?`,a],[`На ветке ${a} птицы, прилетели ещё ${b}. Сколько стало?`,a+b]];return data[i%data.length]}
 if(type==="boss"){return i%2===0?[`${a} × ${b} = ?`,a*b]:[`${a+b} − ${b} = ?`,a]}
 return i%3===0?[`${a+b} − ${b} = ?`,a]:[`${a} + ${b} = ?`,a+b]
}
function options(answer,i){const values=[answer,answer+1,answer+2,Math.max(0,answer-1)];return [...new Set(values)].sort((a,b)=>((a*7+i*3)%11)-((b*7+i*3)%11))}
function show(id){for(const key of ["intro","game","result"])$(key).classList.toggle("hidden",key!==id)}
function setAssessment(level){assessed=true;startingLevel=level;$("diagnosticGate").classList.add("hidden");$("world").hidden=false;$("intro").classList.remove("hidden");$("adventureLevelHeading").textContent="Твой уровень: "+startingLevel+" из 100";map()}
async function checkAssessment(){
 try{const response=await fetch("/api/math/progress",{credentials:"same-origin"});if(!response.ok)throw Error("PROGRESS_UNAVAILABLE");
 const data=await response.json();const attempts=(data.attempts||[]).filter(a=>a.mode==="diagnostic"&&Number.isFinite(a.correct)&&Number.isFinite(a.total)&&a.total>0);
 if(attempts.length){const last=attempts[0];setAssessment(Math.max(1,Math.min(100,Math.round(last.correct/last.total*99)+1)));return}
 }catch(_){const local=(()=>{try{return JSON.parse(localStorage.getItem("school-math-diagnostic-v1")||"null")}catch{return null}})();
 if(local?.mode==="diagnostic"&&local.answers?.length===12){setAssessment(Math.max(1,Math.min(100,Math.round(local.answers.filter(a=>a.correct).length/12*99)+1)));return}}
 $("world").hidden=true;$("intro").classList.add("hidden");$("diagnosticGate").classList.remove("hidden");
}
function map(){document.querySelectorAll(".node").forEach(n=>n.remove());levels.forEach((level,i)=>{const btn=document.createElement("button");btn.className="node";btn.style.left=level.x+"%";btn.style.top=level.y+"%";btn.disabled=i>saved.unlocked;btn.setAttribute("aria-label",level.name+(btn.disabled?", закрыт":""));const img=document.createElement("img");img.alt="";img.src="/assets/math-adventure/map/"+(i===4?"boss-node.svg":i>saved.unlocked?"locked-node.svg":saved.completed.includes(i)?"node-complete.svg":"path-node.svg");const label=document.createElement("span");label.textContent=level.name;const number=document.createElement("b");number.className="node-number";number.textContent=saved.completed.includes(i)?"✓":i<=saved.unlocked?String(Math.min(100,startingLevel+i)):"";btn.append(img,number,label);btn.addEventListener("click",()=>start(i));$("world").append(btn)});$("summary").textContent=`Открыто уровней: ${saved.unlocked+1} из ${levels.length}. Звёзд: ${saved.stars}. Для прохождения нужно не менее 80% правильных ответов.`}
function start(i){if(i>saved.unlocked)return;current=i;round=0;correct=0;questions=Array.from({length:10},(_,j)=>task(levels[i].type,j));$("levelName").textContent=levels[i].name;show("game");render();$("game").scrollIntoView({block:"start",behavior:"instant"})}
function render(){answered=false;$("feedback").textContent="";$("next").classList.add("hidden");$("counter").textContent=`Задание ${round+1} из ${questions.length}`;$("meterFill").style.width=round/questions.length*100+"%";const [q,answer]=questions[round];$("question").textContent=q;$("choices").replaceChildren();for(const val of options(answer,round)){const btn=document.createElement("button");btn.textContent=val;btn.addEventListener("click",()=>{if(answered)return;answered=true;if(val===answer)correct++;$("feedback").textContent=val===answer?"Правильно! ⭐":`Пока нет. Правильный ответ: ${answer}`;for(const b of $("choices").children)b.disabled=true;$("next").classList.remove("hidden")});$("choices").append(btn)}}
$("next").addEventListener("click",()=>{if(!answered)return;round++;if(round<questions.length){render();return}const passed=correct>=8;if(passed){if(!saved.completed.includes(current)){saved.completed.push(current);saved.stars+=Math.min(3,Math.floor(correct/2)-2)}saved.unlocked=Math.max(saved.unlocked,Math.min(levels.length-1,current+1));persist()}$("resultTitle").textContent=passed?"Уровень пройден!":"Попробуем ещё раз";$("resultText").textContent=`Правильных ответов: ${correct} из ${questions.length}. `+(passed?"Следующая остановка открыта.":"Для открытия пути нужно 8 правильных ответов из 10.");$("meterFill").style.width="100%";show("result");map();$("result").scrollIntoView({block:"start",behavior:"instant"});void syncResult(current,correct)});
$("return").addEventListener("click",()=>{show("intro");$("world").scrollIntoView({block:"start",behavior:"instant"})});$("world").hidden=true;$("intro").classList.add("hidden");void checkAssessment();void loadCloud();
})();