"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {create,normalize}=require('../public/math-progress-storage');
const snapshot={unlocked:2,stars:6,completed:[0,1],startLevel:1};
function fixture(entries=[]){const values=new Map(entries);return {values,store:create(()=>({getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}))};}

test('account storage never reads unowned adventure or diagnostic progress',()=>{
 const {store}=fixture([['school-math-adventure-v2',JSON.stringify(snapshot)],['school-math-diagnostic-v1','{"level":100}']]);
 assert.equal(store.load('student-A'),null);
 assert.equal(store.load('student-B'),null);
});
test('same-account snapshots survive reload without crossing another account',()=>{
 const {store,values}=fixture();
 assert.equal(store.save('student-A',snapshot),true);
 assert.deepEqual(store.load('student-A'),snapshot);
 assert.equal(store.load('student-B'),null);
 assert.equal(values.size,1);
 store.forget('student-A');assert.equal(store.load('student-A'),null);
 assert.equal(store.save('',snapshot),false);
 assert.equal(store.load(''),null);
});
test('corrupt snapshots and disabled browser storage fail closed',()=>{
 const {store,values}=fixture();store.save('student-A',snapshot);
 for(const key of values.keys())values.set(key,'invalid json');
 assert.equal(store.load('student-A'),null);
 const disabled=create(()=>{throw new Error('Storage disabled');});
 assert.equal(disabled.load('student-A'),null);
 assert.equal(disabled.save('student-A',snapshot),false);
});
test('offline snapshots require an account assessment and bounded progression',()=>{
 assert.equal(normalize({unlocked:99,stars:99,completed:[]}),null);
 assert.equal(normalize({...snapshot,startLevel:0}),null);
 assert.deepEqual(normalize({unlocked:500,stars:-10,completed:[0,0,-1,100,'1'],startLevel:2}),{unlocked:99,stars:0,completed:[0],startLevel:2});
 assert.deepEqual(normalize({unlocked:0,stars:null,completed:[],startLevel:8}),{unlocked:7,stars:0,completed:[],startLevel:8});
});
