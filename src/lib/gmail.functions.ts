import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeHtml } from "./sanitize";

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
  subject: string;
  body_text: string | null;
  body_html: string | null;
  in_reply_to: string | null;
  references: string | null;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface EmailConversationThread {
  threadId: string;
  subject: string;
  lastMessageAt: string;
  snippet: string;
  messages: EmailMessageRecord[];
}

/**
 * Validates that the user is a member of the given workspace.
 */
async function verifyWorkspaceMembership(
  supabase: any,
  workspaceId: string,
  userId: string,
) {
  const { data: member, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !member) {
    throw new Error("Unauthorized: You do not have access to this workspace.");
  }
  return member;
}

/**
 * 1. Server function to manually trigger a Gmail sync for a workspace.
 */
export const syncGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ workspaceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);
    const { syncGmailForWorkspace } = await import("./gmail-sync.server");
    const result = await syncGmailForWorkspace(data.workspaceId);
    return { ok: true, ...result };
  });

/**
 * 2. Server function to fetch email conversations for a specific client.
 */
export const getClientEmailConversations = createServerFn({ method: "GET" })
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

    // Verify client belongs to workspace
    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("id, email, name")
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (clientErr || !client) {
      throw new Error("Client not found in workspace.");
    }

    // Query email messages for this client
    const { data: messages, error: msgErr } = await (supabaseAdmin as any)
      .from("email_messages")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .eq("client_id", data.clientId)
      .order("received_at", { ascending: true });

    if (msgErr) {
      console.error("Error fetching email messages:", msgErr);
      throw new Error("Failed to load email conversations.");
    }

    const rawList: EmailMessageRecord[] = (messages ?? []) as EmailMessageRecord[];

    // Group messages by thread_id
    const threadMap = new Map<string, EmailMessageRecord[]>();
    for (const msg of rawList) {
      const tid = msg.thread_id || msg.id;
      if (!threadMap.has(tid)) {
        threadMap.set(tid, []);
      }
      threadMap.get(tid)!.push(msg);
    }

    const threads: EmailConversationThread[] = [];
    for (const [threadId, threadMsgs] of threadMap.entries()) {
      const firstMsg = threadMsgs[0];
      const lastMsg = threadMsgs[threadMsgs.length - 1];
      const subject =
        firstMsg?.subject ||
        threadMsgs.find((m) => m.subject)?.subject ||
        "(No Subject)";

      threads.push({
        threadId,
        subject,
        lastMessageAt: lastMsg?.received_at || lastMsg?.created_at || new Date().toISOString(),
        snippet: lastMsg?.body_text?.slice(0, 150) || "",
        messages: threadMsgs,
      });
    }

    // Order threads by newest activity first
    threads.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );

    return { ok: true, client, threads };
  });

/**
 * 3. Server function to send a reply inside an existing Gmail thread.
 */
