/**
 * Diagnostic script: fetches a sample of rows from every known table
 * in the NexusCRM Supabase database and prints a summary.
 *
 * Usage:  node --env-file=.env fetch-all-tables.cjs
 */
const { createClient } = require("@supabase/supabase-js");

const TABLES = [
  "workspaces",
  "workspace_members",
  "profiles",
  "user_roles",
  "clients",
  "activities",
  "call_logs",
  "campaigns",
  "documents",
  "messages",
  "status_history",
  "tasks",
  "templates",
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  console.log(`\n🔗 Connecting to Supabase: ${url}\n`);
  const supabase = createClient(url, key);

  const summary = [];

  for (const table of TABLES) {
    // Fetch count
    const { count, error: countErr } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    if (countErr) {
      console.error(`❌ ${table}: ${countErr.message}`);
      summary.push({ table, rows: "ERROR", sample: countErr.message });
      continue;
    }

    // Fetch up to 5 sample rows
    const { data, error: dataErr } = await supabase
      .from(table)
      .select("*")
      .limit(5);

    if (dataErr) {
      console.error(`❌ ${table} (data): ${dataErr.message}`);
      summary.push({ table, rows: count, sample: dataErr.message });
      continue;
    }

    summary.push({ table, rows: count, sample: data });

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 TABLE: ${table}  (${count} rows)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (data.length === 0) {
      console.log("   (empty)\n");
    } else {
      data.forEach((row, i) => {
        console.log(`   Row ${i + 1}:`, JSON.stringify(row, null, 2));
      });
      if (count > 5) {
        console.log(`   ... and ${count - 5} more rows`);
      }
      console.log();
    }
  }

  // Print summary table
  console.log(`\n${"=".repeat(50)}`);
  console.log("📊 SUMMARY");
  console.log(`${"=".repeat(50)}`);
  console.log(`${"Table".padEnd(25)} ${"Row Count".padStart(10)}`);
  console.log(`${"-".repeat(25)} ${"-".repeat(10)}`);
  for (const s of summary) {
    const rowStr = typeof s.rows === "number" ? String(s.rows) : s.rows;
    console.log(`${s.table.padEnd(25)} ${rowStr.padStart(10)}`);
  }
  console.log();
}

main().catch(console.error);
