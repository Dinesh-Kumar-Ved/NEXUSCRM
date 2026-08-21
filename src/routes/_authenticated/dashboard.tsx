import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Mail, TrendingUp, Users } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  PIPELINE_ORDER,
  STATUS_LABELS,
  formatCurrency,
  formatDate,
  type ClientRecord,
  type DealStatus,
} from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · NexusCRM" },
      {
        name: "description",
        content: "Pipeline value, deal stages, messages sent and conversion rate at a glance.",
      },
      { property: "og:title", content: "Dashboard · NexusCRM" },
      { property: "og:description", content: "Your CRM performance overview." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const [clients, messages, tasks] = await Promise.all([
        supabase.from("clients").select("*").order("updated_at", { ascending: false }),
        supabase
          .from("messages")
          .select("id, status, channel, created_at")
          .gte("created_at", weekAgo),
        supabase
          .from("tasks")
          .select("id, title, due_at, client_id, completed")
          .eq("completed", false)
          .order("due_at", { ascending: true })
          .limit(6),
      ]);
      if (clients.error) throw clients.error;
      return {
        clients: (clients.data ?? []) as ClientRecord[],
        messagesThisWeek: messages.data ?? [],
        tasks: tasks.data ?? [],
      };
    },
  });

  const clients = data?.clients ?? [];
  const byStatus = PIPELINE_ORDER.map((status) => ({
    status,
    count: clients.filter((c) => c.status === status).length,
  }));
  const accepted = clients.filter((c) => c.status === "accepted").length;
  const decided = accepted + clients.filter((c) => c.status === "rejected").length;
  const pipelineValue = clients
    .filter((c) => !["accepted", "rejected"].includes(c.status))
    .reduce((sum, c) => sum + Number(c.deal_value ?? 0), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your pipeline health and outreach activity this week.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={Users}
          label="Total clients"
          value={isLoading ? "—" : String(clients.length)}
        />
        <Metric
          icon={TrendingUp}
          label="Open pipeline value"
          value={isLoading ? "—" : formatCurrency(pipelineValue)}
        />
        <Metric
          icon={Mail}
          label="Messages sent (7d)"
          value={isLoading ? "—" : String(data?.messagesThisWeek.length ?? 0)}
        />
        <Metric
          icon={CheckCircle2}
          label="Acceptance rate"
          value={decided ? `${Math.round((accepted / decided) * 100)}%` : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Deals by stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {byStatus.map(({ status, count }) => (
              <StageRow
                key={status}
                status={status}
                count={count}
                total={Math.max(clients.length, 1)}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.tasks ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              (data?.tasks ?? []).map((task) => (
                <div key={task.id} className="text-sm">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">Due {formatDate(task.due_at)}</p>
                </div>
              ))
            )}
            <Link to="/tasks" className="inline-block text-xs font-medium text-accent">
              Manage follow-ups →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently updated clients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {clients.slice(0, 6).map((client) => (
            <Link
              key={client.id}
              to="/clients/$clientId"
              params={{ clientId: client.id }}
              className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-muted"
            >
              <div>
                <p className="text-sm font-medium">{client.name}</p>
                <p className="text-xs text-muted-foreground">
                  {client.company || "No company"} · {formatCurrency(Number(client.deal_value))}
                </p>
              </div>
              <StatusBadge status={client.status} />
            </Link>
          ))}
          {clients.length === 0 && !isLoading ? (
            <p className="text-sm text-muted-foreground">
              No clients yet.{" "}
              <Link to="/clients" className="text-accent">
                Add your first client
              </Link>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="font-display text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StageRow({ status, count, total }: { status: DealStatus; count: number; total: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
        <span className="font-medium">{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full status-bar-${status}`}
          style={{ width: `${(count / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
