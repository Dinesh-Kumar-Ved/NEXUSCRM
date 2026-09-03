import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Paperclip, Send, Users, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { type Channel, type ClientRecord } from "@/lib/crm";
import { sendBulkMessage } from "@/lib/messaging.functions";
import {
  type ClientEmailAttachment,
  formatFileSize,
} from "@/components/send-message-dialog";

type BulkChannel = Exclude<Channel, "call">;

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

export function BulkSendMessageDialog({
  open,
  onOpenChange,
  clients,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientRecord[];
  onSent?: () => void;
}) {
  const [channel, setChannel] = useState<BulkChannel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ClientEmailAttachment[]>([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sendFn = useServerFn(sendBulkMessage);

  // Count how many clients have a valid contact for the selected channel
  const eligibleClients = clients.filter((c) => {
    if (channel === "email") return Boolean(c.email);
    if (channel === "whatsapp") return Boolean(c.whatsapp || c.phone);
    if (channel === "sms") return Boolean(c.phone);
    return false;
  });

  const ineligibleCount = clients.length - eligibleClients.length;

  useEffect(() => {
    if (open) {
      setChannel("email");
      setSubject("");
      setBody("");
      setCampaignName(`Bulk message – ${new Date().toLocaleDateString()}`);
      setSending(false);
      setAttachments([]);
      setPreparingAttachments(false);
    } else {
      setAttachments([]);
      setPreparingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  const totalAttachmentSize = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  const onPickFile = () => {
    fileInputRef.current?.click();
  };

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    let runningTotal = totalAttachmentSize;
    const prepared: ClientEmailAttachment[] = [];
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
      toast.success(`Added ${prepared.length} attachment${prepared.length > 1 ? "s" : ""}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (eligibleClients.length === 0) {
      toast.error(`No clients have a valid ${channel} address.`);
      return;
    }

    if (!body.trim()) {
      toast.error("Message body cannot be empty.");
      return;
    }

    if (!campaignName.trim()) {
      toast.error("Campaign name is required.");
      return;
    }

    setSending(true);
    setPreparingAttachments(channel === "email" && attachments.length > 0);
    try {
      const attachmentPayload =
        channel === "email" && attachments.length > 0
          ? attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              contentBase64: a.contentBase64,
            }))
          : undefined;

      const result = await sendFn({
        data: {
          clientIds: eligibleClients.map((c) => c.id),
          channel,
          subject: channel === "email" ? (subject.trim() || "Message from your account team") : undefined,
          body: body.trim(),
          campaignName: campaignName.trim(),
          attachments: attachmentPayload,
        },
      });

      if (result.ok) {
        toast.success(
          `Message sent to ${eligibleClients.length} client${eligibleClients.length !== 1 ? "s" : ""}!`
        );
        if (onSent) onSent();
        onOpenChange(false);
      } else {
        toast.error((result as { ok: false; error: string }).error || "Failed to send bulk message.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error sending bulk message");
    } finally {
      setSending(false);
      setPreparingAttachments(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-5" />
              Send Message to {clients.length} Client{clients.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Compose a single message that will be dispatched to all selected clients.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Recipients summary */}
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Recipients</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {clients.map((c) => (
                  <Badge key={c.id} variant="secondary" className="text-xs">
                    {c.name}
                  </Badge>
                ))}
              </div>
              {ineligibleCount > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  ⚠ {ineligibleCount} client{ineligibleCount !== 1 ? "s" : ""} will be skipped (no {channel} address).
                </p>
              )}
            </div>

            {/* Channel */}
            <div>
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as BulkChannel)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campaign name */}
            <div>
              <Label>Campaign name</Label>
              <Input
                className="mt-1"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. September Follow-Up"
                required
              />
            </div>

            {/* Subject (email only) */}
            {channel === "email" && (
              <div>
                <Label>Subject</Label>
                <Input
                  className="mt-1"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Proposal discussion, Follow-up..."
                />
              </div>
            )}

            {/* Body */}
            <div>
              <Label>Message Body</Label>
              <Textarea
                className="mt-1 min-h-32 text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Write your message here...\n\nTip: Keep it personal and concise.`}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This same message will be sent to all {eligibleClients.length} eligible recipients.
              </p>
            </div>

            {/* Attachments (email channel) */}
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
                    disabled={sending || preparingAttachments}
                    className="gap-1.5"
                  >
                    <Paperclip className="size-3.5" />
                    Add files / PDF
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
                          disabled={sending}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={sending || preparingAttachments || eligibleClients.length === 0}
              className="gap-2"
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {preparingAttachments ? "Attaching files..." : "Sending..."}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Send to {eligibleClients.length} Client{eligibleClients.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
