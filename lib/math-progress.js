"use strict";
const SKILLS=["Счёт","Задачи","Дроби","Геометрия"];
function summarizeSkills(attempts){
 const result=Object.fromEntries(SKILLS.map(s=>[s,{correct:0,total:0,percent:null,level:"Не исследовано"}]));
 for(const attempt of (attempts||[]).slice(0,30)){
   for(const [skill,score] of Object.entries(attempt.scores||{})){
     if(!result[skill]||!Number.isFinite(score?.correct)||!Number.isFinite(score?.total)||score.total<0||score.correct<0||score.correct>score.total)continue;
     result[skill].correct+=score.correct;result[skill].total+=score.total;
   }
 }
 for(const item of Object.values(result)){
  if(item.total){item.percent=Math.round(item.correct/item.total*100);item.level=item.percent>=85?"Уверенно":item.percent>=60?"Развивается":"Нужна практика";}
 }
 return result;
}
function mistakes(attempts,questions){
 const byId=new Map(questions.map(q=>[q.origin,q]));
 const wrong=[];
 for(const attempt of (attempts||[]).slice(0,30)){
  for(const answer of attempt.answers||[]){
   if(answer.correct!==false||!byId.has(answer.origin)||wrong.includes(answer.origin))continue;
   wrong.push(answer.origin);
  }
 }
 return wrong;
}
module.exports={summarizeSkills,mistakes,SKILLS};
