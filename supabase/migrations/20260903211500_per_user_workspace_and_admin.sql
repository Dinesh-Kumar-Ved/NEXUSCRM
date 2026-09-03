-- Migration: Ensure every new user gets their own workspace and admin role upon signup

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace UUID;
  user_name TEXT;
BEGIN
  user_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'My');

  -- Create profile row
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  -- Create a new unique workspace for this user
  INSERT INTO public.workspaces (name, created_by)
  VALUES (user_name || '''s Workspace', NEW.id)
  RETURNING id INTO new_workspace;

  -- Assign user_roles = 'admin'
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin')
  ON CONFLICT (user_id, role) DO UPDATE SET role = 'admin';

  -- Add user to workspace_members as 'admin'
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace, NEW.id, 'admin')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin', workspace_id = EXCLUDED.workspace_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.workspaces, public.workspace_members, public.user_roles TO service_role;
