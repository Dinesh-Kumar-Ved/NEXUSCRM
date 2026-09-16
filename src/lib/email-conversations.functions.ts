import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getAccessTokenForWorkspace,
  getAttachmentDownloadSignedUrl,
  syncGmailForWorkspace,
} from "./gmail-sync.server";
import { syncImapForWorkspace } from "./imap-sync.server";
import { fetchGmailProfile, sendGmailMessage } from "./google-auth.server";

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "ps1", "msi", "scr", "vbs", "js", "com", "pif",
  "sh", "dll", "reg", "jse", "wsf", "wsh", "cpl", "jar", "py", "pyc",
  "rb", "pl", "php", "cgi", "htaccess", "htpasswd", "lnk", "inf",
]);

const MAX_PER_FILE = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL = 25 * 1024 * 1024; // 25 MB total

const replyAttachmentSchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    contentBase64: z.string().min(1),
  })
  .superRefine((att, ctx) => {
    const ext = att.filename.split(".").pop()?.toLowerCase() ?? "";
    if (BLOCKED_EXTENSIONS.has(ext)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File type ".${ext}" is blocked for security.`,
      });
      return;
    }
    const cleanLen = att.contentBase64.replace(/\s+/g, "").replace(/=+$/, "").length;
    const sizeBytes = Math.floor((cleanLen * 3) / 4);
    if (sizeBytes > MAX_PER_FILE) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_PER_FILE,
        type: "number",
        inclusive: true,
        message: `Attachment "${att.filename}" exceeds 10 MB limit.`,
      });
    }
  });

export interface StoredEmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  storagePath?: string;
  attachmentId?: string;
}

export interface EmailMessageRecord {
  id: string;
  workspace_id: string;
  client_id: string | null;
  thread_id: string;
  provider_message_id: string;
  rfc_message_id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  from_name: string | null;
  to_email: string;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: StoredEmailAttachment[];
  in_reply_to: string | null;
  references: string | null;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface EmailConversationThread {
  threadId: string;
  subject: string;
  latestTimestamp: string;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  lastMessage: EmailMessageRecord;
  messages: EmailMessageRecord[];
}

/**
 * Validates that the authenticated user is a member of the requested workspace.
 */
async function verifyWorkspaceMembership(supabase: any, workspaceId: string, _userId: string) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Unauthorized: Workspace not found or inaccessible.");
  }
}

/**
 * Fetches all email messages for a client, grouped by Gmail threadId and sorted chronologically.
 */
export const getClientEmailThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    const { data: rows, error } = await (context.supabase as unknown as any)
      .from("email_messages")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("client_id", data.clientId)
      .order("received_at", { ascending: true, nullsFirst: false });

    if (error) {
      throw new Error(`Failed to load email conversations: ${error.message}`);
    }

    const messages = (rows ?? []) as EmailMessageRecord[];
    
    console.log(`[EMAIL_CONVERSATIONS_DEBUG]\nworkspaceId=${data.workspaceId}\nclientId=${data.clientId}\nrowsReturned=${messages.length}`);
    for (const row of messages) {
      console.log(`id=${row.id}\nclientId=${row.client_id}\ndirection=${row.direction}\nfromEmail=${row.from_email}\nsubject=${row.subject}\nthreadId=${row.thread_id}`);
    }

    // Group by thread_id
    const threadMap = new Map<string, EmailMessageRecord[]>();
    for (const msg of messages) {
      const tId = msg.thread_id || msg.provider_message_id || msg.id;
      if (!threadMap.has(tId)) {
        threadMap.set(tId, []);
      }
      threadMap.get(tId)!.push(msg);
    }

    const threads: EmailConversationThread[] = [];

    for (const [threadId, msgs] of threadMap.entries()) {
      // Sort messages within thread chronologically
      msgs.sort((a, b) => {
        const timeA = new Date(a.received_at || a.sent_at || a.created_at).getTime();
        const timeB = new Date(b.received_at || b.sent_at || b.created_at).getTime();
        return timeA - timeB;
      });

      const firstMsg = msgs[0]!;
      const lastMsg = msgs[msgs.length - 1]!;
      const inboundCount = msgs.filter((m) => m.direction === "inbound").length;
      const outboundCount = msgs.filter((m) => m.direction === "outbound").length;

      threads.push({
        threadId,
        subject: firstMsg.subject || "(No Subject)",
        latestTimestamp: lastMsg.received_at || lastMsg.sent_at || lastMsg.created_at,
        messageCount: msgs.length,
        inboundCount,
        outboundCount,
        lastMessage: lastMsg,
        messages: msgs,
      });
    }

    // Display only client/inbound conversations in the view list
    const inboundThreads = threads.filter((t) => t.inboundCount > 0);

    // Sort threads so the one with the newest message is first
    inboundThreads.sort(
      (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime(),
    );

    return inboundThreads;
  });

/**
 * Sends a reply to an existing Gmail thread from CRM.
 */
export const sendEmailThreadReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        clientId: z.string().uuid(),
        threadId: z.string().min(1),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(10000),
        html: z.string().max(30000).optional(),
        inReplyTo: z.string().max(512).optional(),
        references: z.string().max(4096).optional(),
        attachments: z.array(replyAttachmentSchema).max(20).optional(),
      })
      .superRefine((val, ctx) => {
        if (!val.attachments || val.attachments.length === 0) return;
        let total = 0;
        for (const att of val.attachments) {
          const cleanLen = att.contentBase64.replace(/\s+/g, "").replace(/=+$/, "").length;
          total += Math.floor((cleanLen * 3) / 4);
        }
        if (total > MAX_TOTAL) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            maximum: MAX_TOTAL,
            type: "number",
            inclusive: true,
            message: "Total attachments size exceeds 25 MB limit.",
            path: ["attachments"],
          });
        }
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    // Fetch client
    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("id, name, email, workspace_id")
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (clientErr || !client) {
      throw new Error("Client not found in this workspace.");
    }

    const toEmail = client.email?.trim();
    if (!toEmail) {
      throw new Error("Client does not have a valid email address.");
    }

    // Check workspace integration provider (gmail vs smtp)
    const { data: integration } = await (supabaseAdmin as any)
      .from("workspace_integrations")
      .select("provider, config, details")
      .eq("workspace_id", data.workspaceId)
      .eq("provider_type", "email")
      .eq("is_active", true)
      .maybeSingle();

    const provider = integration?.provider ?? "gmail";
    let fromEmail = "";
    let fromName = "You";
    let sendResult: { ok: boolean; messageId?: string | undefined; error?: string | undefined };

    if (provider === "gmail") {
      const accessToken = await getAccessTokenForWorkspace(data.workspaceId);
      const profile = await fetchGmailProfile(accessToken);
      fromEmail = profile.emailAddress;
      fromName = profile.emailAddress.split("@")[0] || "You";

      sendResult = await sendGmailMessage({
        accessToken,
        from: fromEmail,
        to: toEmail,
        subject: data.subject,
        text: data.body,
        html: data.html || `<p>${data.body.replace(/\n/g, "<br/>")}</p>`,
        threadId: data.threadId,
        inReplyTo: data.inReplyTo,
        references: data.references,
        attachments: data.attachments?.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          contentBase64: a.contentBase64,
        })),
      });

      if (!sendResult.ok) {
        throw new Error(sendResult.error || "Failed to send Gmail reply.");
      }
    } else {
      // SMTP / Hostinger workspace dispatch
      const { sendEmailWithConfig } = await import("./integrations.server");
      const config = (integration?.config ?? {}) as Record<string, any>;
      const details = (integration?.details ?? {}) as Record<string, any>;

      fromEmail =
        details["fromEmail"] ||
        config["fromEmail"] ||
        config["smtpUser"] ||
        "me";
      fromName = details["fromName"] || config["fromName"] || fromEmail.split("@")[0] || "You";

      const emailConfig = {
        ...config,
        fromEmail,
        fromName,
        workspaceId: data.workspaceId,
      };

      sendResult = await sendEmailWithConfig({
        config: emailConfig as any,
        to: toEmail,
        subject: data.subject,
        text: data.body,
        html: data.html || `<p>${data.body.replace(/\n/g, "<br/>")}</p>`,
        attachments: data.attachments,
        threadId: data.threadId,
        inReplyTo: data.inReplyTo,
        references: data.references,
      });

      if (!sendResult.ok) {
        throw new Error(sendResult.error || "Failed to send email reply via SMTP.");
      }
    }

    const messageId = sendResult.messageId ?? `reply_${Date.now()}`;

    // Upload any attachments to Supabase Storage
    const processedAttachments: StoredEmailAttachment[] = [];
    if (data.attachments && data.attachments.length > 0) {
      for (const att of data.attachments) {
        const cleanLen = att.contentBase64.replace(/\s+/g, "").replace(/=+$/, "").length;
        const sizeBytes = Math.floor((cleanLen * 3) / 4);
        const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${data.workspaceId}/${messageId}/${safeName}`;

        try {
          const buffer = Buffer.from(att.contentBase64, "base64");
          await supabaseAdmin.storage
            .from("email-attachments")
            .upload(storagePath, buffer, {
              contentType: att.mimeType,
              upsert: true,
            });

          processedAttachments.push({
            filename: att.filename,
            mimeType: att.mimeType,
            size: sizeBytes,
            storagePath,
          });
        } catch (attErr) {
          console.warn("Could not upload reply attachment to storage:", attErr);
          processedAttachments.push({
            filename: att.filename,
            mimeType: att.mimeType,
            size: sizeBytes,
          });
        }
      }
    }

    const now = new Date();

    // Persist outbound reply into email_messages
    const { data: insertedMsg, error: insertErr } = await (supabaseAdmin as unknown as any)
      .from("email_messages")
      .insert({
        workspace_id: data.workspaceId,
        client_id: data.clientId,
        thread_id: data.threadId,
        provider_message_id: sendResult.messageId ?? messageId,
        rfc_message_id: sendResult.messageId ?? messageId,
        direction: "outbound",
        from_email: fromEmail,
        from_name: fromName,
        to_email: toEmail,
        subject: data.subject,
        body_text: data.body,
        body_html: data.html || `<p>${data.body.replace(/\n/g, "<br/>")}</p>`,
        attachments: processedAttachments,
        in_reply_to: data.inReplyTo ?? null,
        references: data.references ?? null,
        sent_at: now,
        received_at: now,
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error("Failed to insert email_message record:", insertErr);
    }

    // Insert activity log
    await context.supabase.from("activities").insert({
      client_id: data.clientId,
      type: "email",
      title: "Email reply sent",
      body: data.body.slice(0, 500),
      created_by: context.userId,
    });

    // Update client's last_contacted_at
    await context.supabase
      .from("clients")
      .update({ last_contacted_at: now.toISOString() })
      .eq("id", data.clientId);

    return {
      ok: true,
      messageId: sendResult.messageId,
      threadId: data.threadId,
      message: insertedMsg as EmailMessageRecord | undefined,
    };
  });

