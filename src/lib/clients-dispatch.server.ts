import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function removeClientFromDb({
  clientId,
  workspaceId,
  userId,
}: {
  clientId: string;
  workspaceId: string;
  userId: string;
}) {
  // 1. Verify caller belongs to workspace
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr || !member) {
    return { ok: false, error: "Unauthorized: User is not a member of this workspace" };
  }

  // 2. Clean up child records to prevent foreign key constraint violations
  await supabaseAdmin.from("activities").delete().eq("client_id", clientId);
  await supabaseAdmin.from("messages").delete().eq("client_id", clientId);
  await supabaseAdmin.from("call_logs").delete().eq("client_id", clientId);
  await supabaseAdmin.from("documents").delete().eq("client_id", clientId);
  await supabaseAdmin.from("status_history").delete().eq("client_id", clientId);
  await supabaseAdmin.from("tasks").delete().eq("client_id", clientId);

  // 3. Delete client
  const { error } = await supabaseAdmin
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("workspace_id", workspaceId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function removeBulkClientsFromDb({
  clientIds,
  workspaceId,
  userId,
}: {
  clientIds: string[];
  workspaceId: string;
  userId: string;
}) {
  // 1. Verify caller belongs to workspace
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr || !member) {
    return { ok: false, error: "Unauthorized: User is not a member of this workspace" };
  }

  // 2. Clean up child records
  await supabaseAdmin.from("activities").delete().in("client_id", clientIds);
  await supabaseAdmin.from("messages").delete().in("client_id", clientIds);
  await supabaseAdmin.from("call_logs").delete().in("client_id", clientIds);
  await supabaseAdmin.from("documents").delete().in("client_id", clientIds);
  await supabaseAdmin.from("status_history").delete().in("client_id", clientIds);
  await supabaseAdmin.from("tasks").delete().in("client_id", clientIds);

  // 3. Delete clients
  const { error } = await supabaseAdmin
    .from("clients")
    .delete()
    .in("id", clientIds)
    .eq("workspace_id", workspaceId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
