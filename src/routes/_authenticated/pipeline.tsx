import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MoreVertical,
  Plus,
  User,
  Search,
  Clock,
  Calendar,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ClientDialog } from "@/components/client-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const STAGE_COLORS: Record<DealStatus, string> = {
  lead: "bg-blue-500",
  proposal_sent: "bg-purple-500",
  negotiating: "bg-orange-500",
  working_with_client: "bg-teal-500",
  follow_up_needed: "bg-yellow-500",
  on_hold: "bg-gray-400",
  accepted: "bg-green-500",
  rejected: "bg-red-500",
};

export function PipelinePage() {
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [initialStatus, setInitialStatus] = useState<DealStatus | undefined>();
  
  // Filters
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [valueFilter, setValueFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const [draggedClientId, setDraggedClientId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStatus | null>(null);

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

  const allClients = clientsQuery.data ?? [];

  // Summary Metrics (Unfiltered, to give overall pipeline view)
  const totalDeals = allClients.length;
  const pipelineValue = allClients
    .filter((c) => !["accepted", "rejected"].includes(c.status))
    .reduce((acc, c) => acc + Number(c.deal_value || 0), 0);
  const wonRevenue = allClients
    .filter((c) => c.status === "accepted")
    .reduce((acc, c) => acc + Number(c.deal_value || 0), 0);
  const lostRevenue = allClients
    .filter((c) => c.status === "rejected")
    .reduce((acc, c) => acc + Number(c.deal_value || 0), 0);

  // Filtered Clients
  const filteredClients = useMemo(() => {
    let filtered = allClients;
    
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.company?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q),
      );
    }
    
    if (stageFilter !== "all") {
      filtered = filtered.filter((c) => c.status === stageFilter);
    }
    
    if (valueFilter !== "all") {
      filtered = filtered.filter((c) => {
        const val = Number(c.deal_value || 0);
        if (valueFilter === "low") return val < 10000;
        if (valueFilter === "medium") return val >= 10000 && val <= 50000;
        if (valueFilter === "high") return val > 50000;
        return true;
      });
    }

    if (dateFilter !== "all") {
      const now = new Date().getTime();
      filtered = filtered.filter((c) => {
        const updated = new Date(c.updated_at).getTime();
        const diffDays = (now - updated) / (1000 * 3600 * 24);
        if (dateFilter === "7days") return diffDays <= 7;
        if (dateFilter === "30days") return diffDays <= 30;
        return true;
      });
    }
    
    return filtered;
  }, [allClients, search, stageFilter, valueFilter, dateFilter]);

  const displayedStages = stageFilter === "all" ? PIPELINE_ORDER : [stageFilter as DealStatus];

  const clearFilters = () => {
    setSearch("");
    setStageFilter("all");
    setValueFilter("all");
    setDateFilter("all");
  };

  const handleDragStart = (e: React.DragEvent, clientId: string) => {
    setDraggedClientId(clientId);
    e.dataTransfer.effectAllowed = "move";
    // For Firefox compatibility
    e.dataTransfer.setData("text/plain", clientId);
  };

  const handleDragOver = (e: React.DragEvent, stage: DealStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStage !== stage) {
      setDragOverStage(stage);
    }
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, targetStage: DealStatus) => {
    e.preventDefault();
    setDragOverStage(null);
    if (!draggedClientId) return;
    
    const client = allClients.find(c => c.id === draggedClientId);
    if (client && client.status !== targetStage) {
      updateStatus.mutate({ id: draggedClientId, status: targetStage });
    }
    setDraggedClientId(null);
  };

  return (
    <div className="flex h-full flex-col space-y-5 overflow-hidden">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Deal Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Track client proposals, deal velocity, and progress across stages.
          </p>
        </div>
        <Button
          onClick={() => {
            setSelectedClient(null);
            setInitialStatus("lead");
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 size-4" /> Add Deal
        </Button>
      </header>

      {/* Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Deals</p>
          <p className="text-xl font-bold tracking-tight">{totalDeals}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Pipeline Value</p>
          <p className="text-xl font-bold tracking-tight">{formatCurrency(pipelineValue)}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Won Revenue</p>
          <p className="text-xl font-bold tracking-tight text-green-600 dark:text-green-500">{formatCurrency(wonRevenue)}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Lost Revenue</p>
          <p className="text-xl font-bold tracking-tight text-muted-foreground">{formatCurrency(lostRevenue)}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search deals..."
            className="pl-8 h-9 text-sm bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[140px] h-9 text-sm bg-background">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {PIPELINE_ORDER.map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={valueFilter} onValueChange={setValueFilter}>
          <SelectTrigger className="w-[130px] h-9 text-sm bg-background">
            <SelectValue placeholder="Deal Value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Value</SelectItem>
            <SelectItem value="low">&lt; ₹10,000</SelectItem>
            <SelectItem value="medium">₹10k - ₹50k</SelectItem>
            <SelectItem value="high">&gt; ₹50,000</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[130px] h-9 text-sm bg-background">
            <SelectValue placeholder="Updated Date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Time</SelectItem>
            <SelectItem value="7days">Last 7 Days</SelectItem>
            <SelectItem value="30days">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
        {(search || stageFilter !== "all" || valueFilter !== "all" || dateFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-3 text-xs text-muted-foreground">
            Clear filters
          </Button>
        )}
      </div>

      {/* Kanban Board Area */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-x-auto overflow-y-hidden pb-4">
          {filteredClients.length === 0 && allClients.length > 0 && (
             <div className="flex h-full items-center justify-center">
               <div className="text-center">
                 <p className="text-sm font-medium text-muted-foreground mb-2">No deals found matching your filters</p>
                 <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
               </div>
             </div>
          )}
          
          <div className="flex h-full gap-3 h-full items-start px-0.5">
            {displayedStages.map((stage) => {
              const stageClients = filteredClients.filter((c) => c.status === stage);
              const stageValue = stageClients.reduce((acc, c) => acc + Number(c.deal_value || 0), 0);
              const isDragOver = dragOverStage === stage;

              return (
                <div
                  key={stage}
                  className={`flex h-full w-[300px] shrink-0 flex-col rounded-xl border bg-muted/20 transition-colors ${isDragOver ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border/50"}`}
                  onDragOver={(e) => handleDragOver(e, stage)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, stage)}
                >
                  {/* Column Header */}
                  <div className="shrink-0 p-3 pb-2 border-b border-border/50">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage]}`} />
                      <span className="font-semibold text-sm text-foreground">
                        {STATUS_LABELS[stage]}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground ml-auto bg-muted px-1.5 py-0.5 rounded-md">
                        {stageClients.length}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-muted-foreground pl-4">
                      {formatCurrency(stageValue)}
                    </div>
                  </div>

                  {/* Card List in Stage */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
                    {stageClients.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-4 py-8 text-center border-2 border-dashed border-border/60 rounded-lg mt-2 mx-1">
                        <p className="text-xs font-medium text-muted-foreground mb-3">No deals here</p>
                        <Button 
                          variant="secondary" 
                          size="sm" 
                          className="h-7 text-xs bg-background shadow-sm hover:bg-muted"
                          onClick={() => {
                            setSelectedClient(null);
                            setInitialStatus(stage);
                            setDialogOpen(true);
                          }}
                        >
                          <Plus className="mr-1 size-3" /> Add Deal
                        </Button>
                      </div>
                    ) : (
                      stageClients.map((client) => (
                        <div
                          key={client.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, client.id)}
                          className="group relative flex flex-col rounded-lg border bg-card p-3 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/30 cursor-grab active:cursor-grabbing"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <Link
                                to="/clients/$clientId"
                                params={{ clientId: client.id }}
                                className="font-semibold text-sm hover:text-primary transition-colors truncate block"
                              >
                                {client.name}
                              </Link>
                              {client.company && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{client.company}</p>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 -mr-1 -mt-1">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel className="text-xs">Move stage</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {DEAL_STATUSES.filter((s) => s !== client.status).map((target) => (
                                  <DropdownMenuItem
                                    key={target}
                                    onClick={() => updateStatus.mutate({ id: client.id, status: target })}
                                    className="text-xs"
                                  >
                                    Move to {STATUS_LABELS[target]}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild className="text-xs">
                                  <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                                    View details
                                  </Link>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <div className="mt-auto">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm text-foreground">
                                {formatCurrency(client.deal_value || 0)}
                              </span>
                              {client.assigned_to && (
                                <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                  <User className="h-3 w-3" />
                                  {teamMap.get(client.assigned_to)?.split(" ")[0] ?? "Assigned"}
                                </span>
                              )}
                            </div>
                            
                            {client.last_contacted_at && (
                               <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-border/40 text-[10px] text-muted-foreground font-medium">
                                 <Clock className="h-3 w-3" />
                                 <span>Last activity: {formatDate(client.last_contacted_at)}</span>
                               </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={selectedClient}
        workspaceId={workspaceId}
        {...(initialStatus ? { initialStatus } : {})}
      />
    </div>
  );
}
