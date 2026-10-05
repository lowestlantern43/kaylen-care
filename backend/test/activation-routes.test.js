import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
let calls=0,lastInput;
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>req.headers['x-family']==='member'?next():res.sendStatus(403)}});
mock.module('../src/services/activation.js',{namedExports:{activationProgress:async(user,family,input)=>{calls++;lastInput=input;return {eligible:true};}}});
const {activationRouter}=await import('../src/routes/activation.routes.js');
test('guidance rejects unrelated families and drops arbitrary tracking/medical payloads',async()=>{
  const app=express();app.use(express.json());app.use('/families/:familyId/activation',activationRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/families/example/activation`;
  const send=(body,member=true)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(member?{'x-family':'member'}:{})},body:JSON.stringify(body)});
  try{
    assert.equal((await send({},false)).status,403);assert.equal(calls,0);
    assert.equal((await send({visit:'yes'})).status,400);assert.equal(calls,0);
    assert.equal((await send({visit:true,notes:'private',name:'private',action:'arbitrary',timeZone:'Europe/London'})).status,200);
    assert.equal(lastInput.notes,undefined);assert.equal(lastInput.name,undefined);assert.equal(lastInput.action,undefined);
    assert.equal(lastInput.visit,true);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
