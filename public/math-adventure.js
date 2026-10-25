"use strict";
(()=>{
const KEY="school-math-adventure-v2";
const LEGACY_KEY="school-math-adventure-v1";
const BUILD="20261025-log-truck-visual-r4";
const TOTAL_LEVELS=100;
const themes=[{name:"Солнечная поляна",x:18,y:80,type:"numbers"},{name:"Мост примеров",x:38,y:60,type:"numbers"},{name:"Развилка задач",x:68,y:75,type:"word"},{name:"Тропа фигур",x:72,y:36,type:"geometry"},{name:"Дракон знаний",x:43,y:22,type:"boss"}];
const levels=Array.from({length:TOTAL_LEVELS},(_,i)=>({...themes[i%5],name:themes[i%5].name+" · "+(i+1),index:i}));
levels[0].name="Собери яблоки";
levels[1].name="Грузовик с брёвнами";
levels[2].name="Соседи числа";
levels[3].name="Почини числовую тропу";
const $=id=>document.getElementById(id);
let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(_){saved={}}
if(!saved||!Number.isInteger(saved.unlocked))saved={unlocked:0,stars:0,completed:[]};
saved.unlocked=Math.max(0,Math.min(levels.length-1,saved.unlocked));saved.completed=Array.isArray(saved.completed)?saved.completed.filter(x=>Number.isInteger(x)&&x>=0&&x<levels.length):[];
let current=-1,round=0,correct=0,answered=false,questions=[],assessed=false,startingLevel=1,chapter=0;
let appleStep=0,appleCount=0,appleHints=0;
const appleTasks=[[2,1],[3,2],[4,3],[5,4],[6,5]];
const bridgeTasks=[[5,2],[7,3],[9,4],[12,5],[15,7]];
let bridgeStep=0,bridgeRemaining=0;
const neighborTasks=[4,7,12,19,28];let neighborStep=0,neighborLeft=null,neighborRight=null;
const pathTasks=[{start:1,step:1,missing:2},{start:2,step:2,missing:3},{start:5,step:5,missing:1},{start:10,step:10,missing:2},{start:3,step:3,missing:3}];let pathStep=0;
function persist(){try{localStorage.setItem(KEY,JSON.stringify(saved))}catch(_){}}
function mergeProgress(remote){
 if(!remote||!Array.isArray(remote.completed))return;
 saved.completed=[...new Set([...saved.completed,...remote.completed.filter(i=>Number.isInteger(i)&&i>=0&&i<levels.length)])];
 saved.unlocked=Math.max(saved.unlocked,Math.min(levels.length-1,remote.unlocked||0));
 if(Number.isInteger(remote.startLevel))startingLevel=remote.startLevel;
 saved.stars=Math.max(saved.stars,Number.isInteger(remote.stars)?remote.stars:0);
 persist();map();
}
async function loadCloud(){
 try{const response=await fetch("/api/math/adventure",{credentials:"same-origin"});
 if(response.ok){const data=await response.json();mergeProgress(data.progress);if(data.progress?.startLevel)setAssessment(data.progress.startLevel)}
 }catch(_){}
}
async function syncResult(level,score){
 try{const response=await fetch("/api/math/adventure",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,correct:score,total:10})});
 if(!response.ok)throw Error("SYNC_FAILED");
 mergeProgress((await response.json()).progress);
 $("resultText").textContent+=" Прогресс сохранён на сервере.";
 }catch(_){$("resultText").textContent+=" Прогресс сохранён на устройстве; синхронизация пока недоступна.";}
}
function task(type,i,level=0){
 const tier=Math.floor(level/10);const a=i+2+tier*2,b=i%5+2+tier;
 if(type==="geometry"&&tier>=2){const side=2+tier+i%4;const width=2+tier+(i%3);const height=2+Math.floor(tier/2)+(i%4);const advanced=[[`Периметр квадрата со стороной ${side} см?`,4*side],[`Площадь прямоугольника ${width} × ${height} клеток?`,width*height],[`Периметр прямоугольника со сторонами ${width} и ${height} см?`,2*(width+height)],[`Сколько градусов в прямом угле?`,90]];return advanced[i%advanced.length]}
 if(type==="geometry"){const data=[["Сколько сторон у треугольника?",3],["Сколько углов у квадрата?",4],["Сколько сторон у пятиугольника?",5],["Сколько углов у прямоугольника?",4],["Сколько сторон у шестиугольника?",6],["Сколько углов у треугольника?",3],["Сколько сторон у прямоугольника?",4],["Сколько углов у пятиугольника?",5],["Сколько сторон у квадрата?",4],["Сколько углов у шестиугольника?",6]];return data[i%data.length]}
 if(type==="word"){const data=[[`У совёнка ${a} яблока и ещё ${b}. Сколько всего?`,a+b],[`У дракона ${a+b} монет, ${b} он отдал. Сколько осталось?`,a],[`На ветке ${a} птицы, прилетели ещё ${b}. Сколько стало?`,a+b]];return data[i%data.length]}
 if(type==="boss"){return i%2===0?[`${a} × ${b} = ?`,a*b]:[`${a+b} − ${b} = ?`,a]}
 return i%3===0?[`${a+b} − ${b} = ?`,a]:[`${a} + ${b} = ?`,a+b]
}
function options(answer,i){const values=[answer,answer+1,answer+2,Math.max(0,answer-1)];return [...new Set(values)].sort((a,b)=>((a*7+i*3)%11)-((b*7+i*3)%11))}
function show(id){for(const key of ["intro","game","result"])$(key).classList.toggle("hidden",key!==id);const playing=id!=="intro";$("world").classList.toggle("hidden",playing);$("chapterNav").classList.toggle("hidden",playing||!assessed);document.body.classList.toggle("adventure-playing",playing)}
function setAssessment(level){assessed=true;startingLevel=level;saved.unlocked=Math.max(saved.unlocked,level-1);chapter=0;$("chapterNav").classList.remove("hidden");$("diagnosticGate").classList.add("hidden");$("world").hidden=false;$("intro").classList.remove("hidden");$("adventureLevelHeading").textContent="Твой уровень: "+startingLevel+" из 100";map()}
async function checkAssessment(){
 try{const v2=await fetch("/api/math/diagnostic-v2",{credentials:"same-origin"});if(v2.ok){const data=await v2.json();if(data.finished&&Number.isInteger(data.result?.level)){setAssessment(data.result.level);return}}}catch(_){}
 try{const response=await fetch("/api/math/progress",{credentials:"same-origin"});if(!response.ok)throw Error("PROGRESS_UNAVAILABLE");
 const data=await response.json();const attempts=(data.attempts||[]).filter(a=>a.mode==="diagnostic"&&Number.isFinite(a.correct)&&Number.isFinite(a.total)&&a.total>0);
 if(attempts.length){const last=attempts[0];setAssessment(Math.max(1,Math.min(100,Math.round(last.correct/last.total*99)+1)));return}
 }catch(_){const local=(()=>{try{return JSON.parse(localStorage.getItem("school-math-diagnostic-v1")||"null")}catch{return null}})();
 if(local?.mode==="diagnostic"&&local.answers?.length===12){setAssessment(Math.max(1,Math.min(100,Math.round(local.answers.filter(a=>a.correct).length/12*99)+1)));return}}
 $("world").hidden=true;$("intro").classList.add("hidden");$("diagnosticGate").classList.remove("hidden");
}
function map(){document.querySelectorAll(".node").forEach(n=>n.remove());const first=chapter*5;const scenes=["forest","river","mountains","castle","clearing","cave","sunset","boss-arena"];$("world").style.backgroundImage=`url("/assets/math-adventure/backgrounds/${scenes[chapter%scenes.length]}.svg")`;$("chapterTitle").textContent=`Глава ${chapter+1} из 20`;$("chapterPrev").disabled=chapter===0;$("chapterNext").disabled=chapter>=Math.floor(saved.unlocked/5);levels.slice(first,first+5).forEach((level,j)=>{const i=first+j;const btn=document.createElement("button");btn.className="node";btn.style.left=themes[j].x+"%";btn.style.top=themes[j].y+"%";btn.disabled=i>saved.unlocked;btn.setAttribute("aria-label",level.name+(btn.disabled?", закрыт":""));const img=document.createElement("img");img.alt="";img.src="/assets/math-adventure/map/"+(j===4?"boss-node.svg":i>saved.unlocked?"locked-node.svg":saved.completed.includes(i)?"node-complete.svg":"path-node.svg");const label=document.createElement("span");label.textContent=level.name;const number=document.createElement("b");number.className="node-number";number.textContent=saved.completed.includes(i)?"✓":i<=saved.unlocked?String(i+1):"";btn.append(img,number,label);btn.addEventListener("click",()=>start(i));$("world").append(btn)});$("summary").textContent=`Твой стартовый уровень: ${startingLevel} из 100. Открыт этап ${saved.unlocked+1} из ${levels.length}. Звёзд: ${saved.stars}. Первая остановка — обучающая игра без штрафов.`}
function start(i){if(i>saved.unlocked)return;current=i;round=0;correct=0;questions=Array.from({length:10},(_,j)=>task(levels[i].type,j,i));$("levelName").textContent=levels[i].name;show("game");if(i===0){appleStep=0;appleHints=0;renderApples()}else if(i===1){bridgeStep=0;renderBridge()}else if(i===2){neighborStep=0;renderNeighbors()}else if(i===3){pathStep=0;renderNumberPath()}else render();$("game").scrollIntoView({block:"start",behavior:"instant"})}
function renderApples(){
 const [inBasket,toAdd]=appleTasks[appleStep];const friend=["🐿️ Белочка","🐰 Зайчик","🦔 Ёжик","🐻 Медвежонок","🦊 Лисёнок"][appleStep];const goal=inBasket+toAdd;appleCount=0;answered=false;
 $("counter").textContent="Игра "+(appleStep+1)+" из "+appleTasks.length;
 $("meterFill").style.width=(appleStep/appleTasks.length*100)+"%";
 $("question").textContent=friend+" ждёт "+goal+" яблок. В корзине уже "+inBasket+". Нажми на яблоки внизу и собери ровно "+goal+"!";
 $("feedback").textContent="Цель: угостить друга "+goal+" яблоками. Нажимай на яблоки внизу, они попадут в корзину.";
 $("next").classList.add("hidden");
 const area=$("choices");area.replaceChildren();area.classList.add("apple-training");area.classList.remove("apple-delivering");
 const existing=document.createElement("div");existing.className="apple-existing";existing.setAttribute("aria-label","В корзине "+inBasket+" яблок");
 const basket=document.createElement("div");basket.className="apple-basket";basket.setAttribute("aria-live","polite");
 const orchard=document.createElement("div");orchard.className="apple-orchard";
 const counter=document.createElement("p");counter.className="apple-counter";
 const hint=document.createElement("button");hint.type="button";hint.className="apple-hint";hint.textContent="Подсказка";
 const update=()=>{basket.textContent="🧺 "+ "🍎".repeat(inBasket+appleCount);counter.textContent="Собрано: "+(inBasket+appleCount)+" из "+goal;};
 existing.textContent="🎯 Нужно: "+goal+" 🍎 · Уже есть: "+inBasket+" 🍎";
 for(let i=0;i<toAdd+3;i++){
  const apple=document.createElement("button");apple.type="button";apple.className="apple-pick";apple.textContent="🍎";apple.setAttribute("aria-label","Положить яблоко в корзину");
  apple.addEventListener("click",()=>{if(answered)return;if(appleCount>=toAdd){$("feedback").textContent="В корзине уже достаточно яблок. Можно убрать лишнее.";return}appleCount++;apple.disabled=true;update();if(appleCount===toAdd){answered=true;correct++;area.classList.add("apple-delivering");$("feedback").textContent="Отлично! "+inBasket+" + "+toAdd+" = "+goal+". Корзинка едет к другу!"; $("next").classList.remove("hidden")}});
  orchard.append(apple);
 }
 basket.addEventListener("click",()=>{if(answered||appleCount===0)return;appleCount--;for(const b of orchard.children){if(b.disabled){b.disabled=false;break}}update()});
 basket.setAttribute("role","button");basket.setAttribute("tabindex","0");basket.setAttribute("aria-label","Убрать последнее яблоко из корзины");
 basket.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();basket.click()}});
 hint.addEventListener("click",()=>{appleHints++;$("feedback").textContent="Осталось добавить "+(toAdd-appleCount)+" яблок. В корзине "+(inBasket+appleCount)+", а другу нужно "+goal+". Нажимай на яблоки по одному.";});
 const receiver=document.createElement("div");receiver.className="apple-receiver";receiver.textContent=friend+" ждёт угощение";
 basket.addEventListener("animationend",()=>{if(answered){receiver.textContent=friend+" получил "+goal+" яблок! 🎉";$("feedback").textContent="Ура! "+friend+" получил все "+goal+" яблок. "+inBasket+" + "+toAdd+" = "+goal+".";}});
 area.append(existing,basket,receiver,orchard,counter,hint);update();
}
function celebrateLevel(){
 const panel=$("result");let stage=panel.querySelector(".level-celebration");if(!stage){stage=document.createElement("div");stage.className="level-celebration";stage.setAttribute("aria-hidden","true");const owl=document.createElement("img");owl.className="celebration-owl";owl.src="/assets/math-adventure/characters/owl-mascot.svg";owl.alt="";stage.append(owl);for(let i=0;i<18;i++){const spark=document.createElement("span");spark.className="celebration-spark";spark.style.setProperty("--i",String(i));spark.style.setProperty("--angle",(i*137.5)+"deg");spark.style.setProperty("--distance",(70+i%4*18)+"px");spark.textContent=["✦","★","✳","✧"][i%4];stage.append(spark)}panel.insertBefore(stage,$("resultTitle"));}
 stage.classList.remove("celebration-play");void stage.offsetWidth;stage.classList.add("celebration-play");
}
function finishApples(){
 if(!saved.completed.includes(0)){saved.completed.push(0);saved.stars+=3}
 saved.unlocked=Math.max(saved.unlocked,1);persist();
 $("resultTitle").textContent="Яблоки собраны!";
 $("resultText").textContent="Ты научился складывать яблоки в корзину. Подсказки можно использовать сколько угодно. Следующая остановка открыта.";
 $("meterFill").style.width="100%";show("result");celebrateLevel();chapter=0;map();$("result").scrollIntoView({block:"start",behavior:"instant"});
 void syncResult(0,10);
}
function renderBridge(){
 const [total,remove]=bridgeTasks[bridgeStep];const safe=total-remove;
 bridgeRemaining=total;answered=false;
 $("counter").textContent="Рейс "+(bridgeStep+1)+" из "+bridgeTasks.length;
 $("meterFill").style.width=(bridgeStep/bridgeTasks.length*100)+"%";
 $("question").textContent="🚚 Грузовик может увезти только "+safe+" брёвен. Сейчас в кузове "+total+", поэтому машина не едет. Убери лишние!";
 $("feedback").textContent="Нажимай на брёвна 🪵 в кузове. Машина поедет, когда останется ровно "+safe+".";
 $("next").classList.add("hidden");
 const area=$("choices");area.replaceChildren();area.classList.add("apple-training");area.classList.remove("truck-departing");
 const bridge=document.createElement("div");bridge.className="bridge-board truck-scene";bridge.setAttribute("aria-label","Брёвна в кузове грузовика");
 const count=document.createElement("p");count.className="apple-counter";
 const hint=document.createElement("button");hint.type="button";hint.className="apple-hint";hint.textContent="Подсказка";
 const update=()=>{
  const removed=total-bridgeRemaining;
  count.textContent="В кузове: "+bridgeRemaining+" · Можно увезти: "+safe;
 };
 for(let j=0;j<total;j++){
  const board=document.createElement("button");board.type="button";board.className="bridge-plank";
  board.textContent="🪵";board.setAttribute("aria-label","Выгрузить бревно "+(j+1));
  board.addEventListener("click",()=>{
   if(answered)return;
   const removed=total-bridgeRemaining;
   if(board.classList.contains("removed")){
    board.classList.remove("removed");bridgeRemaining++;$("feedback").textContent="Бревно снова в кузове.";update();return;
   }
   if(removed>=remove){$("feedback").textContent="Готово! Больше выгружать не нужно.";return}
   board.classList.add("removed");bridgeRemaining--;update();
   if(bridgeRemaining===total-remove){
    answered=true;correct++;
    bridge.classList.add("truck-ready");area.classList.add("truck-departing");cab.classList.add("truck-driving");status.textContent="✅ Можно ехать!";$("feedback").textContent="🚚 Поехали! "+total+" − "+remove+" = "+bridgeRemaining+". Грузовик отправился в путь!";
    $("next").classList.remove("hidden");
   }
  });
  bridge.append(board);
 }
 hint.addEventListener("click",()=>{
  const removed=total-bridgeRemaining;
  $("feedback").textContent="В кузове было "+total+" брёвен, а машина везёт не больше "+safe+". Нажми ещё на "+(remove-removed)+" брёвен, чтобы выгрузить их.";
 });
 const cab=document.createElement("div");cab.className="truck-cab";cab.textContent="🚚";cab.setAttribute("aria-hidden","true");
 const status=document.createElement("div");status.className="truck-status";status.textContent="⛔ Перегруз";
 bridge.prepend(status);area.append(cab,bridge,count,hint);update();
}
function finishBridge(){
 if(!saved.completed.includes(1)){saved.completed.push(1);saved.stars+=3}
 saved.unlocked=Math.max(saved.unlocked,2);persist();
 $("resultTitle").textContent="Мост построен!";
 $("resultText").textContent="Ты научился вычитать: убирать часть и считать, сколько осталось. Следующая остановка открыта.";
 $("meterFill").style.width="100%";show("result");celebrateLevel();chapter=0;map();
 $("result").scrollIntoView({block:"start",behavior:"instant"});void syncResult(1,10);
}
function renderNeighbors(){
 const center=neighborTasks[neighborStep];neighborLeft=null;neighborRight=null;answered=false;
 $("counter").textContent="Улица "+(neighborStep+1)+" из "+neighborTasks.length;
 $("meterFill").style.width=(neighborStep/neighborTasks.length*100)+"%";
 $("question").textContent="🏡 На улице потерялись номера двух домиков. Найди соседей дома № "+center+"!";
 $("feedback").textContent="Слева живёт число на 1 меньше, справа — на 1 больше. Нажми на пустой домик, затем выбери номер.";
 $("next").classList.add("hidden");const area=$("choices");area.replaceChildren();area.className="choices neighbor-training";
 const street=document.createElement("div");street.className="neighbor-street";const numbers=document.createElement("div");numbers.className="neighbor-numbers";const hint=document.createElement("button");hint.type="button";hint.className="apple-hint";hint.textContent="Подсказка";let selected="left";
 const houses={};for(const [side,label] of [["left","Слева"],["center","Дом совёнка"],["right","Справа"]]){const house=document.createElement("button");house.type="button";house.className="neighbor-house"+(side==="center"?" neighbor-center":"");house.setAttribute("aria-label",label);house.disabled=side==="center";houses[side]=house;if(side!=="center")house.addEventListener("click",()=>{if(answered)return;selected=side;update()});street.append(house)}
 const update=()=>{for(const side of ["left","center","right"]){const val=side==="left"?neighborLeft:side==="right"?neighborRight:center;houses[side].replaceChildren();const roof=document.createElement("span");roof.className="neighbor-roof";roof.textContent="🏠";const number=document.createElement("span");number.className="neighbor-number";number.textContent=val===null?"?":String(val);const window=document.createElement("span");window.className="neighbor-window";window.textContent=val===null?"◻":"✨";houses[side].append(roof,number,window);houses[side].classList.toggle("neighbor-lit",val!==null);houses[side].classList.toggle("neighbor-selected",side===selected&&!answered)};
  $("feedback").textContent=neighborLeft===null||neighborRight===null?"Найди два соседних номера. Уже найдено: "+Number(neighborLeft!==null)+ " из 2.":"Все домики на месте! "+(center-1)+", "+center+", "+(center+1)+"."};
 const options=[center-2,center-1,center+1,center+2,center+3].sort((a,b)=>((a*7+neighborStep*3)%11)-((b*7+neighborStep*3)%11));
 for(const num of options){const tile=document.createElement("button");tile.type="button";tile.className="neighbor-tile";tile.textContent=String(num);tile.addEventListener("click",()=>{if(answered)return;const expected=selected==="left"?center-1:center+1;if(num!==expected){$("feedback").textContent="Почти! "+(selected==="left"?"Слева нужен номер на 1 меньше "+center+".":"Справа нужен номер на 1 больше "+center+".")+" Попробуй другой.";return}if(selected==="left"){neighborLeft=num;selected="right"}else{neighborRight=num;selected="left"}tile.disabled=true;update();const destination=houses[selected==="right"&&neighborLeft===num?"left":neighborRight===num?"right":"left"];const placed=houses[neighborLeft===num?"left":"right"];placed.classList.remove("neighbor-arrived");void placed.offsetWidth;placed.classList.add("neighbor-arrived");if(neighborLeft!==null&&neighborRight!==null){answered=true;correct++;street.classList.add("neighbor-complete");const residents=document.createElement("div");residents.className="neighbor-residents";residents.textContent="🐰  🦊  🐿️";residents.setAttribute("aria-hidden","true");street.append(residents);const owl=document.createElement("div");owl.className="neighbor-owl";owl.textContent="🦉 ⭐";owl.setAttribute("aria-hidden","true");street.append(owl);$("feedback").textContent="🎉 Ура! Все соседи дома: "+neighborLeft+", "+center+", "+neighborRight+"!";$("next").classList.remove("hidden")}});numbers.append(tile)}
 hint.addEventListener("click",()=>{$("feedback").textContent="Считай по порядку: "+(center-1)+", "+center+", "+(center+1)+". Выбери номера слева и справа."});
 area.append(street,numbers,hint);update();
}
function finishNeighbors(){
 if(!saved.completed.includes(2)){saved.completed.push(2);saved.stars+=3}
 saved.unlocked=Math.max(saved.unlocked,3);persist();
 $("resultTitle").textContent="Улица заселена!";$("resultText").textContent="Ты нашёл соседей чисел и помог совёнку вернуть номера домикам. Следующая остановка открыта.";
 $("meterFill").style.width="100%";show("result");celebrateLevel();chapter=0;map();$("result").scrollIntoView({block:"start",behavior:"instant"});void syncResult(2,10);
}
function renderNumberPath(){
 const task=pathTasks[pathStep],answer=task.start+task.step*task.missing;answered=false;
 $("counter").textContent="Тропа "+(pathStep+1)+" из "+pathTasks.length;
 $("meterFill").style.width=pathStep/pathTasks.length*100+"%";
 $("question").textContent="🌉 У совёнка пропала плитка на тропинке. Найди число, чтобы можно было пройти дальше!";
 $("feedback").textContent="Посмотри, как меняются числа на камнях. Вставь пропущенное число.";
 $("next").classList.add("hidden");const area=$("choices");area.replaceChildren();area.className="choices number-path-game";
 const scene=document.createElement("div");scene.className="number-path-scene";const owl=document.createElement("div");owl.className="path-owl";owl.textContent="🦉";owl.setAttribute("aria-hidden","true");scene.append(owl);
 const stones=document.createElement("div");stones.className="path-stones";const missing=document.createElement("div");
 for(let i=0;i<5;i++){const stone=document.createElement("div");stone.className="path-stone"+(i===task.missing?" path-gap":"");stone.textContent=i===task.missing?"?":String(task.start+task.step*i);if(i===task.missing){missing.className="path-stone path-gap";missing.replaceWith(stone)}stones.append(stone)}
 scene.append(stones);const tiles=document.createElement("div");tiles.className="path-tiles";
 const variants=[answer,answer+task.step,answer-task.step,answer+2*task.step].filter((v,i,a)=>v>=0&&a.indexOf(v)===i).sort((a,b)=>((a*3+pathStep)%7)-((b*3+pathStep)%7));
 for(const value of variants){const tile=document.createElement("button");tile.type="button";tile.className="path-choice";tile.textContent=String(value);tile.addEventListener("click",()=>{if(answered)return;if(value!==answer){tile.classList.remove("path-wrong");void tile.offsetWidth;tile.classList.add("path-wrong");$("feedback").textContent="Этот камень не подходит. Попробуй посчитать шаг между числами.";return}
 answered=true;correct++;const gap=stones.children[task.missing];gap.textContent=String(answer);gap.classList.remove("path-gap");gap.classList.add("path-repaired");tile.disabled=true;scene.classList.add("path-success");$("feedback").textContent="🌟 Тропинка снова целая! Шаг "+task.step+". Совёнок может пройти!";$("next").classList.remove("hidden")});tiles.append(tile)}
 const hint=document.createElement("button");hint.type="button";hint.className="path-hint";hint.textContent="Подсказка";hint.addEventListener("click",()=>{$("feedback").textContent="Каждый следующий камень больше на "+task.step+". Посчитай от первого камня."});
 area.append(scene,tiles,hint);
}
function finishNumberPath(){
 if(!saved.completed.includes(3)){saved.completed.push(3);saved.stars+=3}
 saved.unlocked=Math.max(saved.unlocked,4);persist();
 $("resultTitle").textContent="Тропа спасена!";$("resultText").textContent="Ты восстановил числовые дорожки, а совёнок добрался до следующей остановки.";
 $("meterFill").style.width="100%";show("result");celebrateLevel();chapter=0;map();$("result").scrollIntoView({block:"start",behavior:"instant"});void syncResult(3,10);
}
function render(){answered=false;$("feedback").textContent="";$("next").classList.add("hidden");$("counter").textContent=`Задание ${round+1} из ${questions.length}`;$("meterFill").style.width=round/questions.length*100+"%";const [q,answer]=questions[round];$("question").textContent=q;$("choices").replaceChildren();for(const val of options(answer,round)){const btn=document.createElement("button");btn.textContent=val;btn.addEventListener("click",()=>{if(answered)return;answered=true;if(val===answer)correct++;$("feedback").textContent=val===answer?"Правильно! ⭐":`Пока нет. Правильный ответ: ${answer}`;for(const b of $("choices").children)b.disabled=true;$("next").classList.remove("hidden");$("next").scrollIntoView({block:"nearest",behavior:"smooth"})});$("choices").append(btn)}}
$("next").addEventListener("click",()=>{if(!answered)return;if(current===0){appleStep++;if(appleStep<appleTasks.length)renderApples();else finishApples();return}if(current===1){bridgeStep++;if(bridgeStep<bridgeTasks.length)renderBridge();else finishBridge();return}if(current===2){neighborStep++;if(neighborStep<neighborTasks.length)renderNeighbors();else finishNeighbors();return}if(current===3){pathStep++;if(pathStep<pathTasks.length)renderNumberPath();else finishNumberPath();return}round++;if(round<questions.length){render();return}const passed=correct>=8;if(passed){if(!saved.completed.includes(current)){saved.completed.push(current);saved.stars+=Math.min(3,Math.floor(correct/2)-2)}saved.unlocked=Math.max(saved.unlocked,Math.min(levels.length-1,current+1));persist()}$("resultTitle").textContent=passed?"Уровень пройден!":"Попробуем ещё раз";$("resultText").textContent=`Правильных ответов: ${correct} из ${questions.length}. `+(passed?"Следующая остановка открыта.":"Для открытия пути нужно 8 правильных ответов из 10.");$("meterFill").style.width="100%";show("result");chapter=Math.floor(current/5);map();$("result").scrollIntoView({block:"start",behavior:"instant"});void syncResult(current,correct)});
$("chapterPrev").addEventListener("click",()=>{chapter=Math.max(0,chapter-1);map()});$("chapterNext").addEventListener("click",()=>{chapter=Math.min(Math.floor(saved.unlocked/5),chapter+1);map()});$("return").addEventListener("click",()=>{chapter=Math.floor(Math.max(0,current)/5);show("intro");$("world").scrollIntoView({block:"start",behavior:"instant"})});$("world").hidden=true;$("intro").classList.add("hidden");void checkAssessment();void loadCloud();
})();