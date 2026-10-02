import { query } from '../db/pool.js';
import { config } from '../config.js';
import { badRequest } from '../utils/httpError.js';
export const adminEmailSchema = `CREATE TABLE IF NOT EXISTS admin_email_messages (
 id UUID PRIMARY KEY, created_by UUID REFERENCES users(id) ON DELETE SET NULL, subject TEXT NOT NULL,
 body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 sent_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_email_recipients (
 message_id UUID NOT NULL REFERENCES admin_email_messages(id), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempted_at TIMESTAMPTZ,
 PRIMARY KEY(message_id, user_id), UNIQUE(message_id,email)
);
`;
let schema;
export function ensureAdminEmailSchema() { return schema ||= query(adminEmailSchema).catch(e=>{schema=null;throw e;}); }
export function validateAdminMessage(body) {
 const subject=String(body.subject || '').trim(), text=String(body.text || '').trim();
 if(!subject || subject.length>160 || /[\r\n]/.test(subject)) throw badRequest('Enter a subject up to 160 characters.');
 if(!text || text.length>20000) throw badRequest('Enter a message up to 20,000 characters.');
 if(!Array.isArray(body.userIds)) throw badRequest('Select recipients.');
 const ids=[...new Set(body.userIds)];
 if(!ids.length || ids.length>2000 || ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))) throw badRequest('Select between 1 and 2,000 users.');
 return {subject,text,ids};
}
export function emailSettings() { return {from:config.emailFrom,replyTo:config.supportEmail,ready: /(?:<|^)hello@familytrack\.care>?$/i.test(config.emailFrom) && Boolean(config.emailProvider==='resend'?config.resendApiKey:config.emailWebhookUrl)}; }
export const eligibleUsersSql = `SELECT u.id,u.email,u.full_name AS name,
 COALESCE((SELECT json_agg(json_build_object('id',f.id,'name',f.name)) FROM family_members fm JOIN families f ON f.id=fm.family_id WHERE fm.user_id=u.id AND fm.deleted_at IS NULL AND f.deleted_at IS NULL),'[]') AS families
 FROM users u WHERE u.deleted_at IS NULL AND COALESCE(u.platform_status,'active') NOT IN ('suspended','blocked','locked')`;
