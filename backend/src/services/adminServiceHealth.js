// Admin-only, read-only observations. Never trigger deliveries or repair actions.
import { readUploadsBackupHealth } from './backupHealth.js';
export async function getAdminServiceHealth({ query, config, now = new Date(), readBackupHealth = readUploadsBackupHealth }) {
  const checks = [{ id: 'api', label: 'Website API', status: 'working', detail: 'This authenticated admin request reached the API. This is not an external uptime check.' }];
  const observe = async (id, label, read) => {
    try { checks.push({ id, label, ...await read() }); }
    catch { checks.push({ id, label, status: 'unknown', detail: 'Could not read monitoring evidence. The service status has not been verified.' }); }
  };
  await observe('database', 'Database connection', async () => {
    await query('SELECT 1 AS connected');
    return { status: 'working', detail: 'A read-only database query succeeded.' };
  });
  for (const [id, label, table] of [
    ['stripe', 'Stripe subscription webhook', 'stripe_webhook_events'],
    ['stripe-evidence', 'Stripe evidence webhook', 'stripe_evidence_webhook_events'],
  ]) {
    await observe(id, label, async () => {
      const { rows } = await query(`SELECT count(*) FILTER (WHERE status = 'processed')::int AS processed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'processing' AND updated_at < now() - interval '15 minutes')::int AS stalled,
        max(processed_at) AS "lastSuccessAt" FROM ${table} WHERE updated_at >= now() - interval '7 days'`);
      const row = rows[0];
      return { status: row.failed || row.stalled ? 'attention' : row.processed ? 'working' : 'unknown', lastSuccessAt: row.lastSuccessAt,
        detail: `Last 7 days: ${row.processed} processed, ${row.failed} failed, ${row.stalled} processing for over 15 minutes. Only deliveries received by FamilyTrack are visible; Stripe-side delivery failures are not verified.` };
    });
  }
  await observe('email', 'App email sending', async () => {
    const configured = config.emailProvider === 'resend' ? Boolean(config.resendApiKey) : Boolean(config.emailWebhookUrl);
    const { rows } = await query(`SELECT count(*) FILTER (WHERE metadata->>'deliveryStatus' = 'sent')::int AS sent,
      count(*) FILTER (WHERE metadata->>'deliveryStatus' = 'failed')::int AS failed,
      count(*) FILTER (WHERE metadata->>'deliveryStatus' = 'skipped')::int AS skipped,
      max(occurred_at) FILTER (WHERE metadata->>'deliveryStatus' = 'sent') AS "lastSuccessAt"
      FROM billing_audit_events WHERE occurred_at >= now() - interval '7 days'
      AND event_type IN ('email_sent','email_failed','email_skipped','trial_reminder_email_sent','trial_reminder_email_failed','trial_reminder_email_skipped')`);
    const row = rows[0];
    return { status: !configured || row.failed || row.skipped ? 'attention' : row.sent ? 'working' : 'unknown', lastSuccessAt: row.lastSuccessAt,
      detail: `${configured ? 'Provider configuration present.' : 'Provider configuration missing.'} Last 7 days: ${row.sent} accepted, ${row.failed} failed, ${row.skipped} skipped. Based on recorded send results; no test email was sent.` };
  });
  await observe('reminders', 'Reminder jobs', async () => {
    const {rows} = await query(`SELECT max(created_at) AS "lastRecordedAt",
      count(*) FILTER (WHERE delivery_status = 'failed')::int AS failed
      FROM notification_events WHERE created_at >= now() - interval '7 days'`);
    return { status: rows[0].failed ? 'attention' : 'unknown', lastRecordedAt: rows[0].lastRecordedAt,
      detail: `${rows[0].failed} failed reminder records in the last 7 days. Delivery records do not prove every scheduled job ran. No scheduler heartbeat is currently recorded.` };
  });
  checks.push({id:'backups', label:'Database backups', status:'unknown', detail:'Backup completion and restore checks are not connected to FamilyTrack. Verify these with the database host; a working database does not confirm a backup exists.'});
  await observe('uploads-backups', 'Uploaded-file backups', () => readBackupHealth({ now }));
  return { checkedAt: now.toISOString(), checks };
}
