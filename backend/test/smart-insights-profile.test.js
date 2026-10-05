import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const id='11111111-1111-4111-8111-111111111111';let enabled=true,active=true;
const query=async(sql,params=[])=>{
  if(sql.includes('FROM children'))return {rows:active?[{id}]:[]};
  if(sql.includes('INSERT INTO child_profiles')){
    const fields=sql.match(/INSERT INTO child_profiles \(([\s\S]*?)\)/)[1].split(',').map(x=>x.trim());
    if(!sql.includes('smart_insights_enabled = child_profiles.smart_insights_enabled'))enabled=params[fields.indexOf('smart_insights_enabled')];
    return {rows:[{smartInsightsEnabled:enabled}]};
  }
  return {rows:[]};
};
mock.module('../src/db/pool.js',{namedExports:{query}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{req.user={id};next();}}});
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>{req.familyMember={family_id:id};next();},requireAtLeastRole:()=> (req,res,next)=>req.headers['x-role']==='parent'?next():res.sendStatus(403)}});
mock.module('../src/middleware/planAccess.js',{namedExports:{requirePlanAccess:()=> (req,res,next)=>next()}});
const {childrenRouter}=await import('../src/routes/children.routes.js');
test('profile insight choice survives legacy saves, rejects invalid values and respects role/archive checks',async()=>{
  const app=express();app.use(express.json());app.use(childrenRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/${id}`;
  const save=(body,role='parent')=>fetch(base+'/profile',{method:'PUT',headers:{'content-type':'application/json','x-role':role},body:JSON.stringify(body)});
  try{
    assert.equal((await save({})).status,200);assert.equal(enabled,true);
    assert.equal((await save({smartInsightsEnabled:false})).status,200);assert.equal(enabled,false);
    assert.equal((await save({})).status,200);assert.equal(enabled,false);
    assert.equal((await save({smartInsightsEnabled:'false'})).status,400);assert.equal(enabled,false);
    assert.equal((await save({smartInsightsEnabled:true},'viewer')).status,403);
    active=false;assert.equal((await save({smartInsightsEnabled:true})).status,404);
    assert.equal((await fetch(base+'/smart-insights?timeZone=Europe%2FLondon')).status,404);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
