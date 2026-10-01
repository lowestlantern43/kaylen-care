import { query } from '../db/pool.js';
let setup;
export function ensureWidgetSleepSchema() {
  return setup ||= query('ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS usual_bedtime TEXT').catch(error => { setup=null; throw error; });
}
