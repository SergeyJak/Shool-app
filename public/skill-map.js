"use strict";
(()=>{
const list=document.getElementById("skillMap"),status=document.getElementById("skillMapStatus"),count=document.getElementById("mistakeCount");
async function refresh(){
 try{
 const res=await fetch("/api/math/skill-map",{credentials:"same-origin"});
 if(!res.ok)throw Error("LOAD_FAILED");
 const data=await res.json();list.replaceChildren();
 for(const [name,score] of Object.entries(data.skills||{})){
  const item=document.createElement("div");item.className="skill";
  const title=document.createElement("strong");title.textContent=name;
  const desc=document.createElement("div");desc.textContent=score.percent===null?"Пока не изучали":score.percent+"% · "+score.level;
  const progress=document.createElement("progress");progress.max=100;progress.value=score.percent??0;progress.setAttribute("aria-label",name);
  progress.style.width="100%";progress.style.marginTop="12px";
  item.append(title,desc,progress);list.append(item);
 }
 count.textContent=data.reviewOrigins?.length?"В повторении нуждаются "+data.reviewOrigins.length+" заданий из тренировок.":"Ошибок в тренировочном банке пока нет.";
 status.textContent="По результатам последних 30 занятий. Это ориентир, а не школьная оценка.";
 }catch(_){status.textContent="Карта временно недоступна.";}
}
window.addEventListener("math-attempt-saved",refresh);void refresh();
})();