export const sendGmailReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        clientId: z.string().uuid(),
        threadId: z.string().min(1),
        subject: z.string().min(1),
        body: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    // Verify client belongs to workspace
    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("id, name, email, workspace_id")
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (clientErr || !client || !client.email) {
      return { ok: false, error: "Client does not have a valid email address." };
    }

    // Get previous messages in thread to determine In-Reply-To and References
    const { data: threadMsgs } = await (supabaseAdmin as any)
      .from("email_messages")
      .select("rfc_message_id, references, in_reply_to")
      .eq("workspace_id", data.workspaceId)
      .eq("thread_id", data.threadId)
      .order("received_at", { ascending: true });

    let inReplyTo: string | undefined = undefined;
    let references: string | undefined = undefined;

    if (threadMsgs && threadMsgs.length > 0) {
      const lastMsgWithRfc = [...threadMsgs].reverse().find((m: any) => m.rfc_message_id);
      if (lastMsgWithRfc) {
        inReplyTo = lastMsgWithRfc.rfc_message_id;
        const previousRefs = threadMsgs
          .map((m: any) => m.rfc_message_id)
          .filter(Boolean);
        references = Array.from(new Set(previousRefs)).join(" ");
      }
    }

    const { getAccessTokenForWorkspace } = await import("./gmail-sync.server");
    const { fetchGmailProfile, sendGmailMessage } = await import("./google-auth.server");

    let accessToken: string;
    let fromEmail: string;
    try {
      accessToken = await getAccessTokenForWorkspace(data.workspaceId);
      const profile = await fetchGmailProfile(accessToken);
      fromEmail = profile.emailAddress;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to obtain Gmail credentials.";
      return { ok: false, error: msg };
    }

    const htmlBody = `<p>${data.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`;

    const sendRes = await sendGmailMessage({
      accessToken,
      from: fromEmail,
      to: client.email.trim(),
      subject: data.subject.startsWith("Re:") ? data.subject : `Re: ${data.subject}`,
      text: data.body,
      html: htmlBody,
      threadId: data.threadId,
      inReplyTo,
      references,
    });

    if (!sendRes.ok) {
      return { ok: false, error: sendRes.error || "Failed to dispatch Gmail reply." };
    }

    // Persist outbound reply in email_messages
    const safeHtml = sanitizeHtml(htmlBody);
    await (supabaseAdmin as any).from("email_messages").insert({
      workspace_id: data.workspaceId,
      client_id: data.clientId,
      thread_id: data.threadId,
      provider_message_id: sendRes.messageId || `out_${Date.now()}`,
      rfc_message_id: "",
      direction: "outbound",
      from_email: fromEmail,
      to_email: client.email.trim(),
      subject: data.subject.startsWith("Re:") ? data.subject : `Re: ${data.subject}`,
      body_text: data.body,
      body_html: safeHtml,
      in_reply_to: inReplyTo ?? null,
      references: references ?? null,
      received_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    });

    // Also record in CRM messages and activities for timeline visibility
    await context.supabase.from("messages").insert({
      client_id: data.clientId,
      channel: "email",
      direction: "outbound",
      subject: data.subject,
      body: data.body,
      to_address: client.email.trim(),
      status: "sent",
      provider: "gmail",
      provider_message_id: sendRes.messageId ?? null,
      created_by: context.userId,
    });

    await context.supabase.from("activities").insert({
      client_id: data.clientId,
      type: "email",
      title: "Email reply sent (Gmail)",
      body: data.body.slice(0, 500),
      created_by: context.userId,
    });

    await context.supabase
      .from("clients")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", data.clientId);

    return { ok: true, messageId: sendRes.messageId };
  });

/**
 * 4. Server function to fetch unmatched inbound emails (client_id IS NULL).
 */
export const getUnmatchedEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ workspaceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    const { data: messages, error } = await (supabaseAdmin as any)
      .from("email_messages")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .is("client_id", null)
      .order("received_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching unmatched emails:", error);
      throw new Error("Failed to load unmatched emails.");
    }

    return { ok: true, emails: (messages ?? []) as EmailMessageRecord[] };
  });

/**
 * 5. Server function to assign an unmatched email thread/message to an existing client.
 */
export const assignEmailToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        emailMessageId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await verifyWorkspaceMembership(context.supabase, data.workspaceId, context.userId);

    // Verify client exists in workspace
    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("id, name, email")
      .eq("id", data.clientId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (clientErr || !client) {
      throw new Error("Target client not found in workspace.");
    }

    // Get the target email message to find its thread_id
    const { data: emailMsg } = await (supabaseAdmin as any)
      .from("email_messages")
      .select("id, thread_id")
      .eq("id", data.emailMessageId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    if (!emailMsg) {
      throw new Error("Email message not found.");
    }

    // Assign all messages in this thread to the client
    const { error: updateErr } = await (supabaseAdmin as any)
      .from("email_messages")
      .update({ client_id: data.clientId })
      .eq("workspace_id", data.workspaceId)
      .eq("thread_id", emailMsg.thread_id);

    if (updateErr) {
      console.error("Error assigning email to client:", updateErr);
      throw new Error("Failed to assign email to client.");
    }

    return { ok: true, clientName: client.name };
  });
