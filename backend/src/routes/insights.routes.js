import { Router } from 'express';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { cleanTraffic,ensureInsights,trafficReport,digestSettings,buildDigest,digestWindow } from '../services/adminInsights.js';

export const insightsRouter=Router();
// A global bound avoids retaining visitor IPs while limiting anonymous writes.
let minute=0, writes=0;
insightsRouter.post('/public/traffic',asyncHandler(async(req,res)=>{
  const current=Math.floor(Date.now()/60000);
  if(current!==minute){minute=current;writes=0;}
  const origins=config.frontendUrl.split(',').map(s=>s.trim());
  if(!origins.includes(req.get('Origin')) || ++writes>300 || /bot|crawler|spider/i.test(req.get('User-Agent') || '')) return res.sendStatus(204);
  const values=cleanTraffic(req.body);
  if(!values) return res.sendStatus(204);
  try {
    await ensureInsights();
    await query('INSERT INTO public_traffic_events(id,visitor_id,page,kind,source,device) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',values);
  } catch { /* Optional analytics must not interrupt signup. */ }
  res.sendStatus(204);
}));
insightsRouter.use('/admin/insights',requireAuth,requirePlatformAdmin,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
insightsRouter.get('/admin/insights',asyncHandler(async(req,res)=>{
  res.json({data:{traffic:await trafficReport(req.query.days),digest:await digestSettings()},error:null});
}));
insightsRouter.put('/admin/insights/digest',asyncHandler(async(req,res)=>{
  const recipient=String(req.body.recipient || '').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||recipient.length>254||typeof req.body.enabled!=='boolean') return res.status(400).json({error:{message:'Enter a valid recipient email and enabled setting.'}});
  if(req.body.enabled && (!config.resendApiKey || config.emailProvider!=='resend')) return res.status(400).json({error:{message:'The nightly digest needs the configured Resend email provider.'}});
  await ensureInsights();
  await query(`UPDATE admin_digest_settings SET recipient=$1,enabled=$2,
    enabled_at=CASE WHEN $2 AND NOT enabled THEN now() ELSE enabled_at END WHERE id=1`,[recipient,req.body.enabled]);
  res.json({data:await digestSettings(),error:null});
}));
insightsRouter.get('/admin/insights/preview',asyncHandler(async(req,res)=>{
  await ensureInsights();
  const window=await digestWindow();
  res.json({data:await buildDigest(window.start,window.end),error:null});
}));
