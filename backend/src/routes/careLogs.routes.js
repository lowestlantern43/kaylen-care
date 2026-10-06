import {wallTime,instant} from '../services/widgetSnapshot.js';
import {schoolSession} from '../services/schoolSession.js';
import {normaliseAttendance,attendanceDates} from '../services/attendance.js';
import { normaliseFeed } from '../services/feeding.js';
import { Router } from "express";
import { query, withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAtLeastRole, requireFamilyMember } from "../middleware/familyAccess.js";
import { requirePlanAccess } from "../middleware/planAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, notFound } from "../utils/httpError.js";
import {
  optionalString,
  optionalTime,
  requireString,
  requireUuid,
} from "../validators/simple.js";

export const careLogsRouter = Router({ mergeParams: true });

const categories = new Set([
  "food",
  "medication",
  "sleep",
  "toileting",
  "health",
  "behaviour",
  "appointment",
  "general",
]);

careLogsRouter.use(requireAuth, requireFamilyMember);

function requireCategory(body) {
  const category = requireString(body, "category", "Category");

  if (!categories.has(category)) {
    throw badRequest("Category is not supported.");
  }

  return category;
}

function requireLogDate(body) {
  const logDate = requireString(body, "logDate", "Log date");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    throw badRequest("Log date must be in YYYY-MM-DD format.");
  }

  return logDate;
}

function jsonData(body, category = body.category) {
  if (!body.data) return {};

  if (typeof body.data !== "object" || Array.isArray(body.data)) {
    throw badRequest("Log data must be an object.");
  }

  try { return normaliseAttendance(normaliseFeed(body.data, category), category); } catch(e) { throw badRequest(e.message); }
}

