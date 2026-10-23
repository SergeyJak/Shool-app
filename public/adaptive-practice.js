"use strict";
(()=>{
const $=id=>document.getElementById(id);let session=null,index=0,answers=[],locked=false;
async function begin(){
 $("adaptiveError").textContent="";$("adaptiveStart").disabled=true;
 try{const r=await fetch("/api/math/adaptive");if(!r.ok)throw Error("LOAD_FAILED");session=await r.json();index=0;answers=[];$("adaptivePanel").hidden=false;$("adaptiveSummary").hidden=true;render();}
 catch(_){$("adaptiveError").textContent="Не удалось загрузить задания. Попробуй ещё раз.";}
 finally{$("adaptiveStart").disabled=false;}
}
function render(){
 const q=session.questions[index];locked=false;
 $("adaptiveTitle").textContent=session.skill+" · уровень "+session.level+" · "+(index+1)+"/"+session.questions.length;
 $("adaptiveQuestion").textContent=q.q;$("adaptiveFeedback").textContent="";$("adaptiveNext").hidden=true;
 const wrap=$("adaptiveOptions");wrap.replaceChildren();
 for(const value of q.options){const btn=document.createElement("button");btn.type="button";btn.className="option";btn.textContent=String(value);btn.addEventListener("click",()=>select(value));wrap.append(btn);}
}
function select(value){
 if(locked)return;locked=true;const q=session.questions[index];answers.push({origin:q.origin,value});
 for(const btn of $("adaptiveOptions").children)btn.disabled=true;
 $("adaptiveFeedback").textContent="Ответ записан. "+q.why;
 $("adaptiveNext").hidden=false;$("adaptiveNext").textContent=index===session.questions.length-1?"Завершить":"Следующее →";
}
async function next(){
 if(!locked)return;
 if(index<session.questions.length-1){index++;render();return;}
 $("adaptiveNext").disabled=true;
 try{const r=await fetch("/api/math/attempts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"adaptive",answers})});if(!r.ok)throw Error("SAVE_FAILED");const data=await r.json();
 $("adaptivePanel").hidden=true;$("adaptiveSummary").hidden=false;$("adaptiveSummary").textContent="Задания завершены! Правильно: "+data.attempt.correct+" из "+data.attempt.total+". Прогресс сохранён в твоём кабинете.";await beginRefresh();
 }catch(_){$("adaptiveFeedback").textContent="Не получилось сохранить. Нажми «Завершить», чтобы повторить."; }
 finally{$("adaptiveNext").disabled=false;}
}
async function beginRefresh(){try{const r=await fetch("/api/math/progress");const data=await r.json();$("adaptiveHistory").textContent="Всего сохранённых занятий в истории: "+(data.attempts||[]).length+" (последние 30).";}catch(_){}}
$("adaptiveStart").addEventListener("click",begin);$("adaptiveNext").addEventListener("click",next);void beginRefresh();
})();