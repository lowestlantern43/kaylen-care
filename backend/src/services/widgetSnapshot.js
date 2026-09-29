import { query } from '../db/pool.js';
import { badRequest, HttpError } from '../utils/httpError.js';
import { pendingWidgetDoses } from './widgetMedication.js';

// UTC-shaped dates allow calendar arithmetic without changing the process timezone.
export function wallTime(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:zone,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
}
export function instant(wall, zone) {
  let result = new Date(wall);
  for (let i=0;i<4;i++) {
    const offset = wallTime(result,zone).getTime()-result.getTime();
    const next = new Date(wall.getTime()-offset);
    if (+next===+result) return next.getTime()/1000;
    result=next;
  }
  // A nonexistent spring-forward time must not silently become a wrong dose.
  throw new HttpError(503,'widget_time_unavailable','Open the diary to check this schedule.');
}
export function medicinesFromProfile(text) {
  const list = value => String(value || '').split(',').map(item=>item.trim()).filter(Boolean);
  return String(text||'').split(/\n|;/).filter(line=>line.includes('|')).map(line=>{
    const [name,amount,unit,times,active,,required,windows,days] = line.split('|').map(s=>s.trim());
    return {name,dose:[amount,unit].filter(Boolean).join(' '),times:list(times),active:active!=='inactive',
      requiredDaily:required==='required',timeWindows:list((windows||'').toLowerCase()),scheduleDays:list((days||'every_day').toLowerCase())};
  });
}
const labels = {food:'Food Diary',medication:'Medication',sleep:'Sleep',toileting:'Toileting',behaviour:'Behaviour',health:'Health',measurement:'Measurements',activity:'Activity'};
export function projectWidget(profile, rows, familyId, zone, now=new Date()) {
  const wallNow=wallTime(now,zone), today=wallNow.toISOString().slice(0,10);
  const entries=rows.map(row=>({...row, date:new Date(`${row.day}T${row.time||'00:00'}Z`)}))
    .filter(row=>Number.isFinite(+row.date)&&row.date<=wallNow).sort((a,b)=>b.date-a.date);
  const care={};
  for(const [key,match] of Object.entries({latest:()=>true,toileting:r=>r.category==='toileting',sleep:r=>r.category==='sleep',food:r=>r.category==='food'&&!['milk','drink'].includes(r.type)})) {
    const row=entries.find(match);
    if(row) care[key]={label:row.category==='food'?(['milk','drink'].includes(row.type)?'Drink logged':'Food logged'):`${labels[row.category]||'Care'} logged`,timestamp:instant(row.date,zone)};
  }
  const medicines=pendingWidgetDoses({medicines:medicinesFromProfile(profile.current_medications),now:wallNow,
    scheduled:(med,date)=>med.requiredDaily&&!med.scheduleDays.some(d=>['prn','as_needed'].includes(d))&&
      (med.scheduleDays.some(d=>['','every_day','daily'].includes(d))||med.scheduleDays.includes(['sun','mon','tue','wed','thu','fri','sat'][date.getUTCDay()])),
    entries:entries.map(row=>({id:row.id,section:labels[row.category],medicationName:row.medicine,medicationDose:row.dose,
      medicationWindow:row.scheduled_window,medicationStatus:row.status||'given',date:row.date})),entryDate:e=>e.date
  }).map(m=>({...m,timestamp:instant(new Date(m.timestamp*1000),zone),...(m.windowEnd?{windowEnd:instant(new Date(m.windowEnd*1000),zone)}:{})}));
  const sleep=entries.find(r=>r.category==='sleep');
  const fluid=entries.filter(r=>r.day===today&&r.category==='food'&&['drink','milk'].includes(r.type))
    .reduce((sum,r)=>sum+(Number.isFinite(Number(r.amount))?Math.max(0,Number(r.amount))*(r.unit==='ml'?1:29.5735):0),0);
  return {id:`${familyId}:${profile.id}`,name:String(profile.first_name||'Care profile').slice(0,80),updated:now.getTime()/1000,
    day:today,fluid,target:Number(profile.daily_fluid_target_ml)||0,medicines,care,
    sleepingSince:sleep?.bedtime&&!sleep.wake_time?instant(sleep.date,zone):null};
}
export async function widgetSnapshot(familyId, zone, now=new Date()) {
  if(typeof zone!=='string'||zone.length>100) throw badRequest('A timezone is required.');
  try { wallTime(now,zone); } catch { throw badRequest('Invalid timezone.'); }
  const {rows:profiles}=await query(`SELECT c.id,c.first_name,cp.current_medications,cp.daily_fluid_target_ml
    FROM children c LEFT JOIN child_profiles cp ON cp.child_id=c.id AND cp.family_id=c.family_id
    WHERE c.family_id=$1 AND c.deleted_at IS NULL ORDER BY c.id LIMIT 51`,[familyId]);
  if(profiles.length>50) throw new HttpError(503,'widget_limit','Open FamilyTrack to update widgets.');
  const children=[];
  for(const profile of profiles) {
    // Whitelist structured fields. Never load notes, diagnoses or whole JSON records.
    const {rows}=await query(`SELECT id,category,log_date::text AS day,to_char(log_time,'HH24:MI') AS time,
      data->>'type' AS type,data->>'amount' AS amount,data->>'unit' AS unit,
      data->>'medicine' AS medicine,data->>'dose' AS dose,data->>'status' AS status,
      data->>'scheduled_window' AS scheduled_window,data->>'bedtime' AS bedtime,data->>'wake_time' AS wake_time
      FROM care_logs WHERE family_id=$1 AND child_id=$2 AND deleted_at IS NULL
      ORDER BY log_date DESC,log_time DESC,created_at DESC LIMIT 3001`,[familyId,profile.id]);
    // Do not present truncated totals as complete.
    if(rows.length>3000 && rows.at(-1).day>=wallTime(now,zone).toISOString().slice(0,10))
      throw new HttpError(503,'widget_limit','Open FamilyTrack to update widgets.');
    children.push(projectWidget(profile,rows,familyId,zone,now));
  }
  const result={children};
  if(Buffer.byteLength(JSON.stringify(result))>190000) throw new HttpError(503,'widget_limit','Open FamilyTrack to update widgets.');
  return result;
}
