import { Router } from 'express';
import { requireFamilyMember } from '../middleware/familyAccess.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { activationProgress } from '../services/activation.js';
export const activationRouter = Router({mergeParams:true});
activationRouter.use(requireFamilyMember,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
activationRouter.post('/',asyncHandler(async(req,res)=>{
  const body=req.body || {};
  for (const key of ['visit','dismissed','reminderOptIn','analyticsOptIn']) {
    if (body[key]!==undefined && typeof body[key]!=='boolean') return res.status(400).json({error:{message:'Invalid guidance preference.'}});
  }
  // Only allowlisted fields; no care text, names, IPs, user agents or arbitrary analytics payloads.
  const input={visit:body.visit,dismissed:body.dismissed,reminderOptIn:body.reminderOptIn,analyticsOptIn:body.analyticsOptIn,
    timeZone:typeof body.timeZone==='string' ? body.timeZone.slice(0,100) : undefined,
    action:['report','share'].includes(body.action)?body.action:undefined};
  res.json({data:await activationProgress(req.user,req.params.familyId,input),error:null});
}));
