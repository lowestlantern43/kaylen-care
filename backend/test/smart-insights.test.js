import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {deriveSmartInsights} from '../src/services/smartInsights.js';
mock.module('../src/db/pool.js',{namedExports:{query:async()=>({rows:[]})}});
const {projectWidget}=await import('../src/services/widgetSnapshot.js');
const baseline=Array.from({length:5},(_,i)=>({day:`2026-10-0${i+1}`,time:'10:00',category:'food',type:'drink',amount:'500',unit:'ml'}));
const options={enabled:true,rows:baseline,today:'2026-10-06',time:'12:00',nowEpoch:100000,fluid:200};
test('insights default off and need five distinct comparable recorded days',()=>{
  assert.deepEqual(deriveSmartInsights({...options,enabled:false}),[]);
  assert.deepEqual(deriveSmartInsights({...options,enabled:undefined}),[]);
  assert.deepEqual(deriveSmartInsights({...options,rows:baseline.slice(0,4)}),[]);
  assert.deepEqual(deriveSmartInsights({...options,rows:baseline.map(r=>({...r,day:'2026-10-01'}))}),[]);
  assert.equal(deriveSmartInsights(options)[0].kind,'fluids');
  assert.deepEqual(deriveSmartInsights({...options,fluid:500}),[]);
  assert.deepEqual(deriveSmartInsights({...options,time:'09:00'}),[]);
});
test('partial oldest days, unknown units, unknown times and future records cannot create a baseline',()=>{
  for(const rows of [baseline.map(r=>({...r,unit:'unknown'})),baseline.map(r=>({...r,time:null})),baseline.map(r=>({...r,time:'19:00'})),baseline.map(r=>({...r,day:'2026-10-07'}))])assert.deepEqual(deriveSmartInsights({...options,rows}),[]);
  assert.deepEqual(deriveSmartInsights({...options,historyStartDay:'2026-10-01'}),[]);
});
test('only unresolved elapsed doses produce a medication indicator; sleeping is about an open log',()=>{
  const base={...options,rows:[],fluid:500};
  assert.deepEqual(deriveSmartInsights({...base,medicines:[{timestamp:100001}]}),[]);
  assert.deepEqual(deriveSmartInsights({...base,medicines:[{timestamp:90000,windowEnd:100001}]}),[]);
  assert.equal(deriveSmartInsights({...base,medicines:[{timestamp:90000}]})[0].kind,'medication');
  assert.deepEqual(deriveSmartInsights({...base,sleepingSince:100000-12*3600}),[]);
  assert.equal(deriveSmartInsights({...base,sleepingSince:100000-14*3600})[0].kind,'sleep');
  const longSleeps=baseline.map(r=>({...r,category:'sleep',bedtime:'01:00',wake_time:'14:00'}));
  assert.deepEqual(deriveSmartInsights({...base,rows:longSleeps,sleepingSince:100000-14*3600}),[]);
});
test('the canonical widget projector removes given or skipped doses from insights',()=>{
  const profile={id:'p',first_name:'Demo',smart_insights_enabled:true,current_medications:'Example|2|ml|08:00|active||required||every_day'};
  const now=new Date('2026-10-06T10:00:00Z');
  assert.equal(projectWidget(profile,[],'f','Europe/London',now).smartInsights[0].kind,'medication');
  for(const status of ['given','skipped']){
    const rows=[{id:'l',category:'medication',day:'2026-10-06',time:'08:00',medicine:'Example',dose:'2 ml',status}];
    assert.deepEqual(projectWidget(profile,rows,'f','Europe/London',now).smartInsights,[]);
  }
});
