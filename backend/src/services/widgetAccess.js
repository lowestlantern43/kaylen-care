import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { unauthorized, forbidden } from '../utils/httpError.js';
import { careAccessAllowed } from './privacyConsent.js';

// Dedicated opaque credentials: never accept these as normal account sessions.
export const widgetTokenHash = token => createHash('sha256').update(token).digest('hex');
export const widgetAccessSchema = `CREATE TABLE IF NOT EXISTS widget_access_grants (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  installation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  session_hash TEXT,
  UNIQUE(user_id, family_id, installation_id)
)`;
let schema;
export function ensureWidgetAccessSchema() {
  if (!schema) schema = query(widgetAccessSchema).then(() => query('ALTER TABLE widget_access_grants ADD COLUMN IF NOT EXISTS session_hash TEXT, ADD COLUMN IF NOT EXISTS sleep_actions BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS school_actions BOOLEAN NOT NULL DEFAULT false')).catch(error => { schema = null; throw error; });
  return schema;
}

export async function issueWidgetAccess(userId, familyId, installationId, session = '', sleepActions = false, schoolActions = false) {
  await ensureWidgetAccessSchema();
  const token = `ftw_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await query(`INSERT INTO widget_access_grants(token_hash,user_id,family_id,installation_id,expires_at,session_hash,sleep_actions,school_actions)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,family_id,installation_id) DO UPDATE
    SET token_hash=EXCLUDED.token_hash, expires_at=EXCLUDED.expires_at, session_hash=EXCLUDED.session_hash, sleep_actions=EXCLUDED.sleep_actions, school_actions=EXCLUDED.school_actions, revoked_at=NULL, created_at=now()`,
    [widgetTokenHash(token), userId, familyId, installationId, expiresAt, session ? widgetTokenHash(session) : null, sleepActions === true, schoolActions === true]);
  return { token, expiresAt };
}

export async function revokeSessionWidgets(session) {
  if (!session || process.env.WIDGET_BACKGROUND_ENABLED !== 'true') return;
  await ensureWidgetAccessSchema();
  await query('UPDATE widget_access_grants SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL', [widgetTokenHash(session)]);
}

export function bearerWidgetToken(req) {
  const match = /^Bearer (ftw_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
  if (!match) throw unauthorized('Open FamilyTrack to refresh widget access.');
  return match[1];
}

export async function readWidgetAccess(token) {
  await ensureWidgetAccessSchema();
  const {rows} = await query(`SELECT g.user_id, g.family_id, g.sleep_actions, g.school_actions, fm.role
    FROM widget_access_grants g
    JOIN users u ON u.id=g.user_id
    JOIN families f ON f.id=g.family_id
    JOIN family_members fm ON fm.user_id=g.user_id AND fm.family_id=g.family_id
    WHERE g.token_hash=$1 AND g.revoked_at IS NULL AND g.expires_at>now()
      AND u.deleted_at IS NULL AND f.deleted_at IS NULL AND fm.deleted_at IS NULL
      AND COALESCE(u.platform_status,'active')<>'suspended'
      AND COALESCE(f.platform_status,'active')<>'suspended' LIMIT 1`, [widgetTokenHash(token)]);
  if (!rows[0]) throw unauthorized('Open FamilyTrack to refresh widget access.');
  if (!await careAccessAllowed(rows[0].user_id)) throw forbidden('Widget access is unavailable.');
  return rows[0];
}

export async function revokeWidgetAccess(token) {
  await ensureWidgetAccessSchema();
  await query('UPDATE widget_access_grants SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [widgetTokenHash(token)]);
}
