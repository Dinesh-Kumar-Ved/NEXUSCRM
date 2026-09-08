import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DealStatus } from "./crm";
import { formatClientEmails, parseClientEmails } from "./email-utils";

const clientImportItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  company: z.string().trim().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  whatsapp: z.string().trim().nullable().optional(),
  website: z.string().trim().nullable().optional(),
  source: z.string().trim().nullable().optional(),
  status: z
    .enum([
      "lead",
      "proposal_sent",
      "negotiating",
      "working_with_client",
      "follow_up_needed",
      "on_hold",
      "accepted",
      "rejected",
    ])
    .optional()
    .default("lead"),
  deal_value: z.number().nonnegative().optional().default(0),
  notes: z.string().trim().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
});

const importClientsSchema = z.object({
  workspaceId: z.string().uuid(),
  clients: z.array(clientImportItemSchema).min(1, "At least one client is required"),
});

export type ClientImportItem = z.infer<typeof clientImportItemSchema>;

export const importClientsServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => importClientsSchema.parse(input))
  .handler(async ({ data, context }) => {
    // 1. Verify that the authenticated user is an authorized member of the workspace
    const { data: membership, error: memError } = await context.supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (memError || !membership) {
      throw new Error("Unauthorized: you do not have access to this workspace.");
    }

    // 2. Fetch existing workspace client emails and phones to prevent duplicate insertion
    const { data: existingClients, error: extError } = await context.supabase
      .from("clients")
      .select("email, phone")
      .eq("workspace_id", data.workspaceId);

    if (extError) throw extError;

    const existingEmails = new Set<string>();
    const existingPhones = new Set<string>();

    for (const c of existingClients || []) {
      if (c.email) {
        for (const e of parseClientEmails(c.email)) {
          existingEmails.add(e.toLowerCase());
        }
      }
      if (c.phone) {
        const cleaned = c.phone.replace(/[^0-9+]/g, "");
        if (cleaned) existingPhones.add(cleaned);
      }
    }

    // 3. Filter valid clients, deduplicating within the batch and against existing CRM
    const seenEmailsInBatch = new Set<string>();
    const seenPhonesInBatch = new Set<string>();
    const toInsert: Array<{
      workspace_id: string;
      created_by: string;
      name: string;
      company: string | null;
      email: string | null;
      phone: string | null;
      whatsapp: string | null;
      website: string | null;
      source: string | null;
      status: DealStatus;
      deal_value: number;
      notes: string | null;
      tags: string[];
    }> = [];

    let skippedDuplicates = 0;

    for (const client of data.clients) {
      const clientEmails = parseClientEmails(client.email);
      const phoneClean = client.phone ? client.phone.replace(/[^0-9+]/g, "") : null;

      // Duplicate check: check if any of client's emails exist in CRM or batch
      let isDuplicate = false;
      for (const email of clientEmails) {
        const lower = email.toLowerCase();
        if (existingEmails.has(lower) || seenEmailsInBatch.has(lower)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate && phoneClean) {
        if (existingPhones.has(phoneClean) || seenPhonesInBatch.has(phoneClean)) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        skippedDuplicates++;
        continue;
      }

      for (const email of clientEmails) {
        seenEmailsInBatch.add(email.toLowerCase());
      }
      if (phoneClean) seenPhonesInBatch.add(phoneClean);

      toInsert.push({
        workspace_id: data.workspaceId,
        created_by: context.userId,
        name: client.name,
        company: client.company || null,
        email: formatClientEmails(clientEmails),
        phone: client.phone || null,
        whatsapp: client.whatsapp || null,
        website: client.website || null,
        source: client.source || null,
        status: client.status as DealStatus,
        deal_value: client.deal_value,
        notes: client.notes || null,
        tags: client.tags,
      });
    }

    // 4. Batch insert into database in chunks of 50
    let imported = 0;
    let failed = 0;
    const CHUNK_SIZE = 50;

    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await context.supabase.from("clients").insert(chunk);

      if (insertError) {
        console.error("[IMPORT_CLIENTS] Chunk insert failed:", insertError);
        failed += chunk.length;
      } else {
        imported += chunk.length;
      }
    }

    return {
      imported,
      skippedDuplicates,
      failed,
      total: data.clients.length,
    };
  });
