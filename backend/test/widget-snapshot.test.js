import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
mock.module('../src/db/pool.js',{namedExports:{query:async()=>({rows:[]})}});
const {projectWidget,wallTime,instant,widgetSnapshot}=await import('../src/services/widgetSnapshot.js');
const profile={id:'p',first_name:'Demo',daily_fluid_target_ml:800,current_medications:'Medicine|2|ml||active|SECRET|true|morning|every_day'};
profile.current_medications=profile.current_medications.replace('|true|','|required|');
const now=new Date('2026-09-28T10:00:00Z');

test('hydration matches the full local-day diary total regardless of recorded time',()=>{
 const rows=[
  {category:'food',type:'drink',day:'2026-09-28',time:'08:00',amount:'400',unit:'ml'},
  {category:'food',type:'drink',day:'2026-09-28',time:'20:00',amount:'400',unit:'ml'},
  {category:'food',type:'drink',day:'2026-09-27',time:'20:00',amount:'200',unit:'ml'},
 ];
 assert.equal(projectWidget(profile,rows,'f','Europe/London',now).fluid,800);
 assert.equal(projectWidget(profile,rows,'f','Europe/London',new Date('2026-09-28T21:00:00Z')).fluid,800);
 assert.equal(projectWidget(profile,rows,'f','Europe/London',new Date('2026-09-28T23:30:00Z')).fluid,0);
});
test('minimal summaries, completed medication, fluids and active/woken/cancelled sleep',()=>{
 const rows=[{id:'m',category:'medication',day:'2026-09-28',time:'08:00',medicine:'Medicine',dose:'2ml',status:'given'},
  {id:'f',category:'food',day:'2026-09-28',time:'09:00',type:'drink',amount:'200',unit:'ml',notes:'PRIVATE'},
  {id:'s',category:'sleep',day:'2026-09-28',time:'10:00',bedtime:'10:00',wake_time:''}];
 const result=projectWidget(profile,rows,'family','Europe/London',now);
 assert.equal(result.fluid,200);assert.equal(result.target,800);
 assert.equal(result.medicines.length,1); // tomorrow only: today was recorded
 assert.equal(projectWidget(profile,rows.map(r=>r.id==='m'?{...r,status:'skipped'}:r),'family','Europe/London',now).medicines.length,1);
 assert.equal(new Date(result.medicines[0].timestamp*1000).toISOString(),'2026-09-29T05:00:00.000Z');
 assert.equal(result.sleepingSince,Date.parse('2026-09-28T09:00:00Z')/1000);
 assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 assert.equal(projectWidget(profile,rows.map(r=>({...r,wake_time:'10:30'})),'family','Europe/London',now).sleepingSince,null);
 assert.equal(projectWidget(profile,rows.filter(r=>r.id!=='s'),'family','Europe/London',now).sleepingSince,null);
 assert.equal(projectWidget(profile,rows,'another','Europe/London',now).id,'another:p');
});
test('timezone, midnight, DST and PRN schedules',async()=>{
 for(const iso of ['2026-03-29T06:00:00Z','2026-10-25T06:00:00Z','2026-09-28T23:30:00Z']) {
  const date=new Date(iso);assert.equal(instant(wallTime(date,'Europe/London'),'Europe/London'),+date/1000);
 }
 const result=projectWidget(profile,[],'f','Europe/London',new Date('2026-09-28T23:30:00Z'));
 assert.equal(result.day,'2026-09-29');
 assert.equal(projectWidget({...profile,current_medications:profile.current_medications.replace('every_day','prn')},[],'f','Europe/London',now).medicines.length,0);
 await assert.rejects(widgetSnapshot('f','invalid/zone'),e=>e.status===400);
});
test('space-separated saved times retain the evening dose after the morning dose is resolved',()=>{
 const daily={...profile,current_medications:'Demo|6|ml|07:30, 19:30|active||required|morning, evening|every_day'};
 for(const status of ['given','skipped']) {
  const result=projectWidget(daily,[{id:'morning',category:'medication',day:'2026-09-29',time:'07:30',medicine:'Demo',dose:'6 ml',status}],
   'f','Europe/London',new Date('2026-09-29T09:00:00Z'));
  assert.equal(result.medicines.length,3);
  assert.equal(new Date(result.medicines[0].timestamp*1000).toISOString(),'2026-09-29T18:30:00.000Z');
 }
 const windows={...profile,current_medications:'Demo|6|ml||active||required|morning, evening|mon, tue'};
 assert.equal(projectWidget(windows,[],'f','Europe/London',new Date('2026-09-29T09:00:00Z')).medicines.length,2);
});