/**
 * Returns a temporary signed download URL for an email attachment stored in Supabase Storage.
 */
export const getEmailAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        storagePath: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);
    const res = await getAttachmentDownloadSignedUrl({
      workspaceId: data.workspaceId,
      storagePath: data.storagePath,
    });
    if (res.error || !res.signedUrl) {
      throw new Error(res.error || "Failed to generate attachment URL");
    }
    return { signedUrl: res.signedUrl };
  });

/**
 * Fetches all unmatched inbound emails (client_id IS NULL) for the workspace.
 */
export const getUnmatchedEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    const { data: rows, error } = await (context.supabase as unknown as any)
      .from("email_messages")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .is("client_id", null)
      .eq("direction", "inbound")
      .neq("rfc_message_id", "DELETED")
      .neq("rfc_message_id", "DELETE_ALL_MARKER")
      .order("received_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load unmatched emails: ${error.message}`);
    }

    return (rows ?? []) as EmailMessageRecord[];
  });

/**
 * Assigns an unmatched email (and its thread) to a specific client.
 */
export const assignEmailToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        messageId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    // Verify client belongs to workspace
    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("id, name, email")
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (clientErr || !client) {
      throw new Error("Target client not found in this workspace.");
    }

    // Get the message to find its thread_id
    const { data: targetMsg, error: msgErr } = await (supabaseAdmin as unknown as any)
      .from("email_messages")
      .select("id, thread_id")
      .eq("id", data.messageId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (msgErr || !targetMsg) {
      throw new Error("Message not found.");
    }

    // Assign this message and any messages in the same thread to this client
    if (targetMsg.thread_id) {
      const { error: updateErr } = await (supabaseAdmin as unknown as any)
        .from("email_messages")
        .update({ client_id: data.clientId })
        .eq("workspace_id", data.workspaceId)
        .eq("thread_id", targetMsg.thread_id);

      if (updateErr) {
        throw new Error(`Failed to assign email thread: ${updateErr.message}`);
      }
    } else {
      const { error: updateErr } = await (supabaseAdmin as unknown as any)
        .from("email_messages")
        .update({ client_id: data.clientId })
        .eq("workspace_id", data.workspaceId)
        .eq("id", data.messageId);

      if (updateErr) {
        throw new Error(`Failed to assign email: ${updateErr.message}`);
      }
    }

    return { success: true, clientName: client.name };
  });

