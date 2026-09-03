-- Migration: Isolate User Workspaces & Remove Team Member Sharing
-- Description: Ensures every user has their own dedicated workspace and isolates CRM data per user.

-- 1. Update handle_new_user() trigger function to create a new workspace for EVERY new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_workspace UUID;
  user_full_name TEXT;
BEGIN
  user_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    SPLIT_PART(NEW.email, '@', 1)
  );

  -- Insert profile
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, user_full_name, NEW.email)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email;

  -- Create a private workspace for the new user
  INSERT INTO public.workspaces (name, created_by)
  VALUES (user_full_name || '''s Workspace', NEW.id)
  RETURNING id INTO target_workspace;

  -- Assign user as admin of their own workspace
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin')
  ON CONFLICT (user_id, role) DO UPDATE SET role = 'admin';

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (target_workspace, NEW.id, 'admin')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- 2. Backfill/Isolate workspaces for all existing users
DO $$
DECLARE
  u RECORD;
  ws_id UUID;
  user_name TEXT;
BEGIN
  FOR u IN SELECT id, full_name, email FROM public.profiles LOOP
    -- Check if user already owns a workspace
    SELECT id INTO ws_id FROM public.workspaces WHERE created_by = u.id LIMIT 1;
    
    IF ws_id IS NULL THEN
      user_name := COALESCE(u.full_name, SPLIT_PART(u.email, '@', 1));
      INSERT INTO public.workspaces (name, created_by)
      VALUES (user_name || '''s Workspace', u.id)
      RETURNING id INTO ws_id;
    END IF;

    -- Remove any membership in workspaces owned by other users
    DELETE FROM public.workspace_members
    WHERE user_id = u.id AND workspace_id != ws_id;

    -- Ensure workspace membership and admin role for their own workspace
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (ws_id, u.id, 'admin')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (u.id, 'admin')
    ON CONFLICT (user_id, role) DO UPDATE SET role = 'admin';
  END LOOP;
END;
$$;
