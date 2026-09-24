import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const queries=[];
mock.module('../src/db/pool.js',{namedExports:{query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{if(!req.headers['x-test-user'])return res.sendStatus(401);req.user={id:'authenticated-user',is_platform_admin:req.headers['x-test-user']==='admin'};next();}}});
const {clientActivityRouter}=await import('../src/routes/clientActivity.routes.js');
test('activity is self attributed, validated, and admin-only to read',async()=>{
 const app=express();app.use(express.json());app.use(clientActivityRouter);app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  assert.equal((await fetch(base)).status,401);
  assert.equal((await fetch(base,{headers:{'x-test-user':'normal'}})).status,403);
  let response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','x-test-user':'normal'},body:JSON.stringify({platform:'ios',userId:'someone-else'})});
  assert.equal(response.status,200);assert.deepEqual(queries.at(-1).params,['authenticated-user','ios']);
  response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','x-test-user':'normal'},body:JSON.stringify({platform:'unknown'})});assert.equal(response.status,400);
  assert.equal((await fetch(base,{headers:{'x-test-user':'admin'}})).status,200);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
