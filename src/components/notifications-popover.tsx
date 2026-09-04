import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck, Mail, MailCheck, Trash2, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, type ClientRecord } from "@/lib/crm";

interface NotificationItem {
  id: string;
  clientId: string | null;
  clientName: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  timestamp: string;
  source: "email_messages" | "messages";
}

interface NotificationsPopoverProps {
  workspaceId: string | null;
  clients: ClientRecord[];
}

const CLEARED_STORAGE_KEY = "nexuscrm_cleared_notifications_v1";

export function NotificationsPopover({ workspaceId, clients }: NotificationsPopoverProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Load cleared notification IDs from localStorage
  const [clearedIds, setClearedIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(CLEARED_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const saveClearedIds = (ids: string[]) => {
    setClearedIds(ids);
    try {
      localStorage.setItem(CLEARED_STORAGE_KEY, JSON.stringify(ids));
    } catch (err) {
      console.warn("Failed to persist cleared notifications to localStorage:", err);
    }
  };

  // Map client email -> client record for easy lookup when client_id is missing
  const clientEmailMap = useMemo(() => {
    const map = new Map<string, ClientRecord>();
    for (const c of clients) {
      if (c.email) {
        map.set(c.email.toLowerCase().trim(), c);
      }
    }
    return map;
  }, [clients]);

  // Query inbound email replies from email_messages and messages tables
  const notificationsQuery = useQuery({
    queryKey: ["inbound-notifications", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const items: NotificationItem[] = [];

      // 1. Fetch from email_messages table
      const { data: emailMsgs, error: emailErr } = await (supabase as any)
        .from("email_messages")
        .select("id, client_id, from_email, from_name, subject, body_text, received_at, created_at")
        .eq("workspace_id", workspaceId!)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(30);

      if (!emailErr && emailMsgs) {
        for (const msg of emailMsgs) {
          const matchedClient =
            clients.find((c) => c.id === msg.client_id) ||
            clientEmailMap.get((msg.from_email || "").toLowerCase().trim());

          items.push({
            id: msg.id,
            clientId: matchedClient?.id ?? msg.client_id ?? null,
            clientName: matchedClient?.name ?? msg.from_name ?? msg.from_email ?? "Unknown Sender",
            fromEmail: msg.from_email || "",
            fromName: msg.from_name || null,
            subject: msg.subject || "No Subject (Email Reply)",
            snippet: (msg.body_text || "").slice(0, 120),
            timestamp: msg.received_at || msg.created_at,
            source: "email_messages",
          });
        }
      }

      // 2. Fetch from messages table (general inbound messages)
      const { data: genMsgs, error: genErr } = await (supabase as any)
        .from("messages")
        .select("id, client_id, from_address, subject, body, created_at")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(30);

      if (!genErr && genMsgs) {
        for (const msg of genMsgs) {
          // Avoid duplicates if already in email_messages
          if (items.some((i) => i.id === msg.id)) continue;

          const matchedClient =
            clients.find((c) => c.id === msg.client_id) ||
            clientEmailMap.get((msg.from_address || "").toLowerCase().trim());

          items.push({
            id: msg.id,
            clientId: matchedClient?.id ?? msg.client_id ?? null,
            clientName: matchedClient?.name ?? msg.from_address ?? "Unknown Sender",
            fromEmail: msg.from_address || "",
            fromName: null,
            subject: msg.subject || "Inbound Message Reply",
            snippet: (msg.body || "").slice(0, 120),
            timestamp: msg.created_at,
            source: "messages",
          });
        }
      }

      // Sort by newest first
      items.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      return items;
    },
    refetchInterval: 15000, // Auto refresh every 15s
  });

  // Realtime postgres subscription for immediate popover updates when new reply comes in
  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel(`inbound_replies:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "email_messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["inbound-notifications", workspaceId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["inbound-notifications", workspaceId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, workspaceId]);

  const allNotifications = notificationsQuery.data ?? [];

  // Active (uncleared) notifications
  const activeNotifications = useMemo(() => {
    const clearedSet = new Set(clearedIds);
    return allNotifications.filter((n) => !clearedSet.has(n.id));
  }, [allNotifications, clearedIds]);

  const unreadCount = activeNotifications.length;

  const handleClearAll = () => {
    const allIds = allNotifications.map((n) => n.id);
    const newCleared = Array.from(new Set([...clearedIds, ...allIds]));
    saveClearedIds(newCleared);
  };

  const handleSelectNotification = (item: NotificationItem) => {
    setOpen(false);
    // Mark this specific item as cleared
    if (!clearedIds.includes(item.id)) {
      saveClearedIds([...clearedIds, item.id]);
    }

    if (item.clientId) {
      void navigate({
        to: "/clients/$clientId",
        params: { clientId: item.clientId },
      });
    } else {
      void navigate({ to: "/clients" });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-9 rounded-md border-input hover:bg-accent"
          aria-label="View Email Reply Notifications"
          title="Email Reply Notifications"
        >
          <Bell className="size-4 text-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[11px] font-bold text-destructive-foreground shadow-xs animate-pulse">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="size-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold leading-none">Email Replies</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {unreadCount === 0
                  ? "No unread replies"
                  : `${unreadCount} new client reply${unreadCount > 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="mr-1 size-3 text-destructive" /> Clear All
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[360px]">
          {activeNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <MailCheck className="size-9 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium text-muted-foreground">All caught up!</p>
              <p className="text-xs text-muted-foreground/70">
                No new client replies or email notifications.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {activeNotifications.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectNotification(item)}
                  className="flex w-full items-start gap-3 p-3.5 text-left transition-colors hover:bg-muted/40 group"
                >
                  <Avatar className="mt-0.5 size-8 border bg-primary/5">
                    <AvatarFallback className="text-xs font-semibold text-primary">
                      {item.clientName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                        {item.clientName}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatDateTime(item.timestamp)}
                      </span>
                    </div>
                    <p className="truncate text-xs font-medium text-muted-foreground/90">
                      {item.subject}
                    </p>
                    {item.snippet && (
                      <p className="line-clamp-2 text-xs text-muted-foreground/70">
                        {item.snippet}
                      </p>
                    )}
                    {item.clientId && (
                      <Badge variant="outline" className="mt-1 text-[10px] text-primary">
                        View Client Section &rarr;
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
