import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { useTeamForWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  CLIENT_SOURCES,
  DEAL_STATUSES,
  STATUS_LABELS,
  type ClientRecord,
  type DealStatus,
} from "@/lib/crm";

type FieldErrors = {
  name?: string;
  email?: string;
};

function logClientError(error: unknown) {
  if (!import.meta.env.DEV) return;
  const details = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  console.error("[CLIENTS] Supabase client operation failed", {
    message: typeof details["message"] === "string" ? details["message"] : String(error),
    code: details["code"],
    details: details["details"],
    hint: details["hint"],
    status: details["status"],
  });
}

function getClientErrorMessage(error: Error, isEditing: boolean) {
  if (
    error.message === "Full name is required." ||
    error.message === "Please enter a valid email address."
  ) {
    return error.message;
  }
  if (error.message === "Your session has expired. Please sign in again.") return error.message;
  return isEditing
    ? "Unable to update client. Please check the information and try again."
    : "Unable to create client. Please check the information and try again.";
}

function logInsertError(error: unknown) {
  if (!import.meta.env.DEV) return;
  const details = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  console.error("ADD CLIENT INSERT ERROR", {
    message: typeof details["message"] === "string" ? details["message"] : String(error),
    code: details["code"],
    details: details["details"],
    hint: details["hint"],
    status: details["status"],
  });
}

const EMPTY = {
  name: "",
  company: "",
  email: "",
  phone: "",
  whatsapp: "",
  website: "",
  source: "Referral",
  tags: "",
  status: "lead" as DealStatus,
  deal_value: "0",
  notes: "",
  assigned_to: "unassigned",
};

export function ClientDialog({
  open,
  onOpenChange,
  client,
  workspaceId,
  onSaved,
  initialStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientRecord | null;
  workspaceId: string | null;
  onSaved?: (client: ClientRecord) => void | Promise<void>;
  initialStatus?: DealStatus;
}) {
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { data: team } = useTeamForWorkspace(workspaceId);

  useEffect(() => {
    if (!open) return;
    setForm(
      client
        ? {
          name: client.name,
          company: client.company ?? "",
          email: client.email ?? "",
          phone: client.phone ?? "",
          whatsapp: client.whatsapp ?? "",
          website: client.website ?? "",
          source: client.source ?? "Referral",
          tags: client.tags.join(", "),
          status: client.status,
          deal_value: String(client.deal_value ?? 0),
          notes: client.notes ?? "",
          assigned_to: client.assigned_to ?? "unassigned",
        }
        : { ...EMPTY, status: initialStatus ?? EMPTY.status },
    );
  }, [open, client, initialStatus]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        throw new Error("Your session has expired. Please sign in again.");
      }
      if (!workspaceId) throw new Error("Workspace is still loading. Please try again.");
      const name = form.name.trim();
      const email = form.email.trim();
      if (!name) throw new Error("Full name is required.");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Please enter a valid email address.");
      }
      const payload = {
        name,
        company: form.company.trim() || null,
        email: email || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        website: form.website.trim() || null,
        source: form.source || null,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        status: form.status,
        deal_value: Number(form.deal_value) || 0,
        notes: form.notes.trim() || null,
        assigned_to: form.assigned_to === "unassigned" ? null : form.assigned_to,
      };

      if (client) {
        const { data, error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", client.id)
          .select()
          .single();
        if (error) throw error;
        return data as ClientRecord;
      }
      const insertPayload = { ...payload, workspace_id: workspaceId, created_by: auth.user.id };
      if (import.meta.env.DEV) {
        console.group("ADD CLIENT DEBUG");
        console.log("authenticated user id:", auth.user.id);
        console.log("workspaceId:", workspaceId);
        console.log("insert payload:", insertPayload);
      }

      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id, role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (import.meta.env.DEV) {
        console.log("workspace membership:", membership);
        console.log("workspace membership error:", membershipError);
      }
      if (membershipError) {
        if (import.meta.env.DEV) console.groupEnd();
        throw membershipError;
      }
      if (!membership) {
        if (import.meta.env.DEV) console.groupEnd();
        throw new Error("The authenticated user is not a member of this workspace.");
      }

      const { data, error } = await supabase
        .from("clients")
        .insert(insertPayload)
        .select()
        .single();
      if (import.meta.env.DEV) {
        console.log("insert result data:", data);
        console.log("insert result error:", error);
        console.groupEnd();
      }
      if (error) throw error;
      if (!data || data.workspace_id !== workspaceId) {
        throw new Error("Supabase returned a client for an unexpected workspace.");
      }
      return data as ClientRecord;
    },
    onSuccess: async (savedClient) => {
      setForm(EMPTY);
      setFieldErrors({});
      await onSaved?.(savedClient);
      toast.success(client ? "Client updated" : "Client added");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      logClientError(error);
      logInsertError(error);
      toast.error(getClientErrorMessage(error, Boolean(client)));
    },
  });

  const submit = () => {
    const nextErrors: FieldErrors = {};
    if (!form.name.trim()) nextErrors.name = "Full name is required.";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "Add client"}</DialogTitle>
          <DialogDescription>
            Contact details and deal status drive messaging and the pipeline board.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={form.name}
              aria-invalid={Boolean(fieldErrors.name)}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {fieldErrors.name ? (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            ) : null}
          </Field>
          <Field label="Company">
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              aria-invalid={Boolean(fieldErrors.email)}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {fieldErrors.email ? (
              <p className="text-xs text-destructive">{fieldErrors.email}</p>
            ) : null}
          </Field>
          <Field label="Website">
            <Input
              type="url"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://company.com"
            />
          </Field>
          <Field label="Phone (E.164, e.g. +15551234567)">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="WhatsApp number">
            <Input
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="Defaults to phone if empty"
            />
          </Field>
          <Field label="Source">
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Proposal status">
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as DealStatus })}
            >
              <SelectTrigger>
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
          </Field>
          <Field label="Deal value (INR)">
            <Input
              type="number"
              min="0"
              value={form.deal_value}
              onChange={(e) => setForm({ ...form, deal_value: e.target.value })}
            />
          </Field>
          <Field label="Tags (comma separated)">
            <Input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="VIP, Repeat Client"
            />
          </Field>
          <Field label="Assigned to">
            <Select
              value={form.assigned_to}
              onValueChange={(v) => setForm({ ...form, assigned_to: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(team ?? []).map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Creating..." : client ? "Save changes" : "Create client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
