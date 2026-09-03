import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, MessageSquare, Plus, Search, Trash2 } from "lucide-react";

import { BulkSendMessageDialog } from "@/components/bulk-send-message-dialog";
import { ClientDialog } from "@/components/client-dialog";
import { SendMessageDialog } from "@/components/send-message-dialog";
import { deleteBulkClientsFn, deleteClientFn } from "@/lib/clients.functions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, useProfile, useTeamForWorkspace, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
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
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkSendDialogOpen, setBulkSendDialogOpen] = useState(false);

  const deleteClientServerFn = useServerFn(deleteClientFn);
  const deleteBulkClientsServerFn = useServerFn(deleteBulkClientsFn);

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
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, workspaceId]);

  const { data: team } = useTeamForWorkspace(workspaceId);
  const teamNames = useMemo(
    () =>
      new Map(
        (team ?? []).map((member) => [
          member.id,
          member.full_name || member.email || "Team member",
        ]),
      ),
    [team],
  );

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

  const [isDeleting, setIsDeleting] = useState(false);

  const removeClient = async () => {
    if (!deleteClient || !workspaceId) return;
    setIsDeleting(true);
    const targetClient = deleteClient;
    try {
      let deleted = false;
      try {
        const result = await deleteClientServerFn({
          data: {
            clientId: targetClient.id,
            workspaceId,
          },
        });
        if (result && result.ok) {
          deleted = true;
        }
      } catch (e) {
        console.warn("Server delete function error, trying direct fallback:", e);
      }

      if (!deleted) {
        // Fallback: Delete related records first then client directly
        await supabase.from("activities").delete().eq("client_id", targetClient.id);
        await supabase.from("messages").delete().eq("client_id", targetClient.id);
        await supabase.from("call_logs").delete().eq("client_id", targetClient.id);
        await supabase.from("documents").delete().eq("client_id", targetClient.id);
        await supabase.from("tasks").delete().eq("client_id", targetClient.id);
        
        const { error } = await supabase
          .from("clients")
          .delete()
          .eq("id", targetClient.id)
          .eq("workspace_id", workspaceId);

        if (error) {
          toast.error(`Failed to delete client: ${error.message}`);
          return;
        }
      }

      setDeleteClient(null);
      setSelectedClientIds((prev) => {
        const next = new Set(prev);
        next.delete(targetClient.id);
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      toast.success(`Client "${targetClient.name}" deleted successfully`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete client.");
    } finally {
      setIsDeleting(false);
    }
  };

  const removeBulkClients = async () => {
    if (selectedClientIds.size === 0 || !workspaceId) return;
    setIsDeleting(true);
    const ids = Array.from(selectedClientIds);
    try {
      let deleted = false;
      try {
        const result = await deleteBulkClientsServerFn({
          data: {
            clientIds: ids,
            workspaceId,
          },
        });
        if (result && result.ok) {
          deleted = true;
        }
      } catch (e) {
        console.warn("Server bulk delete error, trying direct fallback:", e);
      }

      if (!deleted) {
        await supabase.from("activities").delete().in("client_id", ids);
        await supabase.from("messages").delete().in("client_id", ids);
        await supabase.from("call_logs").delete().in("client_id", ids);
        await supabase.from("documents").delete().in("client_id", ids);
        await supabase.from("tasks").delete().in("client_id", ids);

        const { error } = await supabase
          .from("clients")
          .delete()
          .in("id", ids)
          .eq("workspace_id", workspaceId);

        if (error) {
          toast.error(`Failed to delete clients: ${error.message}`);
          return;
        }
      }

      setBulkDeleteDialogOpen(false);
      setSelectedClientIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      toast.success(`Successfully deleted ${ids.length} clients`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete clients.");
    } finally {
      setIsDeleting(false);
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

  const handleClientSaved = async (savedClient: ClientRecord) => {
    queryClient.setQueryData<ClientRecord[]>(["clients", workspaceId], (currentClients = []) => {
      const existingIndex = currentClients.findIndex((client) => client.id === savedClient.id);
      if (existingIndex === -1) return [savedClient, ...currentClients];
      return currentClients.map((client) => (client.id === savedClient.id ? savedClient : client));
    });
    const refreshed = await queryClient.fetchQuery({
      queryKey: ["clients", workspaceId],
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
    const appearsInQuery = refreshed.some((client) => client.id === savedClient.id);
    if (!appearsInQuery) {
      throw new Error("The client was saved but is not visible in the current workspace list.");
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
        <div className="flex items-center gap-2">
          {selectedClientIds.size > 0 && (
            <>
              <Button
                variant="outline"
                onClick={() => setBulkSendDialogOpen(true)}
              >
                <MessageSquare className="mr-2 size-4" /> Send message
              </Button>
              <Button
                variant="destructive"
                onClick={() => setBulkDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 size-4" /> Delete selected
              </Button>
            </>
          )}
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
              <Button className="mt-4" onClick={openAdd}>
                <Plus className="mr-2 size-4" /> Add your first client
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[auto_1.4fr_1fr_1.2fr_1fr_1fr_1fr_auto] gap-4 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid lg:items-center">
            <Checkbox
              checked={filteredClients.length > 0 && selectedClientIds.size === filteredClients.length}
              onCheckedChange={(checked) => {
                if (checked) {
                  setSelectedClientIds(new Set(filteredClients.map((c) => c.id)));
                } else {
                  setSelectedClientIds(new Set());
                }
              }}
              aria-label="Select all"
            />
            <span>Name</span>
            <span>Company</span>
            <span>Email</span>
            <span>Status</span>
            <span>Source</span>
            <span>Assigned to</span>
            <span />
          </div>
          {filteredClients.map((client) => (
            <div
              key={client.id}
              onClick={() => navigate({ to: "/clients/$clientId", params: { clientId: client.id } })}
              className="grid cursor-pointer gap-3 border-b px-4 py-4 last:border-b-0 hover:bg-muted/40 transition-colors lg:grid-cols-[auto_1.4fr_1fr_1.2fr_1fr_1fr_1fr_auto] lg:items-center lg:gap-4"
            >
              <div className="hidden lg:flex" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedClientIds.has(client.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedClientIds);
                    if (checked) next.add(client.id);
                    else next.delete(client.id);
                    setSelectedClientIds(next);
                  }}
                  aria-label={`Select ${client.name}`}
                />
              </div>
              <div className="min-w-0 flex items-start gap-3 lg:block">
                <div className="lg:hidden mt-0.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedClientIds.has(client.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(selectedClientIds);
                      if (checked) next.add(client.id);
                      else next.delete(client.id);
                      setSelectedClientIds(next);
                    }}
                    aria-label={`Select ${client.name}`}
                  />
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
              </div>
              <p className="truncate text-sm">{client.company || "—"}</p>
              <p className="truncate text-sm text-muted-foreground">{client.email || "—"}</p>
              <Badge variant="outline" className="w-fit">
                {STATUS_LABELS[client.status]}
              </Badge>
              <p className="text-sm text-muted-foreground">{client.source || "—"}</p>
              <p className="truncate text-sm">
                {client.assigned_to
                  ? teamNames.get(client.assigned_to) || "Team member"
                  : "Unassigned"}
              </p>
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
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${client.name}`}
                  onClick={() => setDeleteClient(client)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
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
          }}
        />
      )}
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
        open={bulkDeleteDialogOpen}
        onOpenChange={(open) => !open && !isDeleting && setBulkDeleteDialogOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected clients?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete {selectedClientIds.size} selected client(s)? All associated history, messages, and records will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void removeBulkClients();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BulkSendMessageDialog
        open={bulkSendDialogOpen}
        onOpenChange={setBulkSendDialogOpen}
        clients={(clientsQuery.data ?? []).filter((c) => selectedClientIds.has(c.id))}
        onSent={() => {
          setSelectedClientIds(new Set());
          void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
        }}
      />
    </div>
  );
}
