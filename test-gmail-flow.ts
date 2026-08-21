import { config } from "dotenv";
config({ path: ".env" });

import { supabaseAdmin } from "./src/integrations/supabase/client.server";
import { syncGmailForWorkspace } from "./src/lib/gmail-sync.server";

async function main() {
  console.log("=== STARTING REAL GMAIL E2E TEST ===");
  console.log("Supabase URL:", process.env.SUPABASE_URL);

  // 1. Get workspace and client
  const { data: clients, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id, workspace_id, email, first_name, last_name")
    .ilike("email", "%dkvedbusiness@gmail.com%")
    .limit(1);

  if (clientErr) {
    console.error("DB Error:", clientErr);
    return;
  }

  if (!clients || clients.length === 0) {
    console.error("Client not found!");
    return;
  }

  const client = clients[0];
  console.log("Found Client:", client);

  // 2. Query existing email_messages before sync
  console.log("\n--- email_messages BEFORE sync ---");
  let { data: messagesBefore } = await supabaseAdmin
    .from("email_messages")
    .select("id, client_id, direction, thread_id, provider_message_id, from_email, to_email, subject, body_text, received_at, sent_at")
    .eq("client_id", client.id)
    .order("received_at", { ascending: true });

  console.log(messagesBefore);

  // 3. Trigger sync
  console.log("\n--- RUNNING GMAIL SYNC ---");
  try {
    const result = await syncGmailForWorkspace(client.workspace_id);
    console.log("Sync Result:", result);
  } catch (err) {
    console.error("Sync Error:", err);
  }

  // 4. Query existing email_messages after sync
  console.log("\n--- email_messages AFTER sync ---");
  let { data: messagesAfter } = await supabaseAdmin
    .from("email_messages")
    .select("id, client_id, direction, thread_id, provider_message_id, from_email, to_email, subject, body_text, received_at, sent_at")
    .eq("client_id", client.id)
    .order("received_at", { ascending: true });

  console.log(messagesAfter);
}

main().catch(console.error);
