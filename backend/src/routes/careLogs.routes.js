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

  try { return normaliseFeed(body.data, category); } catch(e) { throw badRequest(e.message); }
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
 if(action==='restore' && (!old.deleted_at || Date.now()-new Date(old.deleted_at).getTime()>15*60*1000))throw badRequest('Undo is available for 15 minutes after deletion.');
 let changed;
 if(action==='edit'){
 const date=requireLogDate(req.body),time=optionalTime(req.body,'logTime'),data=jsonData(req.body,old.category),notes=optionalString(req.body,'notes');
 if(old.category==='sleep' && (date!==String(old.log_date instanceof Date?old.log_date.toISOString().slice(0,10):old.log_date) || data.bedtime!==old.data?.bedtime))delete data.sleep_started_at;
 changed=await db.query('UPDATE care_logs SET log_date=$3,log_time=$4,data=$5,notes=$6 WHERE id=$1 AND family_id=$2 RETURNING updated_at',[id,familyId,date,time,JSON.stringify(data),notes]);
 }else if(action==='move')changed=await db.query('UPDATE care_logs SET child_id=$3 WHERE id=$1 AND family_id=$2 RETURNING updated_at',[id,familyId,target]);
 else changed=await db.query(`UPDATE care_logs SET deleted_at=${action==='delete'?'now()':'NULL'} WHERE id=$1 AND family_id=$2 RETURNING updated_at`,[id,familyId]);
 await db.query(`INSERT INTO audit_logs(family_id,user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'care_log',$4,$5)`,[familyId,req.user.id,'care_log_'+action,id,JSON.stringify({fromProfileId:old.child_id,toProfileId:target})]);
 return {id,updatedAt:changed.rows[0].updated_at};
 });res.json({data:result,error:null});
}));
