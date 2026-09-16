// src/lib/imap-sync.server.ts
// Inbound IMAP sync for non-Gmail (SMTP) workspaces such as Hostinger.
// Mirrors syncGmailForWorkspace logic but reads from IMAP instead of Gmail API.
// SAFETY: never marks messages as read, never moves or deletes server-side messages.
// Deduplication key: "imap:<uidValidity>:<uid>" — globally unique per mailbox.

import { ImapFlow } from "imapflow";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractMessageIds, normalizeSubject, parseClientEmails } from "./email-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Public result type (matches shape of GmailSyncResult for easy merging)
// ---------------------------------------------------------------------------
export interface ImapSyncResult {
  found: number;       // total IMAP UIDs fetched
  processed: number;  // messages attempted after dedup skip
  inserted: number;   // net-new rows inserted into email_messages
  matched: number;    // rows matched to a known client
  unmatched: number;  // rows left with client_id = NULL (skipped)
  errors: number;     // messages that threw during processing
  account: string;    // IMAP user address — never logs password
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives an IMAP hostname from the saved SMTP host.
 * For Hostinger: smtp.hostinger.com → imap.hostinger.com
 */
function deriveImapHost(smtpHost: string): string {
  const lower = smtpHost.toLowerCase();
  if (lower.startsWith("smtp.")) {
    return "imap." + smtpHost.slice(5);
  }
  if (lower.startsWith("mail.")) {
    return "imap." + smtpHost.slice(5);
  }
  // Assume the same host supports IMAP (some providers share a hostname)
  return smtpHost;
}

/** Extracts a single email address from an RFC 2822 address (handles "Name <addr>" format). */
function cleanAddress(raw: string | undefined): string {
  if (!raw) return "";
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim().toLowerCase();
}

/**
 * Reads SMTP integration config for the workspace.
 * Returns null if no SMTP integration is configured or credentials are missing.
 * NEVER logs the password at any level.
 */
async function getImapCredentials(workspaceId: string): Promise<{
  host: string;
  port: number;
  user: string;
  password: string;  // kept in memory only — never logged
  fromEmail: string;
} | null> {
  const { data: integration, error } = await (supabaseAdmin as any)
    .from("workspace_integrations")
    .select("config, details")
    .eq("workspace_id", workspaceId)
    .eq("provider_type", "email")
    .eq("provider", "smtp")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !integration) {
    return null;
  }

  const config = (integration.config ?? {}) as Record<string, unknown>;
  const details = (integration.details ?? {}) as Record<string, unknown>;

  const smtpHost = (config["smtpHost"] as string | undefined) ?? "";
  const smtpUser = (config["smtpUser"] as string | undefined) ?? "";
  const smtpPassword = (config["smtpPassword"] as string | undefined) ?? "";

  // fromEmail from details (preferred) or config
  const fromEmail =
    (details["fromEmail"] as string | undefined) ??
    (config["fromEmail"] as string | undefined) ??
    smtpUser;

  if (!smtpHost || !smtpUser || !smtpPassword) {
    console.log(
      `[IMAP_SYNC] workspace=${workspaceId}: SMTP integration exists but host/user/password missing — skipping.`,
    );
    return null;
  }

  const imapHost = deriveImapHost(smtpHost);
  console.log(`[IMAP_SYNC] Derived IMAP host="${imapHost}" from SMTP host="${smtpHost}"`);

  return {
    host: imapHost,
    port: 993,
    user: smtpUser,
    password: smtpPassword, // never referenced in any log statement
    fromEmail: fromEmail || smtpUser,
  };
}

/**
 * Inserts one inbound IMAP message into email_messages with full deduplication.
 * Reuses the same dedup logic as storeMessage() in gmail-sync.server.ts.
 */
