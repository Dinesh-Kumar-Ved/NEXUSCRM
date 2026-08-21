-- Migration: add email_messages table
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id UUID NULL REFERENCES clients(id) ON DELETE SET NULL,
  thread_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  in_reply_to TEXT,
  "references" TEXT,
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_workspace_provider_idx ON email_messages(workspace_id, provider_message_id);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS email_messages_workspace_idx ON email_messages(workspace_id);
CREATE INDEX IF NOT EXISTS email_messages_client_idx ON email_messages(client_id);
CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS email_messages_received_idx ON email_messages(received_at);
