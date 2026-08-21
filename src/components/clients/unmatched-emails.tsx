import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  UserCheck,
  UserPlus,
} from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignEmailToClient,
  getEmailAttachmentUrl,
  getUnmatchedEmails,
  triggerGmailSync,
  type EmailMessageRecord,
  type StoredEmailAttachment,
} from "@/lib/email-conversations.functions";
import { formatDateTime, type ClientRecord } from "@/lib/crm";

interface UnmatchedEmailsProps {
  workspaceId: string;
  clients: ClientRecord[];
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

export function UnmatchedEmails({ workspaceId, clients }: UnmatchedEmailsProps) {
  const queryClient = useQueryClient();
  const getUnmatchedFn = useServerFn(getUnmatchedEmails);
  const assignFn = useServerFn(assignEmailToClient);
  const syncGmailFn = useServerFn(triggerGmailSync);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessageRecord | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientSearch, setClientSearch] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const {
    data: unmatchedEmails,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["unmatched-emails", workspaceId],
    queryFn: async () => {
      return getUnmatchedFn({ data: { workspaceId } });
    },
    enabled: Boolean(workspaceId),
  });

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await syncGmailFn({ data: { workspaceId } });
      if (res.ok) {
        const { found = 0, inserted = 0, matched = 0, unmatched = 0, errors = 0, myEmail = "" } = res as any;
        if (inserted > 0) {
          toast.success(
            `Sync complete (${myEmail ? myEmail + ") — " : ""}` +
            `${found} found · ${inserted} new · ${matched} matched · ${unmatched} unmatched` +
            (errors > 0 ? ` · ${errors} error(s)` : ""),
          );
        } else {
          toast.info(
            `Sync complete (${myEmail ? myEmail + ") — " : ""}` +
            `${found} checked · 0 new messages` +
            (errors > 0 ? ` · ${errors} error(s)` : ""),
          );
        }
        // Always refresh unmatched list after a sync attempt
        await queryClient.invalidateQueries({ queryKey: ["unmatched-emails", workspaceId] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync Gmail.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenAssign = (msg: EmailMessageRecord) => {
    setSelectedMessage(msg);
    setSelectedClientId("");
    setClientSearch("");
    setAssignModalOpen(true);
  };

  const handleConfirmAssign = async () => {
    if (!selectedMessage || !selectedClientId) {
      toast.error("Please select a client to assign this email to.");
      return;
    }

    setIsAssigning(true);
    try {
      const res = await assignFn({
        data: {
          workspaceId,
          messageId: selectedMessage.id,
          clientId: selectedClientId,
        },
      });

      if (res.success) {
        toast.success(`Email thread assigned to ${res.clientName}`);
        setAssignModalOpen(false);
        setSelectedMessage(null);
        await queryClient.invalidateQueries({ queryKey: ["unmatched-emails", workspaceId] });
        await queryClient.invalidateQueries({ queryKey: ["client-email-threads", workspaceId, selectedClientId] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign email.");
    } finally {
      setIsAssigning(false);
    }
  };

  const filteredClients = clients.filter((c) => {
    if (!clientSearch) return true;
    const term = clientSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      (c.email && c.email.toLowerCase().includes(term)) ||
      (c.company && c.company.toLowerCase().includes(term))
    );
  });

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Inbox className="size-5 text-amber-500" />
            <CardTitle className="text-base">Unmatched Inbound Emails</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Inbound emails received from addresses not yet linked to any existing client record.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          className="gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing..." : "Sync Gmail"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin text-primary" />
            Loading unmatched emails...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>Failed to load: {error instanceof Error ? error.message : "Unknown error"}</span>
          </div>
        ) : !unmatchedEmails || unmatchedEmails.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <CheckCircle2 className="mx-auto size-8 text-emerald-500/80" />
            <h3 className="mt-3 text-sm font-semibold">No unmatched emails</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              All inbound emails in your connected Gmail account are automatically matched to CRM clients.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {unmatchedEmails.map((msg) => (
              <UnmatchedEmailRow
                key={msg.id}
                message={msg}
                workspaceId={workspaceId}
                onAssign={() => handleOpenAssign(msg)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Assign to Client Modal */}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Email to Client</DialogTitle>
            <DialogDescription>
              Associate &ldquo;{selectedMessage?.subject || "(No Subject)"}&rdquo; from {selectedMessage?.from_email} with a CRM client.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div>
              <Label className="text-xs font-semibold">Search Client</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8 text-xs h-8"
                  placeholder="Filter by name, email, or company..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Select Target Client</Label>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger className="mt-1 text-xs h-9">
                  <SelectValue placeholder="Choose a client..." />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {filteredClients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-xs">
                      <span className="font-semibold">{client.name}</span>
                      {client.email ? ` (${client.email})` : ""}
                      {client.company ? ` • ${client.company}` : ""}
                    </SelectItem>
                  ))}
                  {filteredClients.length === 0 && (
                    <p className="p-2 text-center text-xs text-muted-foreground">
                      No matching clients found
                    </p>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAssignModalOpen(false)}
              disabled={isAssigning}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmAssign}
              disabled={isAssigning || !selectedClientId}
              className="gap-1.5"
            >
              {isAssigning ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <UserCheck className="size-3.5" />
                  Assign to Client
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function UnmatchedEmailRow({
  message,
  workspaceId,
  onAssign,
}: {
  message: EmailMessageRecord;
  workspaceId: string;
  onAssign: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const getAttachmentUrlFn = useServerFn(getEmailAttachmentUrl);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const handleDownload = async (att: StoredEmailAttachment) => {
    if (!att.storagePath) {
      toast.error("Attachment storage path not available.");
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
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open attachment.");
    } finally {
      setDownloadingFile(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3.5 shadow-2xs hover:border-amber-500/30 transition-all">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-xs text-foreground">
              {message.from_name || message.from_email}
            </span>
            <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
              {message.from_email}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              &bull; {formatDateTime(message.received_at || message.created_at)}
            </span>
          </div>

          <h4 className="text-xs font-medium text-foreground truncate">
            {message.subject || "(No Subject)"}
          </h4>

          {!expanded && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {message.body_text || "No preview available"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-8 text-xs gap-1 text-muted-foreground"
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? "Collapse" : "Read Full"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onAssign}
            className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <UserPlus className="size-3.5" />
            Assign to Client
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-3 space-y-3">
          <div className="rounded bg-muted/20 p-3 text-xs leading-relaxed text-foreground">
            {message.body_html ? (
              <div
                className="prose prose-xs dark:prose-invert max-w-none break-words"
                dangerouslySetInnerHTML={{ __html: message.body_html }}
              />
            ) : (
              <p className="whitespace-pre-wrap">{message.body_text}</p>
            )}
          </div>

          {message.attachments && message.attachments.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Paperclip className="size-3" /> Attachments ({message.attachments.length}):
              </span>
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((att, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-[11px]"
                  >
                    {getAttachmentIcon(att.filename, att.mimeType)}
                    <span className="max-w-40 truncate">{att.filename}</span>
                    <span className="text-[9px] text-muted-foreground">({formatFileSize(att.size)})</span>
                    {att.storagePath && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-5"
                        onClick={() => handleDownload(att)}
                        disabled={downloadingFile === att.filename}
                      >
                        {downloadingFile === att.filename ? (
                          <Loader2 className="size-2.5 animate-spin" />
                        ) : (
                          <Download className="size-2.5" />
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
