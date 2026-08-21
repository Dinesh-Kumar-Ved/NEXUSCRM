import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequestUrl } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import { personalize, type ClientRecord } from "./crm";
import { placeCall, sendEmail, sendSms, sendWhatsApp, type SendResult } from "./messaging.server";
import type { EmailAttachment } from "./google-auth.server";

type Client = SupabaseClient<Database>;
type Channel = "email" | "sms" | "whatsapp";

interface BaseArgs {
  supabase: Client;
  userId: string;
}

function recipientFor(client: ClientRecord, channel: Channel): string | null {
  if (channel === "email") return client.email;
  if (channel === "whatsapp") return client.whatsapp ?? client.phone;
  return client.phone;
}

function optedOut(client: ClientRecord, channel: Channel): boolean {
  if (channel === "email") return client.email_opted_out;
  return client.sms_opted_out;
}

async function loadClients(supabase: Client, ids: string[]): Promise<ClientRecord[]> {
  const { data, error } = await supabase.from("clients").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ClientRecord[];
}

async function deliver(
  supabase: Client,
  workspaceId: string | null | undefined,
  channel: Channel,
  to: string,
  subject: string,
  text: string,
  options?: {
    cc?: string[] | undefined;
    bcc?: string[] | undefined;
    html?: string | undefined;
    attachments?: EmailAttachment[] | undefined;
    threadId?: string | undefined;
    inReplyTo?: string | undefined;
    references?: string | undefined;
  },
): Promise<SendResult> {
  if (workspaceId) {
    const { getWorkspaceIntegrationConfig, sendMetaWhatsAppMessage, sendEmailWithConfig } =
      await import("./integrations.server");

    if (channel === "whatsapp") {
      const wa = await getWorkspaceIntegrationConfig(supabase, workspaceId, "whatsapp");
      const waConfig = wa?.config as Record<string, any> | undefined;
      if (waConfig && waConfig["phoneNumberId"] && waConfig["accessToken"]) {
        const res = await sendMetaWhatsAppMessage({
          phoneNumberId: String(waConfig["phoneNumberId"]),
          accessToken: String(waConfig["accessToken"]),
          to,
          text,
        });
        return {
          ok: res.ok,
          provider: "meta_whatsapp",
          status: res.ok ? "sent" : "failed",
          providerMessageId: res.messageId,
          error: res.error,
        };
      }
    }

    if (channel === "email") {
      const em = await getWorkspaceIntegrationConfig(supabase, workspaceId, "email");
      if (em?.config && (em.config as any).fromEmail) {
        const res = await sendEmailWithConfig({
          config: em.config as any,
          to,
          cc: options?.cc,
          bcc: options?.bcc,
          subject,
          text,
          html: options?.html,
          attachments: options?.attachments,
          threadId: options?.threadId,
          inReplyTo: options?.inReplyTo,
          references: options?.references,
        });
        return {
          ok: res.ok,
          provider: em.provider,
          status: res.ok ? "sent" : "failed",
          providerMessageId: res.messageId,
          error: res.error,
        };
      }
    }
  }

  // Fallback to default env vars
  if (channel === "email") return sendEmail({ to, subject, text });
  if (channel === "sms") return sendSms({ to, text });
  return sendWhatsApp({ to, text });
}

async function recordMessage(args: {
  supabase: Client;
  userId: string;
  clientId: string;
  campaignId?: string | null;
  channel: Channel;
  subject: string | null;
  body: string;
  to: string;
  result: SendResult;
}) {
  const { supabase, result } = args;
  await supabase.from("messages").insert({
    client_id: args.clientId,
    campaign_id: args.campaignId ?? null,
    channel: args.channel,
    direction: "outbound",
    subject: args.subject,
    body: args.body,
    to_address: args.to,
    status: result.ok ? result.status : "failed",
    provider: result.provider,
    provider_message_id: result.providerMessageId ?? null,
    error: result.error ?? null,
    created_by: args.userId,
  });

  await supabase.from("activities").insert({
    client_id: args.clientId,
    type: args.channel,
    title: result.ok
      ? `${args.channel === "email" ? "Email" : args.channel === "sms" ? "SMS" : "WhatsApp"} sent`
      : `${args.channel} failed`,
    body: result.ok ? args.body.slice(0, 500) : (result.error ?? "Delivery failed"),
    created_by: args.userId,
  });

  if (result.ok) {
    await supabase
      .from("clients")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", args.clientId);
  }
}

