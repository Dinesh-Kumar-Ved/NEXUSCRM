// src/routes/_authenticated/api/integrations/google/gmail/sync.ts
import { createFileRoute } from "@tanstack/react-router";
import { syncGmailForWorkspace } from "@/lib/gmail-sync.server";

const json = (data: any, init?: ResponseInit) => 
  new Response(JSON.stringify(data), { 
    status: init?.status || 200, 
    headers: { "Content-Type": "application/json", ...init?.headers } 
  });

export const Route = createFileRoute("/_authenticated/api/integrations/google/gmail/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
    }
  }
});