async function assertChildInFamily(childId, familyId) {
  const { rows } = await query(
    `
      SELECT id
      FROM children
      WHERE id = $1
        AND family_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [childId, familyId],
  );

  if (!rows[0]) {
    throw notFound("Child not found.");
  }
}

careLogsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const familyId = req.familyMember.family_id;
    const childId = req.query.childId ? requireUuid(req.query.childId, "Child ID") : null;
    const category = req.query.category || null;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (category && !categories.has(category)) {
      throw badRequest("Category is not supported.");
    }

    const params = [familyId];
    const where = ["cl.family_id = $1", "cl.deleted_at IS NULL", "c.deleted_at IS NULL"];

    if (childId) {
      params.push(childId);
      where.push(`cl.child_id = $${params.length}`);
    }

    if (category) {
      params.push(category);
      where.push(`cl.category = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      where.push(`cl.log_date >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      where.push(`cl.log_date <= $${params.length}`);
    }

    const { rows } = await query(
      `
        SELECT
          cl.id,
          cl.family_id AS "familyId",
          cl.child_id AS "childId",
          c.first_name AS "childFirstName",
          cl.created_by_user_id AS "createdByUserId",
          u.full_name AS "createdByName",
          cl.category,
          cl.log_date::text AS "logDate",
          to_char(cl.log_time, 'HH24:MI') AS "logTime",
          cl.data,
          cl.notes,
          cl.created_at AS "createdAt",
          cl.updated_at AS "updatedAt"
        FROM care_logs cl
        INNER JOIN children c ON c.id = cl.child_id
        INNER JOIN users u ON u.id = cl.created_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY cl.log_date DESC, cl.log_time DESC NULLS LAST, cl.created_at DESC
        LIMIT 300
      `,
      params,
    );

    res.json({ data: rows, error: null });
  }),
);

careLogsRouter.post('/attendance/session',requireAtLeastRole('carer'),(req,res,next)=>requirePlanAccess(req.body.action==='start'?'addLog':'editLog')(req,res,next),asyncHandler(async(req,res)=>{
 const childId=requireUuid(req.body.childId,'Care profile');
 const data=await schoolSession(req.familyMember.family_id,childId,req.user.id,req.body);
 res.json({data,error:null});
}));

// A range is atomic; repeated submissions do not duplicate identical daily records.
careLogsRouter.post('/attendance',requireAtLeastRole('carer'),requirePlanAccess('addLog'),asyncHandler(async(req,res)=>{
 const familyId=req.familyMember.family_id,childId=requireUuid(req.body.childId,'Care profile');
 let dates,data;try{dates=attendanceDates(req.body.startDate,req.body.endDate||req.body.startDate);data=normaliseAttendance({...req.body.data,attendance:true,schoolStartedAt:null,schoolEndedAt:null,schoolActive:false},'general');}catch(e){throw badRequest(e.message);}
 if(dates.length>1&&!['school_holiday','holiday','training','sick','other'].includes(data.attendanceStatus))throw badRequest('Record attendance and appointments one day at a time.');
 const notes=optionalString(req.body,'notes');
 await assertChildInFamily(childId,familyId);
 const count=await withTransaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`attendance:${childId}`]);
  let saved=0;
  for(const date of dates){
   const existing=await db.query("SELECT data,notes FROM care_logs WHERE family_id=$1 AND child_id=$2 AND log_date=$3 AND category='general' AND data->>'attendance'='true' AND deleted_at IS NULL",[familyId,childId,date]);
   if(existing.rows.length){if(existing.rows.length===1&&JSON.stringify(normaliseAttendance(existing.rows[0].data))===JSON.stringify(data)&&(existing.rows[0].notes||'')===(notes||''))continue;throw badRequest(`Attendance already recorded for ${date}. Edit the existing day instead.`);}
   await db.query("INSERT INTO care_logs(family_id,child_id,created_by_user_id,category,log_date,log_time,data,notes) VALUES($1,$2,$3,'general',$4,$5,$6,$7)",[familyId,childId,req.user.id,date,data.arrival||null,JSON.stringify(data),notes]);saved++;
  }return saved;
 });res.status(201).json({data:{saved:count},error:null});
}));

careLogsRouter.post(
  "/",
  requireAtLeastRole("carer"),
  requirePlanAccess("addLog"),
  asyncHandler(async (req, res) => {
    const familyId = req.familyMember.family_id;
    const childId = requireUuid(req.body.childId, "Child ID");
    const category = requireCategory(req.body);
    const logDate = requireLogDate(req.body);
    const logTime = optionalTime(req.body, "logTime");
    const data = jsonData(req.body);
    if(data.attendance) throw badRequest("Use the attendance endpoint or edit the saved attendance day.");
    const notes = optionalString(req.body, "notes");

    await assertChildInFamily(childId, familyId);

    const { rows } = await query(
      `
        INSERT INTO care_logs (
          family_id,
          child_id,
          created_by_user_id,
          category,
          log_date,
          log_time,
          data,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING
          id,
          family_id AS "familyId",
          child_id AS "childId",
          created_by_user_id AS "createdByUserId",
          category,
          log_date::text AS "logDate",
          to_char(log_time, 'HH24:MI') AS "logTime",
          data,
          notes,
          created_at AS "createdAt"
      `,
      [familyId, childId, req.user.id, category, logDate, logTime, JSON.stringify(data), notes],
    );

    res.status(201).json({ data: rows[0], error: null });
  }),
);

careLogsRouter.get(
  "/sleep/incomplete",
  asyncHandler(async (req, res) => {
    const familyId = req.familyMember.family_id;
    const childId = requireUuid(req.query.childId, "Child ID");

    await assertChildInFamily(childId, familyId);

    const { rows } = await query(
      `
        SELECT
          id,
          child_id AS "childId",
          category,
          log_date::text AS "logDate",
          to_char(log_time, 'HH24:MI') AS "logTime",
          data,
          notes,
          created_at AS "createdAt"
        FROM care_logs
        WHERE family_id = $1
          AND child_id = $2
          AND category = 'sleep'
          AND deleted_at IS NULL
          AND (data->>'wake_time' IS NULL OR data->>'wake_time' = '')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [familyId, childId],
    );

    res.json({ data: rows[0] || null, error: null });
  }),
);

