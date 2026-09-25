import crypto from 'node:crypto';

const host = 'familytrack-backups-lon1.lon1.digitaloceanspaces.com';
const path = '/monitoring/uploads-latest.json';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

export function assessBackupReceipt(receipt, now = new Date()) {
  const recorded = Date.parse(receipt?.recordedAt);
  if (receipt?.scope !== 'uploaded_files_only' || !Number.isFinite(recorded) || recorded > +now + 300000)
    return { status: 'unknown', detail: 'Uploads backup evidence is invalid or has an unexpected timestamp.' };
  if (receipt.status === 'failed')
    return { status: 'attention', lastRecordedAt: receipt.recordedAt, detail: 'The latest uploads backup attempt failed. Check the backup job logs; earlier recovery copies may still exist.' };
  const completed = Date.parse(receipt.completedAt);
  if (receipt.status !== 'success' || receipt.restoreVerified !== true || !Number.isFinite(completed) || completed > recorded)
    return { status: 'unknown', detail: 'No verified successful uploads backup was reported.' };
  const stale = +now - completed > 26 * 3600000;
  return { status: stale ? 'attention' : 'working', lastSuccessAt: receipt.completedAt,
    detail: stale ? 'No verified uploads backup within 26 hours. Check whether the scheduled job ran.' :
      'Uploaded photos and documents backed up; restore and byte comparison passed. Daily at 2am UK time, with 30-day retention. This does not verify database backups.' };
}

export async function readUploadsBackupHealth({ now = new Date(), fetchImpl = fetch, env = process.env } = {}) {
  const key = env.BACKUP_STATUS_ACCESS_KEY;
  const secret = env.BACKUP_STATUS_SECRET_KEY;
  if (!key || !secret) return { status: 'unknown', detail: 'Private uploads-backup monitoring credentials are not configured.' };
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8), scope = `${day}/lon1/s3/aws4_request`, payload = hash('');
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = ['GET', path, '', `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${date}\n`, signed, payload].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'lon1'), 's3'), 'aws4_request');
  const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString('hex');
  const response = await fetchImpl(`https://${host}${path}`, { redirect: 'error', signal: AbortSignal.timeout(4000), headers: {
    'x-amz-date': date, 'x-amz-content-sha256': payload,
    authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  }});
  if (!response.ok) throw new Error('Backup receipt unavailable');
  const text = await response.text();
  if (text.length > 4096) throw new Error('Invalid backup receipt');
  return assessBackupReceipt(JSON.parse(text), now);
}
