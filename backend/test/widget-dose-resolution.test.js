import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingWidgetDoses} from '../src/services/widgetMedication.js';
const run=(times,status='given')=>pendingWidgetDoses({
 medicines:[{name:'Demo',dose:'6 ml',times,active:true}],scheduled:()=>true,
 now:new Date('2026-09-30T21:00:00Z'),entryDate:e=>new Date(e.date),
 entries:[{id:'evening',section:'Medication',medicationName:'Demo',medicationDose:'6ml',medicationStatus:status,date:'2026-09-30T19:48:00Z'}],
}).filter(d=>new Date(d.timestamp*1000).toISOString().startsWith('2026-09-30'));
test('late evening log resolves evening timed dose without clearing morning',()=>{
 for(const status of ['given','taken','late','skipped']){
  const result=run(['07:30','19:30'],status);
  assert.equal(result.length,1);
  assert.equal(new Date(result[0].timestamp*1000).getUTCHours(),7);
 }
});
test('ambiguous evening doses and unresolved statuses stay pending',()=>{
 assert.equal(run(['07:30','19:30','20:30']).length,3);
 assert.equal(run(['07:30','19:30'],'pending').length,2);
});
