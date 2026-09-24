import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
let archived=true,duplicate=false,updated=false;
const query=async(sql)=>{
 if(sql.includes('FOR UPDATE')){assert.ok(sql.includes("interval '30 days'"));return {rows:archived?[{id:'a',family_id:'f',first_name:'Demo',last_name:''}]:[]};}
 if(sql.includes('SELECT id FROM children'))return {rows:duplicate?[{id:'other'}]:[]};
 if(sql.includes('UPDATE children'))updated=true;
 return {rows:[]};
};
mock.module('../src/db/pool.js',{namedExports:{query,withTransaction:fn=>fn({query})}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{if(!req.headers['x-test-user'])return res.sendStatus(401);req.user={is_platform_admin:req.headers['x-test-user']==='admin'};next();}}});
const {archivedProfilesRouter}=await import('../src/routes/archivedProfiles.routes.js');
test('profile recovery requires admin, rejects expired or duplicate profiles',async()=>{
 const app=express();app.use(archivedProfilesRouter);app.use((err,req,res,next)=>res.status(err.status||500).end());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;const url=base+'/11111111-1111-4111-8111-111111111111/restore';
 try{
 assert.equal((await fetch(base)).status,401);
 assert.equal((await fetch(url,{method:'POST',headers:{'x-test-user':'normal'}})).status,403);
 archived=false;assert.equal((await fetch(url,{method:'POST',headers:{'x-test-user':'admin'}})).status,404);assert.equal(updated,false);
 archived=true;duplicate=true;assert.equal((await fetch(url,{method:'POST',headers:{'x-test-user':'admin'}})).status,400);assert.equal(updated,false);
 duplicate=false;assert.equal((await fetch(url,{method:'POST',headers:{'x-test-user':'admin'}})).status,200);assert.equal(updated,true);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
