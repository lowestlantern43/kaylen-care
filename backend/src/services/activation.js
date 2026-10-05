import { activationSchema } from './activationSchema.js';
import { query } from '../db/pool.js';
import { localDay, dayDifference, safeTimeZone, summaryWindow, morningDue } from './activationDates.js';

let schema;
export function ensureActivation() {
  if (!schema) schema = query(activationSchema).catch(error => { schema = null; throw error; });
  return schema;
}

export async function activationProgress(user, familyId, input = {}) {
  if (process.env.ACTIVATION_ENABLED === 'false') return {eligible:false};
  await ensureActivation();
  const rollout = (await query('SELECT started_at FROM activation_rollout WHERE id=1')).rows[0];
  if (new Date(user.created_at) < new Date(rollout.started_at)) return { eligible:false };
  await query(`INSERT INTO activation_progress(user_id,family_id,time_zone) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [user.id, familyId, safeTimeZone(input.timeZone)]);
  // One onboarding journey per account; switching families must not mix histories.
  let state = (await query('SELECT * FROM activation_progress WHERE user_id=$1 AND family_id=$2', [user.id,familyId])).rows[0];
  if (!state) return { eligible:false };
  if (typeof input.dismissed === 'boolean') await query('UPDATE activation_progress SET dismissed=$2, reminder_opt_in=CASE WHEN $2 THEN false ELSE reminder_opt_in END WHERE user_id=$1', [user.id,input.dismissed]);
  if (typeof input.reminderOptIn === 'boolean') await query('UPDATE activation_progress SET reminder_opt_in=$2 WHERE user_id=$1 AND NOT dismissed', [user.id,input.reminderOptIn]);
  if (typeof input.analyticsOptIn === 'boolean') await query(`UPDATE activation_progress SET analytics_opt_in=$2,
    analytics_started_at=CASE WHEN $2 THEN COALESCE(analytics_started_at,now()) ELSE NULL END,
    day2_return=CASE WHEN $2 THEN day2_return ELSE false END,day3_return=CASE WHEN $2 THEN day3_return ELSE false END,
    report_used=CASE WHEN $2 THEN report_used ELSE false END,share_used=CASE WHEN $2 THEN share_used ELSE false END WHERE user_id=$1`, [user.id,input.analyticsOptIn]);

  const own = (await query(`SELECT count(*)::int AS count,min(cl.created_at) AS first FROM care_logs cl
    JOIN children c ON c.id=cl.child_id WHERE cl.family_id=$1 AND cl.created_by_user_id=$2 AND cl.deleted_at IS NULL AND c.deleted_at IS NULL`, [familyId,user.id])).rows[0];
  // Freeze the journey timezone once logging starts; travelling cannot rewrite return days.
  if (!state.first_entry_day && own.first) await query('UPDATE activation_progress SET first_entry_day=$2 WHERE user_id=$1 AND first_entry_day IS NULL', [user.id,localDay(own.first,state.time_zone)]);
  state = (await query('SELECT *,first_entry_day::text AS first_day FROM activation_progress WHERE user_id=$1', [user.id])).rows[0];
  const today = localDay(new Date(),state.time_zone);
  const age = state.first_day ? dayDifference(state.first_day,today) : 0;
  if (input.visit === true && state.analytics_opt_in) await query(`UPDATE activation_progress SET day2_return=day2_return OR $2,day3_return=day3_return OR $3 WHERE user_id=$1 AND analytics_opt_in`, [user.id,age===1,age===2]);
  if (state.analytics_opt_in && ['report','share'].includes(input.action)) await query(`UPDATE activation_progress SET ${input.action==='report'?'report_used':'share_used'}=true WHERE user_id=$1 AND analytics_opt_in`, [user.id]);
  const window = state.first_day ? summaryWindow(state.first_day,today) : null;
  let summary = null;
  if (window) {
    const counts = (await query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE cl.category='food' AND cl.data->>'type'='drink' AND COALESCE(cl.data->>'feeding','false')<>'true')::int AS drinks,
      count(*) FILTER(WHERE cl.category='food' AND COALESCE(cl.data->>'type','')<>'drink' AND COALESCE(cl.data->>'feeding','false')<>'true')::int AS meals,
      count(*) FILTER(WHERE cl.category='food' AND cl.data->>'feeding'='true')::int AS feeds,
      count(*) FILTER(WHERE cl.category='medication')::int AS medication,
      count(*) FILTER(WHERE cl.category='toileting')::int AS toileting
      FROM care_logs cl JOIN children c ON c.id=cl.child_id
      WHERE cl.family_id=$1 AND cl.deleted_at IS NULL AND c.deleted_at IS NULL AND cl.log_date >= $2::date AND cl.log_date < $3::date`, [familyId,window.start,window.end])).rows[0];
    summary = {...window,...counts};
  }
  return {eligible:true,dismissed:state.dismissed,expired:age>14,entries:own.count,age,summary,
    reminderOptIn:state.reminder_opt_in,reminderAttempted:Boolean(state.reminder_claimed_at),analyticsOptIn:state.analytics_opt_in};
}

