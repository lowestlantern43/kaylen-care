import {test,mock} from 'node:test';
mock.module('../src/db/pool.js',{namedExports:{query:async()=>({rows:[]}),withTransaction:async fn=>fn({query:async()=>({rows:[]})})}});
import assert from 'node:assert/strict';
const {validateAdminMessage,emailSettings}=await import('../src/services/adminEmail.js');
const {buildEmailHtml}=await import('../src/services/email.js');
import {config} from '../src/config.js';
const id='11111111-1111-4111-8111-111111111111';
test('admin mail validates content and deduplicates recipient IDs',()=>{
 assert.deepEqual(validateAdminMessage({subject:' Hi ',text:' Hello ',userIds:[id,id]}),{subject:'Hi',text:'Hello',ids:[id]});
 for(const body of [{subject:'',text:'x',userIds:[id]},{subject:'a\nb',text:'x',userIds:[id]},{subject:'x',text:'x',userIds:[]},{subject:'x',text:'x',userIds:['bad']},{subject:'x',text:'x',userIds:{}},{subject:'x',text:'x'.repeat(20001),userIds:[id]}]) assert.throws(()=>validateAdminMessage(body));
});
test('email preview escapes untrusted content and preserves branding',()=>{
 const html=buildEmailHtml({subject:'<script>bad</script>',text:'<img src=x onerror=bad>\nHello'});
 assert.ok(html.includes('FamilyTrack'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));
});
test('sending is gated on the intended sender and configured transport',()=>{
 const old={emailFrom:config.emailFrom,resendApiKey:config.resendApiKey,emailProvider:config.emailProvider};
 try {config.emailProvider='resend';config.resendApiKey='test';config.emailFrom='Other <other@example.com>';assert.equal(emailSettings().ready,false);config.emailFrom='FamilyTrack <hello@familytrack.care>';assert.equal(emailSettings().ready,true);config.resendApiKey='';assert.equal(emailSettings().ready,false);}finally{Object.assign(config,old);}
});
