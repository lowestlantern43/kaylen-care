import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { requireUuid } from '../validators/simple.js';
import { sendAppEmail, buildEmailHtml } from '../services/email.js';
import { ensureAdminEmailSchema, validateAdminMessage, eligibleUsersSql, emailSettings } from '../services/adminEmail.js';
export const adminEmailRouter=Router();
adminEmailRouter.use(requireAuth,requirePlatformAdmin);
adminEmailRouter.use(asyncHandler(async(req,res,next)=>{await ensureAdminEmailSchema();res.set('Cache-Control','no-store');next();}));
adminEmailRouter.get('/',asyncHandler(async(req,res)=>{
 const {rows}=await query(`SELECT m.*,u.full_name AS author,(SELECT count(*)::int FROM admin_email_recipients r WHERE r.message_id=m.id) AS recipients FROM admin_email_messages m LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC LIMIT 100`);
 res.json({data:{messages:rows,settings:emailSettings()},error:null});
}));
adminEmailRouter.get('/recipients',asyncHandler(async(req,res)=>{const {rows}=await query(eligibleUsersSql+' ORDER BY u.full_name,u.email');res.json({data:rows,error:null});}));
adminEmailRouter.post('/',asyncHandler(async(req,res)=>{
 const {subject,text,ids}=validateAdminMessage(req.body);
 const {rows:users}=await query(eligibleUsersSql+' AND u.id=ANY($1::uuid[])',[ids]);
 if(users.length!==ids.length) throw badRequest('Some recipients are no longer available. Refresh the recipient list.');
 const unique=[...new Map(users.map(u=>[u.email.toLowerCase(),u])).values()];
 const id=randomUUID();
 await withTransaction(async db=>{
 await db.query('INSERT INTO admin_email_messages(id,created_by,subject,body) VALUES($1,$2,$3,$4)',[id,req.user.id,subject,text]);
 for(const u of unique) await db.query('INSERT INTO admin_email_recipients(message_id,user_id,email) VALUES($1,$2,$3)',[id,u.id,u.email.toLowerCase()]);
 });
 res.json({data:{id},error:null});
}));
adminEmailRouter.get('/:id',asyncHandler(async(req,res)=>{
 const id=requireUuid(req.params.id,'Message');
 const {rows}=await query('SELECT * FROM admin_email_messages WHERE id=$1',[id]);if(!rows[0])throw notFound('Email not found.');
 const {rows:recipients}=await query('SELECT r.*,u.full_name AS name FROM admin_email_recipients r JOIN users u ON u.id=r.user_id WHERE message_id=$1 ORDER BY email',[id]);
 res.json({data:{...rows[0],recipients,html:buildEmailHtml({subject:rows[0].subject,text:rows[0].body}),settings:emailSettings()},error:null});
}));
adminEmailRouter.post('/:id/send',asyncHandler(async(req,res)=>{
 const id=requireUuid(req.params.id,'Message');
 if(req.body.confirm!==true) throw badRequest('Preview and confirm the recipients before sending.');
 if(!emailSettings().ready) throw badRequest('Configure the email provider and hello@familytrack.care sender before sending.');
 const batch=await withTransaction(async db=>{
 const {rows}=await db.query('SELECT * FROM admin_email_messages WHERE id=$1 FOR UPDATE',[id]);const m=rows[0];if(!m)throw notFound('Email not found.');
 const {rows:recipients}=await db.query(`SELECT r.* FROM admin_email_recipients r WHERE message_id=$1 AND status='pending' ORDER BY email LIMIT 5 FOR UPDATE`,[id]);
 for(const r of recipients) await db.query(`UPDATE admin_email_recipients SET status='sending',attempted_at=now() WHERE message_id=$1 AND user_id=$2`,[id,r.user_id]);
 await db.query(`UPDATE admin_email_messages SET status='sending' WHERE id=$1 AND status='draft'`,[id]);return {m,recipients};
 });
 for(const r of batch.recipients) {
 await new Promise(resolve=>setTimeout(resolve,600));
 let status='unknown';
 try {
 const {rows}=await query(eligibleUsersSql+' AND u.id=$1 AND lower(u.email)=$2',[r.user_id,r.email]);
 if(!rows.length) status='skipped';
 else {const result=await sendAppEmail({to:r.email,subject:batch.m.subject,text:batch.m.body,metadata:{type:'admin_message',userId:r.user_id}});status=result.sent?'sent':result.skipped?'skipped':'failed';}
 } catch { /* An uncertain provider outcome must never be automatically retried. */ }
 await query('UPDATE admin_email_recipients SET status=$3 WHERE message_id=$1 AND user_id=$2',[id,r.user_id,status]);
 await query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata) VALUES($1,'admin_email_attempted','user',$2,$3)`,[req.user.id,r.user_id,JSON.stringify({messageId:id,status})]);
 }
 const {rows:counts}=await query('SELECT status,count(*)::int AS count FROM admin_email_recipients WHERE message_id=$1 GROUP BY status',[id]);
 const pending=counts.find(r=>r.status==='pending')?.count||0;
 if(!pending) await query(`UPDATE admin_email_messages SET status='complete',sent_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM admin_email_recipients WHERE message_id=$1 AND status='sending')`,[id]);
 res.json({data:{pending,counts},error:null});
}));
