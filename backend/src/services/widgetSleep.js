import { withTransaction } from '../db/pool.js';
import { badRequest, forbidden, notFound, HttpError } from '../utils/httpError.js';
import { requireUuid } from '../validators/simple.js';
import { getFamilyPlanAccess } from './planAccess.js';
import { wallTime, instant } from './widgetSnapshot.js';
import { ensureWidgetSleepSchema } from './widgetSleepSchema.js';

export function checkSleepTransition(latest, body, usualBedtime, now, zone) {
  const wall = wallTime(now, zone);
  const day = wall.toISOString().slice(0,10), time = wall.toISOString().slice(11,16);
  if (body.action === 'end') {
    if (!latest || latest.id !== body.expectedSleepId) throw new HttpError(409,'sleep_changed','Sleep has changed. Refresh the widget.');
    if (latest.data.wake_time) return {alreadySaved:true};
    const start = latest.data.sleep_started_at ? Date.parse(latest.data.sleep_started_at)/1000 : instant(new Date(`${latest.day}T${latest.data.bedtime || latest.time}Z`), zone);
    if (!Number.isFinite(start) || now.getTime()/1000 < start || now.getTime()/1000-start > 46800)
      throw badRequest('Open the app to check this unfinished sleep and enter the correct wake-up time.');
    return {day,time};
  }
  if ((latest?.id || '') !== body.expectedSleepId || (latest?.data.bedtime && !latest.data.wake_time))
    throw new HttpError(409,'sleep_changed','Sleep has changed. Refresh the widget.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(usualBedtime || '') || time < usualBedtime)
    throw badRequest('Open the app to log sleep before the usual bedtime.');
  if (latest?.data.wake_time && `${latest.data.wake_date || latest.day}T${latest.data.wake_time}` >= `${day}T${usualBedtime}`)
    throw new HttpError(409,'sleep_completed','Sleep has already been logged. Open the app to start another sleep.');
  return {day,time};
}

export async function widgetSleepAction(access, body={}, now=new Date()) {
  if (!access.sleep_actions) throw forbidden('Open FamilyTrack to enable widget actions.');
  if (!['start','end'].includes(body.action)) throw badRequest('Unknown sleep action.');
  const roles = body.action === 'start' ? ['owner','parent','carer'] : ['owner','parent'];
  if (!roles.includes(access.role)) throw forbidden('Open FamilyTrack to check your permissions.');
  const childId=requireUuid(body.childId,'Care profile');
  if (typeof body.expectedSleepId !== 'string') throw badRequest('A sleep state is required.');
  if (body.expectedSleepId) requireUuid(body.expectedSleepId,'Sleep log');
  if (typeof body.timeZone !== 'string' || body.timeZone.length>100) throw badRequest('A timezone is required.');
  try {wallTime(now,body.timeZone);} catch {throw badRequest('Invalid timezone.');}
  const plan=await getFamilyPlanAccess(access.family_id);
  if (!(body.action==='start'?plan.canAddLogs:plan.canEditLogs)) throw forbidden('This account is view-only.');
  await ensureWidgetSleepSchema();
  return withTransaction(async client => {
    // Serialise simultaneous widget taps for this profile; never accept a family ID from the client.
    const {rows:profiles}=await client.query('SELECT id FROM children WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL FOR UPDATE',[childId,access.family_id]);
    if (!profiles.length) throw notFound('Care profile not found.');
    const {rows:settings}=await client.query('SELECT usual_bedtime FROM child_profiles WHERE child_id=$1 AND family_id=$2',[childId,access.family_id]);
    const {rows}=await client.query(`SELECT id,log_date::text AS day,to_char(log_time,'HH24:MI') AS time,data
      FROM care_logs WHERE child_id=$1 AND family_id=$2 AND category='sleep' AND deleted_at IS NULL
      ORDER BY log_date DESC,log_time DESC,created_at DESC LIMIT 1 FOR UPDATE`,[childId,access.family_id]);
    const latest=rows[0];
    const transition=checkSleepTransition(latest,body,settings[0]?.usual_bedtime,now,body.timeZone);
    if (transition.alreadySaved) return {saved:true,alreadySaved:true};
    if (body.action==='start') {
      await client.query(`INSERT INTO care_logs(family_id,child_id,created_by_user_id,category,log_date,log_time,data,notes)
        VALUES($1,$2,$3,'sleep',$4,$5,$6,'')`,[access.family_id,childId,access.user_id,transition.day,transition.time,
        JSON.stringify({bedtime:transition.time,wake_time:'',nap:'No',sleep_started_at:now.toISOString(),source:'widget'})]);
    } else {
      // Preserve notes and every existing sleep detail. Do not invent quality or night wakings.
      await client.query(`UPDATE care_logs SET data=data || $1::jsonb,updated_at=now()
        WHERE id=$2 AND family_id=$3 AND deleted_at IS NULL`,[JSON.stringify({wake_time:transition.time,wake_date:transition.day}),latest.id,access.family_id]);
    }
    return {saved:true};
  });
}
