import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, CheckCircle2, ExternalLink, ShieldCheck, Users } from "lucide-react";

import { IntegrationsManager } from "@/components/settings/integrations-manager";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuth, useProfile, useTeamForWorkspace, useWorkspace } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings & Integrations · NexusCRM" }] }),
  component: SettingsPage,
});

export function SettingsPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user);
  const { data: workspace } = useWorkspace(user?.id);
  const workspaceId = workspace?.workspace_id ?? null;
  const { data: team, isLoading: teamLoading } = useTeamForWorkspace(workspaceId);

  const workspaceDetailsQuery = useQuery({
    queryKey: ["workspace-details", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Settings & Integrations
        </h1>
        <p className="text-sm text-muted-foreground">
          Email integration and communication accounts connectivity.
        </p>
      </header>

      {/* Main Communication Channels & Real Integrations Component */}
      <IntegrationsManager workspaceId={workspaceId} />

      {/* Step-by-Step Provider Setup Instructions */}
      <Card className="border-border/60 bg-muted/20">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <CardTitle className="text-base">External Accounts Setup Guide</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Step-by-step instructions to obtain your official Email credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full text-xs">
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                Email Account Setup (Gmail OAuth, Resend, or SMTP)
              </AccordionTrigger>
              <AccordionContent className="space-y-2.5 text-muted-foreground pt-1">
                <div className="space-y-2">
                  <p className="font-semibold text-foreground">
                    Option 1: Gmail (Recommended - Official OAuth 2.0)
                  </p>
                  <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                    <li>
                      Click <strong>Connect Gmail</strong> above.
                    </li>
                    <li>
                      Sign in with your personal Google account and allow the requested permission (
                      <strong>Send email on your behalf</strong>).
                    </li>
                    <li>
                      NexusCRM receives an encrypted refresh token and immediately connects your
                      real Gmail address.
                    </li>
                    <li>
                      Click <strong>Send Test Email</strong> to send a test message from your actual
                      Gmail address.
                    </li>
                  </ol>

                  <Separator className="my-2" />

                  <p className="font-semibold text-foreground">Option 2: Resend (API Key)</p>
                  <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                    <li>
                      Create a free account at{" "}
                      <a
                        href="https://resend.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline font-medium inline-flex items-center gap-0.5"
                      >
                        resend.com <ExternalLink className="size-2.5" />
                      </a>
                      .
                    </li>
                    <li>
                      Go to <strong>API Keys</strong> &rarr; <strong>Create API Key</strong> (begins
                      with <code className="font-mono bg-muted px-1 rounded">re_</code>).
                    </li>
                    <li>
                      Click <strong>Other Providers</strong> above &rarr; select{" "}
                      <strong>Resend</strong> &rarr; paste the API Key and Sender Email.
                    </li>
                  </ol>

                  <Separator className="my-2" />

                  <p className="font-semibold text-foreground">Option 3: SMTP (Custom / Outlook)</p>
                  <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                    <li>
                      Host: e.g.{" "}
                      <code className="font-mono bg-muted px-1 rounded">smtp.office365.com</code>{" "}
                      (Outlook).
                    </li>
                    <li>
                      Port: <code className="font-mono bg-muted px-1 rounded">587</code> (or 465 for
                      SSL).
                    </li>
                    <li>Username: Your email address.</li>
                    <li>Password: App password or SMTP credentials.</li>
                  </ol>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
