/**
 * Provider-agnostic messaging layer (server only).
 *
 * Email:    Resend  (RESEND_API_KEY)  or SendGrid (SENDGRID_API_KEY)
 * SMS/WA/Voice: Twilio, either through the Lovable connector gateway
 *           (LOVABLE_API_KEY + TWILIO_API_KEY) or directly
 *           (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN).
 *
 * Swapping providers means adding a branch here — no call-site changes.
 */

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  provider: string;
  error?: string;
  status: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export interface ProviderStatus {
  email: { configured: boolean; provider: string | null; from: string | null };
  sms: { configured: boolean; provider: string | null; from: string | null };
  whatsapp: { configured: boolean; provider: string | null; from: string | null };
  voice: { configured: boolean; provider: string | null; from: string | null };
}

function twilioMode(): "gateway" | "direct" | null {
  if (env("LOVABLE_API_KEY") && env("TWILIO_API_KEY")) return "gateway";
  if (env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN")) return "direct";
  return null;
}

export function getProviderStatus(): ProviderStatus {
  const emailProvider = env("RESEND_API_KEY")
    ? "resend"
    : env("SENDGRID_API_KEY")
      ? "sendgrid"
      : null;
  const from = env("EMAIL_FROM") ?? null;
  const twilio = twilioMode();
  const smsNumber = env("TWILIO_PHONE_NUMBER") ?? null;
  const waNumber = env("TWILIO_WHATSAPP_NUMBER") ?? null;

  return {
    email: { configured: Boolean(emailProvider && from), provider: emailProvider, from },
    sms: { configured: Boolean(twilio && smsNumber), provider: twilio ? "twilio" : null, from: smsNumber },
    whatsapp: {
      configured: Boolean(twilio && waNumber),
      provider: twilio ? "twilio" : null,
      from: waNumber,
    },
    voice: { configured: Boolean(twilio && smsNumber), provider: twilio ? "twilio" : null, from: smsNumber },
  };
}

/* ------------------------------- Email -------------------------------- */

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  const from = env("EMAIL_FROM");
  const resendKey = env("RESEND_API_KEY");
  const sendgridKey = env("SENDGRID_API_KEY");

  if (!from) {
    return { ok: false, provider: "none", status: "failed", error: "EMAIL_FROM is not configured" };
  }

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;white-space:pre-wrap">${escapeHtml(
    params.text,
  )}</div>`;

  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [params.to], subject: params.subject, html, text: params.text }),
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(`Resend send failed [${response.status}]: ${body}`);
      return { ok: false, provider: "resend", status: "failed", error: `${response.status}: ${body}` };
    }
    let id: string | undefined;
    try {
      id = (JSON.parse(body) as { id?: string }).id;
    } catch {
      id = undefined;
    }
    return { ok: true, provider: "resend", status: "sent", providerMessageId: id };
  }

  if (sendgridKey) {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: params.to }] }],
        from: { email: from },
        subject: params.subject,
        content: [
          { type: "text/plain", value: params.text },
          { type: "text/html", value: html },
        ],
        tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true } },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error(`SendGrid send failed [${response.status}]: ${body}`);
      return { ok: false, provider: "sendgrid", status: "failed", error: `${response.status}: ${body}` };
    }
    return {
      ok: true,
      provider: "sendgrid",
      status: "sent",
      providerMessageId: response.headers.get("x-message-id") ?? undefined,
    };
  }

  return {
    ok: false,
    provider: "none",
    status: "failed",
    error: "No email provider configured (set RESEND_API_KEY or SENDGRID_API_KEY)",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------- Twilio ------------------------------- */

async function twilioRequest(
  resource: string,
  form: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const mode = twilioMode();
  if (!mode) {
    return { ok: false, status: 0, body: "Twilio is not configured" };
  }

  const body = new URLSearchParams(form);

  if (mode === "gateway") {
    const response = await fetch(`https://connector-gateway.lovable.dev/twilio${resource}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("LOVABLE_API_KEY")!}`,
        "X-Connection-Api-Key": env("TWILIO_API_KEY")!,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }

  const sid = env("TWILIO_ACCOUNT_SID")!;
  const token = env("TWILIO_AUTH_TOKEN")!;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}${resource}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  return { ok: response.ok, status: response.status, body: await response.text() };
}

function parseTwilioResult(
  result: { ok: boolean; status: number; body: string },
  kind: string,
): SendResult {
  if (!result.ok) {
    console.error(`Twilio ${kind} failed [${result.status}]: ${result.body}`);
    return {
      ok: false,
      provider: "twilio",
      status: "failed",
      error: `${result.status}: ${result.body}`,
    };
  }
  let payload: { sid?: string; status?: string } = {};
  try {
    payload = JSON.parse(result.body) as { sid?: string; status?: string };
  } catch {
    payload = {};
  }
  return {
    ok: true,
    provider: "twilio",
    status: payload.status ?? "sent",
    providerMessageId: payload.sid,
  };
}

export async function sendSms(params: { to: string; text: string }): Promise<SendResult> {
  const from = env("TWILIO_PHONE_NUMBER");
  if (!from) {
    return { ok: false, provider: "twilio", status: "failed", error: "TWILIO_PHONE_NUMBER is not configured" };
  }
  const result = await twilioRequest("/Messages.json", {
    To: params.to,
    From: from,
    Body: params.text,
  });
  return parseTwilioResult(result, "SMS");
}

export async function sendWhatsApp(params: { to: string; text: string }): Promise<SendResult> {
  const from = env("TWILIO_WHATSAPP_NUMBER");
  if (!from) {
    return {
      ok: false,
      provider: "twilio",
      status: "failed",
      error: "TWILIO_WHATSAPP_NUMBER is not configured",
    };
  }
  const normalize = (value: string) => (value.startsWith("whatsapp:") ? value : `whatsapp:${value}`);
  const result = await twilioRequest("/Messages.json", {
    To: normalize(params.to),
    From: normalize(from),
    Body: params.text,
  });
  return parseTwilioResult(result, "WhatsApp");
}

export async function placeCall(params: {
  to: string;
  message?: string;
  statusCallbackUrl?: string;
}): Promise<SendResult> {
  const from = env("TWILIO_PHONE_NUMBER");
  if (!from) {
    return { ok: false, provider: "twilio", status: "failed", error: "TWILIO_PHONE_NUMBER is not configured" };
  }
  const agentNumber = env("AGENT_PHONE_NUMBER");
  const twiml = agentNumber
    ? `<Response><Dial callerId="${from}">${agentNumber}</Dial></Response>`
    : `<Response><Say voice="alice">${escapeHtml(
        params.message ?? "Connecting you with our team. Please hold.",
      )}</Say></Response>`;

  const form: Record<string, string> = { To: params.to, From: from, Twiml: twiml };
  if (params.statusCallbackUrl) {
    form["StatusCallback"] = params.statusCallbackUrl;
    form["StatusCallbackEvent"] = "completed";
  }
  const result = await twilioRequest("/Calls.json", form);
  return parseTwilioResult(result, "call");
}
