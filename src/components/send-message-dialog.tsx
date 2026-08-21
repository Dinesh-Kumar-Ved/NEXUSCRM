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
import { type Channel, type ClientRecord } from "@/lib/crm";
import { sendClientMessage } from "@/lib/messaging.functions";

export interface ClientEmailAttachment {
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

export function formatFileSize(bytes: number): string {
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

export function SendMessageDialog({
  open,
  onOpenChange,
  client,
  defaultChannel = "email",
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientRecord;
  defaultChannel?: Exclude<Channel, "call">;
  onSent?: () => void;
}) {
  const [channel, setChannel] = useState<Exclude<Channel, "call">>(defaultChannel);
  const [recipient, setRecipient] = useState(client.email || "");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(`Hi ${client.name.split(" ")[0] || client.name},\n\n`);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ClientEmailAttachment[]>([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sendFn = useServerFn(sendClientMessage);

  useEffect(() => {
    if (open) {
      setChannel(defaultChannel);
      setRecipient(
        defaultChannel === "email"
          ? client.email || ""
          : defaultChannel === "whatsapp"
            ? client.whatsapp || client.phone || ""
            : client.phone || "",
      );
      setBody(`Hi ${client.name.split(" ")[0] || client.name},\n\n`);
      setSubject("");
      setCcInput("");
      setBccInput("");
      setShowCcBcc(false);
      setAttachments([]);
      setPreparingAttachments(false);
    } else {
      setAttachments([]);
      setPreparingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, client, defaultChannel]);

  // Adjust default recipient whenever channel changes
  const handleChannelChange = (newChannel: Exclude<Channel, "call">) => {
    setChannel(newChannel);
    if (newChannel === "email") {
      setRecipient(client.email || "");
    } else if (newChannel === "whatsapp") {
      setRecipient(client.whatsapp || client.phone || "");
    } else {
      setRecipient(client.phone || "");
    }
  };

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
    if (!body.trim()) {
      toast.error("Message body cannot be empty.");
      return;
    }

    if (channel === "email" && !recipient.trim()) {
      toast.error("Recipient email address is required.");
      return;
    }

    setSending(true);
    setPreparingAttachments(channel === "email" && attachments.length > 0);
    try {
      const ccList = ccInput
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.includes("@"));

      const bccList = bccInput
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.includes("@"));

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
          clientId: client.id,
          channel,
          to: channel === "email" ? recipient.trim() : undefined,
          cc: ccList.length > 0 ? ccList : undefined,
          bcc: bccList.length > 0 ? bccList : undefined,
          subject: channel === "email" ? (subject.trim() || "Message from your account team") : undefined,
          body: body.trim(),
          attachments: attachmentPayload,
        },
      });

      if (result.ok) {
        toast.success(`Message dispatched successfully to ${recipient || client.name}`);
        if (onSent) onSent();
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed to send message.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error sending message");
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
            <DialogTitle>Send Message to {client.name}</DialogTitle>
            <DialogDescription>
              Dispatched in real-time from your active workspace email or messaging provider.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(val) => handleChannelChange(val as Exclude<Channel, "call">)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">
                    Email ({client.email || "Custom recipient"})
                  </SelectItem>
                  <SelectItem value="sms">SMS ({client.phone || "No phone"})</SelectItem>
                  <SelectItem value="whatsapp">
                    WhatsApp ({client.whatsapp || client.phone || "No number"})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {channel === "email" && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">To (Recipient Email)</Label>
                    <button
                      type="button"
                      onClick={() => setShowCcBcc(!showCcBcc)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      {showCcBcc ? "Hide CC/BCC" : "Add CC/BCC"}
                    </button>
                  </div>
                  <Input
                    className="mt-1 font-mono text-xs"
                    type="email"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="recipient@example.com"
                    required
                  />
                </div>

                {showCcBcc && (
                  <div className="grid gap-2 sm:grid-cols-2 pt-1">
                    <div>
                      <Label className="text-xs">CC</Label>
                      <Input
                        className="mt-1 font-mono text-xs"
                        placeholder="cc1@domain.com, cc2@domain.com"
                        value={ccInput}
                        onChange={(e) => setCcInput(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">BCC</Label>
                      <Input
                        className="mt-1 font-mono text-xs"
                        placeholder="bcc@domain.com"
                        value={bccInput}
                        onChange={(e) => setBccInput(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input
                    className="mt-1 text-xs"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Proposal discussion, Follow-up..."
                  />
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Message Body</Label>
              <Textarea
                className="mt-1 min-h-32 text-xs"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message..."
                required
              />
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
                    disabled={sending || preparingAttachments}
                    className="gap-1.5"
                  >
                    <Paperclip className="size-3.5" />
                    Add files
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending || preparingAttachments} className="gap-2">
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {preparingAttachments ? "Attaching files..." : "Sending..."}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Send {channel === "email" ? "Email" : channel === "whatsapp" ? "WhatsApp" : "SMS"}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
