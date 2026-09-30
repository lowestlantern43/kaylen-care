import { query } from '../db/pool.js';
import { config } from '../config.js';
import { ensureInsights, digestWindow, buildDigest } from './adminInsights.js';

export async function deliverDigest(run, fetcher=fetch) {
  // Dedicated owner digest. Existing customer email delivery is untouched.
  if (!config.resendApiKey || config.emailProvider !== 'resend') return false;
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST', signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json',
      'Idempotency-Key':`familytrack-admin-${run.is_test?'test-':''}${new Date(run.period_end).toISOString()}`},
    body:JSON.stringify({from:config.emailFrom,to:[run.recipient],subject:run.subject,text:run.body,...(run.html?{html:run.html}:{})}),
  });
  return response.ok;
}
export async function sendAdminDigestTest() {
  await ensureInsights();
  const settings=(await query('SELECT recipient FROM admin_digest_settings WHERE id=1')).rows[0];
  if(!settings?.recipient) throw new Error('Save the recipient email before sending a test.');
  const end=new Date(),start=new Date(end.getTime()-86400000);
  const message=await buildDigest(start,end);
  const slot=Math.floor(end.getTime()/300000);
  // One test per five minutes across all instances; never changes nightly settings or runs.
  const claim=await query('INSERT INTO admin_digest_tests(slot) VALUES($1) ON CONFLICT DO NOTHING RETURNING slot',[slot]);
  if(!claim.rowCount)return {sent:false,message:'A test was already requested in this five-minute period. Check your inbox before trying again.'};
  let sent=false;
  try {
    sent=await deliverDigest({period_end:end,is_test:true,recipient:settings.recipient,
      subject:`TEST — ${message.subject}`,body:message.body,html:message.html});
  } finally {
    await query('UPDATE admin_digest_tests SET status=$2 WHERE slot=$1',[slot,sent?'sent':'failed']);
  }
  return {sent,message:sent?'Test email accepted by the email provider. The 22:30 schedule is unchanged.':'The provider did not confirm the test email. The nightly schedule is unchanged.'};
}
let running=false;
let cleanedAt=0;
export async function runAdminDigest() {
  if(running) return;
  running=true;
  try {
    await ensureInsights();
    if(Date.now()-cleanedAt>86400000){
      await query("DELETE FROM public_traffic_events WHERE occurred_at < now()-interval '90 days'");
      await query("DELETE FROM admin_digest_runs WHERE period_end < now()-interval '90 days'");
      await query("DELETE FROM admin_digest_tests WHERE created_at < now()-interval '90 days'");
      cleanedAt=Date.now();
    }
    const settings=(await query('SELECT * FROM admin_digest_settings WHERE id=1')).rows[0];
    if(!settings?.enabled) return;
    const window=await digestWindow();
    if(new Date(window.end)<new Date(settings.enabled_at)) return;
    // Never retry outside the provider's idempotency window; expose failed runs to admin.
    await query(`UPDATE admin_digest_runs SET status='failed' WHERE status IN ('pending','sending') AND period_end < now()-interval '12 hours'`);
    if(Date.now()-new Date(window.end).getTime()>12*60*60*1000) return;
    const exists=await query('SELECT 1 FROM admin_digest_runs WHERE period_end=$1',[window.end]);
    if(!exists.rowCount){
      const message=await buildDigest(window.start,window.end);
      await query(`INSERT INTO admin_digest_runs(period_end,recipient,subject,body,html) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [window.end,settings.recipient,message.subject,message.body,message.html]);
    }
    const claimed=await query(`UPDATE admin_digest_runs SET status='sending',attempts=attempts+1,claimed_until=now()+interval '5 minutes'
      WHERE period_end=$1 AND status IN ('pending','sending') AND (claimed_until IS NULL OR claimed_until<now()) RETURNING *`,[window.end]);
    if(!claimed.rowCount) return;
    let sent=false;
    try { sent=await deliverDigest(claimed.rows[0]); } catch { /* retry identical persisted content/key */ }
    await query(`UPDATE admin_digest_runs SET status=$2,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE period_end=$1`,[window.end,sent?'sent':'pending']);
  } finally {running=false;}
}
