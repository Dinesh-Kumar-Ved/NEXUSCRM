REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.log_status_change() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;