async function storeImapMessage(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string,
  providerMessageId: string,  // "imap:<uidValidity>:<uid>"
  fields: {
    fromEmail: string;
    fromName: string | null;
    toEmail: string;
    subject: string;
    rfcMessageId: string;
    inReplyTo: string | null;
    references: string | null;
    receivedAt: Date;
    threadId: string;
  },
  bodyText: string,
  bodyHtml: string,
): Promise<{ inserted: boolean; error?: string }> {
  // Belt-and-suspenders dedup check in DB
  const { data: existing } = await (supabase as unknown as any)
    .from("email_messages")
    .select("id, client_id, rfc_message_id")
    .eq("workspace_id", workspaceId)
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (existing) {
    // Upgrade an unmatched record to matched if we now know the client
    if (
      !existing.client_id &&
      clientId &&
      existing.rfc_message_id !== "DELETED" &&
      existing.rfc_message_id !== "DELETE_ALL_MARKER"
    ) {
      await (supabase as unknown as any)
        .from("email_messages")
        .update({ client_id: clientId })
        .eq("id", existing.id);
      console.log(`[IMAP_SYNC] Updated client_id=${clientId} on existing record for ${providerMessageId}`);
      return { inserted: true };
    }
    return { inserted: false };
  }

  // Build a safe HTML body if only plain text was found
  const safeHtml =
    bodyHtml ||
    (bodyText
      ? `<p>${bodyText
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br/>")}</p>`
      : "");

  const { error } = await (supabase as unknown as any).from("email_messages").insert({
    workspace_id: workspaceId,
    client_id: clientId,
    thread_id: fields.threadId,
    provider_message_id: providerMessageId,
    rfc_message_id: fields.rfcMessageId || "",
    direction: "inbound",
    from_email: fields.fromEmail,
    from_name: fields.fromName,
    to_email: fields.toEmail,
    cc: null,
    bcc: null,
    subject: fields.subject || "(No Subject)",
    body_text: bodyText,
    body_html: safeHtml,
    attachments: [],
    in_reply_to: fields.inReplyTo,
    references: fields.references,
    received_at: fields.receivedAt.toISOString(),
    sent_at: null,
  });

  if (error) {
    if (error.code === "23505") {
      // Unique constraint violation — treat as duplicate
      return { inserted: false };
    }
    return { inserted: false, error: error.message };
  }

  return { inserted: true };
}

