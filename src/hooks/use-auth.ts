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
      // First: find workspace via membership table (respects per-user isolation)
      const { data: membership, error: memberError } = await supabase
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", userId!)
        .limit(1)
        .maybeSingle();

      if (memberError) {
        console.error("Error loading workspace membership:", memberError);
      }

      if (membership) {
        return {
          workspace_id: membership.workspace_id,
          role: membership.role || "admin",
        };
      }

      // Second: try created_by as fallback for legacy workspaces
      const { data: ownedWs } = await supabase
        .from("workspaces")
        .select("id")
        .eq("created_by", userId!)
        .limit(1)
        .maybeSingle();

      if (ownedWs) {
        return { workspace_id: ownedWs.id, role: "admin" };
      }

      // No workspace found — user gets a fresh empty dashboard
      return null;
    },
  });
}
