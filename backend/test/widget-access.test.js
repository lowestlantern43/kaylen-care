import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
let authorised = true, consent = true;
const calls=[];
mock.module('../src/db/pool.js',{namedExports:{withTransaction:async()=>{throw new Error('unexpected write')},query:async(sql,params=[])=>{
  calls.push({sql,params});
  return {rows:sql.includes('SELECT g.user_id') && authorised ? [{user_id:'user',family_id:'family'}] : []};
}}});
mock.module('../src/services/privacyConsent.js',{namedExports:{
  careAccessAllowed:async()=>consent,
  requirePrivacyConsent:(req,res,next)=>consent?next():res.sendStatus(403)
}});
mock.module('../src/middleware/auth.js',{namedExports:{requireAuth:(req,res,next)=>{
  if(req.headers['x-session']!=='valid') return res.sendStatus(401);
  req.user={id:'user'}; next();
}}});
mock.module('../src/middleware/familyAccess.js',{namedExports:{requireFamilyMember:(req,res,next)=>{
  if(req.params.familyId!=='family') return res.sendStatus(404);
  req.familyMember={family_id:'family'};next();
}}});
const { issueWidgetAccess, readWidgetAccess, widgetTokenHash, revokeWidgetAccess, revokeSessionWidgets }=await import('../src/services/widgetAccess.js');
const {widgetsRouter}=await import('../src/routes/widgets.routes.js');
test('opaque grants rotate per installation, store hashes and enforce live access checks',async()=>{
  const first=await issueWidgetAccess('user','family','device','private-session');
  const second=await issueWidgetAccess('user','family','device');
  assert.match(first.token,/^ftw_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token,second.token);
  assert.ok(!JSON.stringify(calls).includes(first.token));
  assert.equal(calls.find(c=>c.sql.includes('INSERT')).params[0],widgetTokenHash(first.token));
  assert.equal(calls.find(c=>c.sql.includes('INSERT')).params[5],widgetTokenHash('private-session'));
  assert.ok(!JSON.stringify(calls).includes('private-session'));
  assert.ok(new Date(first.expiresAt)-Date.now()<=7*86400000);
  assert.deepEqual(await readWidgetAccess(first.token),{user_id:'user',family_id:'family'});
  const sql=calls.find(c=>c.sql.includes('SELECT g.user_id')).sql;
  for(const guard of ['g.revoked_at IS NULL','g.expires_at>now()','fm.deleted_at IS NULL','u.deleted_at IS NULL','f.deleted_at IS NULL','suspended'])assert.ok(sql.includes(guard));
  authorised=false;await assert.rejects(readWidgetAccess(first.token),e=>e.status===401);
  authorised=true;consent=false;await assert.rejects(readWidgetAccess(first.token),e=>e.status===403);
  await revokeWidgetAccess(first.token);
  assert.ok(calls.at(-1).sql.startsWith('UPDATE widget_access_grants'));
  consent=true;
});
test('routes are disabled by default, no cookie substitution, no family escalation',async()=>{
 const app=express();app.use(express.json());app.use(widgetsRouter);app.use((err,req,res,next)=>res.status(err.status||500).json({error:'unavailable'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const previous=process.env.WIDGET_BACKGROUND_ENABLED;
 try {
  delete process.env.WIDGET_BACKGROUND_ENABLED;
  const before=calls.length;assert.equal((await fetch(base+'/access')).status,404);assert.equal(calls.length,before);
  process.env.WIDGET_BACKGROUND_ENABLED='true';
  assert.equal((await fetch(base+'/access',{headers:{cookie:'kaylens_diary_session=anything'}})).status,401);
  assert.equal((await fetch(base+'/families/family/access',{method:'POST'})).status,401);
  assert.equal((await fetch(base+'/families/other/access',{method:'POST',headers:{'x-session':'valid'}})).status,404);
  assert.equal((await fetch(base+'/families/family/access',{method:'POST',headers:{'x-session':'valid','Content-Type':'application/json'},body:JSON.stringify({installationId:'invalid'})})).status,400);
  const response=await fetch(base+'/families/family/access',{method:'POST',headers:{'x-session':'valid','Content-Type':'application/json'},body:JSON.stringify({installationId:'11111111-1111-4111-8111-111111111111'})});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const {data}=await response.json();
  assert.equal((await fetch(base+'/access',{headers:{Authorization:`Bearer ${data.token}`}})).status,200);
  const snapshot=await fetch(base+'/snapshot?timeZone=Europe%2FLondon',{headers:{Authorization:`Bearer ${data.token}`}});
  assert.equal(snapshot.status,200);assert.deepEqual((await snapshot.json()).data,{children:[]});
  const profileRead=calls.find(c=>c.sql.includes('FROM children c LEFT JOIN'));
  assert.deepEqual(profileRead.params,['family',null]);assert.ok(profileRead.sql.includes('c.deleted_at IS NULL'));
  await revokeSessionWidgets('private-session');
  assert.equal(calls.at(-1).params[0],widgetTokenHash('private-session'));
  assert.ok(calls.at(-1).sql.includes('session_hash=$1'));
  assert.equal((await fetch(base+'/access',{method:'DELETE',headers:{Authorization:`Bearer ${data.token}`}})).status,200);
 } finally {if(previous===undefined)delete process.env.WIDGET_BACKGROUND_ENABLED;else process.env.WIDGET_BACKGROUND_ENABLED=previous;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
