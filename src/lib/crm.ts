export const DEAL_STATUSES = [
  "lead",
  "proposal_sent",
  "negotiating",
  "working_with_client",
  "follow_up_needed",
  "on_hold",
  "accepted",
  "rejected",
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

export const STATUS_LABELS: Record<DealStatus, string> = {
  lead: "Lead",
  proposal_sent: "Proposal Sent",
  negotiating: "Negotiating",
  working_with_client: "Working With Client",
  follow_up_needed: "Follow-up Needed",
  on_hold: "On Hold",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const PIPELINE_ORDER: DealStatus[] = [
  "lead",
  "proposal_sent",
  "negotiating",
  "working_with_client",
  "follow_up_needed",
  "on_hold",
  "accepted",
  "rejected",
];

export type Channel = "email" | "sms" | "whatsapp" | "call";

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  call: "Call",
};

export const CLIENT_SOURCES = [
  "Referral",
  "Website",
  "Cold Outreach",
  "Social Media",
  "Event",
  "Partner",
  "Other",
];

export interface ClientRecord {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  tags: string[];
  status: DealStatus;
  deal_value: number;
  notes: string | null;
  assigned_to: string | null;
  created_by: string | null;
  last_contacted_at: string | null;
  email_opted_out: boolean;
  sms_opted_out: boolean;
  created_at: string;
  updated_at: string;
  website: string | null;
  workspace_id: string;
}

/** Replace {{tokens}} with client values for personalized messaging. */
export function personalize(template: string | null | undefined, client: Partial<ClientRecord>): string {
  if (!template || typeof template !== "string") return "";
  const map: Record<string, string> = {
    client_name: client.name ?? "there",
    first_name: (client.name ?? "there").split(" ")[0] ?? "there",
    company: client.company ?? "your company",
    email: client.email ?? "",
    phone: client.phone ?? "",
    status: client.status ? (STATUS_LABELS[client.status as DealStatus] || client.status) : "",
  };
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (full, key: string) =>
    key in map ? map[key]! : full,
  );
}

export const PERSONALIZATION_TOKENS = [
  "{{client_name}}",
  "{{first_name}}",
  "{{company}}",
  "{{status}}",
];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Very small CSV parser that copes with quoted fields and embedded commas. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return body.map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown) => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(",")),
  ].join("\n");
}

export function downloadFile(filename: string, content: string, mime = "text/csv") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
