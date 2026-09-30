import { query } from "../db/pool.js";
import { adminDigestHtml } from './adminDigestTemplate.js';

// New, isolated tables. No changes to subscription, authentication or care data.
export const insightsSchema = `
CREATE TABLE IF NOT EXISTS public_traffic_events (
 id uuid PRIMARY KEY, visitor_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 page text NOT NULL, kind text NOT NULL, source text NOT NULL, device text NOT NULL
);
CREATE INDEX IF NOT EXISTS public_traffic_time_idx ON public_traffic_events(occurred_at);
CREATE TABLE IF NOT EXISTS admin_digest_settings (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 recipient text NOT NULL DEFAULT '', enabled_at timestamptz
);
INSERT INTO admin_digest_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS admin_digest_runs (
 period_end timestamptz PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL,
 body text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 claimed_until timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_digest_runs ADD COLUMN IF NOT EXISTS html text;
CREATE TABLE IF NOT EXISTS admin_digest_tests (
 slot bigint PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'sending'
);`;
let schema;
export function ensureInsights() {
  if (!schema) schema = query(insightsSchema).catch(error => { schema = null; throw error; });
  return schema;
}
export const publicPages = new Set(['/', '/autism-daily-tracker-app', '/special-needs-child-diary-app', '/ehcp-report-tracker', '/child-medication-tracker', '/care-report-app']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function cleanTraffic(value) {
  if (!value || value.consent !== true || !uuid.test(value.id) || !uuid.test(value.visitorId)
      || !publicPages.has(value.page) || !['page_view','signup_interest'].includes(value.kind)
      || !['direct','google','bing','facebook','instagram','other'].includes(value.source)
      || !['mobile','tablet','desktop'].includes(value.device)) return null;
  return [value.id, value.visitorId, value.page, value.kind, value.source, value.device];
}
export async function trafficReport(days=7) {
  await ensureInsights();
  const params = [[1,7,30].includes(Number(days)) ? Number(days) : 7];
  const window = `occurred_at >= ((now() AT TIME ZONE 'Europe/London')::date - ($1::int-1)) AT TIME ZONE 'Europe/London'`;
  const results = await Promise.all([
    query(`SELECT count(*) FILTER(WHERE kind='page_view')::int AS views,
      count(DISTINCT visitor_id) FILTER(WHERE kind='page_view')::int AS visitors,
      count(*) FILTER(WHERE kind='signup_interest')::int AS interest FROM public_traffic_events WHERE ${window}`,params),
    query(`SELECT to_char(occurred_at AT TIME ZONE 'Europe/London','YYYY-MM-DD') AS day,
      count(*)::int AS views, count(DISTINCT visitor_id)::int AS visitors
      FROM public_traffic_events WHERE ${window} AND kind='page_view' GROUP BY 1 ORDER BY 1`,params),
    ...['page','source','device'].map(column => query(`SELECT ${column} AS label,count(*)::int AS views FROM public_traffic_events WHERE ${window} AND kind='page_view' GROUP BY 1 ORDER BY 2 DESC`,params)),
    query(`SELECT count(*)::int AS registrations FROM users WHERE deleted_at IS NULL AND created_at >= ((now() AT TIME ZONE 'Europe/London')::date-($1::int-1)) AT TIME ZONE 'Europe/London'`,params),
  ]);
  return { ...results[0].rows[0], ...results[5].rows[0], days:params[0], daily:results[1].rows,
    pages:results[2].rows, sources:results[3].rows, devices:results[4].rows };
}
export async function digestSettings() {
  await ensureInsights();
  const settings=await query('SELECT enabled,recipient,enabled_at FROM admin_digest_settings WHERE id=1');
  const runs=await query('SELECT period_end,status,attempts,sent_at FROM admin_digest_runs ORDER BY period_end DESC LIMIT 7');
  return {...settings.rows[0], runs:runs.rows};
}
export async function digestWindow() {
  // Both endpoints are local wall-clock times: DST days correctly span 23/25 hours.
  const {rows}=await query(`WITH local AS (SELECT now() AT TIME ZONE 'Europe/London' AS t),
    day AS (SELECT t::date - CASE WHEN t::time < time '22:30' THEN 1 ELSE 0 END AS d FROM local)
    SELECT (d + time '22:30') AT TIME ZONE 'Europe/London' AS end,
    ((d-1) + time '22:30') AT TIME ZONE 'Europe/London' AS start FROM day`);
  return rows[0];
}
export async function buildDigest(start,end) {
  const range=[start,end];
  const [users,emails,traffic,trials,billing,support] = await Promise.all([
    query(`SELECT email,created_at FROM users WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL ORDER BY created_at LIMIT 101`,range),
    query(`SELECT b.event_type,b.occurred_at,b.metadata->>'daysLeft' AS days_left,
      b.metadata->>'emailType' AS email_type,u.email FROM billing_audit_events b LEFT JOIN users u ON u.id=b.user_id AND u.deleted_at IS NULL
      WHERE b.occurred_at >= $1 AND b.occurred_at < $2 AND b.event_source='app_email'
      AND b.event_type IN ('email_sent','email_failed','email_skipped','trial_reminder_email_sent','trial_reminder_email_failed','trial_reminder_email_skipped')
      ORDER BY b.occurred_at LIMIT 201`,range),
    query(`SELECT count(*) FILTER(WHERE kind='page_view')::int AS views,count(DISTINCT visitor_id) FILTER(WHERE kind='page_view')::int AS visitors,
      count(*) FILTER(WHERE kind='signup_interest')::int AS interest FROM public_traffic_events WHERE occurred_at >= $1 AND occurred_at < $2`,range),
    query(`SELECT count(*)::int AS ending FROM subscriptions WHERE trial_ends_at >= $1 AND trial_ends_at < $1::timestamptz+interval '3 days' AND (status='trialing' OR billing_status='trialing')`,[end]),
    query(`SELECT event_type,count(*)::int AS count FROM billing_audit_events WHERE occurred_at >= $1 AND occurred_at < $2
      AND event_type IN ('payment_failed','subscription_cancelled','dispute_created','early_fraud_warning') GROUP BY event_type`,range).catch(()=>null),
    query("SELECT count(*)::int AS count FROM issue_reports WHERE status IN ('new','in_progress')").catch(()=>null),
  ]);
  const date = value => new Date(value).toLocaleString('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'});
  const subject=`FamilyTrack Admin Update — ${new Date(end).toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'})}`;
  const t=traffic.rows[0];
  const attention=[...[
    ['Failed payment events','payment_failed'],['Subscription cancellations','subscription_cancelled'],
    ['New disputes','dispute_created'],['Early fraud warnings','early_fraud_warning'],
  ].map(([label,type])=>[label,billing ? billing.rows.find(row=>row.event_type===type)?.count || 0 : 'Unavailable']),
    ['Unresolved support issues',support?.rows[0]?.count ?? 'Unavailable']];
  const lines=[subject, '', `${date(start)} to ${date(end)} (UK time)`, '',
    'WEBSITE TRAFFIC (visitors who opted in)', `${t.visitors} measured visitors · ${t.views} page views · ${t.interest} signup clicks`,
    'These figures exclude visitors who declined analytics and authenticated app activity.', '',
    'ATTENTION',...attention.map(([label,value])=>`${label}: ${value}`),'',
    `NEW USERS (${users.rows.length>100?'100+':users.rows.length})`,
    ...users.rows.slice(0,100).map(u=>`${u.email} — ${date(u.created_at)}`),
    ...(users.rows.length?[]:['No new users in this period.']), '',
    `TRIALS: ${trials.rows[0].ending} currently due to end within 3 days.`, '',
    'EMAIL ACTIVITY',
    ...emails.rows.slice(0,200).map(e=>`${date(e.occurred_at)} — ${e.email || 'Recipient not recorded'} — ${e.event_type.startsWith('trial_')?`${e.days_left || '?'}-day trial warning`:e.email_type || 'Email'} — ${e.event_type.split('_').at(-1)}`),
    ...(emails.rows.length?[]:['No email activity recorded in this period.']),
    ...(emails.rows.length>200?['Showing the first 200 email events; see the admin billing timelines for more.']:[]), '',
    'Sent means accepted by the email provider. Failed/skipped messages are shown separately.',
    'No care records are included.', '', 'Open the owner platform: https://familytrack.care/'];
  const html=adminDigestHtml({subject,period:`${date(start)} to ${date(end)} (UK time)`,traffic:t,
    newUsers:users.rows.length>100?'100+':users.rows.length,trials:trials.rows[0].ending,attention,
    users:users.rows.slice(0,100).map(u=>[u.email,date(u.created_at)]),
    emails:emails.rows.slice(0,200).map(event=>[event.email||'Recipient not recorded',
      `${event.event_type.startsWith('trial_') ? `${event.days_left || '?'}-day trial warning` : (event.email_type || 'Email').replaceAll('_',' ')} · ${date(event.occurred_at)}`,
      event.event_type.split('_').at(-1)])});
  return {subject,body:lines.join('\n'),html};
}
