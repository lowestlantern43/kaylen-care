import { query } from '../db/pool.js';
import { config } from '../config.js';
import { ensureInsights, digestWindow, buildDigest } from './adminInsights.js';

export async function deliverDigest(run, fetcher=fetch) {
  // Dedicated owner digest. Existing customer email delivery is untouched.
  if (!config.resendApiKey || config.emailProvider !== 'resend') return false;
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST', signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json',
      'Idempotency-Key':`familytrack-admin-${new Date(run.period_end).toISOString()}`},
    body:JSON.stringify({from:config.emailFrom,to:[run.recipient],subject:run.subject,text:run.body,...(run.html?{html:run.html}:{})}),
  });
  return response.ok;
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
