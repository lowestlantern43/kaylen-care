ALTER TABLE families
  ADD COLUMN IF NOT EXISTS document_vault_override jsonb;

INSERT INTO platform_settings (key, value)
VALUES (
  'document_vault',
  '{"enabled": true, "tiers": [{"id": "storage-100gb", "label": "100GB storage", "monthlyPriceGbp": 2, "includedStorageGb": 100}], "notes": "Default Document Vault add-on pricing."}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
