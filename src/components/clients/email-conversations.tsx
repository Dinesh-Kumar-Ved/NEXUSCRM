import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  User,
  X,
} from "lucide-react";
import React, { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getClientEmailThreads,
  getEmailAttachmentUrl,
  sendEmailThreadReply,
  triggerGmailSync,
  type EmailConversationThread,
  type EmailMessageRecord,
  type StoredEmailAttachment,
} from "@/lib/email-conversations.functions";
import { formatDateTime, type ClientRecord } from "@/lib/crm";

interface EmailConversationsProps {
  clientId: string;
  workspaceId: string;
  client: ClientRecord;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MB total

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "ps1", "msi", "scr", "vbs", "js", "com", "pif",
  "sh", "dll", "reg", "jse", "wsf", "wsh", "cpl", "jar", "py", "pyc",
  "rb", "pl", "php", "cgi", "htaccess", "htpasswd", "lnk", "inf",
]);

const ACCEPTED_FILES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
].join(",");

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function getAttachmentIcon(filename: string, mimeType: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return <ImageIcon className="size-4 text-sky-500" />;
  }
  if (
    mimeType.includes("pdf") ||
    ext === "pdf" ||
    mimeType.includes("word") ||
    ["doc", "docx", "txt"].includes(ext)
  ) {
    return <FileText className="size-4 text-emerald-500" />;
  }
  if (
    mimeType.includes("excel") ||
    mimeType.includes("spreadsheet") ||
    ["xls", "xlsx", "csv"].includes(ext)
  ) {
    return <FileSpreadsheet className="size-4 text-amber-500" />;
  }
  return <File className="size-4 text-muted-foreground" />;
}

