const backupUrl = 'https://api.digitalocean.com/v2/databases/e4c5932d-c82a-44fa-9e9b-547de0ca012e/backups';

export function assessDatabaseBackups(data, now = new Date()) {
  if (!Array.isArray(data?.backups)) throw new Error('Invalid backup response');
  if (!data.backups.length) return {status:'attention', detail:'DigitalOcean reports no available database backups. No restore test has been performed.'};
  const dates = data.backups.map(item => Date.parse(item.created_at));
  if (dates.some(date => !Number.isFinite(date) || date > +now + 300000))
    return {status:'unknown', detail:'DigitalOcean returned an invalid backup timestamp; database backup status is not verified.'};
  const latest = Math.max(...dates);
  const stale = +now - latest > 26 * 3600000;
  return {status:stale ? 'attention' : 'working', lastSuccessAt:new Date(latest).toISOString(),
    detail: stale ? 'DigitalOcean lists database backups, but the latest is older than 26 hours. Check the database backup service. Restore testing remains outstanding.' :
      'DigitalOcean reports a database backup created within the last 26 hours. This confirms provider backup availability, not a tested restore. Restore testing remains outstanding.'};
}

export async function readDatabaseBackupHealth({now = new Date(), env = process.env, fetchImpl = fetch} = {}) {
  const token = env.DO_DATABASE_BACKUP_MONITOR_TOKEN;
  if (!token) return {status:'unknown', detail:'DigitalOcean database backup monitoring is not connected. A read-only monitoring token is required.'};
  const response = await fetchImpl(backupUrl, {method:'GET', redirect:'error', signal:AbortSignal.timeout(4000),
    headers:{authorization:`Bearer ${token}`, accept:'application/json'}});
  if (!response.ok) throw new Error('Database backup evidence unavailable');
  return assessDatabaseBackups(await response.json(), now);
}