// ---------------------------------------------------------------------------
// RFC 2822 body extraction — handles 7bit, quoted-printable, base64,
// multipart/alternative, multipart/mixed
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRawHeader(rawHeaders: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*(.+?)(?=\\r?\\n[^\\s]|\\r?\\n\\r?\\n|$)`, "im");
  const m = rawHeaders.match(re);
  if (!m) return undefined;
  // Unfold RFC 2822 multi-line header values
  return m[1]!.replace(/\r?\n[ \t]+/g, " ").trim();
}

function decodeTransferEncoding(body: string, encoding: string): string {
  const enc = encoding.toLowerCase().trim();
  if (enc === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      );
  }
  // 7bit / 8bit / binary — return as-is
  return body;
}

function extractBodyParts(rawSource: string): { text: string; html: string } {
  // Split headers from body on first blank line
  const sep = rawSource.search(/\r?\n\r?\n/);
  if (sep === -1) return { text: "", html: "" };

  const rawHeaders = rawSource.slice(0, sep);
  const rawBody = rawSource.slice(sep).replace(/^\r?\n\r?\n?/, "");

  const contentType = extractRawHeader(rawHeaders, "Content-Type") ?? "text/plain";
  const transferEncoding = extractRawHeader(rawHeaders, "Content-Transfer-Encoding") ?? "7bit";

  const ctLower = contentType.toLowerCase();

  // Non-multipart: single body
  if (!ctLower.includes("multipart")) {
    const decoded = decodeTransferEncoding(rawBody, transferEncoding);
    if (ctLower.includes("text/html")) return { text: "", html: decoded };
    return { text: decoded, html: "" };
  }

  // Multipart: find boundary
  const boundaryMatch = contentType.match(/boundary="?([^";\r\n]+)"?/i);
  if (!boundaryMatch?.[1]) return { text: rawBody, html: "" };

  const boundary = boundaryMatch[1].trim();
  const delimiter = new RegExp(`--${escapeRegex(boundary)}(?:--)?\\r?\\n?`, "g");
  const parts = rawSource.split(delimiter).slice(1); // skip preamble

  let text = "";
  let html = "";

  for (const part of parts) {
    if (!part.trim() || part.trim() === "--") continue;

    const partSep = part.search(/\r?\n\r?\n/);
    if (partSep === -1) continue;

    const partHeaders = part.slice(0, partSep);
    const partBody = part.slice(partSep).replace(/^\r?\n\r?\n?/, "");

    const partCT = (extractRawHeader(partHeaders, "Content-Type") ?? "text/plain").toLowerCase();
    const partEnc = extractRawHeader(partHeaders, "Content-Transfer-Encoding") ?? "7bit";

    if (partCT.includes("multipart")) {
      // Nested multipart — recurse
      const nested = extractBodyParts(part);
      if (!text && nested.text) text = nested.text;
      if (!html && nested.html) html = nested.html;
    } else if (partCT.includes("text/plain") && !text) {
      text = decodeTransferEncoding(partBody, partEnc);
    } else if (partCT.includes("text/html") && !html) {
      html = decodeTransferEncoding(partBody, partEnc);
    }
  }

  return { text, html };
}

// ---------------------------------------------------------------------------
// Main IMAP sync function
// ---------------------------------------------------------------------------

/**
 * Syncs new inbound emails from an IMAP mailbox (e.g. Hostinger) for a workspace.
 * Safe: read-only IMAP session, no server-side message modifications.
 * Idempotent: UID + uidValidity namespaced deduplication prevents duplicates.
 * Incremental: only fetches UIDs greater than the maximum UID already stored.
 */
export async function syncImapForWorkspace(workspaceId: string): Promise<ImapSyncResult> {
  const result: ImapSyncResult = {
    found: 0,
    processed: 0,
    inserted: 0,
    matched: 0,
    unmatched: 0,
    errors: 0,
    account: "",
  };

  // ------------------------------------------------------------------
  // 1. Load credentials (returns null if not an SMTP workspace)
  // ------------------------------------------------------------------
  const creds = await getImapCredentials(workspaceId);
  if (!creds) {
    console.log(`[IMAP_SYNC] No active SMTP integration for workspace=${workspaceId} — skipping.`);
    return result;
  }
  result.account = creds.fromEmail;
  const myEmailLower = creds.fromEmail.toLowerCase();
  const myUserLower = creds.user.toLowerCase();

  console.log(
    `[IMAP_SYNC] Starting sync: workspace=${workspaceId} account=${creds.fromEmail} host=${creds.host}:${creds.port}`,
  );

  // ------------------------------------------------------------------
  // 2. Load client email-to-ID map (same as syncGmailForWorkspace)
  // ------------------------------------------------------------------
  const supabase = supabaseAdmin;

  const { data: clients } = await supabase
    .from("clients")
    .select("id,email")
    .eq("workspace_id", workspaceId);

  const emailToClient: Record<string, string> = {};
  clients?.forEach((c) => {
    if (c.email) {
      for (const email of parseClientEmails(c.email)) {
        emailToClient[email.toLowerCase()] = c.id;
      }
    }
  });

  console.log(`[IMAP_SYNC] Loaded ${clients?.length ?? 0} clients (${Object.keys(emailToClient).length} addresses)`);

  // ------------------------------------------------------------------
  // 3. Load Delete All tombstone cutoffs (same as syncGmailForWorkspace)
  // ------------------------------------------------------------------
  const { data: tombstoneRows } = await (supabase as unknown as any)
    .from("email_messages")
    .select("body_text, received_at")
    .eq("workspace_id", workspaceId)
    .eq("rfc_message_id", "DELETE_ALL_MARKER");

  const clientDeleteAllCutoff: Record<string, number> = {};
  tombstoneRows?.forEach((row: { body_text: string | null; received_at: string | null }) => {
    if (row.body_text && row.received_at) {
      const timeMs = new Date(row.received_at).getTime();
      const existing = clientDeleteAllCutoff[row.body_text] ?? 0;
      if (timeMs > existing) clientDeleteAllCutoff[row.body_text] = timeMs;
    }
  });

  // ------------------------------------------------------------------
  // 4. Load existing IMAP provider_message_ids → find max UID per uidValidity
  //    so subsequent syncs only fetch NEW messages (incremental)
  // ------------------------------------------------------------------
  const { data: existingImapRows } = await (supabase as unknown as any)
    .from("email_messages")
    .select("provider_message_id")
    .eq("workspace_id", workspaceId)
    .like("provider_message_id", "imap:%");

  const existingProviderIds = new Set<string>(
    (existingImapRows ?? []).map(
      (r: { provider_message_id: string }) => r.provider_message_id,
    ),
  );

  // ------------------------------------------------------------------
  // 5. Load thread-to-client and message-to-thread maps for threading
  // ------------------------------------------------------------------
  const { data: existingMsgRows } = await (supabase as unknown as any)
    .from("email_messages")
    .select("rfc_message_id, provider_message_id, thread_id, client_id, subject")
    .eq("workspace_id", workspaceId);

  const threadToClient: Record<string, string> = {};
  const messageToThread = new Map<string, string>();
  const subjectToThread = new Map<string, string>();

  existingMsgRows?.forEach((row: {
    rfc_message_id?: string | null;
    provider_message_id?: string | null;
    thread_id?: string | null;
    client_id?: string | null;
    subject?: string | null;
  }) => {
    if (row.thread_id && !row.thread_id.startsWith("tombstone_")) {
      const tid = row.thread_id.trim();
      if (row.client_id) {
        threadToClient[tid] = row.client_id;
      }
      if (row.rfc_message_id && row.rfc_message_id !== "DELETED" && row.rfc_message_id !== "DELETE_ALL_MARKER") {
        messageToThread.set(row.rfc_message_id.trim(), tid);
      }
      if (row.provider_message_id) {
        messageToThread.set(row.provider_message_id.trim(), tid);
      }
      if (row.subject) {
        const normSub = normalizeSubject(row.subject);
        if (normSub && !subjectToThread.has(normSub)) {
          subjectToThread.set(normSub, tid);
        }
      }
    }
  });

  // ------------------------------------------------------------------
  // 6. Connect to IMAP server — read-only session
  // ------------------------------------------------------------------
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: true,
    auth: {
      user: creds.user,
      pass: creds.password, // never appears in any log statement
    },
    logger: false, // suppress imapflow internal logs (may contain auth details)
    tls: { rejectUnauthorized: true },
  });

  try {
    await client.connect();
    console.log(`[IMAP_SYNC] Connected: ${creds.host}:${creds.port}`);

    // Open INBOX read-only — never modifies flags or messages
    const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    const uidValidity = String(mailbox.uidValidity);
    const totalMessages = mailbox.exists;

    console.log(
      `[IMAP_SYNC] INBOX opened: uidValidity=${uidValidity} totalMessages=${totalMessages}`,
    );

    if (totalMessages === 0) {
      console.log("[IMAP_SYNC] INBOX is empty. Nothing to sync.");
      await client.logout();
      return result;
    }

    // ------------------------------------------------------------------
    // 7. Determine fetch range using incremental UID strategy
    //
    //    Format of stored IDs: "imap:<uidValidity>:<uid>"
    //    Find the max UID already stored for this uidValidity.
    //    → If found: UID FETCH <maxUid+1>:* (only new messages)
    //    → If not found (first sync): FETCH last 200 by sequence number,
    //      requesting UIDs back in results for correct namespacing.
    // ------------------------------------------------------------------
    let maxSyncedUid = 0;
    for (const pid of existingProviderIds) {
      const parts = pid.split(":");
      // "imap" : uidValidity : uid  — 3 parts
      if (parts.length === 3 && parts[0] === "imap" && parts[1] === uidValidity) {
        const uid = parseInt(parts[2]!, 10);
        if (!isNaN(uid) && uid > maxSyncedUid) maxSyncedUid = uid;
      }
    }

    const useUidMode = maxSyncedUid > 0;
    let fetchRange: string;

    if (useUidMode) {
      // Incremental: only UIDs we haven't seen yet
      fetchRange = `${maxSyncedUid + 1}:*`;
      console.log(`[IMAP_SYNC] Incremental fetch: UID ${fetchRange} (maxSyncedUid=${maxSyncedUid})`);
    } else {
      // First sync: last 200 messages by sequence number
      const seqStart = Math.max(1, totalMessages - 199);
      fetchRange = `${seqStart}:${totalMessages}`;
      console.log(`[IMAP_SYNC] First sync: sequence ${fetchRange} (last 200 of ${totalMessages})`);
    }

    // ------------------------------------------------------------------
    // 8. Stream messages from IMAP and process each
    // ------------------------------------------------------------------
    for await (const msg of client.fetch(
      fetchRange,
      { envelope: true, source: true, uid: true },
      { uid: useUidMode },
    )) {
      try {
        result.found++;

        const uid = msg.uid;
        const providerMessageId = `imap:${uidValidity}:${uid}`;

        // Belt-and-suspenders dedup: skip if already in our seen set
        if (existingProviderIds.has(providerMessageId)) {
          continue;
        }

        result.processed++;

        // ------------------------------------------------------------------
        // Parse headers from envelope (imapflow gives us parsed envelope)
        // and from raw source (for In-Reply-To, References headers)
        // ------------------------------------------------------------------
        const env = msg.envelope;
        const rawSource = msg.source?.toString("utf8") ?? "";

        // Sender
        const fromAddr = env?.from?.[0];
        const fromEmail = cleanAddress(
          fromAddr?.address ??
          (fromAddr ? `${fromAddr.name ?? ""} <${(fromAddr as any).address ?? ""}>` : ""),
        );
        const fromName: string | null = (fromAddr as any)?.name ?? null;

        // Recipient
        const toAddr = env?.to?.[0];
        const toEmail = cleanAddress((toAddr as any)?.address ?? "");

        const subject = env?.subject ?? "(No Subject)";
        const receivedAt: Date = env?.date instanceof Date ? env.date : new Date();
        const rfcMessageId = env?.messageId ?? "";

        // Parse In-Reply-To and References from raw source (more reliable than envelope)
        const headerSep = rawSource.search(/\r?\n\r?\n/);
        const rawHeaderSection = headerSep > -1 ? rawSource.slice(0, headerSep) : rawSource;
        const inReplyTo = extractRawHeader(rawHeaderSection, "In-Reply-To") ?? null;
        const references = extractRawHeader(rawHeaderSection, "References") ?? null;

        // ------------------------------------------------------------------
        // Skip messages that are FROM our own sending account (outbound)
        // ------------------------------------------------------------------
        if (fromEmail === myEmailLower || fromEmail === myUserLower) {
          console.log(`[IMAP_SYNC] Skipping outbound (self): uid=${uid} from=${fromEmail}`);
          result.found--; // don't count as "found" for stats
          continue;
        }

        // ------------------------------------------------------------------
        // Client matching — identical three-tier logic to syncGmailForWorkspace
        // ------------------------------------------------------------------
        let matchedClientId: string | null = null;

        // Tier 1: exact From email match
        if (fromEmail && emailToClient[fromEmail]) {
          matchedClientId = emailToClient[fromEmail]!;
        }

        // Tier 1b: parse all emails from the From field (handles aliases)
        if (!matchedClientId && fromEmail) {
          for (const e of parseClientEmails(fromEmail)) {
            const found = emailToClient[e.toLowerCase()];
            if (found) { matchedClientId = found; break; }
          }
        }

        // Tier 2: Reply-To header (parse from raw headers)
        if (!matchedClientId) {
          const replyToRaw = extractRawHeader(rawHeaderSection, "Reply-To");
          if (replyToRaw) {
            const replyToEmail = cleanAddress(replyToRaw);
            if (replyToEmail && emailToClient[replyToEmail]) {
              matchedClientId = emailToClient[replyToEmail]!;
            } else {
              for (const e of parseClientEmails(replyToRaw)) {
                const found = emailToClient[e.toLowerCase()];
                if (found) { matchedClientId = found; break; }
              }
            }
          }
        }

        // Tier 3: Thread fallback via In-Reply-To → existing thread→client map
        if (!matchedClientId && inReplyTo && threadToClient[inReplyTo.trim()]) {
          matchedClientId = threadToClient[inReplyTo.trim()]!;
        }

        // Log match result
        console.log(
          `[IMAP_SYNC_MATCH] uid=${uid} from=${fromEmail} matched=${matchedClientId ?? "NULL"}`,
        );

        if (!matchedClientId) {
          result.unmatched++;
          continue;
        }

        // ------------------------------------------------------------------
        // Delete All tombstone cutoff check (same as syncGmailForWorkspace)
        // ------------------------------------------------------------------
        const cutoffMs = clientDeleteAllCutoff[matchedClientId];
        if (cutoffMs) {
          const msgMs = receivedAt.getTime();
          if (!isNaN(msgMs) && msgMs <= cutoffMs) {
            console.log(
              `[IMAP_SYNC] uid=${uid} before Delete All cutoff for client=${matchedClientId} — skipping`,
            );
            result.unmatched++;
            continue;
          }
        }

        // ------------------------------------------------------------------
        // Determine thread ID for grouping replies in the UI.
        // Priority:
        // 1. Header Resolution: In-Reply-To & References matched against DB/in-memory messageToThread map
        // 2. Root Header Fallback: root Message-ID (1st in References) or In-Reply-To
        // 3. Subject Fallback: normalized subject matched against subjectToThread map
        // 4. Ultimate Fallback: own RFC Message-ID or providerMessageId
        // ------------------------------------------------------------------
        const inReplyToIds = extractMessageIds(inReplyTo);
        const referencesIds = extractMessageIds(references);
        const allReferencedIds = [...inReplyToIds, ...referencesIds];

        let resolvedThreadId: string | null = null;

        // 1. Check if any referenced Message-ID maps to an existing thread
        for (const refId of allReferencedIds) {
          if (messageToThread.has(refId)) {
            resolvedThreadId = messageToThread.get(refId)!;
            break;
          }
        }

        // 2. Root header fallback if no DB match found yet
        if (!resolvedThreadId) {
          if (referencesIds.length > 0) {
            resolvedThreadId = referencesIds[0]!;
          } else if (inReplyToIds.length > 0) {
            resolvedThreadId = inReplyToIds[0]!;
          }
        }

        // 3. Normalized subject fallback
        const normSub = normalizeSubject(subject);
        if (!resolvedThreadId && normSub && subjectToThread.has(normSub)) {
          resolvedThreadId = subjectToThread.get(normSub)!;
        }

        // 4. Ultimate fallback
        const threadId = resolvedThreadId || (rfcMessageId?.trim()) || providerMessageId;

        // Register in in-memory lookup maps for subsequent messages
        threadToClient[threadId] = matchedClientId;
        if (rfcMessageId?.trim()) {
          threadToClient[rfcMessageId.trim()] = matchedClientId;
          messageToThread.set(rfcMessageId.trim(), threadId);
        }
        messageToThread.set(providerMessageId, threadId);
        if (normSub && !subjectToThread.has(normSub)) {
          subjectToThread.set(normSub, threadId);
        }

        // ------------------------------------------------------------------
        // Parse body from raw RFC 2822 source
        // ------------------------------------------------------------------
        const { text: bodyText, html: bodyHtml } = extractBodyParts(rawSource);

        // ------------------------------------------------------------------
        // Store in email_messages
        // ------------------------------------------------------------------
        console.log(
          `[IMAP_SYNC_INSERT] uid=${uid} from=${fromEmail} client=${matchedClientId} subject="${subject}"`,
        );

        const storeResult = await storeImapMessage(
          supabase as unknown as SupabaseClient<Database>,
          workspaceId,
          matchedClientId,
          providerMessageId,
          { fromEmail, fromName, toEmail, subject, rfcMessageId, inReplyTo, references, receivedAt, threadId },
          bodyText,
          bodyHtml,
        );

        if (storeResult.error) {
          console.error(`[IMAP_SYNC] DB error uid=${uid}: ${storeResult.error}`);
          result.errors++;
        } else if (storeResult.inserted) {
          result.inserted++;
          result.matched++;
          // Add to in-memory seen set to prevent double-processing in same run
          existingProviderIds.add(providerMessageId);
          console.log(
            `[IMAP_SYNC_OK] Inserted uid=${uid} providerMessageId=${providerMessageId} client=${matchedClientId}`,
          );
        } else {
          console.log(`[IMAP_SYNC] uid=${uid} → duplicate skipped`);
        }
      } catch (msgErr) {
        result.errors++;
        // Do NOT log the raw error object — it might contain auth context
        console.error(
          `[IMAP_SYNC] Error processing message (uid=${msg?.uid ?? "?"}): ${msgErr instanceof Error ? msgErr.message : "unknown error"}`,
        );
      }
    }

    await client.logout();
    console.log(`[IMAP_SYNC] Complete for workspace=${workspaceId}:`, {
      found: result.found,
      processed: result.processed,
      inserted: result.inserted,
      matched: result.matched,
      unmatched: result.unmatched,
      errors: result.errors,
      account: result.account,
    });
    return result;

  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Scrub the password from any error message before logging
    const safeMsg = rawMsg.replace(creds.password, "[REDACTED]");
    console.error(
      `[IMAP_SYNC] Connection/sync error for workspace=${workspaceId}: ${safeMsg}`,
    );
    result.errors++;
    try { await client.logout(); } catch { /* ignore logout errors */ }
    return result;
  }
}

// ---------------------------------------------------------------------------
// IMAP APPEND: save a copy of a sent email to the Sent folder
// ---------------------------------------------------------------------------

/**
 * Ordered list of common Sent folder names tried as fallback when SPECIAL-USE
 * is not available on the server.
 */
const SENT_FOLDER_CANDIDATES = [
  "Sent",
  "Sent Items",
  "Sent Messages",
  "INBOX.Sent",
  "[Gmail]/Sent Mail",
];

/**
 * Finds the Sent folder on the IMAP server.
 * Priority: SPECIAL-USE \Sent attribute → common name match (status probe).
 * Returns the mailbox path string, or null if not found.
 */
async function detectSentFolder(client: ImapFlow): Promise<string | null> {
  // client.list() returns all mailboxes with flags and specialUse properties
  try {
    const mailboxes = await client.list();
    for (const mailbox of mailboxes) {
      const flags: Set<string> = (mailbox as any).flags ?? new Set<string>();
      if (
        (mailbox as any).specialUse === "\\Sent" ||
        flags.has("\\Sent")
      ) {
        console.log(`[IMAP_APPEND] Found Sent folder via SPECIAL-USE: "${mailbox.path}"`);
        return mailbox.path;
      }
    }
  } catch (listErr) {
    console.log(
      `[IMAP_APPEND] list() probe failed, falling back to name candidates: ${listErr instanceof Error ? listErr.message : listErr}`,
    );
  }

  // Fallback: probe common names with STATUS
  for (const candidate of SENT_FOLDER_CANDIDATES) {
    try {
      const status = await client.status(candidate, { messages: true });
      if (status) {
        console.log(`[IMAP_APPEND] Found Sent folder via candidate name: "${candidate}"`);
        return candidate;
      }
    } catch {
      // folder doesn't exist — try next
    }
  }

  return null;
}

/**
 * Appends a copy of a successfully sent email into the IMAP Sent folder.
 *
 * SAFETY CONTRACT:
 * - This function NEVER throws. All errors are caught and logged internally.
 * - Call it fire-and-forget AFTER a successful SMTP send.
 * - A failure here MUST NOT affect the send result returned to the caller.
 * - Credentials are never written to any log statement.
 * - Only applies to SMTP workspaces; Gmail workspaces are completely untouched.
 *
 * @param workspaceId  Workspace whose SMTP/IMAP credentials to use.
 * @param rawMessage   Exact RFC 2822 message bytes to APPEND (same content as was sent).
 */
export async function appendToImapSentFolder(
  workspaceId: string,
  rawMessage: Buffer,
): Promise<void> {
  let client: ImapFlow | null = null;
  let password = ""; // held only to scrub from error messages

  try {
    const creds = await getImapCredentials(workspaceId);
    if (!creds) {
      // Not an SMTP workspace — nothing to do
      return;
    }

    password = creds.password; // for scrubbing only — never logged

    client = new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: true,
      auth: {
        user: creds.user,
        pass: creds.password, // never referenced in any log statement
      },
      logger: false, // suppress imapflow internal logs (may contain auth context)
      tls: { rejectUnauthorized: true },
    });

    await client.connect();
    console.log(
      `[IMAP_APPEND] Connected to ${creds.host}:${creds.port} workspace=${workspaceId}`,
    );

    const sentFolder = await detectSentFolder(client);
    if (!sentFolder) {
      console.warn(
        `[IMAP_APPEND] No Sent folder found for workspace=${workspaceId} — APPEND skipped.`,
      );
      await client.logout();
      return;
    }

    // APPEND with \Seen flag (standard practice for Sent folder copies)
    await client.append(sentFolder, rawMessage, ["\\Seen"], new Date());

    console.log(
      `[IMAP_APPEND] Saved sent copy to folder="${sentFolder}" workspace=${workspaceId}`,
    );
    await client.logout();

  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = password ? rawMsg.replace(password, "[REDACTED]") : rawMsg;
    console.error(
      `[IMAP_APPEND] Failed to save sent copy for workspace=${workspaceId}: ${safeMsg}`,
    );
    try { if (client) await client.logout(); } catch { /* ignore */ }
    // DO NOT re-throw — must never affect the original send result
  }
}
