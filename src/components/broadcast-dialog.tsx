import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { sendBulkMessage } from "@/lib/messaging.functions";
import { PERSONALIZATION_TOKENS, type Channel } from "@/lib/crm";

export interface BroadcastEmailAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes: number;
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

function isAllowedExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return !BLOCKED_EXTENSIONS.has(ext);
}

export function BroadcastDialog({
  open,
  onOpenChange,
  clientIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientIds: string[];
}) {
  const [channel, setChannel] = useState<Exclude<Channel, "call">>("email");
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Hi {{client_name}},\n\n");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [attachments, setAttachments] = useState<BroadcastEmailAttachment[]>([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const queryClient = useQueryClient();
  const send = useServerFn(sendBulkMessage);

  useEffect(() => {
    if (!open) {
      setAttachments([]);
      setPreparingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  const { data: templates } = useQuery({
    queryKey: ["templates", channel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .eq("channel", channel)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalAttachmentSize = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  const onPickFile = () => {
    fileInputRef.current?.click();
  };

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    let runningTotal = totalAttachmentSize;
    const prepared: BroadcastEmailAttachment[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (!isAllowedExtension(file.name)) {
        errors.push(`${file.name}: file type ".${file.name.split(".").pop() ?? ""}" blocked for security.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: exceeds 10 MB limit (${formatFileSize(file.size)}).`);
        continue;
      }
      if (runningTotal + file.size > MAX_TOTAL_SIZE) {
        errors.push(`${file.name}: adding this exceeds the 25 MB total attachment limit.`);
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
      toast.success(`Added ${prepared.length} attachment${prepared.length > 1 ? "s" : ""}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const run = useMutation({
    mutationFn: () => {
      const attachmentPayload =
        channel === "email" && attachments.length > 0
          ? attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              contentBase64: a.contentBase64,
            }))
          : undefined;

      return send({
        data: {
          clientIds,
          channel,
          subject: channel === "email" ? subject : undefined,
          body,
          campaignName: campaignName.trim() || `${channel} broadcast`,
          templateId: selectedTemplateId,
          attachments: attachmentPayload,
        },
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      toast.success(`Sent ${result.sent} of ${clientIds.length}`, {
        description:
          result.failed || result.skipped.length
            ? `${result.failed} failed, ${result.skipped.length} skipped`
            : undefined,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Broadcast to {clientIds.length} client(s)</DialogTitle>
          <DialogDescription>
            Personalization tokens: {PERSONALIZATION_TOKENS.join(", ")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => {
                  setChannel(v as Exclude<Channel, "call">);
                  setSelectedTemplateId(undefined);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Campaign name</Label>
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="September follow-up"
              />
            </div>
          </div>

          {(templates ?? []).length > 0 ? (
            <div className="space-y-2">
              <Label>Start from a template</Label>
              <Select
                value={selectedTemplateId ?? ""}
                onValueChange={(id) => {
                  const template = (templates ?? []).find((t) => t.id === id);
                  if (!template) return;
                  setSelectedTemplateId(template.id);
                  setSubject(template.subject ?? "");
                  setBody(template.body);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {channel === "email" ? (
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Important updates for your business"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          {channel === "email" && (
            <div className="space-y-2 rounded-lg border border-dashed bg-muted/10 p-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                className="hidden"
                onChange={onFilesSelected}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="size-4" />
                  <span>
                    Attachments ({attachments.length}) · Total {formatFileSize(totalAttachmentSize)} / 25 MB
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onPickFile}
                  disabled={run.isPending || preparingAttachments}
                  className="gap-1.5"
                >
                  <Paperclip className="size-3.5" />
                  Add Attachment
                </Button>
              </div>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {attachments.map((att, idx) => (
                    <div
                      key={`${att.filename}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-secondary/80 px-2.5 py-1 text-xs text-secondary-foreground"
                    >
                      <span className="max-w-44 truncate">{att.filename}</span>
                      <span className="text-[10px] text-muted-foreground">
                        ({formatFileSize(att.sizeBytes)})
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(idx)}
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        disabled={run.isPending}
                        title={`Remove ${att.filename}`}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={run.isPending}>
            Cancel
          </Button>
          <Button onClick={() => run.mutate()} disabled={!body.trim() || run.isPending} className="gap-2">
            {run.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending broadcast…
              </>
            ) : (
              <>
                <Send className="size-4" />
                Send broadcast
                {attachments.length > 0 && channel === "email" && (
                  <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground/90">
                    {attachments.length}
                  </span>
                )}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
