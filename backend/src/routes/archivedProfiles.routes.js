import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireUuid } from '../validators/simple.js';
import { badRequest, notFound } from '../utils/httpError.js';
export const archivedProfilesRouter = Router();
archivedProfilesRouter.use(requireAuth, requirePlatformAdmin);
archivedProfilesRouter.get('/', asyncHandler(async (req,res)=>{
 const {rows}=await query(`SELECT c.id,c.family_id AS "familyId",c.first_name AS "firstName",c.last_name AS "lastName",f.name AS "familyName",c.deleted_at AS "archivedAt",c.deleted_at + interval '30 days' AS "recoverUntil" FROM children c JOIN families f ON f.id=c.family_id WHERE c.deleted_at > now()-interval '30 days' AND f.deleted_at IS NULL ORDER BY c.deleted_at DESC`);
 res.json({data:rows,error:null});
}));
archivedProfilesRouter.post('/:id/restore',asyncHandler(async(req,res)=>{
 const id=requireUuid(req.params.id, 'Profile ID');
 const restored=await withTransaction(async client=>{
  const {rows}=await client.query(`SELECT c.* FROM children c JOIN families f ON f.id=c.family_id WHERE c.id=$1 AND c.deleted_at > now()-interval '30 days' AND f.deleted_at IS NULL FOR UPDATE OF c`,[id]);
  if(!rows[0])throw notFound('Profile is not available within the 30-day recovery window.');
  const child=rows[0];
  const existing=await client.query(`SELECT id FROM children WHERE family_id=$1 AND deleted_at IS NULL AND lower(trim(first_name))=lower(trim($2)) AND lower(trim(COALESCE(last_name,'')))=lower(trim(COALESCE($3,'')))`,[child.family_id,child.first_name,child.last_name]);
  if(existing.rows.length)throw badRequest('An active profile has this name. Rename it before restoring this profile.');
  await client.query('UPDATE children SET deleted_at=NULL WHERE id=$1',[id]);
  return {id};
 });
 res.json({data:restored,error:null});
}));
