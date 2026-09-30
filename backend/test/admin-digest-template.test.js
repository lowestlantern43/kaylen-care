import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminDigestHtml} from '../src/services/adminDigestTemplate.js';
test('HTML escapes user-supplied values and has readable empty states',()=>{
  const html=adminDigestHtml({subject:'Admin <update>',period:'Test period',traffic:{visitors:0,views:0,interest:0},newUsers:0,trials:0,
    users:[],emails:[['<img src=x onerror=alert(1)>','3-day trial warning','sent']],attention:[['Support','Unavailable']]});
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('No new users in this period.'));
  assert.ok(html.includes('3-day trial warning'));
  assert.ok(html.includes('Unavailable'));
  assert.ok(html.includes('width:100%;max-width:640px'));
});
