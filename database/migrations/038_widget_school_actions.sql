ALTER TABLE widget_access_grants ADD COLUMN IF NOT EXISTS school_actions BOOLEAN NOT NULL DEFAULT false;
