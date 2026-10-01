import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
let latest=null, allowed=true, profileExists=true; const writes=[];
const child='11111111-1111-4111-8111-111111111111', sleep='22222222-2222-4222-8222-222222222222';
mock.module('../src/db/pool.js',{namedExports:{query:async()=>({rows:[]}),withTransaction:async fn=>fn({query:async(sql,params)=>{
 if(sql.startsWith('SELECT id FROM children')) {assert.deepEqual(params,[child,'family']);return {rows:profileExists?[{id:child}]:[]};}
 if(sql.includes('SELECT usual_bedtime'))return {rows:[{usual_bedtime:'20:00'}]};
 if(sql.includes('FROM care_logs'))return {rows:latest?[latest]:[]};
 writes.push({sql,params});
 if(sql.startsWith('INSERT'))latest={id:sleep,day:params[3],time:params[4],data:JSON.parse(params[5])};
 if(sql.startsWith('UPDATE'))latest.data={...latest.data,...JSON.parse(params[0])};
 return {rows:[]};
}})}});
mock.module('../src/services/planAccess.js',{namedExports:{getFamilyPlanAccess:async()=>({canAddLogs:allowed,canEditLogs:allowed})}});
const {checkSleepTransition,widgetSleepAction}=await import('../src/services/widgetSleep.js');
const access={user_id:'user',family_id:'family',role:'parent',sleep_actions:true};
const start={action:'start',childId:child,expectedSleepId:'',timeZone:'Europe/London'};
const now=new Date('2026-10-01T19:05:00Z');
test('bedtime gating, repeat taps, overnight wake and preserved details',async()=>{
 assert.throws(()=>checkSleepTransition(null,start,'20:00',new Date('2026-10-01T18:59:00Z'),'Europe/London'),e=>e.status===400);
 assert.throws(()=>checkSleepTransition(null,start,null,now,'Europe/London'),e=>e.status===400);
 await widgetSleepAction(access,start,now);
 assert.equal(writes.length,1);assert.equal(latest.data.bedtime,'20:05');
 await assert.rejects(widgetSleepAction(access,start,now),e=>e.status===409);assert.equal(writes.length,1);
 latest.data.quality='Recorded quality';
 const end={...start,action:'end',expectedSleepId:sleep};
 await widgetSleepAction(access,end,new Date('2026-10-02T06:00:00Z'));
 assert.equal(latest.data.wake_time,'07:00');assert.equal(latest.data.wake_date,'2026-10-02');assert.equal(latest.data.quality,'Recorded quality');
 assert.match(writes[1].sql,/data=data \|\|/);
 await widgetSleepAction(access,end,new Date('2026-10-02T06:01:00Z'));assert.equal(writes.length,2);
 await assert.rejects(widgetSleepAction(access,start,new Date('2026-10-02T20:00:00Z')),e=>e.status===409);
});
test('permissions, plan, archived profile and stale sleep are enforced',async()=>{
 for(const a of [{...access,sleep_actions:false},{...access,role:'viewer'}])await assert.rejects(widgetSleepAction(a,start,now),e=>e.status===403);
 await assert.rejects(widgetSleepAction({...access,role:'carer'},{...start,action:'end'},now),e=>e.status===403);
 allowed=false;await assert.rejects(widgetSleepAction(access,start,now),e=>e.status===403);allowed=true;
 profileExists=false;await assert.rejects(widgetSleepAction(access,start,now),e=>e.status===404);profileExists=true;
 const old={id:sleep,day:'2026-07-24',time:'20:00',data:{bedtime:'20:00'}};
 assert.throws(()=>checkSleepTransition(old,{action:'end',expectedSleepId:sleep},'20:00',now,'Europe/London'),e=>e.status===400);
 assert.throws(()=>checkSleepTransition(old,{action:'end',expectedSleepId:child},'20:00',now,'Europe/London'),e=>e.status===409);
});
test('DST sleep uses actual start instant and no duplicate sleep after same-evening waking',()=>{
 const prior={id:sleep,day:'2026-10-24',time:'22:00',data:{bedtime:'22:00',sleep_started_at:'2026-10-24T21:00:00Z'}};
 assert.equal(checkSleepTransition(prior,{action:'end',expectedSleepId:sleep},'20:00',new Date('2026-10-25T08:00:00Z'),'Europe/London').time,'08:00');
 assert.throws(()=>checkSleepTransition({...prior,day:'2026-10-01',data:{bedtime:'20:00',wake_time:'20:30',wake_date:'2026-10-01'}},{...start,expectedSleepId:sleep},'20:00',new Date('2026-10-01T20:00:00Z'),'Europe/London'),e=>e.status===409);
});
