import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Pencil,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useTeamForWorkspace, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, type ClientRecord } from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Follow-ups · NexusCRM" }] }),
  component: TasksPage,
});

type TaskItem = {
  id: string;
  client_id: string | null;
  title: string;
  notes: string | null;
  due_at: string | null;
  completed: boolean;
  assigned_to: string | null;
  created_at: string;
};

export function TasksPage() {
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<string>("open");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<TaskItem | null>(null);

  const { data: team } = useTeamForWorkspace(workspaceId);
  const teamMap = useMemo(
    () => new Map((team ?? []).map((m) => [m.id, m.full_name || m.email || "Team member"])),
    [team],
  );

  const clientsQuery = useQuery({
    queryKey: ["clients", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, company")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return (data ?? []) as ClientRecord[];
    },
  });

  const clientMap = useMemo(
    () => new Map((clientsQuery.data ?? []).map((c) => [c.id, c.name])),
    [clientsQuery.data],
  );

  const tasksQuery = useQuery({
    queryKey: ["all-tasks", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as TaskItem[];
    },
  });

  const toggleTask = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from("tasks").update({ completed }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
      toast.success("Task removed");
    },
    onError: (err) => toast.error(err.message),
  });

  const now = new Date();

  const filteredTasks = useMemo(() => {
    const list = tasksQuery.data ?? [];
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (tab === "completed") {
      return list.filter((t) => t.completed);
    }
    if (tab === "due_today") {
      return list.filter(
        (t) => !t.completed && t.due_at && new Date(t.due_at).getTime() <= todayEnd.getTime(),
      );
    }
    if (tab === "upcoming") {
      return list.filter(
        (t) => !t.completed && (!t.due_at || new Date(t.due_at).getTime() > todayEnd.getTime()),
      );
    }
    // "open"
    return list.filter((t) => !t.completed);
  }, [tasksQuery.data, tab]);

  const tasks = tasksQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Follow-up Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Keep deals moving with timely reminders and team action items.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 size-4" /> Add Task
        </Button>
      </header>

      <div className="flex items-center justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="open">
              Open ({tasks.filter((t) => !t.completed).length})
            </TabsTrigger>
            <TabsTrigger value="due_today">Due Today / Overdue</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="completed">
              Completed ({tasks.filter((t) => t.completed).length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardContent className="p-0">
          {tasksQuery.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading tasks...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="mx-auto size-10 text-muted-foreground/50" />
              <h3 className="mt-3 font-semibold text-base">No tasks in this view</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                All caught up! Create a new follow-up task to stay organized.
              </p>
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 size-4" /> Create Task
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {filteredTasks.map((task) => {
                const isOverdue =
                  !task.completed && task.due_at && new Date(task.due_at).getTime() < now.getTime();

                return (
                  <div
                    key={task.id}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          toggleTask.mutate({ id: task.id, completed: !task.completed })
                        }
                        className="mt-0.5"
                      >
                        <CheckCircle2
                          className={`size-5 transition-colors ${
                            task.completed
                              ? "text-success fill-success/20"
                              : "text-muted-foreground hover:text-foreground"
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
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {task.client_id && clientMap.has(task.client_id) && (
                            <Link
                              to="/clients/$clientId"
                              params={{ clientId: task.client_id }}
                              className="font-medium text-primary hover:underline"
                            >
                              Client: {clientMap.get(task.client_id)}
                            </Link>
                          )}
                          {task.assigned_to && (
                            <span className="flex items-center gap-1">
                              • <User className="size-3" />
                              {teamMap.get(task.assigned_to)?.split(" ")[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      {task.due_at && (
                        <Badge
                          variant={isOverdue ? "destructive" : "outline"}
                          className="flex items-center gap-1"
                        >
                          {isOverdue && <AlertCircle className="size-3" />}
                          <Calendar className="size-3" />
                          {formatDate(task.due_at)}
                        </Badge>
                      )}
                       <Button
                         variant="ghost"
                         size="icon"
                         className="size-7 text-muted-foreground hover:text-primary"
                         title="Edit follow-up"
                         onClick={() => { setTaskToEdit(task); setEditDialogOpen(true); }}
                       >
                         <Pencil className="size-3.5" />
                       </Button>
                       <Button
                         variant="ghost"
                         size="icon"
                         className="size-7 text-muted-foreground hover:text-destructive"
                         onClick={() => deleteTask.mutate(task.id)}
                       >
                         <Trash2 className="size-3.5" />
                       </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

       <CreateTaskModal
         open={dialogOpen}
         onOpenChange={setDialogOpen}
         clients={clientsQuery.data ?? []}
         team={team ?? []}
         onCreated={() => {
           void queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
           void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
         }}
       />
       {taskToEdit && (
         <EditTaskModal
           open={editDialogOpen}
           onOpenChange={(open) => {
             setEditDialogOpen(open);
             if (!open) setTaskToEdit(null);
           }}
           task={taskToEdit}
           clients={clientsQuery.data ?? []}
           team={team ?? []}
           onUpdated={() => {
             void queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
             void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
           }}
         />
       )}
    </div>
  );
}

function EditTaskModal({
  open,
  onOpenChange,
  task,
  clients,
  team,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskItem;
  clients: ClientRecord[];
  team: Array<{ id: string; full_name: string | null; email: string | null }>;
  onUpdated: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [clientId, setClientId] = useState<string>(task.client_id ?? "none");
  const [assignedTo, setAssignedTo] = useState<string>(task.assigned_to ?? "unassigned");
  const [dueDate, setDueDate] = useState<string>(task.due_at?.split('T')[0] ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Task title is required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tasks")
        .update({
          title: title.trim(),
          client_id: clientId === "none" ? null : clientId,
          assigned_to: assignedTo === "unassigned" ? null : assignedTo,
          due_at: dueDate ? new Date(dueDate).toISOString() : null,
          notes: notes.trim() || null,
        })
        .eq("id", task.id);
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
            <DialogTitle>Edit Follow-up Task</DialogTitle>
            <DialogDescription>Update the task details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Task Title</Label>
              <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <Label>Linked Client (optional)</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (General Task)</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assigned Team Member</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" className="mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context or instructions..." />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Update Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function CreateTaskModal({
  open,
  onOpenChange,
  clients,
  team,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: ClientRecord[];
  team: Array<{ id: string; full_name: string | null; email: string | null }>;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string>("none");
  const [assignedTo, setAssignedTo] = useState<string>("unassigned");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Task title is required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        title: title.trim(),
        client_id: clientId === "none" ? null : clientId,
        assigned_to: assignedTo === "unassigned" ? null : assignedTo,
        due_at: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success("Task scheduled");
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
            <DialogTitle>New Follow-up Task</DialogTitle>
            <DialogDescription>Schedule a reminder or client task.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Task Title</Label>
              <Input
                className="mt-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Follow up on signed proposal"
                required
              />
            </div>
            <div>
              <Label>Linked Client (optional)</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (General Task)</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assigned Team Member</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Context or instructions..."
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