export async function deliverToClient(
  args: BaseArgs & {
    clientId: string;
    channel: Channel;
    to?: string | undefined;
    cc?: string[] | undefined;
    bcc?: string[] | undefined;
    subject?: string | undefined;
    body: string;
    html?: string | undefined;
    attachments?: EmailAttachment[] | undefined;
    threadId?: string | undefined;
    inReplyTo?: string | undefined;
    references?: string | undefined;
  },
) {
  const [client] = await loadClients(args.supabase, [args.clientId]);
  if (!client) throw new Error("Client not found");

  const to = args.to?.trim() || recipientFor(client, args.channel);
  if (!to) {
    return { ok: false, error: `This client has no ${args.channel} contact details.` };
  }
  if (optedOut(client, args.channel)) {
    return { ok: false, error: "This client has opted out of this channel." };
  }
  if (args.channel === "email" && (!to.includes("@") || !to.includes("."))) {
    return { ok: false, error: `Invalid recipient email address: "${to}"` };
  }

  const body = personalize(args.body, client);
  const subject = personalize(args.subject ?? "", client);

  console.log(
    `[DIRECT_DISPATCH] Client: ${client.id} | Channel: ${args.channel} | To: ${to} | Subject: "${subject || "Message from your account team"}" | Attachments: ${args.attachments?.length ?? 0}`,
  );

  const result = await deliver(
    args.supabase,
    client.workspace_id,
    args.channel,
    to,
    subject || "Message from your account team",
    body,
    {
      cc: args.cc,
      bcc: args.bcc,
      html: args.html ? personalize(args.html, client) : undefined,
      attachments: args.attachments,
      threadId: args.threadId,
      inReplyTo: args.inReplyTo,
      references: args.references,
    },
  );

  await recordMessage({
    supabase: args.supabase,
    userId: args.userId,
    clientId: client.id,
    channel: args.channel,
    subject: args.channel === "email" ? subject : null,
    body,
    to,
    result,
  });

  return {
    ok: result.ok,
    error: result.error ?? null,
    status: result.status,
    providerMessageId: result.providerMessageId,
  };
}

