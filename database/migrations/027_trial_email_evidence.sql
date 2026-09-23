-- Import only historical trial delivery facts. Never send emails.
INSERT INTO billing_audit_events (family_id,user_id,event_type,event_source,occurred_at,metadata,idempotency_key)
SELECT family_id,user_id,'trial_reminder_email_' || delivery_status,
  'notification_history',COALESCE(sent_at,created_at),
  jsonb_build_object('deliveryStatus',delivery_status,'daysLeft',metadata->'daysLeft',
    'evidenceMeaning','historical_provider_result_not_inbox_confirmed','notificationEventId',id),
  'trial-email-history:' || id::text
FROM notification_events
WHERE notification_type='trial' AND delivery_channel='email'
  AND delivery_status IN ('sent','failed','skipped')
ON CONFLICT DO NOTHING;
