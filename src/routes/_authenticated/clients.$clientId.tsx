import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { ClientDialog } from "@/components/client-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useTeamForWorkspace, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  DEAL_STATUSES,
  STATUS_LABELS,
  formatCurrency,
  formatDate,
  formatDateTime,
  type Channel,
  type ClientRecord,
  type DealStatus,
} from "@/lib/crm";
import { sendClientMessage, startClientCall } from "@/lib/messaging.functions";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  head: () => ({ meta: [{ title: "Client details · NexusCRM" }] }),
  component: ClientDetailsPage,
});

function ClientDetailsPage() {
  const { clientId } = Route.useParams();
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<any>(null);
  const [calling, setCalling] = useState(false);

  const { data: team } = useTeamForWorkspace(workspaceId);

  const clientQuery = useQuery({
    queryKey: ["client", workspaceId, clientId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as ClientRecord | null;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ["client-messages", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activitiesQuery = useQuery({
    queryKey: ["client-activities", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["client-tasks", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("client_id", clientId)
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const dialFn = useServerFn(startClientCall);

  const handleCall = async () => {
    if (!clientQuery.data?.phone) {
      toast.error("This client does not have a phone number.");
      return;
    }
    setCalling(true);
    try {
      const result = await dialFn({
        data: {
          clientId,
          message: `Hello, calling from your account team at NexusCRM.`,
        },
      });
      if (result.ok) {
        toast.success("Call initiated successfully");
        void queryClient.invalidateQueries({ queryKey: ["client-activities", clientId] });
      } else {
        toast.error(result.error ?? "Failed to place call. Check Twilio settings.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error placing call");
    } finally {
      setCalling(false);
    }
  };

  const updateStatus = useMutation({
    mutationFn: async (newStatus: DealStatus) => {
      const { error } = await supabase
        .from("clients")
        .update({ status: newStatus })
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated");
      void queryClient.invalidateQueries({ queryKey: ["client", workspaceId, clientId] });
      void queryClient.invalidateQueries({ queryKey: ["client-activities", clientId] });
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleTask = useMutation({
    mutationFn: async ({ taskId, completed }: { taskId: string; completed: boolean }) => {
      const { error } = await supabase.from("tasks").update({ completed }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] });
    },
    onError: (err) => toast.error(err.message),
  });

  const assignedMember = (team ?? []).find((member) => member.id === clientQuery.data?.assigned_to);

  if (clientQuery.isLoading || !workspaceId) {
    return <p className="text-sm text-muted-foreground">Loading client...</p>;
  }
  if (clientQuery.error || !clientQuery.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link to="/clients">
            <ArrowLeft className="mr-2 size-4" /> Back to clients
          </Link>
        </Button>
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Unable to find this client.
          </CardContent>
        </Card>
      </div>
    );
  }

  const client = clientQuery.data;
  const details: Array<[string, string | null | undefined]> = [
    ["Email", client.email],
    ["Phone", client.phone],
    ["WhatsApp", client.whatsapp],
    ["Website", client.website],
    ["Source", client.source],
    ["Deal Value", formatCurrency(client.deal_value ?? 0)],
    ["Assigned User", assignedMember?.full_name || assignedMember?.email || "Unassigned"],
    ["Last Contacted", formatDate(client.last_contacted_at)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" asChild>
          <Link to="/clients">
            <ArrowLeft className="mr-2 size-4" /> Back to clients
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {client.phone && (
            <Button variant="outline" onClick={handleCall} disabled={calling}>
              <PhoneCall className="mr-2 size-4" /> {calling ? "Dialing..." : "Call"}
            </Button>
          )}
          <Button onClick={() => setMessageOpen(true)}>
            <Send className="mr-2 size-4" /> Send Message
          </Button>
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            <Pencil className="mr-2 size-4" /> Edit
          </Button>
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{client.name}</h1>
            <Badge variant="secondary">{client.source || "Direct"}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {client.company || "Individual client"}
          </p>
          {client.tags && client.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {client.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Deal Stage</p>
            <Select
              value={client.status}
              onValueChange={(val) => updateStatus.mutate(val as DealStatus)}
            >
              <SelectTrigger className="mt-1 w-44 font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Client Details & Info */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {details.map(([label, value]) => (
                <Detail key={label} label={label} value={value} />
              ))}
              <Detail label="Created" value={formatDateTime(client.created_at)} />
              <Detail label="Last Updated" value={formatDateTime(client.updated_at)} />
              <div className="pt-2">
                <Detail label="Notes" value={client.notes || "No notes added"} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Interactive Tabs for Messages, Tasks, Activities */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="messages" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="messages" className="flex items-center gap-2">
                <MessageSquare className="size-4" /> Messages
              </TabsTrigger>
              <TabsTrigger value="tasks" className="flex items-center gap-2">
                <Calendar className="size-4" /> Tasks
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center gap-2">
                <Clock className="size-4" /> Activity Feed
              </TabsTrigger>
            </TabsList>

            {/* Messages Tab */}
            <TabsContent value="messages">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Communication History</CardTitle>
                    <CardDescription>
                      Emails, SMS, and WhatsApp messages exchanged with this client.
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setMessageOpen(true)}>
                    <Send className="mr-2 size-3.5" /> Compose
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {messagesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading messages...</p>
                  ) : messagesQuery.data?.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No messages sent or received yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messagesQuery.data?.map((msg) => (
                        <div
                          key={msg.id}
                          className="rounded-lg border p-4 transition-colors hover:bg-muted/40"
                        >
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize text-[11px]">
                                {msg.channel}
                              </Badge>
                              <span className="font-medium text-foreground">
                                {msg.direction === "inbound"
                                  ? "Received from client"
                                  : "Sent by team"}
                              </span>
                            </div>
                            <span>{formatDateTime(msg.created_at)}</span>
                          </div>
                          {msg.subject && (
                            <p className="mt-2 text-sm font-semibold text-foreground">
                              {msg.subject}
                            </p>
                          )}
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                            {msg.body}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Status: {msg.status}</span>
                            {msg.provider && <span>• via {msg.provider}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="tasks">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Follow-up Tasks</CardTitle>
                    <CardDescription>Tasks and reminders for this client.</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setTaskOpen(true)}>
                    <Plus className="mr-2 size-3.5" /> New Task
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tasksQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading tasks...</p>
                  ) : tasksQuery.data?.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No tasks scheduled for this client.
                    </div>
                  ) : (
                    tasksQuery.data?.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start justify-between rounded-lg border p-3.5"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              toggleTask.mutate({ taskId: task.id, completed: !task.completed })
                            }
                            className="mt-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <CheckCircle2
                              className={`size-5 ${
                                task.completed
                                  ? "text-success fill-success/20"
                                  : "text-muted-foreground"
                              }`}
                            />
                          </button>
                          <div>
                            <p
                              className={`text-sm font-medium ${
                                task.completed
                                  ? "line-through text-muted-foreground"
                                  : "text-foreground"
                              }`}
                            >
                              {task.title}
                            </p>
                            {task.notes && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{task.notes}</p>
                            )}
                            {task.due_at && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Due: {formatDate(task.due_at)}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTaskToEdit(task);
                            setEditTaskOpen(true);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit follow-up"
                        >
                          <Pencil className="size-5" />
                        </button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Activity Feed Tab */}
            <TabsContent value="activity">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Activity Timeline</CardTitle>
                  <CardDescription>
                    Comprehensive audit log of touchpoints and changes.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {activitiesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading activity log...</p>
                  ) : activitiesQuery.data?.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No activity recorded yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activitiesQuery.data?.map((act) => (
                        <div key={act.id} className="flex gap-3 text-sm">
                          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                            {act.type === "call" ? (
                              <Phone className="size-3.5" />
                            ) : act.type === "email" ? (
                              <Mail className="size-3.5" />
                            ) : act.type === "whatsapp" || act.type === "sms" ? (
                              <MessageSquare className="size-3.5" />
                            ) : (
                              <Sparkles className="size-3.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-foreground">{act.title}</p>
                              <span className="text-xs text-muted-foreground">
                                {formatDateTime(act.created_at)}
                              </span>
                            </div>
                            {act.body && (
                              <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                                {act.body}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Edit Client Dialog */}
      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={client}
        workspaceId={workspaceId}
      />

      {/* Direct Message Composer Modal */}
      <SendMessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        client={client}
        onSent={() => {
          void queryClient.invalidateQueries({ queryKey: ["client-messages", clientId] });
          void queryClient.invalidateQueries({ queryKey: ["client-activities", clientId] });
          void queryClient.invalidateQueries({ queryKey: ["client", workspaceId, clientId] });
        }}
      />

      {/* New Task Modal */}
      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        clientId={clientId}
        workspaceId={workspaceId}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] });
        }}
      />
      <EditTaskDialog
        open={editTaskOpen}
        onOpenChange={setEditTaskOpen}
        task={taskToEdit}
        clientId={clientId}
        workspaceId={workspaceId}
        onUpdated={() => {
          void queryClient.invalidateQueries({ queryKey: ["client-tasks", clientId] });
        }}
      />
    </div>
  );
}

function EditTaskDialog({
  open,
  onOpenChange,
  task,
  clientId,
  workspaceId,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: any;
  clientId: string;
  workspaceId: string | null;
  onUpdated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("unassigned");
  const [saving, setSaving] = useState(false);
  const { data: team } = useTeamForWorkspace(workspaceId);

  useEffect(() => {
    if (task) {
      setTitle(task.title ?? "");
      setNotes(task.notes ?? "");
      setDueDate(task.due_at ? task.due_at.split('T')[0] : "");
      setAssignedTo(task.assigned_to ?? "unassigned");
    }
  }, [task]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Task title is required.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("tasks").update({
        title: title.trim(),
        notes: notes.trim() || null,
        due_at: dueDate ? new Date(dueDate).toISOString() : null,
        assigned_to: assignedTo === "unassigned" ? null : assignedTo,
      }).eq("id", task.id);
      if (error) throw error;
      toast.success("Task updated");
      onUpdated();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Follow-up</DialogTitle>
            <DialogDescription>Update the task details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Task Title</Label>
              <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" className="mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Assigned Team Member</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {(team ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context..." />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Update Task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

interface ClientEmailAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "ps1", "msi", "scr", "vbs", "js", "com", "pif",
  "sh", "dll", "reg", "jse", "wsf", "wsh", "cpl", "jar", "py", "pyc",
  "rb", "pl", "php", "cgi", "htaccess", "htpasswd", "lnk", "inf",
]);

const ACCEPTED_FILES =
  ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

function SendMessageDialog({
  open,
  onOpenChange,
  client,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientRecord;
  onSent: () => void;
}) {
  const [channel, setChannel] = useState<Exclude<Channel, "call">>("email");
  const [recipient, setRecipient] = useState(client.email || "");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(`Hi ${client.name.split(" ")[0]},\n\n`);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ClientEmailAttachment[]>([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sendFn = useServerFn(sendClientMessage);

  useEffect(() => {
    if (!open) {
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

    const currentTotal = totalAttachmentSize;
    let runningTotal = currentTotal;
    const prepared: ClientEmailAttachment[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (!isAllowedExtension(file.name)) {
        errors.push(`${file.name}: file type ".${file.name.split(".").pop() ?? ""}" blocked.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: exceeds 10 MB (${formatFileSize(file.size)}).`);
        continue;
      }
      if (runningTotal + file.size > MAX_TOTAL_SIZE) {
        errors.push(`${file.name}: adding it would exceed 25 MB total attachment limit.`);
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
          subject: channel === "email" ? subject.trim() : undefined,
          body: body.trim(),
          attachments: attachmentPayload,
        },
      });

      if (result.ok) {
        toast.success(`Message dispatched successfully to ${recipient || client.name}`);
        onSent();
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
              Dispatched in real-time from your configured email or messaging provider.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(val) => setChannel(val as Exclude<Channel, "call">)}
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
                    required
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
                    Attach File
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Allowed: PDF, JPG/JPEG, PNG, DOC/DOCX, XLS/XLSX, PPT/PPTX · 10 MB max per file
                </p>

                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {attachments.map((att, idx) => (
                      <li
                        key={`${att.filename}-${idx}`}
                        className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-medium">{att.filename}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatFileSize(att.sizeBytes)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Remove ${att.filename}`}
                          disabled={sending}
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={sending || preparingAttachments || !body.trim()}
              className="gap-2"
            >
              {sending || preparingAttachments ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {preparingAttachments ? "Preparing attachments…" : "Sending…"}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Send Message
                  {attachments.length > 0 && channel === "email" && (
                    <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground/90">
                      {attachments.length}
                    </span>
                  )}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  clientId,
  workspaceId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  workspaceId: string | null;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: team } = useTeamForWorkspace(workspaceId);
  const [assignedTo, setAssignedTo] = useState<string>("unassigned");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Task title is required.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        client_id: clientId,
        title: title.trim(),
        notes: notes.trim() || null,
        due_at: dueDate ? new Date(dueDate).toISOString() : null,
        assigned_to: assignedTo === "unassigned" ? null : assignedTo,
      });
      if (error) throw error;
      toast.success("Task created");
      setTitle("");
      setNotes("");
      setDueDate("");
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>Schedule a follow-up action for this client.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Task Title</Label>
              <Input
                className="mt-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Send revised pricing proposal"
                required
              />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Assigned Team Member</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {(team ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                className="mt-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add context..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
