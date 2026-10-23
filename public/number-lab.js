"use strict";
(()=>{const $=id=>document.getElementById(id);const max=20;let level="easy",round=0,score=0,selected=0,current=null,locked=false;
function question(){const n=round; if(level==="easy"){const target=[3,7,5,9,2][n%5];return{label:"Найди число "+target,target};}
if(level==="medium"){const a=[4,8,6,9,7][n%5],b=[3,5,2,4,6][n%5];return{label:a+" + "+b+" = ?",target:a+b};}
const a=[14,18,16,20,15][n%5],b=[6,9,7,8,5][n%5];return{label:a+" − "+b+" = ?",target:a-b};}
function setValue(v){if(locked)return;selected=Math.max(0,Math.min(max,Math.round(v)));const rect=$("line").getBoundingClientRect();const width=Math.max(1,rect.width-24);$("marker").style.left=(12+width*selected/max)+"px";$("marker").setAttribute("aria-valuenow",String(selected));$("selected").textContent="Выбрано: "+selected;}
function render(){locked=false;current=question();$("round").textContent="Задание "+(round+1)+" / 5";$("score").textContent="Правильно: "+score;$("task").textContent=current.label;$("feedback").textContent="";$("check").hidden=false;$("next").hidden=true;setValue(0);}
function pointer(event){const rect=$("line").getBoundingClientRect();const x=event.clientX-rect.left-12;setValue(x/(rect.width-24)*max);}
const ticks=$("ticks");for(let i=0;i<=max;i++){const d=document.createElement("div");d.className="tick";if(i%2===0){const n=document.createElement("span");n.textContent=i;d.append(n)}ticks.append(d);}
$("line").addEventListener("pointerdown",e=>{if(locked)return;pointer(e);$("line").setPointerCapture?.(e.pointerId);});$("line").addEventListener("pointermove",e=>{if(e.buttons&& !locked)pointer(e)});
$("marker").addEventListener("keydown",e=>{if(e.key==="ArrowRight"||e.key==="ArrowUp"){e.preventDefault();setValue(selected+1)}else if(e.key==="ArrowLeft"||e.key==="ArrowDown"){e.preventDefault();setValue(selected-1)}else if(e.key==="Home"){e.preventDefault();setValue(0)}else if(e.key==="End"){e.preventDefault();setValue(max)}});
$("check").addEventListener("click",()=>{if(locked)return;locked=true;const good=selected===current.target;if(good)score++;$("score").textContent="Правильно: "+score;$("feedback").textContent=good?"Точно в цель!":"Почти! Правильная точка: "+current.target+". Посмотри, сколько шагов от нуля.";$("check").hidden=true;$("next").hidden=false;$("next").textContent=round===4?"Сыграть ещё раз":"Следующее →";});
$("next").addEventListener("click",()=>{if(round===4){round=0;score=0}else round++;render()});
for(const b of document.querySelectorAll("[data-level]"))b.addEventListener("click",()=>{level=b.dataset.level;round=0;score=0;for(const x of document.querySelectorAll("[data-level]")){const active=x===b;x.setAttribute("aria-pressed",String(active));x.classList.toggle("secondary",!active)}render()});
window.addEventListener("resize",()=>{const value=selected;locked=false;setValue(value);locked=$("check").hidden;});render();
})();