import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireFamilyMember } from '../middleware/familyAccess.js';
import { requirePrivacyConsent } from '../services/privacyConsent.js';
import { requireUuid } from '../validators/simple.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { bearerWidgetToken, issueWidgetAccess, readWidgetAccess, revokeWidgetAccess } from '../services/widgetAccess.js';

export const widgetsRouter = Router();
// Deliberately disabled until the native secure-storage and logout integration
// are verified. Existing clients and endpoints never use this router.
widgetsRouter.use((req,res,next) => {
  res.set('Cache-Control','no-store');
  if (process.env.WIDGET_BACKGROUND_ENABLED !== 'true') return next(notFound());
  next();
});
widgetsRouter.post('/families/:familyId/access', requireAuth, requirePrivacyConsent, requireFamilyMember,
  asyncHandler(async(req,res) => {
    const installationId = requireUuid(req.body?.installationId, 'Installation ID');
    const data = await issueWidgetAccess(req.user.id,req.familyMember.family_id,installationId);
    res.json({data,error:null});
  }));
widgetsRouter.delete('/access', asyncHandler(async(req,res) => {
  // Possession permits revocation only, even after membership/consent removal.
  await revokeWidgetAccess(bearerWidgetToken(req));
  res.json({data:{ok:true},error:null});
}));
widgetsRouter.get('/access', asyncHandler(async(req,res) => {
  await readWidgetAccess(bearerWidgetToken(req));
  res.json({data:{available:true},error:null});
}));
