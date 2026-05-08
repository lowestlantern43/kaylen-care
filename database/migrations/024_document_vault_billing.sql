ALTER TABLE families
  ADD COLUMN IF NOT EXISTS document_vault_override jsonb;

INSERT INTO platform_settings (key, value)
VALUES (
  'document_vault',
  '{"enabled": true, "tiers": [{"id": "storage-50gb", "label": "50GB storage", "monthlyPriceGbp": 1, "includedStorageGb": 50, "stripePriceId": "price_1TUlQrFCbC5qpS8MXTjrpqjm"}, {"id": "storage-100gb", "label": "100GB storage", "monthlyPriceGbp": 2, "includedStorageGb": 100, "stripePriceId": "price_1TUlSSFCbC5qpS8MU8DdEyZW"}], "notes": "Default Document Vault add-on pricing."}'::jsonb
)
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value;
