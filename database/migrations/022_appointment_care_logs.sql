ALTER TABLE care_logs
  DROP CONSTRAINT IF EXISTS care_logs_category_valid;

ALTER TABLE care_logs
  ADD CONSTRAINT care_logs_category_valid CHECK (
    category IN (
      'food',
      'medication',
      'sleep',
      'toileting',
      'health',
      'behaviour',
      'appointment',
      'general'
    )
  );
