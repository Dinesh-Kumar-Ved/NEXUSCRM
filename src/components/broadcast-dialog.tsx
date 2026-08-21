import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { sendBulkMessage } from "@/lib/messaging.functions";
import { PERSONALIZATION_TOKENS, type Channel } from "@/lib/crm";

export function BroadcastDialog({
  open,
  onOpenChange,
  clientIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientIds: string[];
}) {
  const [channel, setChannel] = useState<Exclude<Channel, "call">>("email");
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Hi {{client_name}},\n\n");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const send = useServerFn(sendBulkMessage);

  const { data: templates } = useQuery({
    queryKey: ["templates", channel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .eq("channel", channel)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const run = useMutation({
    mutationFn: () =>
      send({
        data: {
          clientIds,
          channel,
          subject: channel === "email" ? subject : undefined,
          body,
          campaignName: campaignName.trim() || `${channel} broadcast`,
          templateId: selectedTemplateId,
        },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      toast.success(`Sent ${result.sent} of ${clientIds.length}`, {
        description:
          result.failed || result.skipped.length
            ? `${result.failed} failed, ${result.skipped.length} skipped`
            : undefined,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Broadcast to {clientIds.length} client(s)</DialogTitle>
          <DialogDescription>
            Personalization tokens: {PERSONALIZATION_TOKENS.join(", ")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => {
                  setChannel(v as Exclude<Channel, "call">);
                  setSelectedTemplateId(undefined);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Campaign name</Label>
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="September follow-up"
              />
            </div>
          </div>

          {(templates ?? []).length > 0 ? (
            <div className="space-y-2">
              <Label>Start from a template</Label>
              <Select
                value={selectedTemplateId ?? ""}
                onValueChange={(id) => {
                  const template = (templates ?? []).find((t) => t.id === id);
                  if (!template) return;
                  setSelectedTemplateId(template.id);
                  setSubject(template.subject ?? "");
                  setBody(template.body);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {channel === "email" ? (
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => run.mutate()} disabled={!body.trim() || run.isPending}>
            {run.isPending ? "Sending…" : "Send broadcast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
