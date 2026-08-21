import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, FileText, Mail, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { PERSONALIZATION_TOKENS, personalize, type Channel } from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({ meta: [{ title: "Templates · NexusCRM" }] }),
  component: TemplatesPage,
});

type Template = {
  id: string;
  name: string;
  channel: "email" | "sms" | "whatsapp" | "call";
  subject: string | null;
  body: string;
  created_at: string;
};

export function TemplatesPage() {
  const queryClient = useQueryClient();
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  const templates = (templatesQuery.data ?? []).filter(
    (t) => selectedChannel === "all" || t.channel === selectedChannel,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Message Templates</h1>
          <p className="text-sm text-muted-foreground">
            Reusable outreach templates for Email, SMS, and WhatsApp with token personalization.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingTemplate(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 size-4" /> New Template
        </Button>
      </header>

      <div className="flex items-center justify-between">
        <Tabs value={selectedChannel} onValueChange={setSelectedChannel}>
          <TabsList>
            <TabsTrigger value="all">All Templates</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {templatesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading templates...</p>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto size-10 text-muted-foreground/50" />
            <h3 className="mt-3 font-semibold text-base">No templates found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create reusable email and messaging templates with dynamic client tags.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setEditingTemplate(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" /> Create First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-semibold">{tpl.name}</CardTitle>
                    {tpl.subject && (
                      <p className="mt-0.5 text-xs text-muted-foreground font-medium">
                        Subject: {tpl.subject}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="capitalize shrink-0">
                    {tpl.channel === "email" ? (
                      <Mail className="mr-1 size-3" />
                    ) : (
                      <MessageSquare className="mr-1 size-3" />
                    )}
                    {tpl.channel}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap line-clamp-4">
                  {tpl.body}
                </div>
                <div className="flex items-center justify-end gap-2 border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingTemplate(tpl);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="mr-1 size-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteTemplate.mutate(tpl.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editingTemplate}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["templates"] })}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState<Exclude<Channel, "call">>(
    (template?.channel as Exclude<Channel, "call">) || "email",
  );
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [saving, setSaving] = useState(false);

  // Sync state on open/edit change
  useState(() => {
    if (template) {
      setName(template.name);
      setChannel((template.channel as Exclude<Channel, "call">) || "email");
      setSubject(template.subject ?? "");
      setBody(template.body);
    } else {
      setName("");
      setChannel("email");
      setSubject("");
      setBody("Hi {{client_name}},\n\n");
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !body.trim()) {
      toast.error("Name and message body are required.");
      return;
    }
    setSaving(true);
    try {
      if (template) {
        const { error } = await supabase
          .from("templates")
          .update({
            name: name.trim(),
            channel,
            subject: channel === "email" ? subject.trim() || null : null,
            body: body.trim(),
          })
          .eq("id", template.id);
        if (error) throw error;
        toast.success("Template updated");
      } else {
        const { error } = await supabase.from("templates").insert({
          name: name.trim(),
          channel,
          subject: channel === "email" ? subject.trim() || null : null,
          body: body.trim(),
        });
        if (error) throw error;
        toast.success("Template created");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const insertToken = (token: string) => {
    setBody((prev) => prev + token);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{template ? "Edit Template" : "New Message Template"}</DialogTitle>
            <DialogDescription>
              Use dynamic tokens to personalize message text automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Template Name</Label>
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Proposal Follow-up"
                required
              />
            </div>

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
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {channel === "email" && (
              <div>
                <Label>Subject Line</Label>
                <Input
                  className="mt-1"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Follow up regarding {{company}}"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <Label>Message Content</Label>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Tokens:</span>
                  {PERSONALIZATION_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertToken(token)}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-mono hover:bg-secondary/80 text-foreground"
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                className="mt-1 min-h-32 font-mono text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your template text..."
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : template ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
