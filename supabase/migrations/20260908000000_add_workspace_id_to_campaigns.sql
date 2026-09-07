-- Migration: Add workspace_id to campaigns table
-- This was missing, causing the Campaign History page to show "No campaigns yet"
-- because the UI query filters by workspace_id which did not exist on the table.

-- 1. Add workspace_id column (nullable initially to allow backfill)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- 2. Backfill workspace_id for existing campaigns using created_by -> workspace_members
UPDATE public.campaigns c
SET workspace_id = wm.workspace_id
FROM public.workspace_members wm
WHERE wm.user_id = c.created_by
  AND c.workspace_id IS NULL;

-- 3. Drop overly-permissive RLS policies and replace with workspace-scoped ones
DROP POLICY IF EXISTS "campaigns readable by team" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns insert by team" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns update by team" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns delete by admin" ON public.campaigns;

-- 4. New workspace-scoped RLS policies
CREATE POLICY "campaigns select own workspace" ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "campaigns insert own workspace" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "campaigns update own workspace" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "campaigns delete own workspace" ON public.campaigns
  FOR DELETE TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
