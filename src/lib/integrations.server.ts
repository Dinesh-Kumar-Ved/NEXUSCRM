import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { decryptToken, type EncryptedPayload } from "./crypto";
import {
  refreshGmailAccessToken,
  sendGmailMessage as dispatchGmailMessage,
  type EmailAttachment,
} from "./google-auth.server";

export interface WhatsAppConfig {
  phoneNumberId: string;
  businessAccountId?: string | undefined;
  accessToken: string;
  verifyToken?: string | undefined;
}

export interface EmailConfig {
  provider: "resend" | "smtp" | "sendgrid" | "gmail";
  fromEmail: string;
  fromName?: string | undefined;
  workspaceId?: string | undefined;
  // Resend
  resendApiKey?: string | undefined;
  // SMTP
  smtpHost?: string | undefined;
  smtpPort?: number | undefined;
  smtpUser?: string | undefined;
  smtpPassword?: string | undefined;
  smtpSecure?: boolean | undefined;
  // SendGrid
  sendgridApiKey?: string | undefined;
}

export interface MaskedIntegrationInfo {
  providerType: "whatsapp" | "email";
  provider: string;
  isConnected: boolean;
  status: "connected" | "disconnected" | "error";
  maskedDetails: {
    phoneNumberId?: string | null | undefined;
    businessAccountId?: string | null | undefined;
    displayPhoneNumber?: string | null | undefined;
    verifiedName?: string | null | undefined;
    qualityRating?: string | null | undefined;
    fromEmail?: string | null | undefined;
    fromName?: string | null | undefined;
    provider?: string | null | undefined;
    smtpHost?: string | null | undefined;
    smtpPort?: number | null | undefined;
    connectedEmail?: string | null | undefined;
  };
  details: {
    displayPhoneNumber?: string | null | undefined;
    verifiedName?: string | null | undefined;
    qualityRating?: string | null | undefined;
    fromEmail?: string | null | undefined;
    fromName?: string | null | undefined;
    connectedEmail?: string | null | undefined;
  };
  lastTestedAt: string | null;
  lastTestError: string | null;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

interface MetaGraphResponse {
  id?: string | undefined;
  display_phone_number?: string | undefined;
  verified_name?: string | undefined;
  quality_rating?: string | undefined;
  code_verification_status?: string | undefined;
  error?: {
    message?: string | undefined;
    error_user_msg?: string | undefined;
  };
}

interface MetaSendMessageResponse {
  messages?: Array<{ id?: string | undefined }>;
  error?: {
    message?: string | undefined;
  };
}

// ---------------------------------------------------------------------------
// 1. WhatsApp Business Platform / Meta WhatsApp Cloud API
// ---------------------------------------------------------------------------

export async function testMetaWhatsAppConnection(params: {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string | undefined;
}): Promise<{
  ok: boolean;
  details?:
    | {
        id: string;
        displayPhoneNumber?: string | undefined;
        verifiedName?: string | undefined;
        qualityRating?: string | undefined;
        codeVerificationStatus?: string | undefined;
      }
    | undefined;
  error?: string | undefined;
}> {
  const { phoneNumberId, accessToken } = params;

  if (!phoneNumberId || !accessToken) {
    return {
      ok: false,
      error: "Phone Number ID and Meta Access Token are required.",
    };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=verified_name,code_verification_status,display_phone_number,quality_rating,id`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = (await res.json()) as MetaGraphResponse;

    if (!res.ok || data.error) {
      const errMsg =
        data.error?.message ||
        `Meta API error (${res.status}): ${data.error?.error_user_msg || res.statusText}`;
      return {
        ok: false,
        error: errMsg,
      };
    }

    return {
      ok: true,
      details: {
        id: data.id || phoneNumberId,
        displayPhoneNumber: data.display_phone_number || undefined,
        verifiedName: data.verified_name || undefined,
        qualityRating: data.quality_rating || undefined,
        codeVerificationStatus: data.code_verification_status || undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to connect to Meta Graph API.",
    };
  }
}

export async function sendMetaWhatsAppMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}): Promise<{ ok: boolean; messageId?: string | undefined; error?: string | undefined }> {
  const { phoneNumberId, accessToken, to, text } = params;

  // Clean phone number to international digits without +
  const cleanTo = to.replace(/\D/g, "");

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanTo,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });

    const data = (await res.json()) as MetaSendMessageResponse;

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || `Meta WhatsApp error (${res.status})`;
      return { ok: false, error: errMsg };
    }

    const messageId = data.messages?.[0]?.id || undefined;
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error sending WhatsApp message.",
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Email Connection (Gmail, Resend, SMTP, SendGrid)
// ---------------------------------------------------------------------------

export async function testEmailConnection(params: {
  config: EmailConfig;
  testRecipient: string;
}): Promise<{ ok: boolean; messageId?: string | undefined; error?: string | undefined }> {
  const { config, testRecipient } = params;

  if (!testRecipient || !testRecipient.includes("@")) {
    return { ok: false, error: "A valid test recipient email address is required." };
  }

  const providerLabel =
    config.provider === "gmail" ? "Gmail (Official API)" : config.provider.toUpperCase();

  const subject = "NexusCRM: Email Connection Test";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; margin-top: 0;">Email Connection Verified</h2>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Your email integration configured via <strong>${providerLabel}</strong> has been successfully verified in NexusCRM.
      </p>
      <div style="background-color: #f8fafc; padding: 12px; border-radius: 6px; font-size: 13px; color: #64748b; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Sender:</strong> ${config.fromName ? `${config.fromName} &lt;${config.fromEmail}&gt;` : config.fromEmail}</p>
        <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </div>
      <p style="color: #94a3b8; font-size: 12px;">This is an automated test message from NexusCRM.</p>
    </div>
  `;
  const text = `Email Connection Verified\n\nYour email integration (${providerLabel}) was successfully verified in NexusCRM.\nSender: ${config.fromEmail}\nTimestamp: ${new Date().toISOString()}`;

  return sendEmailWithConfig({ config, to: testRecipient, subject, text, html });
}

// In-memory token cache for active workspace Google OAuth access tokens
const workspaceAccessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function invalidateWorkspaceAccessTokenCache(workspaceId?: string) {
  if (workspaceId) {
    workspaceAccessTokenCache.delete(workspaceId);
  } else {
    workspaceAccessTokenCache.clear();
  }
}

export async function sendEmailWithConfig(params: {
  config: EmailConfig;
  to: string;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject: string;
  text: string;
  html?: string | undefined;
  attachments?: EmailAttachment[] | undefined;
  threadId?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}): Promise<{ ok: boolean; messageId?: string | undefined; error?: string | undefined }> {
  const { config, to, cc, bcc, subject, text } = params;
  const html = params.html || `<p>${text.replace(/\n/g, "<br/>")}</p>`;
  const fromFormatted = config.fromName
    ? `${config.fromName} <${config.fromEmail}>`
    : config.fromEmail;

  // 1. GMAIL API DISPATCH
  if (config.provider === "gmail") {
    const workspaceId = config.workspaceId;
    if (!workspaceId) {
      return {
        ok: false,
        error: "Workspace ID is required to authenticate Gmail message dispatch.",
      };
    }

    try {
      // Retrieve integration credentials server-side using service role
      const { data: integration, error: dbError } = await supabaseAdmin
        .from("workspace_integrations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("provider_type", "email")
        .maybeSingle();

      if (dbError || !integration) {
        return {
          ok: false,
          error:
            "Gmail integration not found for this workspace. Please connect your Gmail account in Settings.",
        };
      }

      const encryptedToken =
        integration.encrypted_refresh_token as unknown as EncryptedPayload | null;
      if (!encryptedToken) {
        return {
          ok: false,
          error: "Gmail refresh token is missing. Please reconnect your Gmail account in Settings.",
        };
      }

      // Decrypt refresh token
      let refreshToken: string;
      try {
        refreshToken = decryptToken(encryptedToken);
      } catch (decryptErr) {
        console.error(
          "Failed to decrypt Gmail token:",
          decryptErr instanceof Error ? decryptErr.message : "Decryption failed",
        );
        return {
          ok: false,
          error:
            "Failed to decrypt Gmail credentials. Please reconnect your Gmail account in Settings.",
        };
      }

      // Refresh Google OAuth Access Token (with in-memory cache)
      let accessToken: string;
      const cached = workspaceAccessTokenCache.get(workspaceId);
      if (cached && cached.expiresAt > Date.now() + 60000) {
        accessToken = cached.token;
      } else {
        try {
          const tokenRes = await refreshGmailAccessToken(refreshToken);
          accessToken = tokenRes.accessToken;
          const expiresInMs = (tokenRes.expiresIn || 3500) * 1000;
          workspaceAccessTokenCache.set(workspaceId, {
            token: accessToken,
            expiresAt: Date.now() + expiresInMs,
          });
        } catch (refreshErr) {
          const errMsg =
            refreshErr instanceof Error ? refreshErr.message : "Gmail authorization expired.";
          workspaceAccessTokenCache.delete(workspaceId);
          // Update status to error in DB
          await supabaseAdmin
            .from("workspace_integrations")
            .update({
              status: "error",
              last_test_error: errMsg,
            })
            .eq("id", integration.id);

          return {
            ok: false,
            error: errMsg,
          };
        }
      }

      // Connected Gmail sender address is source of truth
      const integrationDetails = (integration.details ?? {}) as Record<string, any>;
      const integrationConfig = (integration.config ?? {}) as Record<string, any>;
      const realFromEmail =
        integrationDetails["fromEmail"] ||
        integrationDetails["connectedEmail"] ||
        integrationConfig["fromEmail"] ||
        config.fromEmail;

      const fromAddress = config.fromName ? `${config.fromName} <${realFromEmail}>` : realFromEmail;

      // Dispatch message via Gmail REST API
      const result = await dispatchGmailMessage({
        accessToken,
        from: fromAddress,
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        attachments: params.attachments,
        threadId: params.threadId,
        inReplyTo: params.inReplyTo,
        references: params.references,
      });

      if (!result.ok && result.error?.includes("401")) {
        // Invalidate token cache on 401
        workspaceAccessTokenCache.delete(workspaceId);
      }

      return result;
    } catch (err) {
      const errStr = err instanceof Error ? err.message : "Failed to send email via Gmail API.";
      return { ok: false, error: errStr };
    }
  }

  // 2. RESEND API DISPATCH
  if (config.provider === "resend") {
    const key = config.resendApiKey || env("RESEND_API_KEY");
    if (!key) {
      return {
        ok: false,
        error:
          "Missing Resend API Key. Please enter your API key in Settings or set RESEND_API_KEY in .env",
      };
    }

    try {
      const { Resend } = await import("resend");
      const resend = new Resend(key);

      const emailPayload: Parameters<typeof resend.emails.send>[0] = {
        from: fromFormatted,
        to: [to],
        subject,
        html,
        text,
      };

      if (cc && cc.length > 0) emailPayload.cc = cc;
      if (bcc && bcc.length > 0) emailPayload.bcc = bcc;

      const { data, error } = await resend.emails.send(emailPayload);

      if (error) {
        let friendlyMessage = error.message;
        const msgLower = (error.message || "").toLowerCase();

        if (
          msgLower.includes("api_key") ||
          msgLower.includes("unauthorized") ||
          msgLower.includes("forbidden") ||
          error.name === "missing_api_key"
        ) {
          friendlyMessage =
            "Invalid or unauthorized Resend API Key. Please verify your Sending API key in resend.com/api-keys.";
        } else if (
          msgLower.includes("domain") ||
          msgLower.includes("verify") ||
          msgLower.includes("not verified")
        ) {
          friendlyMessage =
            "Sender domain not verified in Resend. Use 'onboarding@resend.dev' (sends to your signup email) or verify your domain at resend.com/domains.";
        } else if (msgLower.includes("rate limit") || error.name === "rate_limit_exceeded") {
          friendlyMessage = "Resend rate limit reached. Please wait a moment before sending again.";
        } else if (msgLower.includes("restricted") || msgLower.includes("sandbox")) {
          friendlyMessage =
            "Resend Sandbox Restriction: When sending from 'onboarding@resend.dev', you can only send to your own registered Resend email address. To send to any recipient, verify your domain in Resend.";
        }

        return {
          ok: false,
          error: friendlyMessage,
        };
      }

      return { ok: true, messageId: data?.id || undefined };
    } catch (err) {
      const errStr = err instanceof Error ? err.message : "Failed to connect to Resend API.";
      return {
        ok: false,
        error:
          errStr.includes("fetch") || errStr.includes("network")
            ? "Unable to reach Resend API. Please check your internet connection."
            : errStr,
      };
    }
  }

  // 3. SMTP DISPATCH
  if (config.provider === "smtp") {
    const host = config.smtpHost || env("EMAIL_HOST");
    const port = config.smtpPort || (env("EMAIL_PORT") ? Number(env("EMAIL_PORT")) : 587);
    const user = config.smtpUser || env("EMAIL_USER");
    const pass = config.smtpPassword || env("EMAIL_PASSWORD");
    const secure = config.smtpSecure ?? port === 465;

    if (!host || !user || !pass) {
      return {
        ok: false,
        error: "SMTP Host, Username, and Password are required.",
      };
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });

      const info = await transporter.sendMail({
        from: fromFormatted,
        to,
        cc: cc && cc.length > 0 ? cc : undefined,
        bcc: bcc && bcc.length > 0 ? bcc : undefined,
        subject,
        text,
        html,
      });

      return { ok: true, messageId: info.messageId || undefined };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "SMTP delivery failed.",
      };
    }
  }

