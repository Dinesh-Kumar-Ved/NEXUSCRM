import { useServerFn } from "@tanstack/react-start";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getGoogleAuthUrl } from "@/lib/auth.functions";

type SupabaseErrorLike = {
  message?: string | undefined;
  code?: string | undefined;
  details?: string | undefined;
  hint?: string | undefined;
  status?: number | undefined;
};

function getSupabaseErrorDetails(error: unknown): SupabaseErrorLike {
  if (!error || typeof error !== "object") return { message: String(error) };
  const candidate = error as Record<string, unknown>;
  return {
    message: typeof candidate["message"] === "string" ? candidate["message"] : undefined,
    code: typeof candidate["code"] === "string" ? candidate["code"] : undefined,
    details: typeof candidate["details"] === "string" ? candidate["details"] : undefined,
    hint: typeof candidate["hint"] === "string" ? candidate["hint"] : undefined,
    status: typeof candidate["status"] === "number" ? candidate["status"] : undefined,
  };
}

function logAuthEvent(message: string, details?: Record<string, unknown>) {
  if (import.meta.env.DEV) console.info(message, details ?? {});
}

function logAuthError(scope: string, error: unknown) {
  const details = getSupabaseErrorDetails(error);
  if (import.meta.env.DEV) console.error(`[${scope}] Supabase operation failed`, details);
  return details.message || "Unable to create your account. Please try again.";
}