/**
 * Triggers a live email sync for the workspace.
 * Runs Gmail sync (if Gmail integration configured) then IMAP sync (if SMTP/Hostinger
 * integration configured). Both are isolated in their own try/catch so one failing
 * never blocks the other.
 * Returns combined counts for display in the UI and debugging.
 */
export const triggerGmailSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    // Aggregate counters across all providers
    let totalFound = 0;
    let totalProcessed = 0;
    let totalInserted = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalErrors = 0;
    let primaryEmail = "";

    // ── Gmail sync (unchanged) ──────────────────────────────────────────
    try {
      const gmailResult = await syncGmailForWorkspace(data.workspaceId);
      totalFound     += gmailResult.found;
      totalProcessed += gmailResult.processed;
      totalInserted  += gmailResult.inserted;
      totalMatched   += gmailResult.matched;
      totalUnmatched += gmailResult.unmatched;
      totalErrors    += gmailResult.errors;
      primaryEmail    = gmailResult.myEmail;
      console.log(`[SYNC] Gmail sync done: inserted=${gmailResult.inserted}`);
    } catch (gmailErr) {
      // Gmail not configured or token expired — skip silently
      const msg = gmailErr instanceof Error ? gmailErr.message : String(gmailErr);
      console.log(`[SYNC] Gmail sync skipped or failed: ${msg}`);
    }

    // ── IMAP sync (Hostinger / SMTP workspaces) ─────────────────────────
    try {
      const imapResult = await syncImapForWorkspace(data.workspaceId);
      totalFound     += imapResult.found;
      totalProcessed += imapResult.processed;
      totalInserted  += imapResult.inserted;
      totalMatched   += imapResult.matched;
      totalUnmatched += imapResult.unmatched;
      totalErrors    += imapResult.errors;
      if (!primaryEmail && imapResult.account) primaryEmail = imapResult.account;
      console.log(`[SYNC] IMAP sync done: inserted=${imapResult.inserted}`);
    } catch (imapErr) {
      // IMAP not configured or connection failed — skip silently
      const msg = imapErr instanceof Error ? imapErr.message : String(imapErr);
      console.log(`[SYNC] IMAP sync skipped or failed: ${msg}`);
    }

    return {
      ok: true,
      // Legacy fields kept for backward compat
      synced: totalInserted,
      newMessages: totalInserted,
      total: totalFound,
      // Detailed combined counts
      found: totalFound,
      processed: totalProcessed,
      inserted: totalInserted,
      matched: totalMatched,
      unmatched: totalUnmatched,
      errors: totalErrors,
      myEmail: primaryEmail,
    };
  });