export async function activationMetrics() {
  await ensureActivation();
  const signupCounts = (await query(`SELECT count(*)::int AS accounts,
    count(*) FILTER(WHERE EXISTS(SELECT 1 FROM children c WHERE c.created_by_user_id=u.id AND c.deleted_at IS NULL))::int AS accounts_with_profile
    FROM users u WHERE u.deleted_at IS NULL AND u.created_at >= (SELECT started_at FROM activation_rollout WHERE id=1)`)).rows[0];
  const {rows} = await query(`WITH cohort AS (
    SELECT a.*, (now() AT TIME ZONE a.time_zone)::date - a.first_entry_day AS age,
      (a.analytics_started_at AT TIME ZONE a.time_zone)::date <= a.first_entry_day AS observed_from_start,
      (SELECT count(*) FROM care_logs cl WHERE cl.created_by_user_id=a.user_id AND cl.family_id=a.family_id AND cl.deleted_at IS NULL) AS entries,
      EXISTS(SELECT 1 FROM children c WHERE c.created_by_user_id=a.user_id AND c.deleted_at IS NULL) AS person,
      EXISTS(SELECT 1 FROM billing_audit_events b WHERE b.family_id=a.family_id AND b.event_type='payment_succeeded' AND b.amount_minor>0 AND b.occurred_at>=a.created_at) AS paid
    FROM activation_progress a JOIN users u ON u.id=a.user_id AND u.deleted_at IS NULL WHERE a.analytics_opt_in
  ) SELECT count(*)::int AS participants,count(*) FILTER(WHERE person)::int AS person,
    count(*) FILTER(WHERE entries>=1)::int AS first,count(*) FILTER(WHERE entries>=3)::int AS three,
    count(*) FILTER(WHERE age>=1 AND observed_from_start)::int AS day2_eligible,count(*) FILTER(WHERE day2_return AND age>=1 AND observed_from_start)::int AS day2,
    count(*) FILTER(WHERE age>=2 AND observed_from_start)::int AS day3_eligible,count(*) FILTER(WHERE day3_return AND age>=2 AND observed_from_start)::int AS day3,
    count(*) FILTER(WHERE report_used)::int AS reports,count(*) FILTER(WHERE share_used)::int AS shares,
    count(*) FILTER(WHERE paid)::int AS paid FROM cohort`);
  return {...rows[0],...signupCounts};
}

export async function runActivationReminders(now = new Date()) {
  if (process.env.ACTIVATION_ENABLED === 'false') return;
  await ensureActivation();
  const {sendPushToUser,ensureNotificationSchema} = await import('./pushNotifications.js');
  await ensureNotificationSchema();
  const {rows} = await query(`SELECT a.*,a.first_entry_day::text AS first_day FROM activation_progress a
    JOIN users u ON u.id=a.user_id AND u.deleted_at IS NULL AND u.platform_status<>'suspended'
    JOIN families f ON f.id=a.family_id AND f.deleted_at IS NULL AND f.platform_status<>'suspended'
    JOIN family_members m ON m.user_id=a.user_id AND m.family_id=a.family_id AND m.deleted_at IS NULL
    JOIN user_preferences p ON p.user_id=a.user_id AND p.key='notification-settings' AND p.value->>'pushEnabled'='true'
    WHERE a.reminder_opt_in AND NOT a.dismissed AND a.reminder_claimed_at IS NULL AND a.first_entry_day IS NOT NULL
    AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=a.user_id AND s.enabled)
    AND a.first_entry_day >= ($1::timestamptz - interval '3 days')::date`, [now]);
  for (const state of rows) {
    if (!morningDue(state.first_day,state.time_zone,now)) continue;
    // Claim before network I/O. An uncertain delivery is never retried automatically.
    const claim = await query(`UPDATE activation_progress SET reminder_claimed_at=$2,reminder_status='attempted'
      WHERE user_id=$1 AND reminder_claimed_at IS NULL AND reminder_opt_in AND NOT dismissed RETURNING user_id`, [state.user_id,now]);
    if (!claim.rowCount) continue;
    let status = 'failed';
    try {
      const delivery = await sendPushToUser(state.user_id,{title:'Your first FamilyTrack day is ready',body:'Welcome back — pick up wherever you left off.',url:'/',tag:'first-care-day',type:'activation'});
      status = delivery.sent>0 ? 'sent' : delivery.skipped ? 'skipped' : 'failed';
    } catch { /* No care data or provider errors are written to logs. */ }
    await query('UPDATE activation_progress SET reminder_status=$2 WHERE user_id=$1',[state.user_id,status]);
  }
}