careLogsRouter.patch(
  "/:logId",
  requireAtLeastRole("parent"),
  requirePlanAccess("editLog"),
  asyncHandler(async (req, res) => {
    const familyId = req.familyMember.family_id;
    const logId = requireUuid(req.params.logId, "Log ID");
    const category = requireCategory(req.body);
    const logDate = requireLogDate(req.body);
    const logTime = optionalTime(req.body, "logTime");
    const data = jsonData(req.body);
    if(data.attendance) throw badRequest("Use the attendance endpoint or edit the saved attendance day.");
    const notes = optionalString(req.body, "notes");

    const { rows } = await query(
      `
        UPDATE care_logs
        SET category = $1,
            log_date = $2,
            log_time = $3,
            data = $4,
            notes = $5
        WHERE id = $6
          AND family_id = $7
          AND deleted_at IS NULL
        RETURNING
          id,
          family_id AS "familyId",
          child_id AS "childId",
          created_by_user_id AS "createdByUserId",
          category,
          log_date::text AS "logDate",
          to_char(log_time, 'HH24:MI') AS "logTime",
          data,
          notes,
          updated_at AS "updatedAt"
      `,
      [category, logDate, logTime, JSON.stringify(data), notes, logId, familyId],
    );

    if (!rows[0]) {
      throw notFound("Care log not found.");
    }

    res.json({ data: rows[0], error: null });
  }),
);

