import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase admin environment variables (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(url, serviceKey);
}

export const deleteClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        workspaceId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // 1. Verify caller belongs to workspace
    const { data: member } = await context.supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!member) {
      return { ok: false, error: "Unauthorized for this workspace" };
    }

    const admin = getAdminClient();

    // 2. Clean up child records to prevent foreign key constraints
    await admin.from("activities").delete().eq("client_id", data.clientId);
    await admin.from("messages").delete().eq("client_id", data.clientId);
    await admin.from("call_logs").delete().eq("client_id", data.clientId);
    await admin.from("documents").delete().eq("client_id", data.clientId);
    await admin.from("status_history").delete().eq("client_id", data.clientId);
    await admin.from("tasks").delete().eq("client_id", data.clientId);

    // 3. Delete client
    const { error } = await admin
      .from("clients")
      .delete()
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  });

export const deleteBulkClientsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clientIds: z.array(z.string().uuid()).min(1).max(500),
        workspaceId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // 1. Verify caller belongs to workspace
    const { data: member } = await context.supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!member) {
      return { ok: false, error: "Unauthorized for this workspace" };
    }

    const admin = getAdminClient();

    // 2. Clean up child records
    await admin.from("activities").delete().in("client_id", data.clientIds);
    await admin.from("messages").delete().in("client_id", data.clientIds);
    await admin.from("call_logs").delete().in("client_id", data.clientIds);
    await admin.from("documents").delete().in("client_id", data.clientIds);
    await admin.from("status_history").delete().in("client_id", data.clientIds);
    await admin.from("tasks").delete().in("client_id", data.clientIds);

    // 3. Delete clients
    const { error } = await admin
      .from("clients")
      .delete()
      .in("id", data.clientIds)
      .eq("workspace_id", data.workspaceId);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  });
