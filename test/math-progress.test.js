"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {summarizeSkills,mistakes}=require("../lib/math-progress");
const {QUESTIONS}=require("../lib/math-adaptive");
test("map aggregates correct answers across skills",()=>{
 const x=summarizeSkills([{scores:{"Счёт":{correct:2,total:3}}},{scores:{"Счёт":{correct:3,total:3}}}]);
 assert.equal(x["Счёт"].total,6);assert.equal(x["Счёт"].percent,83);assert.equal(x["Дроби"].percent,null);
});
test("review list includes unique wrong questions that exist in bank",()=>{
 const id=QUESTIONS[0].origin;
 const x=mistakes([{answers:[{origin:id,correct:false},{origin:id,correct:false},{origin:999,correct:false}]}],QUESTIONS);
 assert.deepEqual(x,[id]);
});
test("bad scores cannot poison the skill map",()=>{
 const x=summarizeSkills([{scores:{"Счёт":{correct:8,total:2},"__proto__":{correct:1,total:1}}}]);
 assert.equal(x["Счёт"].total,0);
});
