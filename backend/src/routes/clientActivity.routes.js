import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest } from '../utils/httpError.js';

export const clientActivityRouter = Router();
let schema;
function ensureSchema() {
  if (!schema) schema = query(`CREATE TABLE IF NOT EXISTS user_client_activity (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, platform)
  )`).catch(error => { schema = null; throw error; });
  return schema;
}
clientActivityRouter.use(requireAuth);
clientActivityRouter.post('/', asyncHandler(async (req, res) => {
  const platform = req.body?.platform;
  if (!['web','ios','android'].includes(platform)) throw badRequest('Invalid client platform.');
  await ensureSchema();
  // Always attribute to the authenticated user, never an ID in the request body.
  await query(`INSERT INTO user_client_activity (user_id, platform) VALUES ($1,$2)
    ON CONFLICT (user_id, platform) DO UPDATE SET last_seen_at = now()
    WHERE user_client_activity.last_seen_at < now() - interval '5 minutes'`, [req.user.id, platform]);
  res.json({ data: { recorded: true }, error: null });
}));
clientActivityRouter.get('/', requirePlatformAdmin, asyncHandler(async (req, res) => {
  await ensureSchema();
  const { rows } = await query(`SELECT a.user_id AS "userId", a.platform,
    a.first_seen_at AS "firstSeenAt", a.last_seen_at AS "lastSeenAt"
    FROM user_client_activity a JOIN users u ON u.id = a.user_id
    WHERE u.deleted_at IS NULL ORDER BY a.last_seen_at DESC`);
  res.json({ data: rows, error: null });
}));
