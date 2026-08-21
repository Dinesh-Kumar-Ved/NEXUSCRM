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

export interface GmailSyncResult {
  found: number;      // total message IDs returned by Gmail API
  processed: number;  // messages we attempted to fetch & store
  inserted: number;   // net-new messages inserted into DB
  matched: number;    // messages matched to a known client
  unmatched: number;  // messages left with client_id = NULL
  errors: number;     // messages that failed with an error
  myEmail: string;    // the connected Gmail address that was synced
}

/**
 * Retrieves the Gmail access token for a workspace, refreshing if needed.
 */
export async function getAccessTokenForWorkspace(workspaceId: string): Promise<string> {
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
 * Fetches a list of message IDs from the user's mailbox.
 */
async function listMessageIds(
  accessToken: string,
  query: string = "",
  maxResults: number = 50,
): Promise<string[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to list Gmail messages: ${txt}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[]; resultSizeEstimate?: number };
  const ids = data.messages?.map((m) => m.id) ?? [];
  console.log(`[GMAIL_SYNC] listMessageIds: found ${ids.length} message IDs (query="${query}", maxResults=${maxResults})`);
  return ids;
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
 * Retrieves all messages in a Gmail thread.
 */
async function getThreadMessages(accessToken: string, threadId: string): Promise<GmailMessage[]> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const txt = await res.text();
    console.warn(`[GMAIL_SYNC] Failed to fetch thread ${threadId}:`, txt);
    return [];
  }
  const data = (await res.json()) as { messages?: GmailMessage[] };
  return data.messages ?? [];
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
 * Recursively extracts text/plain and text/html parts from a Gmail payload.
 */
function extractBodyParts(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";

  function traverse(part: any) {
    if (!part) return;
    const mimeType = part.mimeType || "";
    if (mimeType === "text/plain" && part.body?.data) {
      text += Buffer.from(part.body.data, "base64").toString("utf8");
    } else if (mimeType === "text/html" && part.body?.data) {
      html += Buffer.from(part.body.data, "base64").toString("utf8");
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  }

  traverse(payload);
  return { text, html };
}

/**
 * Recursively extracts attachment metadata from a Gmail payload.
 */
function extractAttachments(payload: any): Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }> = [];

  function traverse(part: any) {
    if (!part) return;
    if (part.filename && part.filename.trim().length > 0 && part.body) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId || undefined,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  }

  traverse(payload);
  return attachments;
}

/**
 * Sanitizes a filename for storage path safety.
 */
function sanitizeStorageFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Stores a Gmail message into email_messages table with deduplication, HTML sanitization, and attachment uploading.
 */
