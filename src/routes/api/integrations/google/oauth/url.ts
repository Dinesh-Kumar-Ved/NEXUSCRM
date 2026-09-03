import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createGoogleAuthUrl } from "@/lib/google-auth.server";

export const Route = createFileRoute("/api/integrations/google/oauth/url")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const workspaceId = url.searchParams.get("workspaceId");

          if (!workspaceId) {
            return new Response(
              JSON.stringify({ error: "Missing required workspaceId parameter." }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          // Check for authenticated user via Authorization header
          const authHeader = request.headers.get("authorization");
          let userId: string | null = null;

          if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.replace("Bearer ", "");
            const { data } = await supabaseAdmin.auth.getUser(token);
            if (data?.user) {
              userId = data.user.id;
            }
          }

          // If no Authorization header, verify workspace exists
          if (userId) {
            const { data: ws, error: wsErr } = await supabaseAdmin
              .from("workspaces")
              .select("id, created_by")
              .eq("id", workspaceId)
              .maybeSingle();

            if (wsErr || !ws) {
              return new Response(
                JSON.stringify({ error: "Forbidden: Workspace not found or unauthorized." }),
                { status: 403, headers: { "Content-Type": "application/json" } },
              );
            }
          } else {
            const { data: ws } = await supabaseAdmin
              .from("workspaces")
              .select("created_by")
              .eq("id", workspaceId)
              .maybeSingle();

            if (ws?.created_by) {
              userId = ws.created_by;
            }
          }

          if (!userId) {
            return new Response(
              JSON.stringify({ error: "Invalid workspace or user could not be determined." }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }

          const authUrl = await createGoogleAuthUrl({ workspaceId, userId });

          const wantsJson =
            url.searchParams.get("format") === "json" ||
            request.headers.get("accept")?.includes("application/json");

          if (wantsJson) {
            return new Response(JSON.stringify({ url: authUrl }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          return Response.redirect(authUrl, 302);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Failed to generate Google OAuth URL";
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
