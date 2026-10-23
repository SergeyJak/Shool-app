"use strict";
const SKILLS=["Счёт","Задачи","Дроби","Геометрия"];
const extra=[
["Счёт",1,"Сколько будет 16 + 13?",29,[27,29,31,39],"16 + 10 + 3 = 29."],
["Счёт",1,"Сколько будет 42 − 17?",25,[23,25,27,35],"42 − 10 − 7 = 25."],
["Счёт",2,"Сколько будет 9 × 6?",54,[45,48,54,56],"9 × 6 = 54."],
["Счёт",2,"Сколько будет 84 ÷ 7?",12,[11,12,13,14],"7 × 12 = 84."],
["Счёт",3,"Сколько будет 125 + 278?",403,[393,403,413,503],"125 + 278 = 403."],
["Счёт",3,"Сколько будет 144 ÷ 12?",12,[10,11,12,14],"12 × 12 = 144."],
["Задачи",1,"У тебя 18 конфет. 7 съели. Сколько осталось?",11,[9,10,11,12],"18 − 7 = 11."],
["Задачи",1,"В классе 12 девочек и 9 мальчиков. Сколько детей?",21,[19,20,21,22],"12 + 9 = 21."],
["Задачи",2,"4 коробки по 7 яблок. Сколько яблок?",28,[21,24,28,32],"4 × 7 = 28."],
["Задачи",2,"30 карандашей разделили между 5 детьми поровну. Сколько каждому?",6,[5,6,7,8],"30 ÷ 5 = 6."],
["Задачи",3,"Было 150 €. Купили 3 книги по 28 €. Сколько осталось?",66,[56,64,66,76],"150 − 3 × 28 = 66 €."],
["Задачи",3,"Автобус проехал 45 км за час. Сколько за 3 часа при той же скорости?",135,[115,125,135,145],"45 × 3 = 135 км."],
["Дроби",1,"Четверть от 20 — это…",5,[4,5,6,10],"20 ÷ 4 = 5."],
["Дроби",1,"Две четверти — это…","1/2",["1/4","1/2","3/4","1/3"],"2/4 = 1/2."],
["Дроби",2,"Сколько будет 1/4 + 1/4?","1/2",["1/4","1/2","3/4","1"],"2/4 = 1/2."],
["Дроби",2,"Что больше: 3/4 или 1/2?","3/4",["1/2","3/4","Равны","1/4"],"3/4 больше 2/4."],
["Дроби",3,"Сколько будет 2/3 + 1/3?",1,["2/6","3/6",1,"4/3"],"3/3 = 1."],
["Дроби",3,"Сколько будет 3/4 − 1/4?","1/2",["1/4","1/2","2/3","3/4"],"2/4 = 1/2."],
["Геометрия",1,"Сколько сторон у треугольника?",3,[2,3,4,5],"У треугольника 3 стороны."],
["Геометрия",1,"Сколько прямых углов у квадрата?",4,[1,2,3,4],"У квадрата 4 прямых угла."],
["Геометрия",2,"Периметр прямоугольника 4 × 6 см?",20,[10,20,24,26],"2 × (4 + 6) = 20 см."],
["Геометрия",2,"Площадь прямоугольника 3 × 7 см²?",21,[10,20,21,24],"3 × 7 = 21 см²."],
["Геометрия",3,"Площадь квадрата со стороной 9 см?",81,[18,36,72,81],"9 × 9 = 81 см²."],
["Геометрия",3,"Периметр прямоугольника со сторонами 12 и 8 см?",40,[20,32,40,96],"2 × (12 + 8) = 40 см."]
];