async function storeMessage(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string | null,
  msg: GmailMessage,
  direction: "inbound" | "outbound",
): Promise<{ inserted: boolean; error?: string }> {
  const { rfcMessageId, inReplyTo, references } = extractHeaders(msg.payload);
  const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const fromHeader = getHeader("From") ?? "";
  const toHeader = getHeader("To") ?? "";
  const ccHeader = getHeader("Cc") ?? null;
  const bccHeader = getHeader("Bcc") ?? null;
  const subjectHeader = getHeader("Subject") ?? "(No Subject)";

  const { text: bodyText, html: rawHtml } = extractBodyParts(msg.payload);
  let bodyHtml = rawHtml;

  if (!bodyHtml && bodyText) {
    bodyHtml = `<p>${bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`;
  }

  const safeHtml = bodyHtml ? sanitizeHtml(bodyHtml) : "";
  const rawAttachments = extractAttachments(msg.payload);

  const processedAttachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    storagePath?: string | undefined;
    attachmentId?: string | undefined;
  }> = [];

  for (const att of rawAttachments) {
    let storagePath: string | undefined = undefined;
    if (att.attachmentId) {
      try {
        const safeName = sanitizeStorageFilename(att.filename);
        storagePath = `${workspaceId}/${msg.id}/${safeName}`;
        
        const attData = await fetchGmailAttachment({
          workspaceId,
          messageId: msg.id,
          attachmentId: att.attachmentId,
        });

        if (attData.dataBase64) {
          const buffer = Buffer.from(attData.dataBase64, "base64");
          const { error: uploadErr } = await supabaseAdmin.storage
            .from("email-attachments")
            .upload(storagePath, buffer, {
              contentType: att.mimeType,
              upsert: true,
            });

          if (uploadErr) {
            console.warn(`Could not upload attachment ${att.filename} to storage:`, uploadErr.message);
          }
        }
      } catch (attErr) {
        console.warn(`Failed to process attachment ${att.filename}:`, attErr);
      }
    }

    processedAttachments.push({
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      storagePath,
      attachmentId: att.attachmentId,
    });
  }

  const fromName = fromHeader.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() || null;
  const cleanFromEmail = parseEmail(fromHeader) || fromHeader;
  const cleanToEmail = parseEmail(toHeader) || toHeader;

  // Check if message already exists
  const { data: existing } = await (supabase as unknown as any)
    .from("email_messages")
    .select("id, client_id")
    .eq("workspace_id", workspaceId)
    .eq("provider_message_id", msg.id)
    .maybeSingle();

  if (existing) {
    if (!existing.client_id && clientId) {
      const { error: updateErr } = await (supabase as unknown as any)
        .from("email_messages")
        .update({ client_id: clientId })
        .eq("id", existing.id);

      if (updateErr) {
        console.error(`[GMAIL_SYNC] Failed to update client_id on existing record ${existing.id}:`, updateErr.message);
      } else {
        console.log(`[GMAIL_SYNC] Updated client_id=${clientId} on existing message ${msg.id}`);
      }
      return { inserted: true };
    }
    return { inserted: false };
  }

  // Insert new email message
  const { error } = await (supabase as unknown as any).from("email_messages").insert({
    workspace_id: workspaceId,
    client_id: clientId,
    thread_id: msg.threadId,
    provider_message_id: msg.id,
    rfc_message_id: rfcMessageId ?? "",
    direction,
    from_email: cleanFromEmail,
    from_name: fromName,
    to_email: cleanToEmail,
    cc: ccHeader,
    bcc: bccHeader,
    subject: subjectHeader,
    body_text: bodyText || "",
    body_html: safeHtml,
    attachments: processedAttachments,
    in_reply_to: inReplyTo ?? null,
    references: references ?? null,
    received_at: new Date(parseInt(msg.internalDate, 10)),
    sent_at: direction === "outbound" ? new Date(parseInt(msg.internalDate, 10)) : null,
  });

  if (error) {
    if (error.code === "23505") {
      console.log(`[GMAIL_SYNC] Duplicate detected for message ${msg.id}, skipping.`);
      return { inserted: false };
    }
    console.error(`[GMAIL_SYNC] Failed to insert email_message for msgId=${msg.id}:`, error.message, error);
    return { inserted: false, error: error.message };
  }

  return { inserted: true };
}

/**
 * Extracts a clean email address from a header value (e.g. "Name <email@example.com>").
 */
function parseEmail(headerVal?: string): string {
  if (!headerVal) return "";
  const match = headerVal.match(/<([^>]+)>/);
  const raw = match && match[1] ? match[1] : headerVal;
  return raw.trim().toLowerCase();
}

/**
 * Main sync function – fetches recent INBOX/SENT messages and thread replies from Gmail, matches them to clients, and persists them.
 */
