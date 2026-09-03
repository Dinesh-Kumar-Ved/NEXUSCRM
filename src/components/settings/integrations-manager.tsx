import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  disconnectIntegration,
  getGoogleOAuthUrl,
  getIntegrationsStatus,
  getIntegrationsStatus,
  saveEmailIntegration,
  testEmailIntegration,
} from "@/lib/integrations.functions";
import { triggerGmailSync } from "@/lib/email-conversations.functions";
import type { MaskedIntegrationInfo } from "@/lib/integrations.server";

interface IntegrationsManagerProps {
  workspaceId: string | null;
}

export function IntegrationsManager({ workspaceId }: IntegrationsManagerProps) {
  const queryClient = useQueryClient();

  // Server functions
  const getStatusFn = useServerFn(getIntegrationsStatus);
  const getOAuthUrlFn = useServerFn(getGoogleOAuthUrl);
  const saveEmailFn = useServerFn(saveEmailIntegration);
  const testEmailFn = useServerFn(testEmailIntegration);
  const disconnectFn = useServerFn(disconnectIntegration);

  // Modals state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [testEmailDialogOpen, setTestEmailDialogOpen] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);

  // Email form state
  const [emailProvider, setEmailProvider] = useState<"gmail" | "resend" | "smtp" | "sendgrid">(
    "gmail",
  );
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [sendgridApiKey, setSendgridApiKey] = useState("");

  // Test recipient
  const [testRecipientEmail, setTestRecipientEmail] = useState("");

  // Gmail sync state
  const syncGmailFn = useServerFn(triggerGmailSync);
  const [isSyncingGmail, setIsSyncingGmail] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{
    synced: number;
    newMessages: number;
    timestamp: Date;
  } | null>(null);

  const handleSyncGmail = async () => {
    if (!workspaceId) {
      toast.error("Workspace ID is required to sync Gmail.");
      return;
    }
    setIsSyncingGmail(true);
    try {
      const res = await syncGmailFn({ data: { workspaceId } });
      if (res.ok) {
        setLastSyncResult({
          synced: res.synced,
          newMessages: res.newMessages,
          timestamp: new Date(),
        });
        if (res.newMessages > 0) {
          toast.success(`Gmail sync complete: ${res.newMessages} new message${res.newMessages > 1 ? "s" : ""} synced!`);
        } else {
          toast.success(`Gmail inbox is up to date (${res.synced} messages total).`);
        }
        void queryClient.invalidateQueries({ queryKey: ["integrations-status"] });
        void queryClient.invalidateQueries({ queryKey: ["unmatched-emails", workspaceId] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync Gmail.");
    } finally {
      setIsSyncingGmail(false);
    }
  };

  // Handle URL query parameters from OAuth redirect callback
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    const email = params.get("email");
    const error = params.get("error");

    if (integration === "gmail_connected") {
      toast.success(
        email
          ? `Gmail account connected successfully! (Sending from ${email})`
          : "Gmail account connected successfully via Google OAuth 2.0!",
      );
      void queryClient.invalidateQueries({ queryKey: ["integrations-status"] });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      toast.error(`Gmail Connection Failed: ${decodeURIComponent(error)}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [queryClient]);

  // Query integration status
  const {
    data: status,
    isLoading,
    refetch,
  } = useQuery<{
  } | null>({
    queryKey: ["integrations-status", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) return null;
      const res = await getStatusFn({ data: { workspaceId } });
      return res as { email: MaskedIntegrationInfo };
    },
  });

  // Start Gmail OAuth Flow
  const handleConnectGmail = async () => {
    console.log("[GMAIL] Connect button clicked");
    try {
      setIsConnectingGmail(true);
      console.log("[GMAIL] Requesting OAuth URL");
      // workspaceId is optional — server auto-resolves from authenticated session if not provided
      const res = await getOAuthUrlFn({ data: workspaceId ? { workspaceId } : {} });
      if (res?.url) {
        console.log("[GMAIL] OAuth URL received, redirecting to Google");
        window.location.href = res.url;
      } else {
        toast.error("Failed to generate Google OAuth authorization URL.");
        setIsConnectingGmail(false);
      }
    } catch (err) {
      setIsConnectingGmail(false);
      const msg = err instanceof Error ? err.message : "Failed to initialize Google OAuth connection.";
      console.error("[GMAIL] Error:", msg);
      toast.error(msg);
    }
  };


  // Save Email mutation
  const saveEmailMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Workspace is required");
      return await saveEmailFn({
        data: {
          workspaceId,
          provider: emailProvider,
          fromEmail: fromEmail.trim(),
          fromName: fromName.trim() || undefined,
          resendApiKey: emailProvider === "resend" ? resendApiKey.trim() : undefined,
          smtpHost: emailProvider === "smtp" ? smtpHost.trim() : undefined,
          smtpPort: emailProvider === "smtp" ? Number(smtpPort) : undefined,
          smtpUser: emailProvider === "smtp" ? smtpUser.trim() : undefined,
          smtpPassword: emailProvider === "smtp" ? smtpPassword.trim() : undefined,
          smtpSecure: emailProvider === "smtp" ? smtpSecure : undefined,
          sendgridApiKey: emailProvider === "sendgrid" ? sendgridApiKey.trim() : undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Email configuration saved!");
      setEmailDialogOpen(false);
      setResendApiKey("");
      setSmtpPassword("");
      void queryClient.invalidateQueries({ queryKey: ["integrations-status"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save Email configuration");
    },
  });

  // Test Email mutation
  const testEmailMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Workspace is required");
      return await testEmailFn({
        data: {
          workspaceId,
          testRecipientEmail: testRecipientEmail.trim(),
        },
      });
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Verification test email sent to ${testRecipientEmail}!`);
        setTestEmailDialogOpen(false);
      } else {
        toast.error(`Email test failed: ${res.error}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["integrations-status"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Email test request failed");
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (providerType: "email") => {
      if (!workspaceId) throw new Error("Workspace is required");
      return await disconnectFn({
        data: { workspaceId, providerType },
      });
    },
    onSuccess: (_, providerType) => {
      toast.info(`Email integration disconnected.`);
      void queryClient.invalidateQueries({ queryKey: ["integrations-status"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    },
  });

  const em = status?.email;
  const isGmail = em?.provider === "gmail";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Communication Channels & Real Integrations
          </h2>
          <p className="text-xs text-muted-foreground">
            Connect your personal Gmail account for direct
            outbound messaging.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isLoading}
          className="gap-1.5 text-xs"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh Status
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">


        {/* 2. EMAIL INTEGRATION CARD (GMAIL OAUTH & APIS) */}
        <Card className="flex flex-col border-border/80 shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-500/20">
                  <Mail className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-base">Email Integration</CardTitle>
                  <CardDescription className="text-xs">
                    {isGmail
                      ? "Personal Gmail Account (OAuth 2.0 + Gmail API)"
                      : "Gmail, Resend, SMTP, or SendGrid"}
                  </CardDescription>
                </div>
              </div>

              {em?.isConnected ? (
                <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">
                  <CheckCircle2 className="mr-1 size-3" /> Connected & Verified
                </Badge>
              ) : em?.status === "error" && em?.provider === "gmail" ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="size-3" /> Connection Expired
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <WifiOff className="mr-1 size-3" /> Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="flex-1 space-y-3 pb-3 text-xs">
            {em?.isConnected ? (
              <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Email Provider:</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase font-mono font-semibold"
                  >
                    {em.provider === "gmail" ? "Gmail (OAuth 2.0)" : em.provider}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connected Account:</span>
                  <span className="font-medium text-foreground font-mono">
                    {em.maskedDetails?.fromEmail || em.maskedDetails?.connectedEmail || "—"}
                  </span>
                </div>
                {em.maskedDetails?.fromName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Display Name:</span>
                    <span className="font-medium text-foreground">{em.maskedDetails.fromName}</span>
                  </div>
                )}
                {em.maskedDetails?.smtpHost && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SMTP Host:</span>
                    <span className="font-mono">
                      {em.maskedDetails.smtpHost}:{em.maskedDetails.smtpPort || 587}
                    </span>
                  </div>
                )}
                {em.lastTestedAt && (
                  <div className="flex justify-between text-[11px] text-muted-foreground pt-1 border-t">
                    <span>Last Verified:</span>
                    <span>{new Date(em.lastTestedAt).toLocaleString()}</span>
                  </div>
                )}
                {lastSyncResult && (
                  <div className="flex justify-between text-[11px] text-emerald-600 dark:text-emerald-400 pt-1 border-t font-medium">
                    <span>Last Gmail Sync:</span>
                    <span>
                      {lastSyncResult.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ({lastSyncResult.newMessages} new messages)
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground space-y-2">
                <p className="font-medium text-foreground">No Email Account Connected</p>
                <p className="text-[11px]">
                  Connect your personal Gmail account to send emails directly from your own Gmail
                  address to any client.
                </p>
                <div className="pt-1">
                  <Button
                    onClick={handleConnectGmail}
                    disabled={isConnectingGmail}
                    size="sm"
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shadow-xs"
                  >
                    {isConnectingGmail ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="size-3.5" />
                    )}
                    Connect Gmail (OAuth 2.0)
                  </Button>
                </div>
              </div>
            )}

            {em?.lastTestError && (
              <Alert variant="destructive" className="py-2 text-xs">
                <AlertCircle className="size-3.5" />
                <AlertDescription className="text-xs">
                  {em.lastTestError.includes("expired") || em.lastTestError.includes("revoked")
                    ? "Your Gmail connection has expired. Please reconnect your Gmail account."
                    : em.lastTestError}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-between gap-2 border-t pt-3">
            <div className="flex items-center gap-2">
              {isGmail ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectGmail}
                  disabled={isConnectingGmail}
                  className="text-xs gap-1.5"
                >
                  {isConnectingGmail && <Loader2 className="size-3 animate-spin" />}
                  {em?.isConnected ? "Switch / Reconnect Gmail" : "Connect Gmail"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFromEmail((em?.maskedDetails?.fromEmail as string) || "");
                    setFromName((em?.maskedDetails?.fromName as string) || "");
                    setEmailProvider((em?.provider as any) || "gmail");
                    setEmailDialogOpen(true);
                  }}
                  className="text-xs"
                >
                  {em?.isConnected ? "Reconfigure" : "Other Providers"}
                </Button>
              )}

              {em?.isConnected && !isGmail && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectGmail}
                  disabled={isConnectingGmail}
                  className="text-xs gap-1.5"
                >
                  Switch to Gmail
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {em?.isConnected && (
                <>
                  {isGmail && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSyncGmail}
                      disabled={isSyncingGmail}
                      className="gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                    >
                      <RefreshCw className={`size-3 ${isSyncingGmail ? "animate-spin" : ""}`} />
                      {isSyncingGmail ? "Syncing..." : "Sync Gmail"}
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTestRecipientEmail(
                        (em?.maskedDetails?.fromEmail as string) ||
                          (em?.maskedDetails?.connectedEmail as string) ||
                          "",
                      );
                      setTestEmailDialogOpen(true);
                    }}
                    className="gap-1.5 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <Send className="size-3" /> Send Test Email
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => disconnectMutation.mutate("email")}
                    disabled={disconnectMutation.isPending}
                    className="size-8 p-0 text-muted-foreground hover:text-destructive"
                    title="Disconnect Email"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </CardFooter>
        </Card>
      </div>



      {/* DIALOG: CONFIGURE EMAIL PROVIDER */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Mail className="size-5 text-blue-600" />
              <DialogTitle>Connect Email Account</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Choose your email provider or connect your personal Gmail account via official Google
              OAuth.
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={emailProvider}
            onValueChange={(v) => setEmailProvider(v as any)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="gmail" className="text-xs">
                Gmail (OAuth)
              </TabsTrigger>
              <TabsTrigger value="resend" className="text-xs">
                Resend
              </TabsTrigger>
              <TabsTrigger value="smtp" className="text-xs">
                SMTP
              </TabsTrigger>
              <TabsTrigger value="sendgrid" className="text-xs">
                SendGrid
              </TabsTrigger>
            </TabsList>

            {emailProvider === "gmail" && (
              <div className="space-y-4 py-4 text-center">
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                  <h4 className="font-semibold text-foreground text-sm">
                    Official Google OAuth 2.0
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Connect your personal Gmail account securely. NexusCRM requests permissions
                    to send emails on your behalf and identify your email address (
                    <code className="font-mono text-[11px] bg-muted px-1 rounded">gmail.send</code>
                    {" "}and{" "}
                    <code className="font-mono text-[11px] bg-muted px-1 rounded">userinfo.email</code>
                    ). No passwords are ever stored.
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={() => {
                    setEmailDialogOpen(false);
                    void handleConnectGmail();
                  }}
                  disabled={isConnectingGmail}
                  className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium"
                >
                  {isConnectingGmail ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ExternalLink className="size-4" />
                  )}
                  Authorize with Google
                </Button>
              </div>
            )}

            {emailProvider !== "gmail" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEmailMutation.mutate();
                }}
                className="space-y-3.5 py-3"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">
                      Sender Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="email"
                      placeholder="team@yourdomain.com"
                      value={fromEmail}
                      onChange={(e) => setFromEmail(e.target.value)}
                      required
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Sender Display Name</Label>
                    <Input
                      placeholder="e.g. Dinesh from NexusCRM"
                      value={fromName}
                      onChange={(e) => setFromName(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>

                {emailProvider === "resend" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Resend API Key</Label>
                    <Input
                      type="password"
                      placeholder="re_123456789... (or configure RESEND_API_KEY in .env)"
                      value={resendApiKey}
                      onChange={(e) => setResendApiKey(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Get your key from{" "}
                      <a
                        href="https://resend.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        resend.com/api-keys
                      </a>
                      . For testing, set Sender Email to{" "}
                      <code className="font-mono bg-muted px-1 rounded">onboarding@resend.dev</code>{" "}
                      (delivers to your registered Resend email address).
                    </p>
                  </div>
                )}

                {emailProvider === "smtp" && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-xs font-medium">
                          SMTP Host <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          placeholder="smtp.gmail.com"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          required
                          className="text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Port</Label>
                        <Input
                          type="number"
                          value={smtpPort}
                          onChange={(e) => setSmtpPort(Number(e.target.value))}
                          className="text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">
                          SMTP Username <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          placeholder="user@domain.com"
                          value={smtpUser}
                          onChange={(e) => setSmtpUser(e.target.value)}
                          required
                          className="text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">
                          SMTP Password <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="password"
                          placeholder="App Password"
                          value={smtpPassword}
                          onChange={(e) => setSmtpPassword(e.target.value)}
                          required
                          className="text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border p-2.5">
                      <div>
                        <p className="text-xs font-medium">Use TLS / SSL</p>
                        <p className="text-[11px] text-muted-foreground">
                          Enabled automatically for port 465
                        </p>
                      </div>
                      <Switch checked={smtpSecure} onCheckedChange={setSmtpSecure} />
                    </div>
                  </div>
                )}

                {emailProvider === "sendgrid" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      SendGrid API Key <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="password"
                      placeholder="SG.123456789..."
                      value={sendgridApiKey}
                      onChange={(e) => setSendgridApiKey(e.target.value)}
                      required
                      className="font-mono text-xs"
                    />
                  </div>
                )}

                <DialogFooter className="pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEmailDialogOpen(false)}
                    disabled={saveEmailMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saveEmailMutation.isPending || !fromEmail}
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {saveEmailMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                    Save Email Connection
                  </Button>
                </DialogFooter>
              </form>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* DIALOG: SEND TEST EMAIL */}
      <Dialog open={testEmailDialogOpen} onOpenChange={setTestEmailDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Send className="size-5 text-blue-600" />
              <DialogTitle>Send Verification Test Email</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Enter your email address to receive a live test message from your configured provider
              (
              <span className="font-semibold text-foreground">
                {em?.maskedDetails?.fromEmail || em?.maskedDetails?.connectedEmail || em?.provider}
              </span>
              ).
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              testEmailMutation.mutate();
            }}
            className="space-y-4 py-2"
          >
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Recipient Email Address <span className="text-destructive">*</span>
              </Label>
              <Input
                type="email"
                placeholder="your.personal@email.com"
                value={testRecipientEmail}
                onChange={(e) => setTestRecipientEmail(e.target.value)}
                required
                className="text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                The test email will be sent directly from your connected account.
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTestEmailDialogOpen(false)}
                disabled={testEmailMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={testEmailMutation.isPending || !testRecipientEmail}
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {testEmailMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Send Test Email
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
