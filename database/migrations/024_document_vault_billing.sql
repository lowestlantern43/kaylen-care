ALTER TABLE families
  ADD COLUMN IF NOT EXISTS document_vault_override jsonb;

INSERT INTO platform_settings (key, value)
VALUES (
  'document_vault',
  '{"enabled": true, "tiers": [{"id": "storage-50gb", "label": "50GB Secure Document Storage", "monthlyPriceGbp": 2, "includedStorageGb": 50, "stripePriceId": ""}, {"id": "storage-100gb", "label": "100GB Secure Document Storage", "monthlyPriceGbp": 3, "includedStorageGb": 100, "stripePriceId": ""}], "notes": "Secure Document Storage add-on pricing. Add Stripe Price IDs through owner settings or backend environment variables."}'::jsonb
)
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value;
