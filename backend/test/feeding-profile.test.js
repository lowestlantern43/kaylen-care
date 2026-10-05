import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const id='11111111-1111-4111-8111-111111111111';let saved={route:'peg',fluidMode:'include',routes:[]},active=true;
const query=async(sql,params=[])=>{
 if(sql.includes('FROM children'))return {rows:active?[{id}]:[]};
 if(sql.includes('INSERT INTO child_profiles')) {
  const fields=sql.match(/INSERT INTO child_profiles \(([\s\S]*?)\)/)[1].split(',').map(x=>x.trim());
  if(!sql.includes('feeding_settings = child_profiles.feeding_settings'))saved=JSON.parse(params[fields.indexOf('feeding_settings')]);
  return {rows:[{feedingSettings:saved}]};
 }
 return {rows:[]};
};
mock.module('../src/db/pool.js',{namedExports:{query}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{req.user={id};next();}}});
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>{req.familyMember={family_id:id};next();},requireAtLeastRole:()=> (req,res,next)=>req.headers['x-role']==='parent'?next():res.sendStatus(403)}});
mock.module('../src/middleware/planAccess.js',{namedExports:{requirePlanAccess:()=> (req,res,next)=>next()}});
const {childrenRouter}=await import('../src/routes/children.routes.js');
test('feeding settings save and legacy clients cannot clear them by omission',async()=>{
 const app=express();app.use(express.json());app.use(childrenRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const send=(body,role='parent')=>fetch(`http://127.0.0.1:${server.address().port}/${id}/profile`,{method:'PUT',headers:{'content-type':'application/json','x-role':role},body:JSON.stringify(body)});
 try{
 assert.equal((await send({eatingPreferences:'Legacy save'})).status,200);assert.equal(saved.route,'peg');assert.equal(saved.fluidMode,'include');
 assert.equal((await send({feedingSettings:{route:'ng',fluidMode:'unsure'}})).status,200);assert.equal(saved.route,'ng');assert.equal(saved.fluidMode,'unsure');
 assert.equal((await send({feedingSettings:{route:'unknown'}})).status,400);assert.equal(saved.route,'ng');
 assert.equal((await send({feedingSettings:{route:'oral'}},'viewer')).status,403);active=false;assert.equal((await send({feedingSettings:{route:'oral'}})).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
