// src/routes/_authenticated/api/integrations/google/gmail/sync.ts
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { syncGmailForWorkspace } from "@/lib/gmail-sync.server";

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return json({ error: "workspaceId query param is required" }, { status: 400 });
  }
  try {
    const result = await syncGmailForWorkspace(workspaceId);
    return json({
      ok: true,
      // Detailed counts
      found: result.found,
      processed: result.processed,
      inserted: result.inserted,
      matched: result.matched,
      unmatched: result.unmatched,
      errors: result.errors,
      myEmail: result.myEmail,
      // Legacy aliases
      synced: result.inserted,
      newMessages: result.inserted,
      total: result.found,
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}

export const loader = undefined; // No GET loader needed
