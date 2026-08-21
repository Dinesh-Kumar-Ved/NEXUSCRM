const { createClient } = require("@supabase/supabase-js");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: clients } = await supabase
    .from("clients")
    .select("id, email, first_name");

  if (!clients || clients.length === 0) {
    console.error("No client found in DB!");
    return;
  }
  
  console.log("Found clients:", clients);
  const client = clients.find(c => c.email && c.email.toLowerCase().includes("dkvedbusiness"));

  if (!client) {
    console.error("Dinesh not found among clients!");
    return;
  }
  
  console.log("Found Dinesh:", client);

  const { data: messages, error } = await supabase
    .from("email_messages")
    .select("*")
    .eq("client_id", client.id)
    .order("received_at", { ascending: true });

  if (error) {
    console.error("Error fetching messages:", error);
    return;
  }

  console.log(`Found ${messages.length} messages for client ${client.id}:`);
  messages.forEach(msg => {
    console.log(`\n--- MESSAGE ---`);
    console.log(`ID: ${msg.id}`);
    console.log(`Direction: ${msg.direction}`);
    console.log(`Thread ID: ${msg.thread_id}`);
    console.log(`Provider Msg ID: ${msg.provider_message_id}`);
    console.log(`From: ${msg.from_email}`);
    console.log(`To: ${msg.to_email}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(`Body (snippet): ${msg.body_text?.substring(0, 100)}...`);
  });
}
main();
