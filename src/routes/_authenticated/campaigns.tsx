import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Mail,
  Megaphone,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BroadcastDialog } from "@/components/broadcast-dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, type ClientRecord } from "@/lib/crm";
import { clearAllCampaigns, deleteCampaign } from "@/lib/messaging.functions";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({ meta: [{ title: "Campaigns · NexusCRM" }] }),
  component: CampaignsPage,
});

export function CampaignsPage() {
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [clearAllOpen, setClearAllOpen] = useState(false);

  const queryClient = useQueryClient();
  const removeSingle = useServerFn(deleteCampaign);
  const removeAll = useServerFn(clearAllCampaigns);

  const clientsQuery = useQuery({
    queryKey: ["clients", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, phone, whatsapp, status, source")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return (data ?? []) as ClientRecord[];
    },
  });

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (campaignId: string) => removeSingle({ data: { campaignId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign deleted successfully");
      setDeletingCampaign(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete campaign");
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => removeAll(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("All campaign history cleared successfully");
      setClearAllOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to clear campaign history");
    },
  });

  const campaigns = campaignsQuery.data ?? [];
  const totalSent = campaigns.reduce((acc, c) => acc + (c.sent_count ?? 0), 0);
  const totalRecipients = campaigns.reduce((acc, c) => acc + (c.recipient_count ?? 0), 0);

  const allClientIds = (clientsQuery.data ?? []).map((c) => c.id);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Outreach Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Execute bulk Email, WhatsApp, and SMS broadcasts to segmented client lists.
          </p>
        </div>
        <Button onClick={() => setBroadcastOpen(true)} disabled={allClientIds.length === 0}>
          <Plus className="mr-2 size-4" /> New Broadcast
        </Button>
      </header>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Campaigns
            </CardTitle>
            <Megaphone className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold">{campaigns.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Recipients
            </CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold">{totalRecipients}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Delivered Messages
            </CardTitle>
            <CheckCircle2 className="size-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold text-success">{totalSent}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Audience In Workspace
            </CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-display text-2xl font-bold">{clientsQuery.data?.length ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Campaign History</CardTitle>
            <CardDescription>
              Logs and delivery analytics for past multi-channel broadcasts.
            </CardDescription>
          </div>
          {campaigns.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setClearAllOpen(true)}
            >
              <Trash2 className="mr-1.5 size-3.5" /> Clear All History
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {campaignsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading campaigns...</p>
          ) : campaigns.length === 0 ? (
            <div className="py-12 text-center">
              <Megaphone className="mx-auto size-10 text-muted-foreground/50" />
              <h3 className="mt-3 font-semibold text-base">No campaigns yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Launch a bulk broadcast to reach your clients across Email, WhatsApp, or SMS.
              </p>
              <Button className="mt-4" onClick={() => setBroadcastOpen(true)}>
                <Send className="mr-2 size-4" /> Create Broadcast
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Campaign Name</th>
                    <th className="px-4 py-3">Channel</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Recipients</th>
                    <th className="px-4 py-3">Delivered / Failed</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {campaigns.map((camp) => (
                    <tr key={camp.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3.5 font-medium">{camp.name}</td>
                      <td className="px-4 py-3.5">
                        <Badge variant="outline" className="capitalize">
                          {camp.channel === "email" ? (
                            <Mail className="mr-1 size-3" />
                          ) : (
                            <MessageSquare className="mr-1 size-3" />
                          )}
                          {camp.channel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge
                          variant={
                            camp.status === "completed"
                              ? "secondary"
                              : camp.status === "sending"
                                ? "default"
                                : "outline"
                          }
                          className="capitalize"
                        >
                          {camp.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">{camp.recipient_count}</td>
                      <td className="px-4 py-3.5">
                        <span className="font-medium text-success">{camp.sent_count} sent</span>
                        {camp.failed_count > 0 && (
                          <span className="ml-2 text-destructive">
                            ({camp.failed_count} failed)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        {formatDateTime(camp.created_at)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title={`Delete "${camp.name}"`}
                          onClick={() => setDeletingCampaign({ id: camp.id, name: camp.name })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Single Campaign Confirmation Dialog */}
      <AlertDialog
        open={Boolean(deletingCampaign)}
        onOpenChange={(open) => !open && setDeletingCampaign(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign History</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">
                "{deletingCampaign?.name}"
              </span>
              ? This will permanently delete this broadcast record and its delivery logs from your database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                if (deletingCampaign) {
                  deleteMutation.mutate(deletingCampaign.id);
                }
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Campaign"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear All Campaigns Confirmation Dialog */}
      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Campaign History</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all{" "}
              <span className="font-semibold text-foreground">
                {campaigns.length} broadcast records
              </span>
              ? This will permanently delete all campaign history logs from your database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearAllMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearAllMutation.isPending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                clearAllMutation.mutate();
              }}
            >
              {clearAllMutation.isPending ? "Clearing All…" : "Clear All History"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BroadcastDialog
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        clientIds={allClientIds}
      />
    </div>
  );
}