function getAuthErrorMessage(error: { message: string }, operation: "sign-in" | "sign-up") {
  const message = error.message.toLowerCase();
  if (message.includes("fetch") || message.includes("network") || message.includes("connect")) {
    return "Unable to connect to the authentication service.";
  }
  if (message.includes("email not confirmed") || message.includes("confirm your email")) {
    return "Please confirm your email before signing in.";
  }
  if (
    operation === "sign-in" &&
    (message.includes("invalid login credentials") || message.includes("user not found"))
  ) {
    return "Invalid email or password.";
  }
  if (operation === "sign-up" && message.includes("already registered")) {
    return "An account with this email already exists.";
  }
  return operation === "sign-up"
    ? "Unable to create your account. Please try again."
    : "Unable to sign in. Please try again.";
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · NexusCRM" },
      {
        name: "description",
        content:
          "Sign in to NexusCRM to manage clients, track proposals and message contacts by email, WhatsApp and SMS.",
      },
      { property: "og:title", content: "Sign in · NexusCRM" },
      {
        property: "og:description",
        content: "Access your client pipeline and multi-channel inbox.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  required,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const getGoogleUrlFn = useServerFn(getGoogleAuthUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted && session) void navigate({ to: "/dashboard", replace: true });
    });
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (mounted && sessionData.session) void navigate({ to: "/dashboard", replace: true });
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  const clearMessages = () => {
    setAuthError(null);
    setSuccessMessage(null);
  };

  const validateCredentials = () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return "Please enter your email address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return "Please enter a valid email address.";
    }
    if (!password) return "Please enter your password.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    const validationError = validateCredentials();
    if (validationError) {
      setAuthError(validationError);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setAuthError(getAuthErrorMessage(error, "sign-in"));
        return;
      }
      void navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      setAuthError(getAuthErrorMessage({ message: String(error) }, "sign-in"));
    } finally {
      setBusy(false);
    }
  };

  const signUp = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    logAuthEvent("[AUTH] Starting signup", {
      emailProvided: Boolean(email.trim()),
      fullNameProvided: Boolean(fullName.trim()),
    });
    const validationError = validateCredentials();
    if (validationError) {
      logAuthEvent("[AUTH] Signup validation failed", { message: validationError });
      setAuthError(validationError);
      return;
    }
    if (!fullName.trim()) {
      logAuthEvent("[AUTH] Signup validation failed", { message: "Please enter your full name." });
      setAuthError("Please enter your full name.");
      return;
    }
    setBusy(true);
    try {
      logAuthEvent("[AUTH] Calling supabase.auth.signUp", {
        emailProvided: true,
        metadata: { fullNameProvided: true },
      });
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth`,
        },
      });
      if (error) {
        setAuthError(logAuthError("AUTH", error));
        return;
      }
      logAuthEvent("[AUTH] Supabase signup successful", {
        userCreated: Boolean(data.user),
        sessionCreated: Boolean(data.session),
        profileAndRoleProvisioning: "database trigger public.handle_new_user",
      });
      if (data.session) {
        logAuthEvent("[AUTH] Session created; opening dashboard");
        void navigate({ to: "/dashboard", replace: true });
      } else {
        logAuthEvent("[AUTH] Signup complete; email confirmation required");
        setSuccessMessage("Account created. Please check your email to confirm your account.");
      }
    } catch (error) {
      setAuthError(logAuthError("AUTH", error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <Radar className="size-6 text-sidebar-primary" />
          <span className="font-display text-lg font-semibold">NexusCRM</span>
        </div>
        <div className="space-y-6">
          <h1 className="max-w-md text-4xl font-semibold leading-tight">
            Every client, every conversation, one pipeline.
          </h1>
          <p className="max-w-md text-sm text-sidebar-foreground/70">
            Track proposals from first touch to signed deal, and reach clients over email, WhatsApp,
            SMS or a phone call without leaving the record.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          The first person to sign up becomes the workspace admin.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Radar className="size-5 text-accent" />
            <span className="font-display text-lg font-semibold">NexusCRM</span>
          </div>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      onClick={() => {
                        clearMessages();
                        setForgotMode(true);
                        setResetEmail(email);
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <PasswordInput
                    id="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Sign in
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Morgan"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-up">Work email</Label>
                  <Input
                    id="email-up"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password-up">Password</Label>
                  <PasswordInput
                    id="password-up"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                  />
                  <p className="text-[11px] text-muted-foreground">Must be at least 8 characters</p>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {authError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {authError}
            </p>
          ) : null}
          {successMessage ? (
            <p role="status" className="mt-4 text-sm text-success">
              {successMessage}
            </p>
          ) : null}

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={busy || googleBusy}
            onClick={async () => {
              clearMessages();
              setGoogleBusy(true);
              try {
                const redirectTo = `${window.location.origin}/auth/callback`;
                let authUrl: string | null = null;
                try {
                  const result = await getGoogleUrlFn({ data: { redirectTo } });
                  authUrl = result?.url ?? null;
                } catch {
                  authUrl = null;
                }

                if (authUrl) {
                  window.location.href = authUrl;
                  return;
                }

                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo },
                });

                if (error) {
                  setAuthError(
                    error.message?.includes("fetch") || error.message?.includes("network")
                      ? "Unable to connect to Google Auth server. Please verify your Supabase project URL."
                      : error.message || "Failed to initialize Google login.",
                  );
                  setGoogleBusy(false);
                }
              } catch (err) {
                setAuthError(
                  err instanceof Error ? err.message : "Failed to initialize Google login.",
                );
                setGoogleBusy(false);
              }
            }}
          >
            {googleBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <svg className="size-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  fill="#EA4335"
                />
              </svg>
            )}
            Continue with Google
          </Button>
        </div>
      </section>

      {/* Forgot Password Modal */}
      {forgotMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg space-y-4">
            <h2 className="text-lg font-semibold">Reset your password</h2>
            <p className="text-sm text-muted-foreground">
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = resetEmail.trim();
                if (!trimmed || !trimmed.includes("@")) return;
                setResetBusy(true);
                const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
                  redirectTo: `${window.location.origin}/auth`,
                });
                setResetBusy(false);
                if (error) {
                  setAuthError(error.message || "Failed to send reset email.");
                } else {
                  setSuccessMessage("Password reset link sent! Check your inbox.");
                }
                setForgotMode(false);
              }}
              className="space-y-3"
            >
              <Input
                type="email"
                required
                placeholder="you@company.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setForgotMode(false)}
                  disabled={resetBusy}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={resetBusy || !resetEmail.trim()}>
                  {resetBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Send reset link
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
