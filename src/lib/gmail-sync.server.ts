// src/lib/gmail-sync.server.ts
// Service to sync Gmail messages into Supabase email_messages table.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshGmailAccessToken, fetchGmailProfile } from "./google-auth.server";
import { decryptToken } from "./crypto";
import { sanitizeHtml } from "./sanitize";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

interface GmailMessage {
  id: string; // provider message ID
  threadId: string;
  labelIds?: string[];
  snippet: string;
  historyId?: string;
  internalDate: string; // timestamp in ms
  payload: any;
  sizeEstimate?: number;
  raw?: string;
}

/**
 * Retrieves the Gmail access token for a workspace, refreshing if needed.
 */
export async function getAccessTokenForWorkspace(workspaceId: string): Promise<string> {
  // Fetch integration row for Gmail
  const { data: integration, error } = await supabaseAdmin
    .from("workspace_integrations")
    .select("encrypted_refresh_token, details")
    .eq("workspace_id", workspaceId)
    .eq("provider_type", "email")
    .maybeSingle();
  if (error || !integration) {
    throw new Error("Gmail integration not configured for workspace.");
  }
  const encrypted = integration.encrypted_refresh_token as any;
  const refreshToken = decryptToken(encrypted as any);
  const { accessToken } = await refreshGmailAccessToken(refreshToken);
  return accessToken;
}

/**
 * Fetches a list of message IDs for the workspace (simple query for all messages).
 */
async function listMessageIds(accessToken: string, query?: string): Promise<string[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  if (query) url.searchParams.set("q", query);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to list Gmail messages: ${txt}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[]; resultSizeEstimate?: number };
  return data.messages?.map((m) => m.id) ?? [];
}

/**
 * Retrieves full Gmail message by ID.
 */
async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to fetch Gmail message ${messageId}: ${txt}`);
  }
  return (await res.json()) as GmailMessage;
}

/**
 * Extracts RFC Message-ID, In-Reply-To, References from headers.
 */
function extractHeaders(payload: any): { rfcMessageId: string | undefined; inReplyTo: string | undefined; references: string | undefined } {
  const headers: { name: string; value: string }[] = payload?.headers ?? [];
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
  const rfcMessageId = get("Message-ID");
  const inReplyTo = get("In-Reply-To");
  const references = get("References");
  return { rfcMessageId, inReplyTo, references };
}

/**
 * Stores a Gmail message into email_messages table.
 */
async function storeMessage(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string | null,
  msg: GmailMessage,
  direction: "inbound" | "outbound",
) {
  const { rfcMessageId, inReplyTo, references } = extractHeaders(msg.payload);
  const fromHeader = msg.payload.headers.find((h: any) => h.name.toLowerCase() === "from");
  const toHeader = msg.payload.headers.find((h: any) => h.name.toLowerCase() === "to");
  const ccHeader = msg.payload.headers.find((h: any) => h.name.toLowerCase() === "cc");
  const bccHeader = msg.payload.headers.find((h: any) => h.name.toLowerCase() === "bcc");
  const subjectHeader = msg.payload.headers.find((h: any) => h.name.toLowerCase() === "subject");

  const bodyParts = (msg.payload?.parts ?? []).filter((p: any) => p.mimeType === "text/html" || p.mimeType === "text/plain");
  let bodyHtml = "";
  let bodyText = "";
  for (const part of bodyParts) {
    const data = part.body?.data;
    if (!data) continue;
    const decoded = Buffer.from(data, "base64").toString("utf8");
    if (part.mimeType === "text/html") bodyHtml += decoded;
    else if (part.mimeType === "text/plain") bodyText += decoded;
  }

  // Fallback if bodyHtml empty
  if (!bodyHtml && bodyText) {
    bodyHtml = `<p>${bodyText.replace(/\n/g, "<br/>")}</p>`;
  }

  // Sanitize inbound HTML
  const safeHtml = direction === "inbound" ? sanitizeHtml(bodyHtml) : bodyHtml;

  const from = fromHeader?.value ?? "";
  const to = toHeader?.value ?? "";

  // Insert with deduplication unique index on (workspace_id, provider_message_id)
  const { error } = await (supabase as unknown as any).from("email_messages").upsert(
    {
      workspace_id: workspaceId,
      client_id: clientId,
      thread_id: msg.threadId,
      provider_message_id: msg.id,
      rfc_message_id: rfcMessageId ?? "",
      direction,
      from_email: from,
      from_name: undefined,
      to_email: to,
      cc: ccHeader?.value ?? null,
      bcc: bccHeader?.value ?? null,
      subject: subjectHeader?.value ?? "",
      body_text: bodyText,
      body_html: safeHtml,
      in_reply_to: inReplyTo ?? null,
      references: references ?? null,
      received_at: new Date(parseInt(msg.internalDate, 10)),
    },
    { onConflict: "workspace_id,provider_message_id" },
  );
  if (error) {
    console.error("Failed to store email message", error);
  }
}

/**
 * Main sync function – fetches new messages, matches to clients, stores them.
 */
export async function syncGmailForWorkspace(workspaceId: string) {
  const accessToken = await getAccessTokenForWorkspace(workspaceId);
  const messageIds = await listMessageIds(accessToken);
  const supabase = supabaseAdmin;

  // Load client emails for matching
  const { data: clients } = await supabase
    .from("clients")
    .select("id,email")
    .eq("workspace_id", workspaceId);
  const emailToClient: Record<string, string> = {};
  clients?.forEach((c) => {
    if (c.email) emailToClient[c.email.toLowerCase()] = c.id;
  });

  for (const msgId of messageIds) {
    try {
      const msg = await getMessage(accessToken, msgId);
      // Determine direction based on From address matching workspace Gmail address
      const fromHeader = msg.payload.headers.find((h: any) => h.name.toLowerCase() === "from");
      const fromEmail = fromHeader?.value?.match(/<([^>]+)>/)?.[1] ?? fromHeader?.value?.trim();
      const gmailProfile = await fetchGmailProfile(accessToken);
      const isOutbound = fromEmail?.toLowerCase() === gmailProfile.emailAddress.toLowerCase();
      const clientId = isOutbound ? null : emailToClient[fromEmail?.toLowerCase() || ""] || null;
      await storeMessage(supabase, workspaceId, clientId, msg, isOutbound ? "outbound" : "inbound");
    } catch (e) {
      console.error("Error syncing Gmail message", msgId, e);
    }
  }
  return { synced: messageIds.length };
}
