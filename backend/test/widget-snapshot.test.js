import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
mock.module('../src/db/pool.js',{namedExports:{query:async()=>({rows:[]})}});
const {projectWidget,wallTime,instant,widgetSnapshot}=await import('../src/services/widgetSnapshot.js');
const profile={id:'p',first_name:'Demo',daily_fluid_target_ml:800,current_medications:'Medicine|2|ml||active|SECRET|true|morning|every_day'};
profile.current_medications=profile.current_medications.replace('|true|','|required|');
const now=new Date('2026-09-28T10:00:00Z');
test('minimal summaries, completed medication, fluids and active/woken/cancelled sleep',()=>{
 const rows=[{id:'m',category:'medication',day:'2026-09-28',time:'08:00',medicine:'Medicine',dose:'2ml',status:'given'},
  {id:'f',category:'food',day:'2026-09-28',time:'09:00',type:'drink',amount:'200',unit:'ml',notes:'PRIVATE'},
  {id:'s',category:'sleep',day:'2026-09-28',time:'10:00',bedtime:'10:00',wake_time:''}];
 const result=projectWidget(profile,rows,'family','Europe/London',now);
 assert.equal(result.fluid,200);assert.equal(result.target,800);
 assert.equal(result.medicines.length,1); // tomorrow only: today was recorded
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
