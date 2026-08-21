-- Migration: Ensure email-attachments storage bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for email-attachments bucket
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'email attachments readable by workspace'
  ) THEN
    CREATE POLICY "email attachments readable by workspace" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'email-attachments' AND
        public.is_workspace_member(((storage.foldername(name))[1])::uuid)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'email attachments insert by workspace'
  ) THEN
    CREATE POLICY "email attachments insert by workspace" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'email-attachments' AND
        public.is_workspace_member(((storage.foldername(name))[1])::uuid)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'email attachments delete by workspace'
  ) THEN
    CREATE POLICY "email attachments delete by workspace" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'email-attachments' AND
        public.is_workspace_member(((storage.foldername(name))[1])::uuid)
      );
  END IF;
END $$;
