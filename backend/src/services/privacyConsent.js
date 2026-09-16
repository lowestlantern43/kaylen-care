import { query } from "../db/pool.js";
import { forbidden } from "../utils/httpError.js";

export const PRIVACY_VERSION = "2026-09-15";
export const CONSENT_TEXT = "I explicitly consent to FamilyTrack storing and using the health and care information I provide to operate my care diary, reports, sharing and reminders. For information about another person, I confirm I have their permission or legal authority to act for them. I will only share it with authorised carers. I can withdraw my choice in Privacy controls; withdrawal stops my access and reminders, and I can request deletion. Records needed by other authorised family members are reviewed separately.";
let schema;
export function ensurePrivacySchema() {
  if (!schema) schema = query(`CREATE TABLE IF NOT EXISTS privacy_consent_events (
    id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version TEXT NOT NULL, accepted BOOLEAN NOT NULL, statement TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(error => { schema = null; throw error; });
  return schema;
}
export async function privacyStatus(userId) {
  await ensurePrivacySchema();
  const { rows } = await query(`SELECT accepted, version, created_at AS "recordedAt"
    FROM privacy_consent_events WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [userId]);
  return { version: PRIVACY_VERSION, statement: CONSENT_TEXT,
    accepted: rows[0]?.accepted === true && rows[0]?.version === PRIVACY_VERSION,
    recordedAt: rows[0]?.recordedAt || null };
}
export async function requirePrivacyConsent(req, res, next) {
  try {
    if (!(await careAccessAllowed(req.user.id))) {
      throw forbidden("Please open Privacy controls in the latest FamilyTrack app and record your care-data choice before opening the workspace.");
    }
    next();
  } catch (error) { next(error); }
}

// Enable the rollout switch only after the website and native consent UI are
// available. An explicit withdrawal is enforced even during the rollout.
export async function careAccessAllowed(userId) {
  const status = await privacyStatus(userId);
  return status.accepted || (!status.recordedAt && process.env.PRIVACY_CONSENT_REQUIRED !== "true");
}
