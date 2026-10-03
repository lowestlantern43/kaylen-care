import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const id='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
let record,active=true,allowed=true;const audits=[];
const query=async(sql,p=[])=>{
 if(sql.startsWith('SELECT * FROM care_logs'))return {rows:p[1]==='family'?[record]:[]};
 if(sql.startsWith('SELECT id FROM children'))return {rows:active?[{id:p[0]}]:[]};
 if(sql.startsWith('UPDATE care_logs')){
 if(sql.includes('child_id=$3'))record.child_id=p[2];
 if(sql.includes('log_date=$3'))Object.assign(record,{log_date:p[2],log_time:p[3],data:JSON.parse(p[4]),notes:p[5]});
 if(sql.includes('deleted_at=now()'))record.deleted_at=new Date();
 if(sql.includes('deleted_at=NULL'))record.deleted_at=null;
 record.updated_at=new Date(new Date(record.updated_at).getTime()+1000);return {rows:[{updated_at:record.updated_at}]};
 }
 if(sql.includes('INSERT INTO audit_logs'))audits.push(p);
 return {rows:[]};
};
mock.module('../src/db/pool.js',{namedExports:{query,withTransaction:async fn=>fn({query})}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{req.user={id};next();}}});
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>{req.familyMember={family_id:req.headers['x-family']||'family'};next();},requireAtLeastRole:()=> (req,res,next)=>req.headers['x-role']==='parent'?next():res.sendStatus(403)}});
mock.module('../src/middleware/planAccess.js',{namedExports:{requirePlanAccess:()=> (req,res,next)=>allowed?next():res.sendStatus(403)}});
const {careLogsRouter}=await import('../src/routes/careLogs.routes.js');
test('corrections preserve records, enforce scope and version, and support timed undo',async()=>{
 record={id,child_id:child,category:'food',log_date:'2026-10-02',data:{item:'Toast',amount:'All',preserved:'value'},updated_at:new Date('2026-10-02T10:00:00Z'),deleted_at:null};
 const app=express();app.use(express.json());app.use(careLogsRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const send=(body,headers={})=>fetch(`http://127.0.0.1:${server.address().port}/${id}/correction`,{method:'POST',headers:{'content-type':'application/json','x-role':'parent',...headers},body:JSON.stringify({expectedUpdatedAt:record.updated_at,...body})});
 try{
 assert.equal((await send({action:'move',childId:other},{'x-role':'carer'})).status,403);
 assert.equal((await send({action:'move',childId:other},{'x-family':'foreign'})).status,404);
 active=false;assert.equal((await send({action:'move',childId:other})).status,404);active=true;
 allowed=false;assert.equal((await send({action:'move',childId:other})).status,403);allowed=true;
 assert.equal((await send({action:'edit',expectedUpdatedAt:'2000-01-01'})).status,400);
 assert.equal((await send({action:'move',childId:other})).status,200);assert.equal(record.child_id,other);assert.equal(record.data.item,'Toast');
 assert.equal((await send({action:'edit',logDate:'2026-10-01',logTime:'08:00',data:{...record.data,item:'Porridge'},notes:'Corrected'})).status,200);assert.equal(record.data.preserved,'value');
 assert.equal((await send({action:'delete'})).status,200);assert.ok(record.deleted_at);
 assert.equal((await send({action:'restore'})).status,200);assert.equal(record.deleted_at,null);
 record.deleted_at=new Date(Date.now()-16*60000);assert.equal((await send({action:'restore'})).status,400);
 assert.equal(audits.length,4);assert.ok(!JSON.stringify(audits).includes('Porridge'));
 }finally{await new Promise(r=>server.close(r));}
});
