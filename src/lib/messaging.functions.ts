import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const channelSchema = z.enum(["email", "sms", "whatsapp"]);

const sendSchema = z.object({
  clientId: z.string().uuid(),
  channel: channelSchema,
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(6000),
});

const bulkSchema = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(500),
  channel: channelSchema,
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(6000),
  campaignName: z.string().min(1).max(160),
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
  .inputValidator((input: unknown) => sendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { deliverToClient } = await import("./messaging-dispatch.server");
    return deliverToClient({
      supabase: context.supabase,
      userId: context.userId,
      clientId: data.clientId,
      channel: data.channel,
      subject: data.subject,
      body: data.body,
    });
  });

export const sendBulkMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => bulkSchema.parse(input))
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
    });
  });

export const startClientCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => callSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { dialClient } = await import("./messaging-dispatch.server");
    return dialClient({
      supabase: context.supabase,
      userId: context.userId,
      clientId: data.clientId,
      message: data.message,
    });
  });
