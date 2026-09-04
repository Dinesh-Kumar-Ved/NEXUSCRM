import { useQuery } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useProfile(user: User | null) {
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const [{ data: profile }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle(),
      ]);
      return {
        profile,
        roles: ["admin"],
        isAdmin: true,
      };
    },
  });
}

export function useTeam() {
  return useTeamForWorkspace(null);
}

export function useTeamForWorkspace(_workspaceId: string | null) {
  return useQuery({
    queryKey: ["team", _workspaceId],
    queryFn: async () => [],
  });
}

export function useWorkspace(userId: string | undefined) {
  return useQuery({
    queryKey: ["workspace", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, created_by")
        .eq("created_by", userId!)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error loading workspace:", error);
      }

      if (data) {
        return { workspace_id: data.id, role: "admin" };
      }

      // Fallback if created_by doesn't match
      const { data: firstWs } = await supabase
        .from("workspaces")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (firstWs) {
        return { workspace_id: firstWs.id, role: "admin" };
      }

      return null;
    },
  });
}
