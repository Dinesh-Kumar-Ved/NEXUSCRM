import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Twilio inbound SMS / WhatsApp webhook.
 * Configure this URL as the "A message comes in" webhook on your Twilio number.
 */
export const Route = createFileRoute("/api/public/twilio/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const params = new URLSearchParams(raw);

        if (!verifyTwilioSignature(request, raw)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const from = (params.get("From") ?? "").trim();
        const body = (params.get("Body") ?? "").trim();
        const to = (params.get("To") ?? "").trim();
        const sid = params.get("MessageSid");
        if (!from || !body) {
          return twiml("");
        }

        const isWhatsApp = from.startsWith("whatsapp:");
        const number = from.replace("whatsapp:", "");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const digits = number.replace(/[^\d]/g, "").slice(-9);
        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, name, phone, whatsapp, sms_opted_out")
          .or(`phone.ilike.%${digits}%,whatsapp.ilike.%${digits}%`)
          .limit(1);
        const client = clients?.[0] ?? null;

        // STOP / START keyword compliance handling.
        const keyword = body.toUpperCase();
        if (client && ["STOP", "UNSUBSCRIBE", "STOPALL", "QUIT"].includes(keyword)) {
          await supabaseAdmin.from("clients").update({ sms_opted_out: true }).eq("id", client.id);
        }
        if (client && ["START", "UNSTOP", "SUBSCRIBE"].includes(keyword)) {
          await supabaseAdmin.from("clients").update({ sms_opted_out: false }).eq("id", client.id);
        }

        await supabaseAdmin.from("messages").insert({
          client_id: client?.id ?? null,
          channel: isWhatsApp ? "whatsapp" : "sms",
          direction: "inbound",
          body,
          to_address: to,
          from_address: number,
          status: "received",
          provider: "twilio",
          provider_message_id: sid,
        });

        if (client) {
          await supabaseAdmin.from("activities").insert({
            client_id: client.id,
            type: isWhatsApp ? "whatsapp" : "sms",
            title: `Inbound ${isWhatsApp ? "WhatsApp" : "SMS"} reply`,
            body: body.slice(0, 500),
          });
        }

        return twiml("");
      },
    },
  },
});

function twiml(inner: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Validates Twilio's X-Twilio-Signature. Requires TWILIO_AUTH_TOKEN.
 * When no auth token is available (connector-gateway-only setups) the request
 * is rejected unless TWILIO_SKIP_SIGNATURE_CHECK is explicitly set.
 */
function verifyTwilioSignature(request: Request, rawBody: string): boolean {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const signature = request.headers.get("x-twilio-signature");

  if (!token) {
    return process.env["TWILIO_SKIP_SIGNATURE_CHECK"] === "true";
  }
  if (!signature) return false;

  const params = new URLSearchParams(rawBody);
  const sorted = [...params.keys()].sort();
  const url = new URL(request.url);
  const publicUrl = `${process.env["PUBLIC_APP_URL"] ?? url.origin}${url.pathname}`;
  const payload = sorted.reduce((acc, key) => acc + key + (params.get(key) ?? ""), publicUrl);
  const expected = createHmac("sha1", token).update(Buffer.from(payload, "utf-8")).digest("base64");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
