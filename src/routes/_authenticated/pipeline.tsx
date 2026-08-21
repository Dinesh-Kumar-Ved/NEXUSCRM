import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  DollarSign,
  Filter,
  Layers,
  MoreVertical,
  Plus,
  TrendingUp,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ClientDialog } from "@/components/client-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth, useTeamForWorkspace, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  DEAL_STATUSES,
  PIPELINE_ORDER,
  STATUS_LABELS,
  formatCurrency,
  formatDate,
  type ClientRecord,
  type DealStatus,
} from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline · NexusCRM" }] }),
  component: PipelinePage,
});

export function PipelinePage() {
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [search, setSearch] = useState("");

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
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientRecord[];
    },
  });

  // Real-time synchronization
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`pipeline:${workspaceId}`)
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

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DealStatus }) => {
      const { error } = await supabase.from("clients").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      toast.success("Deal stage updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const clients = useMemo(() => {
    const all = clientsQuery.data ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }, [clientsQuery.data, search]);

  const totalValue = useMemo(
    () =>
      (clientsQuery.data ?? [])
        .filter((c) => !["accepted", "rejected"].includes(c.status))
        .reduce((acc, c) => acc + Number(c.deal_value || 0), 0),
    [clientsQuery.data],
  );

  return (
    <div className="flex h-full flex-col space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Deal Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Track client proposals, deal velocity, and progress across stages.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border bg-card px-3.5 py-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Active Pipeline: </span>
            <span className="font-semibold text-primary">{formatCurrency(totalValue)}</span>
          </div>
          <Button
            onClick={() => {
              setSelectedClient(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" /> Add Deal
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter deals by client, company..."
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Kanban Board Horizontal Scroll Container */}
      <div className="flex flex-1 gap-4 overflow-x-auto pb-6">
        {PIPELINE_ORDER.map((stage) => {
          const stageClients = clients.filter((c) => c.status === stage);
          const stageValue = stageClients.reduce((acc, c) => acc + Number(c.deal_value || 0), 0);

          return (
            <div
              key={stage}
              className="flex w-80 shrink-0 flex-col rounded-xl border bg-muted/30 p-3"
            >
              {/* Column Header */}
              <div className="mb-3 flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground">
                    {STATUS_LABELS[stage]}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                    {stageClients.length}
                  </span>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {formatCurrency(stageValue)}
                </span>
              </div>

              {/* Card List in Stage */}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
                {stageClients.length === 0 ? (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                    No deals in {STATUS_LABELS[stage]}
                  </div>
                ) : (
                  stageClients.map((client) => (
                    <Card
                      key={client.id}
                      className="transition-all hover:border-primary/50 hover:shadow-sm"
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <Link
                              to="/clients/$clientId"
                              params={{ clientId: client.id }}
                              className="font-medium text-sm hover:underline"
                            >
                              {client.name}
                            </Link>
                            {client.company && (
                              <p className="text-xs text-muted-foreground">{client.company}</p>
                            )}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-6">
                                <MoreVertical className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Move stage</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {DEAL_STATUSES.filter((s) => s !== client.status).map((target) => (
                                <DropdownMenuItem
                                  key={target}
                                  onClick={() =>
                                    updateStatus.mutate({ id: client.id, status: target })
                                  }
                                >
                                  Move to {STATUS_LABELS[target]}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                                  View details
                                </Link>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="font-semibold text-sm text-foreground">
                            {formatCurrency(client.deal_value || 0)}
                          </span>
                          {client.assigned_to && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <User className="size-3" />
                              {teamMap.get(client.assigned_to)?.split(" ")[0] ?? "Assigned"}
                            </span>
                          )}
                        </div>

                        {client.tags && client.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {client.tags.slice(0, 2).map((t) => (
                              <span
                                key={t}
                                className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] text-secondary-foreground font-medium"
                              >
                                {t}
                              </span>
                            ))}
                            {client.tags.length > 2 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{client.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={selectedClient}
        workspaceId={workspaceId}
      />
    </div>
  );
}
