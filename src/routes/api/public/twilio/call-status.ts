import { createFileRoute } from "@tanstack/react-router";

/** Twilio call status callback — updates the matching call log with duration/outcome. */
export const Route = createFileRoute("/api/public/twilio/call-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const params = new URLSearchParams(await request.text());
        const callSid = params.get("CallSid");
        if (!callSid) return new Response("ok");

        const status = params.get("CallStatus") ?? "completed";
        const duration = Number(params.get("CallDuration") ?? "0");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("call_logs")
          .update({ status, duration_seconds: Number.isFinite(duration) ? duration : 0 })
          .eq("provider_call_id", callSid);

        return new Response("ok");
      },
    },
  },
});