// Additional items are appended to preserve permanent question IDs from earlier sessions.
const MORE=[
["Счёт",1,"Сколько будет 35 + 14?",49,[39,45,49,59],"35 + 10 + 4 = 49."],
["Счёт",2,"Сколько будет 8 × 7?",56,[48,54,56,64],"8 × 7 = 56."],
["Счёт",3,"Сколько будет 360 ÷ 15?",24,[20,22,24,26],"15 × 24 = 360."],
["Задачи",1,"В корзине 11 груш и 8 яблок. Сколько фруктов?",19,[18,19,20,21],"11 + 8 = 19."],
["Задачи",2,"За 6 тетрадей заплатили 24 €. Сколько стоит одна?",4,[3,4,5,6],"24 ÷ 6 = 4 €."],
["Задачи",3,"В магазине 4 упаковки по 18 наклеек. 25 подарили. Сколько осталось?",47,[43,45,47,49],"4 × 18 − 25 = 47."],
["Дроби",1,"Половина от 30 — это…",15,[10,12,15,20],"30 ÷ 2 = 15."],
["Дроби",2,"Чему равна сумма 1/5 + 2/5?","3/5",["2/5","3/5","3/10","1/5"],"Складываем числители: 1/5 + 2/5 = 3/5."],
["Дроби",3,"Чему равна разность 5/6 − 1/6?","2/3",["1/6","1/2","2/3","5/6"],"4/6 сокращается до 2/3."],
["Геометрия",1,"Сколько сторон у пятиугольника?",5,[4,5,6,7],"У пятиугольника 5 сторон."],
["Геометрия",2,"Площадь квадрата со стороной 6 см?",36,[12,24,30,36],"6 × 6 = 36 см²."],
["Геометрия",3,"Площадь прямоугольника 12 см на 7 см?",84,[38,74,84,96],"12 × 7 = 84 см²."]
];
const QUESTIONS=[...extra,...MORE].map(([skill,level,q,a,options,why],i)=>({origin:i+12,skill,level,q,a,options,why}));
function chooseSkill(attempts){
 const totals=Object.fromEntries(SKILLS.map(s=>[s,{correct:0,total:0}]));
 for(const attempt of (attempts||[]).slice(0,20))for(const [s,score] of Object.entries(attempt.scores||{}))if(totals[s]){totals[s].correct+=score.correct;totals[s].total+=score.total;}
 return SKILLS.slice().sort((a,b)=>{const x=totals[a],y=totals[b];return (x.total?x.correct/x.total:0)-(y.total?y.correct/y.total:0)})[0];
}
function chooseLevel(attempts,skill){
 let correct=0,total=0;for(const attempt of (attempts||[]).slice(0,5)){const s=attempt.scores?.[skill];if(s){correct+=s.correct;total+=s.total;}}
 return !total?1:correct/total>=.85?3:correct/total>=.6?2:1;
}
function selectFreshPair(pool,attempts){
 const seen=new Map();
 for(const attempt of attempts||[])for(const answer of attempt.answers||[])seen.set(answer.origin,(seen.get(answer.origin)||0)+1);
 return [...pool].sort((a,b)=>(seen.get(a.origin)||0)-(seen.get(b.origin)||0)||a.origin-b.origin).slice(0,2);
}
function buildSession(attempts){
 const skill=chooseSkill(attempts),level=chooseLevel(attempts,skill);
 const pool=QUESTIONS.filter(q=>q.skill===skill && q.level===level);
 return {skill,level,questions:selectFreshPair(pool,attempts).map(({a,...item})=>item)};
}
function buildReviewSession(attempts){
 const lastWrong=[];
 for(const attempt of attempts||[]){
  for(const answer of attempt.answers||[])if(answer.correct===false&&answer.origin>=12&&!lastWrong.includes(answer.origin))lastWrong.push(answer.origin);
 }
 for(const id of lastWrong){
  const missed=QUESTIONS.find(q=>q.origin===id);if(!missed)continue;
  const pool=QUESTIONS.filter(q=>q.skill===missed.skill&&q.level===missed.level);
  if(pool.length<2)continue;
  return {skill:missed.skill,level:missed.level,review:true,questions:[missed,...selectFreshPair(pool.filter(q=>q.origin!==missed.origin),attempts)].slice(0,2).map(({a,...item})=>item)};
 }
 return {...buildSession(attempts),review:false};
}
module.exports={QUESTIONS,SKILLS,chooseSkill,chooseLevel,buildSession,buildReviewSession,selectFreshPair};
