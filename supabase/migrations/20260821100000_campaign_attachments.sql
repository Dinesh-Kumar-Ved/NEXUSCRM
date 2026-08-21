-- Migration: Add campaign attachments table and storage bucket
CREATE TABLE IF NOT EXISTS public.campaign_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT,
  public_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.campaign_attachments TO authenticated;
GRANT ALL ON public.campaign_attachments TO service_role;

ALTER TABLE public.campaign_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign attachments readable by workspace" ON public.campaign_attachments
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE POLICY "campaign attachments insert by workspace" ON public.campaign_attachments
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "campaign attachments delete by workspace" ON public.campaign_attachments
  FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE INDEX IF NOT EXISTS campaign_attachments_workspace_idx ON public.campaign_attachments(workspace_id);
CREATE INDEX IF NOT EXISTS campaign_attachments_campaign_idx ON public.campaign_attachments(campaign_id);

-- Initialize campaign-attachments bucket in storage schema if storage exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-attachments', 'campaign-attachments', true)
ON CONFLICT (id) DO NOTHING;
