"use strict";
// Canonical answers live server-side. Never accept browser-provided scores.
const ANSWERS=[75,54,56,15,18,20,9,"2/4","1/2",4,20,200];
const SKILLS=["Счёт","Задачи","Дроби","Геометрия"];
function validateAttempt(body){
  const mode=body?.mode;
  if(mode!=="diagnostic" && mode!=="practice")return null;
  const answers=body?.answers;
  if(!Array.isArray(answers)||answers.length<1||answers.length>12)return null;
  const seen=new Set();
  const normalized=[];
  for(const item of answers){
    if(!item||!Number.isInteger(item.origin)||item.origin<0||item.origin>=ANSWERS.length||seen.has(item.origin))return null;
    if(typeof item.value!=="number"&&typeof item.value!=="string")return null;
    if(String(item.value).length>30)return null;
    seen.add(item.origin);
    normalized.push({origin:item.origin,correct:String(ANSWERS[item.origin])===String(item.value)});
  }
  if(mode==="diagnostic"&&(normalized.length!==12||normalized.some((item,i)=>item.origin!==i)))return null;
  if(mode==="practice"&&(normalized.length!==3||normalized.some(x=>Math.floor(x.origin/3)!==Math.floor(normalized[0].origin/3))))return null;
  const scores=Object.fromEntries(SKILLS.map(skill=>[skill,{correct:0,total:0}]));
  for(const item of normalized){const skill=SKILLS[Math.floor(item.origin/3)];scores[skill].total++;if(item.correct)scores[skill].correct++;}
  return {mode,answers:normalized,scores,correct:normalized.filter(a=>a.correct).length,total:normalized.length};
}
module.exports={validateAttempt};