careLogsRouter.delete(
  "/:logId",
  requireAtLeastRole("parent"),
  requirePlanAccess("deleteLog"),
  asyncHandler(async (req, res) => {
    const familyId = req.familyMember.family_id;
    const logId = requireUuid(req.params.logId, "Log ID");

    const { rows } = await query(
      `
        UPDATE care_logs
        SET deleted_at = now()
        WHERE id = $1
          AND family_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [logId, familyId],
    );

    if (!rows[0]) {
      throw notFound("Care log not found.");
    }

    res.json({ data: { id: rows[0].id, deleted: true }, error: null });
  }),
);

careLogsRouter.post('/:logId/correction', requireAtLeastRole('parent'),
 (req,res,next)=>requirePlanAccess(req.body.action==='delete'?'deleteLog':'editLog')(req,res,next),
 asyncHandler(async(req,res)=>{
 const id=requireUuid(req.params.logId,'Log ID'),familyId=req.familyMember.family_id;
 const action=req.body.action;
 if(!['edit','move','delete','restore'].includes(action))throw badRequest('Unknown entry action.');
 const result=await withTransaction(async db=>{
 const peek=await db.query('SELECT child_id,data FROM care_logs WHERE id=$1 AND family_id=$2',[id,familyId]);
 if(peek.rows[0]?.data?.attendance){
  const targets=[peek.rows[0].child_id,...(action==='move'?[requireUuid(req.body.childId,'Care profile')]:[])].sort();
  for(const target of [...new Set(targets)])await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`attendance:${target}`]);
 }
 const {rows}=await db.query('SELECT * FROM care_logs WHERE id=$1 AND family_id=$2 FOR UPDATE',[id,familyId]);const old=rows[0];
 if(!old || (action!=='restore' && old.deleted_at))throw notFound('Entry not found.');
 if(!req.body.expectedUpdatedAt || new Date(req.body.expectedUpdatedAt).getTime()!==new Date(old.updated_at).getTime())throw badRequest('This entry has changed. Refresh it before trying again.');
 const target=action==='move'?requireUuid(req.body.childId,'Care profile'):old.child_id;
 const active=await db.query('SELECT id FROM children WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL',[target,familyId]);
 if(!active.rows.length)throw notFound('Active care profile not found.');
 if(old.category==='sleep' && !old.data?.wake_time && ['move','restore'].includes(action)) {
 const other=await db.query("SELECT id FROM care_logs WHERE family_id=$1 AND child_id=$2 AND id<>$3 AND category='sleep' AND deleted_at IS NULL AND COALESCE(data->>'wake_time','')='' LIMIT 1",[familyId,target,id]);
 if(other.rows.length)throw badRequest('This profile already has an active sleep. End or clear it first.');
 }
 if(old.data?.attendance && action!=='delete'){
 const date=action==='edit'?requireLogDate(req.body):String(old.log_date instanceof Date?old.log_date.toISOString().slice(0,10):old.log_date);
 try{attendanceDates(date);}catch(e){throw badRequest(e.message);}
 if(action==='edit' && req.body.data?.attendance!==true)throw badRequest('Keep attendance details when editing this day.');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`attendance:${target}`]);
 const duplicate=await db.query("SELECT id FROM care_logs WHERE family_id=$1 AND child_id=$2 AND id<>$3 AND log_date=$4 AND category='general' AND data->>'attendance'='true' AND deleted_at IS NULL",[familyId,target,id,date]);
 if(old.data.schoolActive && action==='move'){const open=await db.query("SELECT id FROM care_logs WHERE family_id=$1 AND child_id=$2 AND id<>$3 AND deleted_at IS NULL AND data->>'schoolActive'='true'",[familyId,target,id]);if(open.rows.length)throw badRequest('That profile already has an active school session.');}
 if(duplicate.rows.length)throw badRequest('Attendance is already recorded for that profile and date.');
 }
 if(action==='restore' && (!old.deleted_at || Date.now()-new Date(old.deleted_at).getTime()>15*60*1000))throw badRequest('Undo is available for 15 minutes after deletion.');
 let changed;
 if(action==='edit'){
 const date=requireLogDate(req.body),time=optionalTime(req.body,'logTime'),data=jsonData(old.data?.attendance?{...req.body,data:{...req.body.data,schoolStartedAt:old.data.schoolStartedAt,schoolEndedAt:old.data.schoolEndedAt,schoolActive:old.data.schoolActive}}:req.body,old.category),notes=optionalString(req.body,'notes');
 if(old.data?.attendance && data.schoolStartedAt && (date!==String(old.log_date instanceof Date?old.log_date.toISOString().slice(0,10):old.log_date) || data.arrival!==old.data.arrival)){
  try{if(typeof req.body.timeZone!=='string'||req.body.timeZone.length>100||!data.arrival)throw Error();wallTime(new Date(),req.body.timeZone);data.schoolStartedAt=new Date(instant(new Date(`${date}T${data.arrival}Z`),req.body.timeZone)*1000).toISOString();}catch{throw badRequest('Enter a valid arrival time and timezone for this school period.');}
 }
 if(old.category==='sleep' && (date!==String(old.log_date instanceof Date?old.log_date.toISOString().slice(0,10):old.log_date) || data.bedtime!==old.data?.bedtime))delete data.sleep_started_at;
 changed=await db.query('UPDATE care_logs SET log_date=$3,log_time=$4,data=$5,notes=$6 WHERE id=$1 AND family_id=$2 RETURNING updated_at',[id,familyId,date,time,JSON.stringify(data),notes]);
 }else if(action==='move')changed=await db.query('UPDATE care_logs SET child_id=$3 WHERE id=$1 AND family_id=$2 RETURNING updated_at',[id,familyId,target]);
 else changed=await db.query(`UPDATE care_logs SET deleted_at=${action==='delete'?'now()':'NULL'} WHERE id=$1 AND family_id=$2 RETURNING updated_at`,[id,familyId]);
 await db.query(`INSERT INTO audit_logs(family_id,user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'care_log',$4,$5)`,[familyId,req.user.id,'care_log_'+action,id,JSON.stringify({fromProfileId:old.child_id,toProfileId:target})]);
 return {id,updatedAt:changed.rows[0].updated_at};
 });res.json({data:result,error:null});
}));
