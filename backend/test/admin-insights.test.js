import { test,mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const statements=[];
mock.module('../src/db/pool.js',{namedExports:{query:async(sql,params)=>{statements.push({sql,params});return {rows:[{enabled:false,recipient:''}],rowCount:1};}}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{if(!req.headers['x-test-user'])return res.sendStatus(401);req.user={is_platform_admin:req.headers['x-test-user']==='admin'};next();}}});
const {cleanTraffic}=await import('../src/services/adminInsights.js');
const {insightsRouter}=await import('../src/routes/insights.routes.js');
const {config}=await import('../src/config.js');
const valid={id:'42ae67f7-973a-4366-9a37-e4d0c479e634',visitorId:'04c05662-e491-4b9f-8897-cf7cdb6bcc50',consent:true,page:'/',kind:'page_view',source:'direct',device:'mobile'};
test('only consented, allowlisted, minimal public traffic is retained',()=>{
  assert.equal(cleanTraffic({...valid,consent:false}),null);
  assert.equal(cleanTraffic({...valid,page:'/account?token=secret'}),null);
  assert.equal(cleanTraffic({...valid,page:'/families/private'}),null);
  assert.equal(cleanTraffic({...valid,visitorId:'invalid'}),null);
  assert.deepEqual(cleanTraffic({...valid,notes:'private',email:'private',ip:'private'}),[valid.id,valid.visitorId,'/','page_view','direct','mobile']);
});
test('admin routes reject public/normal users and public tracking rejects untrusted origins',async()=>{
  const app=express();app.use(express.json());app.use(insightsRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const path of ['/admin/insights','/admin/insights/preview']){
      assert.equal((await fetch(base+path)).status,401);
      assert.equal((await fetch(base+path,{headers:{'x-test-user':'normal'}})).status,403);
    }
    assert.equal((await fetch(base+'/admin/insights/digest',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const before=statements.length;
    await fetch(base+'/public/traffic',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify(valid)});
    assert.equal(statements.length,before);
    await fetch(base+'/public/traffic',{method:'POST',headers:{'Content-Type':'application/json',Origin:config.frontendUrl.split(',')[0]},body:JSON.stringify(valid)});
    assert.ok(statements.at(-1).sql.includes('ON CONFLICT DO NOTHING'));
    assert.deepEqual(statements.at(-1).params,cleanTraffic(valid));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
