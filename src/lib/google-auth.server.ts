import crypto from "node:crypto";
import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import { decryptToken, encryptToken, type EncryptedPayload } from "./crypto.ts";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim();
  const redirectUri =
    process.env["GOOGLE_REDIRECT_URI"]?.trim() ||
    "http://localhost:8080/api/integrations/google/oauth/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Google OAuth credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/**
 * Creates a cryptographically secure OAuth 2.0 authorization URL for Gmail API with CSRF state protection.
 */
export async function createGoogleAuthUrl(params: {
  workspaceId: string;
  userId: string;
}): Promise<string> {
  const { clientId, redirectUri } = getGoogleOAuthConfig();

  // Generate cryptographically secure random state (32 bytes = 64 hex chars)
  const state = crypto.randomBytes(32).toString("hex");

  // Clean up any existing expired states
  await supabaseAdmin
    .from("workspace_oauth_states")
    .delete()
    .lt("expires_at", new Date().toISOString());

  // Store the state with workspace and user binding (15 min TTL)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error: insertError } = await supabaseAdmin.from("workspace_oauth_states").insert({
    state,
    workspace_id: params.workspaceId,
    user_id: params.userId,
    provider: "google",
    expires_at: expiresAt,
  });

  if (insertError) {
    throw new Error(`Failed to initialize OAuth state: ${insertError.message}`);
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "select_account consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  return authUrl.toString();
}

/**
 * Exchanges the authorization code with Google for tokens.
 */
export async function exchangeGoogleAuthCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string | undefined;
  expiresIn: number;
  scope?: string | undefined;
}> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || data.error || !data.access_token) {
    const errorDetail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Failed to exchange Google authorization code: ${errorDetail}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 3600,
    scope: data.scope,
  };
}

/**
 * Fetches the authenticated Gmail address for the current access token.
 */
export async function fetchGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  // 1. Try Google UserInfo endpoint (works with userinfo.email scope)
  try {
    const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (userinfoRes.ok) {
      const data = (await userinfoRes.json()) as { email?: string; emailAddress?: string };
      const email = data.email || data.emailAddress;
      if (email) {
        return { emailAddress: email };
      }
    }
  } catch {
    // ignore and fallback to Gmail profile endpoint
  }

  // 2. Fallback to Gmail users.getProfile endpoint (works if gmail.readonly / gmail.metadata scope is granted)
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch Gmail profile (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { emailAddress?: string };
  if (!data.emailAddress) {
    throw new Error("Gmail profile response did not contain an email address.");
  }

  return { emailAddress: data.emailAddress };
}

/**
 * Exchanges a refresh token for a fresh access token.
 */
export async function refreshGmailAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || data.error || !data.access_token) {
    const isRevoked =
      data.error === "invalid_grant" ||
      (data.error_description || "").toLowerCase().includes("revoked") ||
      (data.error_description || "").toLowerCase().includes("expired");

    if (isRevoked) {
      throw new Error(
        "Your Gmail connection has expired or authorization was revoked. Please reconnect your Gmail account.",
      );
    }

    throw new Error(
      `Failed to refresh Gmail access token: ${data.error_description || data.error || response.statusText}`,
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  };
}

/**
 * Encodes a string into Gmail-compliant base64url format.
 */
export function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function wrapBase64(b64: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    lines.push(b64.slice(i, i + lineLength));
  }
  return lines.join("\r\n");
}

