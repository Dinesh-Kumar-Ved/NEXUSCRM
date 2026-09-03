import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        workspaceId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { removeClientFromDb } = await import("./clients-dispatch.server");
    return removeClientFromDb({
      clientId: data.clientId,
      workspaceId: data.workspaceId,
      userId: context.userId,
    });
  });

export const deleteBulkClientsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clientIds: z.array(z.string().uuid()).min(1).max(500),
        workspaceId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { removeBulkClientsFromDb } = await import("./clients-dispatch.server");
    return removeBulkClientsFromDb({
      clientIds: data.clientIds,
      workspaceId: data.workspaceId,
      userId: context.userId,
    });
  });
