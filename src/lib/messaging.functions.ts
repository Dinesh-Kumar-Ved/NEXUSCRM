import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const channelSchema = z.enum(["email", "sms", "whatsapp"]);

const MAX_ATTACHMENT_SIZE_PER_FILE = 10 * 1024 * 1024; // 10 MB per file
const MAX_ATTACHMENT_SIZE_TOTAL = 25 * 1024 * 1024; // 25 MB total

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "ps1", "msi", "scr", "vbs", "js", "com", "pif",
  "sh", "dll", "reg", "jse", "wsf", "wsh", "cpl", "jar", "py", "pyc",
  "rb", "pl", "php", "cgi", "htaccess", "htpasswd", "lnk", "inf",
]);

const ALLOWED_MIME_PREFIXES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml",
];

const attachmentSchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    contentBase64: z.string().min(1),
  })
  .superRefine((att, ctx) => {
    // Extension validation
    const ext = att.filename.split(".").pop()?.toLowerCase() ?? "";
    if (BLOCKED_EXTENSIONS.has(ext)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File type ".${ext}" is blocked for security.`,
      });
      return;
    }
    // Base64 size estimate: 3 bytes per 4 base64 chars, ignoring whitespace
    const cleanLen = att.contentBase64.replace(/\s+/g, "").replace(/=+$/, "").length;
    const sizeBytes = Math.floor((cleanLen * 3) / 4);
    if (sizeBytes > MAX_ATTACHMENT_SIZE_PER_FILE) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_ATTACHMENT_SIZE_PER_FILE,
        type: "number",
        inclusive: true,
        message: `Attachment "${att.filename}" exceeds 10 MB limit.`,
      });
    }
  });

const sendSchema = z
  .object({
    clientId: z.string().uuid(),
    channel: channelSchema,
    to: z.string().optional(),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string().max(300).optional(),
    body: z.string().min(1).max(10000),
    html: z.string().max(30000).optional(),
    attachments: z.array(attachmentSchema).max(20).optional(),
    threadId: z.string().max(512).optional(),
    inReplyTo: z.string().max(512).optional(),
    references: z.string().max(4096).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.attachments || data.attachments.length === 0) return;
    let totalBytes = 0;
    for (const att of data.attachments) {
      const cleanLen = att.contentBase64.replace(/\s+/g, "").replace(/=+$/, "").length;
      totalBytes += Math.floor((cleanLen * 3) / 4);
    }
    if (totalBytes > MAX_ATTACHMENT_SIZE_TOTAL) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_ATTACHMENT_SIZE_TOTAL,
        type: "number",
        inclusive: true,
        message: `Total attachments size exceeds 25 MB limit.`,
        path: ["attachments"],
      });
    }
  });

const bulkSchema = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(500),
  channel: channelSchema,
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(6000),
  campaignName: z.string().min(1).max(160),
  templateId: z.string().uuid().optional(),
});

const callSchema = z.object({
  clientId: z.string().uuid(),
  message: z.string().max(600).optional(),
});

export const getMessagingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getProviderStatus } = await import("./messaging.server");
    return getProviderStatus();
  });

export const sendClientMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => sendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { deliverToClient } = await import("./messaging-dispatch.server");
    return deliverToClient({
      supabase: context.supabase,
      userId: context.userId,
      clientId: data.clientId,
      channel: data.channel,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      body: data.body,
      html: data.html,
      attachments: data.attachments,
      threadId: data.threadId,
      inReplyTo: data.inReplyTo,
      references: data.references,
    });
  });

export const sendBulkMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => bulkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { runCampaign } = await import("./messaging-dispatch.server");
    return runCampaign({
      supabase: context.supabase,
      userId: context.userId,
      clientIds: data.clientIds,
      channel: data.channel,
      subject: data.subject,
      body: data.body,
      campaignName: data.campaignName,
      templateId: data.templateId,
    });
  });

export const startClientCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => callSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { dialClient } = await import("./messaging-dispatch.server");
    return dialClient({
      supabase: context.supabase,
      userId: context.userId,
      clientId: data.clientId,
      message: data.message,
    });
  });
