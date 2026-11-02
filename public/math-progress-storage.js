"use strict";
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.MathProgressStorage=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 const PREFIX='school-math-adventure-v2:user:';
 function normalize(value){
  if(!value||!Number.isInteger(value.unlocked)||!Array.isArray(value.completed)||!Number.isInteger(value.startLevel)||value.startLevel<1||value.startLevel>100)return null;
  return {unlocked:Math.max(value.startLevel-1,Math.min(99,Math.max(0,value.unlocked))),stars:Number.isInteger(value.stars)?Math.max(0,value.stars):0,
   completed:[...new Set(value.completed.filter(i=>Number.isInteger(i)&&i>=0&&i<100))],startLevel:value.startLevel};
 }
 function create(getStorage){
  function key(userId){return typeof userId==='string'&&userId.length?PREFIX+encodeURIComponent(userId):null;}
  return {
   forget(userId){try{const name=key(userId);if(name)getStorage().removeItem(name);}catch(_){}},
   load(userId){try{const name=key(userId);return name?normalize(JSON.parse(getStorage().getItem(name))):null;}catch(_){return null;}},
   save(userId,progress){try{const name=key(userId),value=normalize(progress);if(!name||!value)return false;getStorage().setItem(name,JSON.stringify(value));return true;}catch(_){return false;}}
  };
 }
 return {create,normalize};
});
