import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAccessTokenForWorkspace } from "@/lib/gmail-sync.server";
import { fetchGmailProfile, sendGmailMessage, type EmailAttachment } from "@/lib/google-auth.server";

const json = (data: any, init?: ResponseInit) => 
  new Response(JSON.stringify(data), { 
    status: init?.status || 200, 
    headers: { "Content-Type": "application/json", ...init?.headers } 
  });

const MAX_PER_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
const BLOCKED_EXTS = new Set([
  "exe", "bat", "cmd", "ps1", "msi", "scr", "vbs", "js", "com", "pif",
  "sh", "dll", "reg", "jse", "wsf", "wsh", "cpl", "jar", "py", "pyc",
  "rb", "pl", "php", "cgi", "htaccess", "htpasswd", "lnk", "inf",
]);

function estimateBase64Bytes(base64: string): number {
  const clean = base64.replace(/\s+/g, "").replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

function validateAttachments(raw: unknown): EmailAttachment[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "Attachments must be an array.";
  if (raw.length > 20) return "Maximum 20 attachments allowed.";

  const result: EmailAttachment[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] as any;
    if (!a || typeof a !== "object") return `Attachment ${i + 1}: invalid object.`;
    const filename = typeof a.filename === "string" ? a.filename.trim() : "";
    const mimeType = typeof a.mimeType === "string" ? a.mimeType.trim() : "";
    const contentBase64 = typeof a.contentBase64 === "string" ? a.contentBase64 : "";
    if (!filename || filename.length > 255) return `Attachment ${i + 1}: filename required (max 255 chars).`;
    if (!mimeType) return `Attachment ${i + 1}: MIME type required.`;
    if (!contentBase64) return `Attachment ${i + 1}: content missing.`;

    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (BLOCKED_EXTS.has(ext)) return `Attachment "${filename}": file type ".${ext}" is blocked.`;

    const size = estimateBase64Bytes(contentBase64);
    if (size > MAX_PER_FILE) return `Attachment "${filename}": exceeds 10 MB per-file limit.`;
    total += size;
    if (total > MAX_TOTAL) return `Total attachments size exceeds 25 MB limit.`;

    result.push({ filename, mimeType, contentBase64 });
  }
  return result;
}

async function resolveWorkspaceAndUser(request: Request): Promise<{ workspaceId: string; userId: string } | { error: Response }> {
  const cookie = request.headers.get("cookie") ?? "";
  const SUPABASE_URL = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return { error: json({ error: "Server missing Supabase env vars" }, { status: 500 }) };
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: {
        getItem: (key: string) => {
          const match = cookie.match(new RegExp(`(?:^|;\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
          return match ? decodeURIComponent(match[1]!) : null;
        },
        setItem: () => {},
        removeItem: () => {},
      },
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    return { error: json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = data.user.id;
  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("created_by", userId)
    .limit(1)
    .maybeSingle();
  if (wsErr || !ws?.id) {
    return { error: json({ error: "Workspace not found" }, { status: 401 }) };
  }
  return { workspaceId: ws.id, userId };
}

export const Route = createFileRoute("/_authenticated/api/integrations/google/gmail/send-reply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const resolved = await resolveWorkspaceAndUser(request);
        if ("error" in resolved) return resolved.error;
        const { workspaceId } = resolved;

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Invalid JSON payload" }, { status: 400 });
        }

        const { clientId, threadId, subject, body, html } = payload;
        if (!clientId || !threadId || !subject || !body) {
          return json({ error: "Missing required fields (clientId, threadId, subject, body)" }, { status: 400 });
        }

        const attachmentsOrError = validateAttachments(payload.attachments);
        if (typeof attachmentsOrError === "string") {
          return json({ error: attachmentsOrError }, { status: 400 });
        }
        const attachments = attachmentsOrError;

        const inReplyTo: string | undefined =
          typeof payload.inReplyTo === "string" ? payload.inReplyTo.trim() || undefined : undefined;
        const references: string | undefined =
          typeof payload.references === "string" ? payload.references.trim() || undefined : undefined;

        const { data: client, error: clientErr } = await supabaseAdmin
          .from("clients")
          .select("email, workspace_id")
          .eq("id", String(clientId))
          .maybeSingle();
        if (clientErr || !client) {
          return json({ error: "Client not found" }, { status: 404 });
        }
        if (client.workspace_id !== workspaceId) {
          return json({ error: "Client does not belong to workspace" }, { status: 403 });
        }
        const toEmail = client.email;
        if (!toEmail) {
          return json({ error: "Client has no email address" }, { status: 400 });
        }

        const accessToken = await getAccessTokenForWorkspace(workspaceId);
        if (!accessToken) {
          return json({ error: "Google integration not connected or token expired" }, { status: 403 });
        }

        const profile = await fetchGmailProfile(accessToken).catch(() => null);
        if (!profile || !profile.emailAddress) {
          return json({ error: "Failed to fetch Gmail profile or missing email address" }, { status: 500 });
        }
        const fromEmail = profile.emailAddress;

        const msgId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        const referencesHeader = [references, inReplyTo].filter(Boolean).join(" ").trim();

        const sendResult = await sendGmailMessage({
          accessToken,
          from: fromEmail,
          to: toEmail,
          subject,
          text: body,
          html: typeof html === "string" ? html : undefined,
          inReplyTo: inReplyTo || `<${msgId}@mail.gmail.com>`,
          references: referencesHeader || undefined,
          threadId: String(threadId),
          attachments,
        });

        const processedOutboundAttachments = [];
        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const buffer = Buffer.from(att.contentBase64, "base64");
            const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
              .from("email-attachments")
              .upload(`${workspaceId}/${clientId}/${Date.now()}-${att.filename}`, buffer, {
                contentType: att.mimeType,
                upsert: false,
              });

            if (!uploadErr && uploadData?.path) {
              const { data: signedUrlData } = await supabaseAdmin.storage
                .from("email-attachments")
                .createSignedUrl(uploadData.path, 60 * 60 * 24 * 365 * 10);
              processedOutboundAttachments.push({
                filename: att.filename,
                mimeType: att.mimeType,
                size: buffer.length,
                storagePath: uploadData.path,
                signedUrl: signedUrlData?.signedUrl ?? null,
              });
            }
          }
        }

        await (supabaseAdmin as unknown as any).from("email_messages").insert({
          workspace_id: workspaceId,
          client_id: String(clientId),
          thread_id: String(threadId),
          provider_message_id: sendResult.messageId ?? msgId,
          rfc_message_id: "",
          direction: "outbound",
          from_email: fromEmail,
          to_email: toEmail,
          subject,
          body_text: body,
          body_html: typeof html === "string" ? html : `<p>${body.replace(/\n/g, "<br/>")}</p>`,
          attachments: processedOutboundAttachments,
          in_reply_to: inReplyTo ?? null,
          references: references ?? null,
          sent_at: new Date(),
          received_at: new Date(),
        });

        await supabaseAdmin
          .from("clients")
          .update({ last_contacted_at: new Date().toISOString() })
          .eq("id", String(clientId));

        return json({
          ok: true,
          messageId: sendResult.messageId,
          attachments: processedOutboundAttachments.length,
        });
      }
    }
  }
});
