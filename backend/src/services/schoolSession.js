import {ensureSchoolSettingsSchema} from './schoolSettings.js';
import {withTransaction} from '../db/pool.js';
import {badRequest,notFound,HttpError} from '../utils/httpError.js';
import {wallTime} from './widgetSnapshot.js';
import {normaliseAttendance} from './attendance.js';
export async function schoolSession(familyId,childId,userId,body,now=new Date()) {
 if(!['start','end'].includes(body.action))throw badRequest('Choose Left for School or Back Home.');
 let wall;try{if(typeof body.timeZone!=='string'||body.timeZone.length>100)throw Error();wall=wallTime(now,body.timeZone);}catch{throw badRequest('A valid timezone is required.');}
 const day=wall.toISOString().slice(0,10),time=wall.toISOString().slice(11,16);
 await ensureSchoolSettingsSchema();
 return withTransaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`attendance:${childId}`]);
  const child=await db.query('SELECT id FROM children WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL FOR UPDATE',[childId,familyId]);if(!child.rows.length)throw notFound('Care profile not found.');
  const {rows}=await db.query("SELECT id,data,updated_at,log_date::text AS day FROM care_logs WHERE family_id=$1 AND child_id=$2 AND category='general' AND data->>'attendance'='true' AND deleted_at IS NULL AND (log_date=$3 OR data->>'schoolActive'='true' OR id::text=$4) ORDER BY log_date DESC FOR UPDATE",[familyId,childId,day,body.expectedLogId||'']);
  const active=rows.find(r=>r.data.schoolActive===true&&!r.data.schoolEndedAt&&!r.data.collection&&r.data.attendanceStatus==='attended');
  if(body.action==='start' && active)throw new HttpError(409,'school_changed','A school session is already running. Refresh to see it.');
  const current=body.action==='end'?rows.find(r=>r.id===body.expectedLogId):rows.find(r=>r.day===day);
  if(body.action==='end' && current?.data.schoolEndedAt)return {saved:true,alreadySaved:true};
  if(body.action==='end' && (!active||active.id!==body.expectedLogId))throw new HttpError(409,'school_changed','School state has changed. Refresh before trying again.');
  if((current?.id||'')!==(body.expectedLogId||'') || (current && new Date(current.updated_at).getTime()!==new Date(body.expectedUpdatedAt).getTime()))throw new HttpError(409,'school_changed','Attendance has changed. Refresh before trying again.');
  if(body.action==='start' && current && current.data.attendanceStatus!=='attended')throw badRequest('This day is recorded as an absence or closure. Edit its status before starting school.');
  if(body.action==='start' && current?.data.schoolStartedAt)throw badRequest('This day already has a school period. Edit the saved attendance rather than replacing it.');
  const settings=await db.query("SELECT school_settings FROM child_profiles WHERE child_id=$1 AND family_id=$2",[childId,familyId]);
  const data=normaliseAttendance(body.action==='start'?{...(current?.data||{}),attendance:true,attendanceStatus:'attended',setting:current?.data?.setting||settings.rows[0]?.school_settings?.name||'',arrival:time,collection:'',schoolStartedAt:now.toISOString(),schoolEndedAt:null,schoolActive:true}:{...current.data,collection:current.day===day?time:'',schoolEndedAt:now.toISOString(),schoolActive:false});
  let saved;
  if(current)saved=await db.query('UPDATE care_logs SET data=$3,log_time=$4,updated_at=now() WHERE id=$1 AND family_id=$2 RETURNING id,updated_at',[current.id,familyId,JSON.stringify(data),data.arrival||null]);
  else saved=await db.query("INSERT INTO care_logs(family_id,child_id,created_by_user_id,category,log_date,log_time,data,notes) VALUES($1,$2,$3,'general',$4,$5,$6,'') RETURNING id,updated_at",[familyId,childId,userId,day,time,JSON.stringify(data)]);
  await db.query("INSERT INTO audit_logs(family_id,user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'care_log',$4,'{}')",[familyId,userId,'school_'+body.action,saved.rows[0].id]);
  return {saved:true,id:saved.rows[0].id};
 });
}
