CREATE TABLE IF NOT EXISTS admin_email_messages (
 id UUID PRIMARY KEY, created_by UUID REFERENCES users(id) ON DELETE SET NULL, subject TEXT NOT NULL,
 body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 sent_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_email_recipients (
 message_id UUID NOT NULL REFERENCES admin_email_messages(id), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempted_at TIMESTAMPTZ,
 PRIMARY KEY(message_id, user_id), UNIQUE(message_id,email)
);