export function EmailConversations({ clientId, workspaceId, client }: EmailConversationsProps) {
  const queryClient = useQueryClient();
  const getThreadsFn = useServerFn(getClientEmailThreads);
  const syncGmailFn = useServerFn(triggerGmailSync);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const {
    data: threads,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["client-email-threads", workspaceId, clientId],
    queryFn: async () => {
      return getThreadsFn({ data: { workspaceId, clientId } });
    },
    enabled: Boolean(workspaceId && clientId),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleSync = async () => {
    setIsSyncing(true);
    console.log(`[GMAIL_DEBUG] SYNC BUTTON CLICKED\nworkspaceId=${workspaceId}\nclientId=${clientId}`);
    try {
      const res = await syncGmailFn({ data: { workspaceId } });
      if (res.ok) {
        setLastSyncedAt(new Date());
        if (res.newMessages > 0) {
          toast.success(`Sync complete: ${res.newMessages} new message${res.newMessages > 1 ? "s" : ""} received!`);
        } else {
          toast.success("Inbox is up to date.");
        }
        
        console.log(`[EMAIL_UI_DEBUG]\nsyncResult=${JSON.stringify(res)}\ninvalidatingClientEmailThreads=true`);
        await queryClient.invalidateQueries({ queryKey: ["client-email-threads", workspaceId, clientId] });
        await queryClient.invalidateQueries({ queryKey: ["client-messages", clientId] });
        await queryClient.invalidateQueries({ queryKey: ["unmatched-emails", workspaceId] });
        console.log(`[EMAIL_UI_DEBUG]\nrefetchComplete=true`);
        
      } else {
        toast.error("Sync completed with warnings.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync with Gmail.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-primary" />
            <CardTitle className="text-base">Email Conversations</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Live two-way Gmail sync with full reply threading and attachments for {client.email || client.name}.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="hidden sm:inline text-[11px] text-muted-foreground">
              Synced {lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin text-primary" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync Gmail"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin text-primary" />
            Loading email threads...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>Failed to load conversations: {error instanceof Error ? error.message : "Unknown error"}</span>
          </div>
        ) : !threads || threads.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Mail className="mx-auto size-8 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold">No email conversations yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Send an email to {client.name} using the &quot;Send Message&quot; button above, or click &quot;Sync Gmail&quot; to fetch replies.
            </p>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing} className="mt-4 gap-1.5">
              <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              Sync Inbox Now
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {threads.map((thread) => (
              <ThreadCard
                key={thread.threadId}
                thread={thread}
                workspaceId={workspaceId}
                clientId={clientId}
                clientEmail={client.email || ""}
                onReplySent={() => {
                  void queryClient.invalidateQueries({
                    queryKey: ["client-email-threads", workspaceId, clientId],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ["client-activities", clientId],
                  });
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ThreadCard({
  thread,
  workspaceId,
  clientId,
  clientEmail,
  onReplySent,
}: {
  thread: EmailConversationThread;
  workspaceId: string;
  clientId: string;
  clientEmail: string;
  onReplySent: () => void;
}) {
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  // Find the latest message to reply to
  const latestMessage = thread.messages[thread.messages.length - 1];
  const originalSubject = thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;

  return (
    <div className="rounded-xl border bg-card/50 shadow-sm overflow-hidden transition-all">
      {/* Thread Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-left font-semibold text-sm hover:text-primary transition-colors truncate"
          >
            {isExpanded ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
            <span className="truncate">{thread.subject || "(No Subject)"}</span>
          </button>
          <Badge variant="secondary" className="text-[11px] font-normal shrink-0">
            {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
          </Badge>
          {thread.inboundCount > 0 && (
            <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20 shrink-0">
              {thread.inboundCount} from client
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{formatDateTime(thread.latestTimestamp)}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsReplyOpen(!isReplyOpen)}
            className="h-8 gap-1 text-xs"
          >
            <Reply className="size-3.5" />
            {isReplyOpen ? "Cancel Reply" : "Reply"}
          </Button>
        </div>
      </div>

      {/* Messages List */}
      {isExpanded && (
        <div className="divide-y p-4 space-y-4">
          {thread.messages.map((msg, index) => (
            <MessageItem
              key={msg.id || `${msg.provider_message_id}-${index}`}
              message={msg}
              workspaceId={workspaceId}
            />
          ))}

          {/* Reply Box inside the thread */}
          {isReplyOpen && (
            <div className="pt-2">
              <ReplyComposer
                workspaceId={workspaceId}
                clientId={clientId}
                threadId={thread.threadId}
                defaultSubject={originalSubject}
                clientEmail={clientEmail}
                inReplyTo={latestMessage?.rfc_message_id || latestMessage?.provider_message_id}
                references={latestMessage?.references || latestMessage?.rfc_message_id}
                onSuccess={() => {
                  setIsReplyOpen(false);
                  onReplySent();
                }}
                onCancel={() => setIsReplyOpen(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageItem({
  message,
  workspaceId,
}: {
  message: EmailMessageRecord;
  workspaceId: string;
}) {
  const isInbound = message.direction === "inbound";
  const [showFullHtml, setShowFullHtml] = useState(false);
  const getAttachmentUrlFn = useServerFn(getEmailAttachmentUrl);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const handleDownloadAttachment = async (att: StoredEmailAttachment) => {
    if (!att.storagePath) {
      toast.error("Attachment storage path not available for download.");
      return;
    }
    setDownloadingFile(att.filename);
    try {
      const res = await getAttachmentUrlFn({
        data: {
          workspaceId,
          storagePath: att.storagePath,
        },
      });
      if (res.signedUrl) {
        window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Could not obtain download link.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open attachment.");
    } finally {
      setDownloadingFile(null);
    }
  };

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        isInbound
          ? "bg-muted/10 border-border/80"
          : "bg-primary/5 border-primary/15"
      }`}
    >
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <div
            className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold ${
              isInbound
                ? "bg-secondary text-secondary-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {isInbound ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">
                {isInbound ? message.from_name || message.from_email || "Client" : "You (Team)"}
              </span>
              <Badge
                variant={isInbound ? "outline" : "default"}
                className={`text-[10px] uppercase tracking-wider py-0 px-1.5 ${
                  isInbound ? "text-muted-foreground" : "bg-primary/80"
                }`}
              >
                {isInbound ? "Inbound Reply" : "Outbound Sent"}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              From: {message.from_email} &bull; To: {message.to_email}
            </p>
          </div>
        </div>

        <span className="text-xs text-muted-foreground">
          {formatDateTime(message.received_at || message.sent_at || message.created_at)}
        </span>
      </div>

      {/* Message Body */}
      <div className="mt-2 text-xs leading-relaxed text-foreground">
        {message.body_html ? (
          <div
            className="prose prose-xs dark:prose-invert max-w-none break-words overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: message.body_html }}
          />
        ) : (
          <p className="whitespace-pre-wrap font-sans text-xs">{message.body_text || "(Empty body)"}</p>
        )}
      </div>

      {/* Attachments Section */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border/40 pt-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Paperclip className="size-3" />
            <span>Attachments ({message.attachments.length})</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {message.attachments.map((att, idx) => (
              <div
                key={`${att.filename}-${idx}`}
                className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-xs hover:border-primary/40 transition-colors"
              >
                {getAttachmentIcon(att.filename, att.mimeType)}
                <div className="max-w-44 truncate">
                  <p className="truncate font-medium text-[11px] text-foreground">{att.filename}</p>
                  <p className="text-[10px] text-muted-foreground">{formatFileSize(att.size)}</p>
                </div>
                {att.storagePath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-primary"
                    title={`Download ${att.filename}`}
                    onClick={() => handleDownloadAttachment(att)}
                    disabled={downloadingFile === att.filename}
                  >
                    {downloadingFile === att.filename ? (
                      <Loader2 className="size-3 animate-spin text-primary" />
                    ) : (
                      <Download className="size-3" />
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyComposer({
  workspaceId,
  clientId,
  threadId,
  defaultSubject,
  clientEmail,
  inReplyTo,
  references,
  onSuccess,
  onCancel,
}: {
  workspaceId: string;
  clientId: string;
  threadId: string;
  defaultSubject: string;
  clientEmail: string;
  inReplyTo?: string | null | undefined;
  references?: string | null | undefined;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<
    Array<{ filename: string; mimeType: string; contentBase64: string; sizeBytes: number }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sendReplyFn = useServerFn(sendEmailThreadReply);

  const totalAttachmentSize = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  const onPickFile = () => {
    fileInputRef.current?.click();
  };

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    let runningTotal = totalAttachmentSize;
    const prepared: Array<{ filename: string; mimeType: string; contentBase64: string; sizeBytes: number }> = [];
    const errors: string[] = [];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (BLOCKED_EXTENSIONS.has(ext)) {
        errors.push(`${file.name}: file type ".${ext}" is blocked for security.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: exceeds 10 MB limit (${formatFileSize(file.size)}).`);
        continue;
      }
      if (runningTotal + file.size > MAX_TOTAL_SIZE) {
        errors.push(`${file.name}: adding this exceeds the 25 MB total limit.`);
        continue;
      }
      try {
        const contentBase64 = await fileToBase64(file);
        prepared.push({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64,
          sizeBytes: file.size,
        });
        runningTotal += file.size;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed to read ${file.name}`);
      }
    }

    if (errors.length > 0) {
      for (const err of errors) toast.error(err);
    }
    if (prepared.length > 0) {
      setAttachments((prev) => [...prev, ...prepared]);
      toast.success(`Attached ${prepared.length} file${prepared.length > 1 ? "s" : ""}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      toast.error("Reply body cannot be empty.");
      return;
    }

    setSending(true);
    try {
      const res = await sendReplyFn({
        data: {
          workspaceId,
          clientId,
          threadId,
          subject: subject.trim() || defaultSubject,
          body: body.trim(),
          inReplyTo: inReplyTo || undefined,
          references: references || undefined,
          attachments:
            attachments.length > 0
              ? attachments.map((a) => ({
                  filename: a.filename,
                  mimeType: a.mimeType,
                  contentBase64: a.contentBase64,
                }))
              : undefined,
        },
      });

      if (res.ok) {
        toast.success(`Reply sent directly in Gmail thread to ${clientEmail}`);
        setBody("");
        setAttachments([]);
        onSuccess();
      } else {
        toast.error("Failed to send reply.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error dispatching reply.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSend} className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Reply className="size-3.5 text-primary" />
          <span>Reply to {clientEmail}</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div>
        <Label className="text-[11px] text-muted-foreground">Subject</Label>
        <Input
          className="mt-1 h-8 text-xs font-medium"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
      </div>

      <div>
        <Label className="text-[11px] text-muted-foreground">Message</Label>
        <Textarea
          className="mt-1 min-h-24 text-xs font-normal leading-relaxed"
          placeholder="Type your reply here..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </div>

      {/* Attachment area */}
      <div className="space-y-2 rounded-md border border-dashed bg-background/50 p-2.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={onFilesSelected}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Attachments ({attachments.length}) &bull; {formatFileSize(totalAttachmentSize)} / 25 MB
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPickFile}
            disabled={sending}
            className="h-7 gap-1 text-xs"
          >
            <Paperclip className="size-3" />
            Add attachment
          </Button>
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {attachments.map((att, idx) => (
              <div
                key={`${att.filename}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
              >
                <span className="max-w-36 truncate">{att.filename}</span>
                <span className="text-[9px] text-muted-foreground">({formatFileSize(att.sizeBytes)})</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  disabled={sending}
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={sending} className="gap-1.5">
          {sending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Sending Reply...
            </>
          ) : (
            <>
              <Send className="size-3.5" />
              Send Reply
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
