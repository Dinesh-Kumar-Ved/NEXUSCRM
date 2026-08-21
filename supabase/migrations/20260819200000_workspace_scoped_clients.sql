CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'sales_rep',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
GRANT SELECT ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID, _user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

CREATE POLICY "workspace members can view their workspaces" ON public.workspaces
  FOR SELECT TO authenticated USING (public.is_workspace_member(id));
CREATE POLICY "workspace members can view membership" ON public.workspace_members
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
REVOKE ALL ON FUNCTION public.is_workspace_member(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID, UUID) TO authenticated;

INSERT INTO public.workspaces (name, created_by)
SELECT 'NexusCRM Workspace', ur.user_id
FROM public.user_roles ur
WHERE ur.role = 'admin'
ORDER BY ur.created_at
LIMIT 1;

INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT w.id, p.id, COALESCE(ur.role, 'sales_rep'::public.app_role)
FROM public.workspaces w
CROSS JOIN public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.id
ON CONFLICT DO NOTHING;

ALTER TABLE public.clients ADD COLUMN workspace_id UUID;
ALTER TABLE public.clients ADD COLUMN website TEXT;

UPDATE public.clients
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

ALTER TABLE public.clients
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT clients_workspace_id_fkey FOREIGN KEY (workspace_id)
    REFERENCES public.workspaces(id) ON DELETE CASCADE;

DROP POLICY "clients readable by team" ON public.clients;
DROP POLICY "clients insert by team" ON public.clients;
DROP POLICY "clients update by team" ON public.clients;
DROP POLICY "clients delete by admin" ON public.clients;

CREATE POLICY "clients readable by workspace" ON public.clients
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "clients insert by workspace" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "clients update by workspace" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "clients delete by workspace admin" ON public.clients
  FOR DELETE TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = clients.workspace_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

CREATE INDEX clients_workspace_updated_idx ON public.clients(workspace_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_workspace UUID;
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  PERFORM pg_advisory_xact_lock(hashtext('nexuscrm:first_workspace_admin'));

  SELECT id INTO target_workspace FROM public.workspaces ORDER BY created_at LIMIT 1;
  IF target_workspace IS NULL THEN
    assigned_role := 'admin';
    INSERT INTO public.workspaces (name, created_by)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'full_name', 'NexusCRM') || '''s Workspace', NEW.id)
    RETURNING id INTO target_workspace;
  ELSE
    assigned_role := 'sales_rep';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (target_workspace, NEW.id, assigned_role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.workspaces, public.workspace_members TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;