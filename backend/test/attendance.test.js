import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {normaliseAttendance,attendanceDates} from '../src/services/attendance.js';
const id='11111111-1111-4111-8111-111111111111';let records=[],active=true;
const query=async(sql,p=[])=>{if(sql.includes('FROM children'))return {rows:active?[{id}]:[]};if(sql.includes('SELECT data,notes'))return {rows:records.filter(r=>r.date===p[2])};if(sql.includes('INSERT INTO care_logs'))records.push({date:p[3],data:JSON.parse(p[5]),notes:p[6]});return {rows:[]};};
mock.module('../src/db/pool.js',{namedExports:{query,withTransaction:async fn=>{const old=structuredClone(records);try{return await fn({query});}catch(e){records=old;throw e;}}}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{req.user={id};next();}}});
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>{req.familyMember={family_id:id};next();},requireAtLeastRole:()=> (req,res,next)=>req.headers['x-role']==='parent'?next():res.sendStatus(403)}});
mock.module('../src/middleware/planAccess.js',{namedExports:{requirePlanAccess:()=> (req,res,next)=>next()}});
const {careLogsRouter}=await import('../src/routes/careLogs.routes.js');
test('attendance validates calendar ranges, times and stale absence fields',()=>{
 assert.deepEqual(attendanceDates('2028-02-28','2028-03-01'),['2028-02-28','2028-02-29','2028-03-01']);
 for(const d of ['2026-02-29','2026-04-31','bad'])assert.throws(()=>attendanceDates(d));
 assert.throws(()=>attendanceDates('2026-01-01','2026-12-01'));
 assert.throws(()=>normaliseAttendance({attendance:true,attendanceStatus:'unknown'}));
 assert.throws(()=>normaliseAttendance({attendance:true,attendanceStatus:'attended',arrival:'15:00',collection:'09:00'}));
 assert.equal(normaliseAttendance({attendance:true,attendanceStatus:'sick',arrival:'09:00'}).arrival,'');
 assert.equal(normaliseAttendance({attendance:true,attendanceStatus:'medical',partDay:true,arrival:'10:00'}).arrival,'10:00');
});
test('attendance ranges are atomic, retry safe and access controlled',async()=>{
 const app=express();app.use(express.json());app.use(careLogsRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const payload={childId:id,startDate:'2026-10-20',endDate:'2026-10-22',data:{attendanceStatus:'school_holiday'}};
 const send=(body,role='parent')=>fetch(`http://127.0.0.1:${server.address().port}/attendance`,{method:'POST',headers:{'content-type':'application/json','x-role':role},body:JSON.stringify(body)});
 try{assert.equal((await send(payload)).status,201);assert.equal(records.length,3);assert.equal((await send(payload)).status,201);assert.equal(records.length,3);assert.equal((await send({...payload,startDate:'2026-10-19',data:{attendanceStatus:'sick'}})).status,400);assert.equal(records.length,3);assert.equal((await send(payload,'viewer')).status,403);active=false;assert.equal((await send(payload)).status,404);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
