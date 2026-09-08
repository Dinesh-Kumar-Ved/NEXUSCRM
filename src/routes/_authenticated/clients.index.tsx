import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, Plus, Search, Trash2, Upload } from "lucide-react";

import { BroadcastDialog } from "@/components/broadcast-dialog";
import { ClientDialog } from "@/components/client-dialog";
import { ImportClientsDialog } from "@/components/import-clients-dialog";
import { NotificationsPopover } from "@/components/notifications-popover";
import { SendMessageDialog } from "@/components/send-message-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, useProfile, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getAdditionalEmails, getPrimaryEmail } from "@/lib/email-utils";
import {
  CLIENT_SOURCES,
  STATUS_LABELS,
  type ClientRecord,
  type DealStatus,
  formatDate,
} from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({ meta: [{ title: "Clients · NexusCRM" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user);
  const {
    data: workspace,
    isLoading: workspaceLoading,
    error: workspaceError,
  } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [emailClient, setEmailClient] = useState<ClientRecord | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [deleteClient, setDeleteClient] = useState<ClientRecord | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const clientsQuery = useQuery({
    queryKey: ["clients", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientRecord[];
    },
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`clients:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clients",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] }),
      )
  }, [queryClient, workspaceId]);

  const filteredClients = useMemo(() => {
    return (clientsQuery.data ?? []).filter((client) => {
      const matchesSearch =
        !debouncedSearch ||
        [client.name, client.company, client.email].some((value) =>
          value?.toLowerCase().includes(debouncedSearch),
        );
      const matchesStatus = status === "all" || client.status === status;
      const matchesSource = source === "all" || client.source === source;
      return matchesSearch && matchesStatus && matchesSource;
    });
  }, [clientsQuery.data, debouncedSearch, source, status]);

  const isAllSelected =
    filteredClients.length > 0 &&
    filteredClients.every((client) => selectedIds.includes(client.id));
  const isSomeSelected =
    !isAllSelected &&
    filteredClients.some((client) => selectedIds.includes(client.id));

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newIds = new Set(selectedIds);
      filteredClients.forEach((client) => newIds.add(client.id));
      setSelectedIds(Array.from(newIds));
    } else {
      const filteredIdSet = new Set(filteredClients.map((client) => client.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
    }
  };

  const handleToggleClient = (clientId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, clientId] : prev.filter((id) => id !== clientId),
    );
  };

  const handleSendMessage = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      const client = (clientsQuery.data ?? []).find((c) => c.id === selectedIds[0]);
      if (client) {
        setEmailClient(client);
        setEmailDialogOpen(true);
        return;
      }
    }
    setBulkMessageOpen(true);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0 || !workspaceId) return;
    setIsBulkDeleting(true);
    try {
      const { error } = await supabase
        .from("clients")
        .delete()
        .in("id", selectedIds)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      toast.success(
        `Deleted ${selectedIds.length} client${selectedIds.length > 1 ? "s" : ""}`,
      );
      setSelectedIds([]);
      setBulkDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete selected clients",
      );
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const openAdd = () => {
    setSelectedClient(null);
    setDialogOpen(true);
  };

  const openEdit = (client: ClientRecord) => {
    setSelectedClient(client);
    setDialogOpen(true);
  };

  const handleClientSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const removeClient = async () => {
    if (!deleteClient) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from("clients").delete().eq("id", deleteClient.id);
      if (error) throw error;
      toast.success("Client deleted");
      setSelectedIds((prev) => prev.filter((id) => id !== deleteClient.id));
      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      setDeleteClient(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete client");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Manage the people and companies in your workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/60 px-3 py-1 shadow-sm animate-in fade-in">
              <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                {selectedIds.length} selected
              </span>
              <div className="h-3.5 w-px bg-border" />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs gap-1.5"
                onClick={handleSendMessage}
              >
                <Mail className="size-3.5" /> Send Message
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2.5 text-xs gap-1.5"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" /> Delete Selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedIds([])}
                title="Clear selection"
              >
                Clear
              </Button>
            </div>
          )}
          <NotificationsPopover
            workspaceId={workspaceId}
            clients={clientsQuery.data ?? []}
          />
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Upload className="mr-2 size-4" /> Import clients
          </Button>
          <Button onClick={openAdd}>
            <Plus className="mr-2 size-4" /> Add client
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, company or email"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as DealStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {CLIENT_SOURCES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {workspaceLoading || clientsQuery.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading clients...
          </CardContent>
        </Card>
      ) : workspaceError || clientsQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Unable to load clients. Please try again.
          </CardContent>
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <h2 className="font-display text-lg font-semibold">
              {debouncedSearch || status !== "all" || source !== "all"
                ? "No matching clients"
                : "No clients yet"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {debouncedSearch || status !== "all" || source !== "all"
                ? "Try changing your search or filters."
                : "Add your first client to start building your CRM."}
            </p>
            {!debouncedSearch && status === "all" && source === "all" ? (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                  <Upload className="mr-2 size-4" /> Import clients
                </Button>
                <Button onClick={openAdd}>
                  <Plus className="mr-2 size-4" /> Add your first client
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[40px_1.4fr_1fr_1.2fr_1fr_1fr_auto] gap-4 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid lg:items-center">
            <div className="flex items-center justify-center">
              <Checkbox
                checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
                onCheckedChange={(checked) => handleSelectAll(Boolean(checked))}
                aria-label="Select all clients"
              />
            </div>
            <span>Name</span>
            <span>Company</span>
            <span>Email</span>
            <span>Status</span>
            <span>Source</span>
            <span />
          </div>
          {filteredClients.map((client) => {
            const isSelected = selectedIds.includes(client.id);
            return (
              <div
                key={client.id}
                onClick={() => navigate({ to: "/clients/$clientId", params: { clientId: client.id } })}
                className={cn(
                  "grid cursor-pointer gap-3 border-b px-4 py-4 last:border-b-0 hover:bg-muted/40 transition-colors lg:grid-cols-[40px_1.4fr_1fr_1.2fr_1fr_1fr_auto] lg:items-center lg:gap-4",
                  isSelected && "bg-primary/5",
                )}
              >
                <div
                  className="flex items-center lg:justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => handleToggleClient(client.id, Boolean(checked))}
                    aria-label={`Select ${client.name}`}
                  />
                  <span className="ml-2 text-xs font-medium text-muted-foreground lg:hidden">
                    Select
                  </span>
                </div>
                <div className="min-w-0">
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: client.id }}
                    className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {client.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDate(client.updated_at)}
                  </p>
                </div>
                <p className="truncate text-sm">{client.company || "—"}</p>
                <div className="truncate text-sm">
                  <span className="text-muted-foreground">{getPrimaryEmail(client.email) || "—"}</span>
                  {getAdditionalEmails(client.email).length > 0 && (
                    <span className="ml-1.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      +{getAdditionalEmails(client.email).length}
                    </span>
                  )}
                </div>
                <Badge variant="outline" className="w-fit">
                  {STATUS_LABELS[client.status]}
                </Badge>
                <p className="text-sm text-muted-foreground">{client.source || "—"}</p>
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setEmailClient(client);
                      setEmailDialogOpen(true);
                    }}
                    title={`Send email to ${client.name}`}
                    aria-label={`Send email to ${client.name}`}
                  >
                    <Mail className="size-3.5" />
                    Email
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(client)}>
                    Edit
                  </Button>
                  {profile?.isAdmin ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${client.name}`}
                      onClick={() => setDeleteClient(client)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={selectedClient}
        workspaceId={workspaceId}
        onSaved={handleClientSaved}
      />
      {emailClient && (
        <SendMessageDialog
          open={emailDialogOpen}
          onOpenChange={(open) => {
            setEmailDialogOpen(open);
            if (!open) setEmailClient(null);
          }}
          client={emailClient}
          defaultChannel="email"
          onSent={() => {
            void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
            setSelectedIds((prev) => prev.filter((id) => id !== emailClient.id));
          }}
        />
      )}
      <BroadcastDialog
        open={bulkMessageOpen}
        onOpenChange={(open) => {
          setBulkMessageOpen(open);
          if (!open) {
            void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
          }
        }}
        clientIds={selectedIds}
      />
      <AlertDialog
        open={Boolean(deleteClient)}
        onOpenChange={(open) => !open && !isDeleting && setDeleteClient(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete {deleteClient?.name ? `"${deleteClient.name}"` : "this client"}? All associated history, messages, and records will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void removeClient();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => !open && !isBulkDeleting && setBulkDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length} selected {selectedIds.length === 1 ? "client" : "clients"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete {selectedIds.length} selected {selectedIds.length === 1 ? "client" : "clients"}? All associated history, messages, and records will be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBulkDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleBulkDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting
                ? "Deleting..."
                : `Delete ${selectedIds.length} ${selectedIds.length === 1 ? "client" : "clients"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportClientsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        workspaceId={workspaceId}
      />
    </div>
  );
}
