-- Migration: 20260820160000_workspace_integrations.sql
-- Create workspace_integrations table for secure per-workspace channel credentials

CREATE TABLE IF NOT EXISTS public.workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('whatsapp', 'email', 'sms', 'voice')),
  provider TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_workspace_provider_type UNIQUE (workspace_id, provider_type)
);

-- Enable RLS
ALTER TABLE public.workspace_integrations ENABLE ROW LEVEL SECURITY;

-- Workspace members can view integrations in their workspace
CREATE POLICY "Workspace members can view integrations"
  ON public.workspace_integrations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_integrations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Workspace admins can insert/update/delete integrations
CREATE POLICY "Workspace members can manage integrations"
  ON public.workspace_integrations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_integrations.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_integrations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_workspace_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_workspace_integrations_updated_at ON public.workspace_integrations;
CREATE TRIGGER tr_workspace_integrations_updated_at
  BEFORE UPDATE ON public.workspace_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_workspace_integrations_updated_at();