export async function runCampaign(
  args: BaseArgs & {
    clientIds: string[];
    channel: Channel;
    subject?: string | undefined;
    body: string;
    campaignName: string;
    templateId?: string | undefined;
  },
) {
  const clients = await loadClients(args.supabase, args.clientIds);

  const { data: campaign, error: campaignError } = await args.supabase
    .from("campaigns")
    .insert({
      name: args.campaignName,
      channel: args.channel,
      subject: args.subject ?? null,
      body: args.body,
      recipient_count: clients.length,
      status: "sending",
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (campaignError) throw new Error(campaignError.message);

  let sent = 0;
  let failed = 0;
  const skipped: string[] = [];
  const source = args.templateId ? "template" : "custom";

  for (const client of clients) {
    const rawTo = recipientFor(client, args.channel);
    const to = rawTo?.trim();

    if (!to) {
      skipped.push(`${client.name} (no ${args.channel} address)`);
      failed += 1;
      await recordMessage({
        supabase: args.supabase,
        userId: args.userId,
        clientId: client.id,
        campaignId: campaign.id,
        channel: args.channel,
        subject: args.channel === "email" ? (args.subject ?? null) : null,
        body: args.body,
        to: "N/A",
        result: {
          ok: false,
          status: "failed",
          provider: "none",
          error: `Client has no ${args.channel} contact address.`,
        },
      });
      continue;
    }

    if (optedOut(client, args.channel)) {
      skipped.push(`${client.name} (opted out)`);
      continue;
    }

    if (args.channel === "email" && (!to.includes("@") || !to.includes("."))) {
      skipped.push(`${client.name} (invalid email: ${to})`);
      failed += 1;
      await recordMessage({
        supabase: args.supabase,
        userId: args.userId,
        clientId: client.id,
        campaignId: campaign.id,
        channel: args.channel,
        subject: args.channel === "email" ? (args.subject ?? null) : null,
        body: args.body,
        to,
        result: {
          ok: false,
          status: "failed",
          provider: "none",
          error: `Invalid recipient email address: "${to}"`,
        },
      });
      continue;
    }

    const body = personalize(args.body, client);
    const subject = personalize(args.subject ?? "", client);

    console.log(
      `[BROADCAST_DISPATCH] Starting send | source=${source} | Campaign: ${campaign.id} | Client: ${client.id} | Recipient: ${to} | Subject: "${subject || "Update from your account team"}" | messageLength=${body.length}`,
    );

    const result = await deliver(
      args.supabase,
      client.workspace_id,
      args.channel,
      to,
      subject || "Update from your account team",
      body,
    );

    if (result.ok) {
      sent += 1;
      console.log(
        `[BROADCAST_DISPATCH] Delivered | source=${source} | Campaign: ${campaign.id} | Client: ${client.id} | Recipient: ${to} | Provider: ${result.provider} | provider_message_id=${result.providerMessageId || "N/A"}`,
      );
    } else {
      failed += 1;
      console.error(
        `[BROADCAST_DISPATCH] Failed | source=${source} | Campaign: ${campaign.id} | Client: ${client.id} | Recipient: ${to} | Error: ${result.error}`,
      );
    }

    await recordMessage({
      supabase: args.supabase,
      userId: args.userId,
      clientId: client.id,
      campaignId: campaign.id,
      channel: args.channel,
      subject: args.channel === "email" ? subject : null,
      body,
      to,
      result,
    });
  }

  const finalStatus =
    sent === 0 && failed > 0
      ? "failed"
      : failed > 0 || skipped.length > 0
        ? "partially_failed"
        : "completed";

  await args.supabase
    .from("campaigns")
    .update({
      sent_count: sent,
      failed_count: failed,
      recipient_count: clients.length,
      status: finalStatus,
    })
    .eq("id", campaign.id);

  return { campaignId: campaign.id, sent, failed, skipped };
}

export async function dialClient(
  args: BaseArgs & { clientId: string; message?: string | undefined },
) {
  const [client] = await loadClients(args.supabase, [args.clientId]);
  if (!client) throw new Error("Client not found");
  if (!client.phone) return { ok: false, error: "This client has no phone number." };

  let statusCallbackUrl: string | undefined;
  try {
    const url = getRequestUrl();
    statusCallbackUrl = `${url.origin}/api/public/twilio/call-status`;
  } catch {
    statusCallbackUrl = undefined;
  }

  const result = await placeCall({
    to: client.phone,
    message: args.message,
    statusCallbackUrl,
  });

  await args.supabase.from("call_logs").insert({
    client_id: client.id,
    direction: "outbound",
    to_number: client.phone,
    status: result.ok ? result.status : "failed",
    provider: result.provider,
    provider_call_id: result.providerMessageId ?? null,
    created_by: args.userId,
  });

  await args.supabase.from("activities").insert({
    client_id: client.id,
    type: "call",
    title: result.ok ? "Call placed" : "Call failed",
    body: result.error ?? `Outbound call to ${client.phone}`,
    created_by: args.userId,
  });

  if (result.ok) {
    await args.supabase
      .from("clients")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", client.id);
  }

  return { ok: result.ok, error: result.error ?? null };
}
