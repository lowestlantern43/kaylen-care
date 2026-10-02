import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {config} from '../src/config.js';
const id='11111111-1111-4111-8111-111111111111';
let status='pending',sent=0,dbCalls=0;
const query=async(sql,p=[])=>{
 dbCalls++;
 if(sql.includes('SELECT * FROM admin_email_messages'))return {rows:[{id,subject:'Test',body:'Hello'}]};
 if(sql.includes('SELECT r.*'))return {rows:status==='pending'?[{user_id:id,email:'test@example.com'}]:[]};
 if(sql.includes("SET status='sending',attempted_at"))status='sending';
 if(sql.includes('FROM users u WHERE'))return {rows:[{id}]};
 if(sql.startsWith('UPDATE admin_email_recipients SET status=$3'))status=p[2];
 if(sql.includes('GROUP BY status'))return {rows:[{status,count:1}]};
 return {rows:[]};
};
mock.module('../src/db/pool.js',{namedExports:{query,withTransaction:async fn=>fn({query})}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{if(!req.headers['x-test-role'])return res.sendStatus(401);req.user={id,is_platform_admin:req.headers['x-test-role']==='admin'};next();}}});
mock.module('../src/services/email.js',{namedExports:{buildEmailHtml:()=>'<p>Preview</p>',sendAppEmail:async m=>{assert.equal(m.to,'test@example.com');sent++;return {sent:true};}}});
const {adminEmailRouter}=await import('../src/routes/adminEmail.routes.js');
test('admin-only routes, explicit confirmation and no duplicate send on retry',async()=>{
 const app=express();app.use(express.json());app.use(adminEmailRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const old={emailProvider:config.emailProvider,emailFrom:config.emailFrom,resendApiKey:config.resendApiKey};
 config.emailProvider='resend';config.emailFrom='FamilyTrack <hello@familytrack.care>';config.resendApiKey='fake';
 try {
 assert.equal((await fetch(base+'/recipients')).status,401);assert.equal(dbCalls,0);
 assert.equal((await fetch(base+'/recipients',{headers:{'x-test-role':'user'}})).status,403);assert.equal(dbCalls,0);
 const headers={'x-test-role':'admin','Content-Type':'application/json'};
 assert.equal((await fetch(base+`/${id}/send`,{method:'POST',headers,body:'{}'})).status,400);assert.equal(sent,0);
 for(let i=0;i<2;i++)assert.equal((await fetch(base+`/${id}/send`,{method:'POST',headers,body:'{"confirm":true}'})).status,200);
 assert.equal(sent,1);assert.equal(status,'sent');
 }finally{Object.assign(config,old);await new Promise(r=>server.close(r));}
});
