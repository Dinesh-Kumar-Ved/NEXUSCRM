-- Migration: Add attachments column and RLS policies to email_messages
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_messages' AND policyname = 'email_messages readable by workspace'
  ) THEN
    CREATE POLICY "email_messages readable by workspace" ON public.email_messages
      FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_messages' AND policyname = 'email_messages insert by workspace'
  ) THEN
    CREATE POLICY "email_messages insert by workspace" ON public.email_messages
      FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_messages' AND policyname = 'email_messages update by workspace'
  ) THEN
    CREATE POLICY "email_messages update by workspace" ON public.email_messages
      FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'email_messages' AND policyname = 'email_messages delete by workspace'
  ) THEN
    CREATE POLICY "email_messages delete by workspace" ON public.email_messages
      FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id));
  END IF;
END $$;