/**
 * Deletes a single email message record by ID.
 * Soft-deletes the record in email_messages so future Gmail syncs preserve the deletion.
 */
export const deleteEmailMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        messageId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    const { error } = await (supabaseAdmin as unknown as any)
      .from("email_messages")
      .update({
        client_id: null,
        rfc_message_id: "DELETED",
      })
      .eq("id", data.messageId)
      .eq("workspace_id", data.workspaceId);

    if (error) {
      throw new Error(`Failed to delete email message: ${error.message}`);
    }

    return { success: true };
  });

/**
 * Deletes all email conversation records for a client (never deletes the client).
 * Soft-deletes existing messages and inserts a Delete All tombstone marker cutoff timestamp
 * so future Gmail syncs do not re-import past emails.
 */
export const deleteAllClientEmailMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    // 1. Soft-delete all existing email_messages for this client
    const { error: updateErr, count } = await (supabaseAdmin as unknown as any)
      .from("email_messages")
      .update({
        client_id: null,
        rfc_message_id: "DELETED",
      })
      .eq("client_id", data.clientId)
      .eq("workspace_id", data.workspaceId);

    if (updateErr) {
      throw new Error(`Failed to delete email history: ${updateErr.message}`);
    }

    // 2. Fetch client email for reference
    const { data: client } = await context.supabase
      .from("clients")
      .select("email")
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    const clientEmail = client?.email?.trim() || "";
    const nowIso = new Date().toISOString();

    // 3. Upsert tombstone marker for Delete All cutoff timestamp
    await (supabaseAdmin as unknown as any).from("email_messages").insert({
      workspace_id: data.workspaceId,
      client_id: null,
      thread_id: `tombstone_${data.clientId}`,
      provider_message_id: `tombstone_${data.clientId}_${Date.now()}`,
      rfc_message_id: "DELETE_ALL_MARKER",
      direction: "inbound",
      from_email: clientEmail,
      to_email: "",
      subject: "[DELETE_ALL_MARKER]",
      body_text: data.clientId,
      received_at: nowIso,
    });

    return { success: true, count: count ?? 0 };
  });


