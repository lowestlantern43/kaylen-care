import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
let records=[],activeChild=true;const child='22222222-2222-4222-8222-222222222222',family='f';
const query=async(sql,p=[])=>{
 if(sql.includes('SELECT school_settings'))return {rows:[{school_settings:{name:'Demo School'}}]};
 if(sql.includes('FROM children'))return {rows:activeChild&&p[1]===family?[{id:child}]:[]};
 if(sql.includes('SELECT id,data,updated_at'))return {rows:records.filter(r=>r.family===p[0]&&r.child===p[1]&&!r.deleted)};
 if(sql.startsWith('INSERT INTO care_logs')){const row={id:'school-1',family:p[0],child:p[1],day:p[3],data:JSON.parse(p[5]),updated_at:new Date('2026-10-06T08:00:00Z')};records.push(row);return {rows:[row]};}
 if(sql.startsWith('UPDATE care_logs')){const row=records.find(r=>r.id===p[0]);row.data=JSON.parse(p[2]);row.updated_at=new Date('2026-10-06T15:00:00Z');return {rows:[row]};}
 return {rows:[]};
};
mock.module('../src/db/pool.js',{namedExports:{query,withTransaction:async f=>f({query})}});
const {schoolSession}=await import('../src/services/schoolSession.js');
const {projectWidget}=await import('../src/services/widgetSnapshot.js');
const {activeSchoolRecord,normaliseAttendance}=await import('../src/services/attendance.js');
const now=new Date('2026-10-06T08:00:00Z'),zone='Europe/London',profile={id:child,first_name:'Demo',daily_fluid_target_ml:1000,current_medications:'Example|2|ml|20:00|active||required||every_day'};
const baseRows=[{category:'food',day:'2026-10-06',time:'07:00',type:'drink',amount:200,unit:'ml'},{category:'sleep',day:'2026-10-05',time:'20:00',bedtime:'20:00',wake_time:'07:00',wake_date:'2026-10-06'}];
const project=(saved=records)=>projectWidget(profile,[...baseRows,...saved.filter(r=>!r.deleted).map(r=>({id:r.id,category:'general',day:r.day,time:r.data.arrival,attendance:'true',attendance_status:r.data.attendanceStatus,school_active:String(r.data.schoolActive),school_started_at:r.data.schoolStartedAt,school_ended_at:r.data.schoolEndedAt,school_collection:r.data.collection}))],family,zone,new Date('2026-10-06T16:00:00Z'));
test('home -> school -> persisted reopen -> home leaves one completed attendance and unchanged other widget data',async()=>{
 records=[];const before=project();assert.equal(before.schoolSince,null);
 await schoolSession(family,child,'user',{action:'start',expectedLogId:'',timeZone:zone},now);
 assert.equal(records[0].data.setting,'Demo School');assert.equal(records.length,1);assert.equal(records[0].data.attendanceStatus,'attended');assert.equal(project().schoolSince,now.getTime()/1000);
 const reloaded=JSON.parse(JSON.stringify(records));assert.equal(project(reloaded).schoolSince,project().schoolSince);assert.equal(activeSchoolRecord(reloaded).id,'school-1');
 assert.equal(project().fluid,before.fluid);assert.deepEqual(project().medicines,before.medicines);assert.equal(project().sleepingSince,before.sleepingSince);
 await assert.rejects(()=>schoolSession(family,child,'other',{action:'start',expectedLogId:'',timeZone:zone},now));
 await schoolSession(family,child,'other',{action:'end',expectedLogId:'school-1',expectedUpdatedAt:records[0].updated_at,timeZone:zone},new Date('2026-10-06T15:00:00Z'));
 assert.equal(project().schoolSince,null);assert.equal(records.length,1);assert.equal(records[0].data.collection,'16:00');assert.equal(records[0].data.schoolEndedAt,'2026-10-06T15:00:00.000Z');
 assert.equal((await schoolSession(family,child,'user',{action:'end',expectedLogId:'school-1',timeZone:zone})).alreadySaved,true);
 await assert.rejects(()=>schoolSession(family,child,'user',{action:'start',expectedLogId:'school-1',expectedUpdatedAt:records[0].updated_at,timeZone:zone},now));
});
test('absence edits, collection, deletion and future planned days never leave an active widget',()=>{
 const started={attendance:true,attendanceStatus:'attended',schoolActive:true,schoolStartedAt:now.toISOString(),arrival:'09:00'};
 for(const change of [{attendanceStatus:'sick'},{attendanceStatus:'training'},{attendanceStatus:'school_holiday'},{attendanceStatus:'medical',partDay:true},{collection:'15:00'}])assert.equal(activeSchoolRecord([{data:normaliseAttendance({...started,...change})}]),null);
 assert.equal(activeSchoolRecord([{data:{attendance:true,attendanceStatus:'attended'}}]),null);
 assert.equal(activeSchoolRecord([{data:{...started,schoolStartedAt:'2099-01-01T09:00:00Z'}}]),null);
 assert.equal(project([{day:'2026-10-06',data:started,deleted:true}]).schoolSince,null);
 const sleeping=projectWidget(profile,[{category:'sleep',day:'2026-10-06',time:'12:00',bedtime:'12:00',wake_time:''}],family,zone,new Date('2026-10-06T13:00:00Z'));assert.equal(sleeping.sleepingSince,Date.parse('2026-10-06T11:00:00Z')/1000);assert.equal(sleeping.schoolSince,null);
});
test('school session rejects foreign and archived profiles and stale carers',async()=>{
 await assert.rejects(()=>schoolSession('other',child,'user',{action:'start',timeZone:zone},now));activeChild=false;await assert.rejects(()=>schoolSession(family,child,'user',{action:'start',timeZone:zone},now));activeChild=true;
 await assert.rejects(()=>schoolSession(family,child,'user',{action:'start',expectedLogId:'',timeZone:zone},now));
});

test('pickup follows selected weekdays without starting a school session',()=>{
 const configured={...profile,school_settings:{days:{tue:{enabled:true,pickup:'15:15'}}}};
 const weekday=projectWidget(configured,[],family,zone,now);assert.equal(weekday.schoolPickup,'15:15');assert.equal(weekday.schoolSince,null);
 assert.equal(projectWidget(configured,[],family,zone,new Date('2026-10-10T08:00:00Z')).schoolPickup,null);
});

test('part-day attendance clears live school state and preserves real recorded times',()=>{
 const data=normaliseAttendance({attendance:true,attendanceStatus:'part_day',schoolActive:true,schoolStartedAt:now.toISOString(),arrival:'09:00',collection:'12:00'});
 assert.equal(data.partDay,true);assert.equal(data.schoolActive,false);assert.equal(data.arrival,'09:00');assert.equal(data.collection,'12:00');assert.equal(activeSchoolRecord([{data}]),null);
});