function formatSubjectHeader(subject: string): string {
  const clean = (subject || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean) return "Subject: ";

  // Purely printable ASCII without RFC 2047 special tokens
  const isPlainAscii = /^[\x20-\x7E]+$/.test(clean) && !clean.includes("=?") && !clean.includes("?=");
  if (isPlainAscii && clean.length <= 70) {
    return `Subject: ${clean}`;
  }

  // RFC 2047 base64 encoded-word
  const b64 = Buffer.from(clean, "utf8").toString("base64");
  return `Subject: =?UTF-8?B?${b64}?=`;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

/**
 * Builds an RFC 2822 / MIME formatted email string.
 *
 * - Without attachments: multipart/alternative (text/plain + text/html)
 * - With attachments: multipart/mixed wrapping multipart/alternative + attachments
 */
export function buildMimeEmail(params: {
  from: string;
  to: string;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject: string;
  text: string;
  html?: string | undefined;
  attachments?: EmailAttachment[] | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}): string {
  const hasAttachments = params.attachments && params.attachments.length > 0;
  const outerBoundary = `====_NexusCRM_Mixed_${crypto.randomBytes(8).toString("hex")}====`;
  const altBoundary = `====_NexusCRM_Alt_${crypto.randomBytes(8).toString("hex")}====`;

  const headers: string[] = [
    `From: ${params.from.replace(/[\r\n]+/g, " ").trim()}`,
    `To: ${params.to.replace(/[\r\n]+/g, " ").trim()}`,
    formatSubjectHeader(params.subject),
    "MIME-Version: 1.0",
  ];

  if (params.cc && params.cc.length > 0) {
    headers.push(`Cc: ${params.cc.map((c) => c.replace(/[\r\n]+/g, " ").trim()).join(", ")}`);
  }
  if (params.bcc && params.bcc.length > 0) {
    headers.push(`Bcc: ${params.bcc.map((b) => b.replace(/[\r\n]+/g, " ").trim()).join(", ")}`);
  }
  if (params.inReplyTo && params.inReplyTo.trim().length > 0) {
    const clean = params.inReplyTo.replace(/[\r\n]+/g, " ").trim();
    if (clean.length > 0) {
      headers.push(`In-Reply-To: ${clean}`);
    }
  }
  if (params.references && params.references.trim().length > 0) {
    const clean = params.references.replace(/[\r\n]+/g, " ").trim();
    if (clean.length > 0) {
      headers.push(`References: ${clean}`);
    }
  }

  const textBody = params.text || "";
  const htmlBody =
    params.html ||
    `<p>${textBody
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>")}</p>`;

  const textBase64 = wrapBase64(Buffer.from(textBody, "utf8").toString("base64"));
  const htmlBase64 = wrapBase64(Buffer.from(htmlBody, "utf8").toString("base64"));

  const mimeParts: string[] = [];

  if (hasAttachments) {
    headers.push(`Content-Type: multipart/mixed; boundary="${outerBoundary}"`);
    mimeParts.push(headers.join("\r\n"), "");
    mimeParts.push(
      `--${outerBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
    );
    mimeParts.push(
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      textBase64,
      "",
    );
    mimeParts.push(
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      htmlBase64,
      "",
    );
    mimeParts.push(`--${altBoundary}--`, "");
    for (const att of params.attachments!) {
      const safeName = att.filename.replace(/[\r\n]+/g, " ").trim() || "attachment";
      const encodedName = Buffer.from(safeName, "utf8").toString("base64");
      const mime = att.mimeType && att.mimeType.trim().length > 0 ? att.mimeType.trim() : "application/octet-stream";
      const content = wrapBase64(att.contentBase64.replace(/\s+/g, ""));
      mimeParts.push(
        `--${outerBoundary}`,
        `Content-Type: ${mime}; name="=?UTF-8?B?${encodedName}?="`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="=?UTF-8?B?${encodedName}?="`,
        "",
        content,
        "",
      );
    }
    mimeParts.push(`--${outerBoundary}--`, "");
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    mimeParts.push(headers.join("\r\n"), "");
    mimeParts.push(
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      textBase64,
      "",
    );
    mimeParts.push(
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      htmlBase64,
      "",
    );
    mimeParts.push(`--${altBoundary}--`, "");
  }

  return mimeParts.join("\r\n");
}

/**
 * Sends an email using the official Gmail API (users.messages.send).
 *
 * Pass threadId + inReplyTo + references so replies stay inside the existing Gmail conversation.
 * Attachments are sent as multipart/mixed MIME parts.
 */
export async function sendGmailMessage(params: {
  accessToken: string;
  from: string;
  to: string;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject: string;
  text: string;
  html?: string | undefined;
  threadId?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  attachments?: EmailAttachment[] | undefined;
}): Promise<{ ok: boolean; messageId?: string | undefined; error?: string | undefined }> {
  try {
    const rawMime = buildMimeEmail({
      from: params.from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
      inReplyTo: params.inReplyTo,
      references: params.references,
    });
    const rawEncoded = base64UrlEncode(rawMime);

    const payload: { raw: string; threadId?: string } = { raw: rawEncoded };
    if (params.threadId && params.threadId.trim().length > 0) {
      payload.threadId = params.threadId.trim();
    }

    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as {
      id?: string;
      threadId?: string;
      error?: {
        message?: string;
        code?: number;
        status?: string;
      };
    };

    if (!response.ok || data.error) {
      const errMsg =
        data.error?.message || `Gmail API Error (${response.status}): ${response.statusText}`;
      console.error(`[GMAIL_DISPATCH] Error sending to ${params.to}:`, errMsg);
      return { ok: false, error: errMsg };
    }

    console.log(`[GMAIL_DISPATCH] Success for ${params.to} -> message ID: ${data.id}, thread: ${data.threadId || params.threadId || "N/A"}`);
    return { ok: true, messageId: data.id };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Failed to connect to Gmail API.";
    console.error(`[GMAIL_DISPATCH] Network/connection error for ${params.to}:`, errMsg);
    return {
      ok: false,
      error: errMsg,
    };
  }
}
