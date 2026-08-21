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
  providerMessageId?: string | undefined;
  provider: string;
  error?: string | undefined;
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
      : env("EMAIL_HOST")
        ? "smtp"
        : null;
  const from = env("EMAIL_FROM") ?? null;
  const twilio = twilioMode();
  const smsNumber = env("TWILIO_PHONE_NUMBER") ?? null;
  const metaWaToken = env("WHATSAPP_ACCESS_TOKEN");
  const metaWaPhoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  const waNumber = metaWaPhoneId
    ? `Meta ID: ${metaWaPhoneId}`
    : (env("TWILIO_WHATSAPP_NUMBER") ?? null);
  const waProvider = metaWaToken && metaWaPhoneId ? "meta_whatsapp" : twilio ? "twilio" : null;

  return {
    email: { configured: Boolean(emailProvider && from), provider: emailProvider, from },
    sms: {
      configured: Boolean(twilio && smsNumber),
      provider: twilio ? "twilio" : null,
      from: smsNumber,
    },
    whatsapp: {
      configured: Boolean(waProvider && waNumber),
      provider: waProvider,
      from: waNumber,
    },
    voice: {
      configured: Boolean(twilio && smsNumber),
      provider: twilio ? "twilio" : null,
      from: smsNumber,
    },
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
  const smtpHost = env("EMAIL_HOST");

  if (resendKey && from) {
    const { sendEmailWithConfig } = await import("./integrations.server");
    const res = await sendEmailWithConfig({
      config: {
        provider: "resend",
        resendApiKey: resendKey,
        fromEmail: from,
        fromName: env("EMAIL_FROM_NAME"),
      },
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return {
      ok: res.ok,
      provider: "resend",
      status: res.ok ? "sent" : "failed",
      providerMessageId: res.messageId,
      error: res.error,
    };
  }

  if (smtpHost && from) {
    const { sendEmailWithConfig } = await import("./integrations.server");
    const res = await sendEmailWithConfig({
      config: {
        provider: "smtp",
        smtpHost,
        smtpPort: env("EMAIL_PORT") ? Number(env("EMAIL_PORT")) : 587,
        smtpUser: env("EMAIL_USER"),
        smtpPassword: env("EMAIL_PASSWORD"),
        smtpSecure: env("EMAIL_SECURE") === "true",
        fromEmail: from,
        fromName: env("EMAIL_FROM_NAME"),
      },
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return {
      ok: res.ok,
      provider: "smtp",
      status: res.ok ? "sent" : "failed",
      providerMessageId: res.messageId,
      error: res.error,
    };
  }

  if (sendgridKey && from) {
    const { sendEmailWithConfig } = await import("./integrations.server");
    const res = await sendEmailWithConfig({
      config: {
        provider: "sendgrid",
        sendgridApiKey: sendgridKey,
        fromEmail: from,
        fromName: env("EMAIL_FROM_NAME"),
      },
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return {
      ok: res.ok,
      provider: "sendgrid",
      status: res.ok ? "sent" : "failed",
      providerMessageId: res.messageId,
      error: res.error,
    };
  }

  return {
    ok: false,
    provider: "none",
    status: "failed",
    error:
      "No email provider configured. Please configure Resend in Settings or set RESEND_API_KEY in .env",
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
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${resource}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
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
    return {
      ok: false,
      provider: "twilio",
      status: "failed",
      error: "TWILIO_PHONE_NUMBER is not configured",
    };
  }
  const result = await twilioRequest("/Messages.json", {
    To: params.to,
    From: from,
    Body: params.text,
  });
  return parseTwilioResult(result, "SMS");
}

export async function sendWhatsApp(params: { to: string; text: string }): Promise<SendResult> {
  const metaToken = env("WHATSAPP_ACCESS_TOKEN");
  const metaPhoneId = env("WHATSAPP_PHONE_NUMBER_ID");

  if (metaToken && metaPhoneId) {
    const { sendMetaWhatsAppMessage } = await import("./integrations.server");
    const res = await sendMetaWhatsAppMessage({
      phoneNumberId: metaPhoneId,
      accessToken: metaToken,
      to: params.to,
      text: params.text,
    });
    return {
      ok: res.ok,
      provider: "meta_whatsapp",
      status: res.ok ? "sent" : "failed",
      providerMessageId: res.messageId,
      error: res.error,
    };
  }

  const from = env("TWILIO_WHATSAPP_NUMBER");
  if (!from) {
    return {
      ok: false,
      provider: "none",
      status: "failed",
      error:
        "WhatsApp provider not configured (set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID)",
    };
  }
  const normalize = (value: string) =>
    value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
  const result = await twilioRequest("/Messages.json", {
    To: normalize(params.to),
    From: normalize(from),
    Body: params.text,
  });
  return parseTwilioResult(result, "WhatsApp");
}

export async function placeCall(params: {
  to: string;
  message?: string | undefined;
  statusCallbackUrl?: string | undefined;
}): Promise<SendResult> {
  const from = env("TWILIO_PHONE_NUMBER");
  if (!from) {
    return {
      ok: false,
      provider: "twilio",
      status: "failed",
      error: "TWILIO_PHONE_NUMBER is not configured",
    };
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