  // 4. SENDGRID DISPATCH
  if (config.provider === "sendgrid") {
    const key = config.sendgridApiKey || env("SENDGRID_API_KEY");
    if (!key) return { ok: false, error: "SendGrid API Key is missing." };

    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: config.fromEmail, name: config.fromName },
          subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html", value: html },
          ],
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        return {
          ok: false,
          error: `SendGrid error (${response.status}): ${bodyText}`,
        };
      }

      const msgId = response.headers.get("x-message-id") || undefined;
      return {
        ok: true,
        messageId: msgId,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to connect to SendGrid API.",
      };
    }
  }

  return { ok: false, error: `Unsupported email provider: ${config.provider}` };
}

// ---------------------------------------------------------------------------
// 3. Database Helpers & Workspace Integration State
// ---------------------------------------------------------------------------

export async function getWorkspaceIntegrationConfig(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  providerType: "whatsapp" | "email",
): Promise<{
  provider: string;
  config: Record<string, any>;
  details: Record<string, any>;
  status: "connected" | "disconnected" | "error";
  lastTestedAt: string | null;
  lastTestError: string | null;
} | null> {
  const { data } = await supabase
    .from("workspace_integrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider_type", providerType)
    .maybeSingle();

  if (data && data.is_active) {
    const conf = ((data.config as Record<string, any>) || {}) as Record<string, any>;
    // Inject workspaceId into config so dispatch has access
    conf["workspaceId"] = workspaceId;

    return {
      provider: data.provider,
      config: conf,
      details: (data.details as Record<string, any>) || {},
      status: (data.status as "connected" | "disconnected" | "error") || "disconnected",
      lastTestedAt: data.last_tested_at,
      lastTestError: data.last_test_error,
    };
  }

  // Fallback to environment variables if no DB record
  if (providerType === "whatsapp") {
    const accessToken = env("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
    const businessAccountId = env("WHATSAPP_BUSINESS_ACCOUNT_ID");

    if (accessToken && phoneNumberId) {
      return {
        provider: "meta_whatsapp",
        config: {
          accessToken,
          phoneNumberId,
          businessAccountId: businessAccountId || "",
        },
        details: {},
        status: "connected",
        lastTestedAt: null,
        lastTestError: null,
      };
    }
  }

  if (providerType === "email") {
    const resendKey = env("RESEND_API_KEY");
    const fromEmail = env("EMAIL_FROM");
    const fromName = env("EMAIL_FROM_NAME");

    if (resendKey && fromEmail) {
      return {
        provider: "resend",
        config: {
          provider: "resend",
          resendApiKey: resendKey,
          fromEmail,
          fromName: fromName || "",
          workspaceId,
        },
        details: {},
        status: "connected",
        lastTestedAt: null,
        lastTestError: null,
      };
    }

    const smtpHost = env("EMAIL_HOST");
    const smtpUser = env("EMAIL_USER");
    const smtpPassword = env("EMAIL_PASSWORD");
    if (smtpHost && smtpUser && smtpPassword && fromEmail) {
      return {
        provider: "smtp",
        config: {
          provider: "smtp",
          smtpHost,
          smtpPort: env("EMAIL_PORT") ? Number(env("EMAIL_PORT")) : 587,
          smtpUser,
          smtpPassword,
          smtpSecure: env("EMAIL_SECURE") === "true",
          fromEmail,
          fromName: fromName || "",
          workspaceId,
        },
        details: {},
        status: "connected",
        lastTestedAt: null,
        lastTestError: null,
      };
    }
  }

  return null;
}

export async function getMaskedIntegrationsState(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<{
  whatsapp: MaskedIntegrationInfo;
  email: MaskedIntegrationInfo;
}> {
  const wa = await getWorkspaceIntegrationConfig(supabase, workspaceId, "whatsapp");
  const em = await getWorkspaceIntegrationConfig(supabase, workspaceId, "email");

  const waConfig = (wa?.config ?? {}) as Record<string, any>;
  const waDetails = (wa?.details ?? {}) as Record<string, any>;

  const maskedWa: MaskedIntegrationInfo = {
    providerType: "whatsapp",
    provider: wa?.provider || "meta_whatsapp",
    isConnected: wa?.status === "connected",
    status: wa?.status || "disconnected",
    maskedDetails: {
      phoneNumberId: waConfig["phoneNumberId"] ? String(waConfig["phoneNumberId"]) : null,
      businessAccountId: waConfig["businessAccountId"]
        ? String(waConfig["businessAccountId"])
        : null,
      displayPhoneNumber: waDetails["displayPhoneNumber"]
        ? String(waDetails["displayPhoneNumber"])
        : null,
      verifiedName: waDetails["verifiedName"] ? String(waDetails["verifiedName"]) : null,
      qualityRating: waDetails["qualityRating"] ? String(waDetails["qualityRating"]) : null,
    },
    details: {
      displayPhoneNumber: waDetails["displayPhoneNumber"]
        ? String(waDetails["displayPhoneNumber"])
        : null,
      verifiedName: waDetails["verifiedName"] ? String(waDetails["verifiedName"]) : null,
      qualityRating: waDetails["qualityRating"] ? String(waDetails["qualityRating"]) : null,
    },
    lastTestedAt: wa?.lastTestedAt ?? null,
    lastTestError: wa?.lastTestError ?? null,
  };

  const emConfig = (em?.config ?? {}) as Record<string, any>;
  const emDetails = (em?.details ?? {}) as Record<string, any>;

  const emailProvider = em?.provider || (emConfig["provider"] as string) || "resend";
  const emailSender =
    (emDetails["fromEmail"] as string | undefined) ||
    (emDetails["connectedEmail"] as string | undefined) ||
    (emConfig["fromEmail"] as string | undefined) ||
    null;

  const maskedEm: MaskedIntegrationInfo = {
    providerType: "email",
    provider: emailProvider,
    isConnected: em?.status === "connected",
    status: em?.status || "disconnected",
    maskedDetails: {
      fromEmail: emailSender,
      fromName: emConfig["fromName"] ? String(emConfig["fromName"]) : null,
      provider: emailProvider,
      connectedEmail: emailSender,
      smtpHost: emConfig["smtpHost"] ? String(emConfig["smtpHost"]) : null,
      smtpPort: emConfig["smtpPort"] ? Number(emConfig["smtpPort"]) : null,
    },
    details: {
      fromEmail: emailSender,
      fromName: emDetails["fromName"] ? String(emDetails["fromName"]) : null,
      connectedEmail: emailSender,
    },
    lastTestedAt: em?.lastTestedAt ?? null,
    lastTestError: em?.lastTestError ?? null,
  };

  return {
    whatsapp: maskedWa,
    email: maskedEm,
  };
}