export async function syncGmailForWorkspace(workspaceId: string): Promise<GmailSyncResult> {
  const accessToken = await getAccessTokenForWorkspace(workspaceId);

  const gmailProfile = await fetchGmailProfile(accessToken);
  const myEmail = gmailProfile.emailAddress.toLowerCase();
  console.log(`[GMAIL_DEBUG] CONNECTED_GMAIL_ACCOUNT=${myEmail}`);
  console.log(`[GMAIL_SYNC] Syncing for workspace=${workspaceId}, connected Gmail account=${myEmail}`);

  // 1. Fetch recent 50 messages from mailbox
  const mailboxMsgIds = await listMessageIds(accessToken, "", 50);

  const supabase = supabaseAdmin;

  // Load client emails for workspace-scoped matching (case-insensitive)
  const { data: clients } = await supabase
    .from("clients")
    .select("id,email")
    .eq("workspace_id", workspaceId);

  const emailToClient: Record<string, string> = {};
  clients?.forEach((c) => {
    if (c.email) emailToClient[c.email.trim().toLowerCase()] = c.id;
  });
  
  console.log(`[GMAIL_DEBUG_CLIENT]\nworkspaceId=${workspaceId}\nclientCount=${clients?.length ?? 0}\nclientEmails=${JSON.stringify(Object.keys(emailToClient))}`);
  console.log(`[GMAIL_SYNC] Loaded ${clients?.length ?? 0} client email(s) for matching`);

  // Preload existing thread-to-client associations from email_messages
  const { data: threadRows } = await (supabase as unknown as any)
    .from("email_messages")
    .select("thread_id, client_id")
    .eq("workspace_id", workspaceId)
    .not("client_id", "is", null);

  const threadToClient: Record<string, string> = {};
  threadRows?.forEach((row: { thread_id: string; client_id: string }) => {
    if (row.thread_id && row.client_id) {
      threadToClient[row.thread_id] = row.client_id;
    }
  });

  // 2. Fetch messages from active threads in email_messages
  const activeThreadIds = new Set<string>();
  threadRows?.forEach((row: { thread_id: string }) => {
    if (row.thread_id && !row.thread_id.startsWith("thread_")) {
      activeThreadIds.add(row.thread_id);
    }
  });

  const threadMsgList: GmailMessage[] = [];
  for (const tId of activeThreadIds) {
    try {
      const msgs = await getThreadMessages(accessToken, tId);
      console.log(`[GMAIL_THREAD_DEBUG]\nthreadId=${tId}\nmessagesInThread=${msgs.length}\nmessageIds=${JSON.stringify(msgs.map(m => m.id))}`);
      threadMsgList.push(...msgs);
    } catch (e) {
      console.warn(`[GMAIL_SYNC] Error fetching thread ${tId}:`, e);
    }
  }

  // Combine and deduplicate GmailMessage objects by message ID
  const allMessagesMap = new Map<string, GmailMessage>();

  for (const msgId of mailboxMsgIds) {
    try {
      const msg = await getMessage(accessToken, msgId);
      allMessagesMap.set(msg.id, msg);
    } catch (e) {
      console.warn(`[GMAIL_SYNC] Error fetching message ${msgId}:`, e);
    }
  }

  for (const msg of threadMsgList) {
    if (!allMessagesMap.has(msg.id)) {
      allMessagesMap.set(msg.id, msg);
    }
  }

  console.log(`[GMAIL_DEBUG] GMAIL_MESSAGES_RETURNED=${allMessagesMap.size}`);

  // Log EVERY returned Gmail message headers
  for (const msg of allMessagesMap.values()) {
    const hdrs: { name: string; value: string }[] = msg.payload?.headers ?? [];
    const gh = (name: string) => hdrs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    console.log(`[GMAIL_DEBUG_MESSAGE]\nmsgId=${msg.id}\nthreadId=${msg.threadId}\nFrom=${gh("From")}\nTo=${gh("To")}\nSubject=${gh("Subject")}\nDate=${gh("Date")}\nMessage-ID=${gh("Message-ID")}\nIn-Reply-To=${gh("In-Reply-To")}\nReferences=${gh("References")}`);
  }

  let processedCount = 0;
  let insertedCount = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let errorCount = 0;

  for (const msg of allMessagesMap.values()) {
    try {
      processedCount++;

      const { rfcMessageId, inReplyTo, references } = extractHeaders(msg.payload);
      const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

      const fromHeader = getHeader("From") ?? "";
      const toHeader = getHeader("To") ?? "";
      const subjectHeader = getHeader("Subject") ?? "(No Subject)";
      const dateHeader = getHeader("Date") ?? "";

      const fromEmail = parseEmail(fromHeader);
      const toEmail = parseEmail(toHeader);

      // Determine client matching and direction
      let matchedClientId: string | null = null;
      const direction: "inbound" = "inbound";

      // Strict INBOUND check: fromEmail or Reply-To must belong to a client.
      if (fromEmail && emailToClient[fromEmail]) {
        matchedClientId = emailToClient[fromEmail];
      } else {
        const replyToEmail = parseEmail(getHeader("Reply-To"));
        if (replyToEmail && emailToClient[replyToEmail]) {
          matchedClientId = emailToClient[replyToEmail];
        }
      }

      // Log the match result for EVERY message
      console.log(`[GMAIL_DEBUG_MATCH]\nmsgId=${msg.id}\nfromEmail=${fromEmail}\nnormalizedFromEmail=${fromEmail}\nmatchedClientId=${matchedClientId ?? "NULL"}\nemailToClientKeys=${JSON.stringify(Object.keys(emailToClient))}`);

      // Record thread→client mapping for subsequent messages
      if (matchedClientId && msg.threadId) {
        threadToClient[msg.threadId] = matchedClientId;
      }

      // Only insert inbound messages sent by the client. Do NOT create outbound rows.
      if (!matchedClientId) {
        console.log(`[GMAIL_DEBUG_SKIP]\nmsgId=${msg.id}\nthreadId=${msg.threadId}\nfromEmail=${fromEmail}\ntoEmail=${toEmail}\nreason=fromEmail does not match any known client email`);
        unmatchedCount++;
        continue;
      }

      // Log insert attempt
      console.log(`[GMAIL_DEBUG_INSERT_ATTEMPT]\nworkspaceId=${workspaceId}\nclientId=${matchedClientId}\ndirection=inbound\nfromEmail=${fromEmail}\ntoEmail=${toEmail}\nthreadId=${msg.threadId}\nproviderMessageId=${msg.id}`);

      const result = await storeMessage(
        supabase,
        workspaceId,
        matchedClientId,
        msg,
        "inbound",
      );

      if (result.error) {
        console.error(`[GMAIL_DEBUG_DB_ERROR]\nmessage=${result.error}\nmsgId=${msg.id}`);
        errorCount++;
      } else if (result.inserted) {
        insertedCount++;
        matchedCount++;
        console.log(`[GMAIL_DEBUG_INSERT_SUCCESS]\nproviderMessageId=${msg.id}\nclientId=${matchedClientId}\ndirection=inbound\nthreadId=${msg.threadId}`);
      } else {
        console.log(`[GMAIL_SYNC] msgId=${msg.id} → DUPLICATE SKIPPED`);
      }
    } catch (e) {
      errorCount++;
      console.error(`[GMAIL_SYNC] Error processing Gmail message:`, e);
    }
  }

  // POST-SYNC: Verify what inbound rows exist in DB for this workspace
  const { data: postSyncRows, error: postSyncError } = await (supabase as unknown as any)
    .from("email_messages")
    .select("id, workspace_id, client_id, direction, from_email, to_email, subject, thread_id, provider_message_id, received_at")
    .eq("workspace_id", workspaceId)
    .eq("direction", "inbound");
  
  if (postSyncError) {
    console.error(`[GMAIL_DEBUG_POST_SYNC_ERROR] ${postSyncError.message}`);
  } else {
    console.log(`[GMAIL_DEBUG_POST_SYNC] Total inbound rows in DB for workspace=${workspaceId}: ${postSyncRows?.length ?? 0}`);
    for (const row of (postSyncRows ?? [])) {
      console.log(`[GMAIL_DEBUG_POST_SYNC_ROW]\nid=${row.id}\nworkspace_id=${row.workspace_id}\nclient_id=${row.client_id}\ndirection=${row.direction}\nfrom_email=${row.from_email}\nto_email=${row.to_email}\nsubject=${row.subject}\nthread_id=${row.thread_id}\nprovider_message_id=${row.provider_message_id}\nreceived_at=${row.received_at}`);
    }
  }

  // Update integration last_tested_at to track sync time
  await supabase
    .from("workspace_integrations")
    .update({
      last_tested_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("provider_type", "email");

  const result: GmailSyncResult = {
    found: allMessagesMap.size,
    processed: processedCount,
    inserted: insertedCount,
    matched: matchedCount,
    unmatched: unmatchedCount,
    errors: errorCount,
    myEmail,
  };

  console.log(`[GMAIL_SYNC] COMPLETE:`, result);
  return result;
}

/**
 * Fetches raw attachment data from Gmail API by message ID and attachment ID.
 */
export async function fetchGmailAttachment(params: {
  workspaceId: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ dataBase64: string; size: number }> {
  const accessToken = await getAccessTokenForWorkspace(params.workspaceId);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
    params.messageId,
  )}/attachments/${encodeURIComponent(params.attachmentId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to fetch attachment from Gmail: ${txt}`);
  }
  const data = (await res.json()) as { data?: string; size?: number };
  const standardBase64 = (data.data || "").replace(/-/g, "+").replace(/_/g, "/");
  return { dataBase64: standardBase64, size: data.size || 0 };
}

/**
 * Creates a signed URL for an email attachment stored in Supabase Storage.
 */
export async function getAttachmentDownloadSignedUrl(params: {
  workspaceId: string;
  storagePath: string;
}): Promise<{ signedUrl: string | null; error?: string }> {
  if (!params.storagePath.startsWith(`${params.workspaceId}/`)) {
    return { signedUrl: null, error: "Access denied: Attachment does not belong to workspace." };
  }

  const { data, error } = await supabaseAdmin.storage
    .from("email-attachments")
    .createSignedUrl(params.storagePath, 3600);

  if (error || !data?.signedUrl) {
    return { signedUrl: null, error: error?.message || "Failed to generate signed URL" };
  }

  return { signedUrl: data.signedUrl };
}
