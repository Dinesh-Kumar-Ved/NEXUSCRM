-- Migration: 20260821000000_add_gmail_oauth_support.sql
-- Add encrypted_refresh_token column to workspace_integrations and create OAuth CSRF state table

-- 1. Add encrypted_refresh_token to workspace_integrations
ALTER TABLE public.workspace_integrations
ADD COLUMN IF NOT EXISTS encrypted_refresh_token JSONB DEFAULT NULL;

-- 2. Create workspace_oauth_states table for secure CSRF protection
CREATE TABLE IF NOT EXISTS public.workspace_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- 3. Enable RLS on workspace_oauth_states
ALTER TABLE public.workspace_oauth_states ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for workspace_oauth_states
DROP POLICY IF EXISTS "Users can manage their own oauth states" ON public.workspace_oauth_states;
CREATE POLICY "Users can manage their own oauth states"
  ON public.workspace_oauth_states
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
