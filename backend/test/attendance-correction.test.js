import {test,mock} from 'node:test';import assert from 'node:assert/strict';import express from 'express';
const id='11111111-1111-4111-8111-111111111111';let saved;
const old={id,child_id:id,category:'general',log_date:'2026-10-06',updated_at:'2026-10-06T08:00:00Z',data:{attendance:true,attendanceStatus:'attended',arrival:'09:00',schoolActive:true,schoolStartedAt:'2026-10-06T08:00:00Z'}};
const query=async(sql,p=[])=>{if(sql.startsWith('SELECT child_id,data')||sql.startsWith('SELECT * FROM care_logs'))return {rows:[old]};if(sql.includes('FROM children'))return {rows:[{id}]};if(sql.startsWith('UPDATE care_logs SET log_date')){saved=JSON.parse(p[4]);return {rows:[{updated_at:'2026-10-06T09:00:00Z'}]};}return {rows:[]};};
mock.module('../src/db/pool.js',{namedExports:{query,withTransaction:async f=>f({query})}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{req.user={id};next();}}});
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>{req.familyMember={family_id:id};next();},requireAtLeastRole:()=> (req,res,next)=>next()}});
mock.module('../src/middleware/planAccess.js',{namedExports:{requirePlanAccess:()=> (req,res,next)=>next()}});
const {careLogsRouter}=await import('../src/routes/careLogs.routes.js');
test('calendar correction from active school to sick clears live state without an arrival prompt',async()=>{
 const app=express();app.use(express.json());app.use(careLogsRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const result=await fetch(`http://127.0.0.1:${server.address().port}/${id}/correction`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'edit',expectedUpdatedAt:old.updated_at,logDate:old.log_date,data:{...old.data,attendanceStatus:'sick'},notes:'Recorded in error'})});assert.equal(result.status,200,await result.text());assert.equal(saved.schoolActive,false);assert.equal(saved.attendanceStatus,'sick');assert.equal(saved.arrival,'');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
