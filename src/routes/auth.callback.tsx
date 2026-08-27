import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Parse URL params for explicit OAuth error returns from provider
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const errParam = params.get("error_description") || params.get("error");
      if (errParam) {
        setError(decodeURIComponent(errParam));
        return;
      }
    }

    // Subscribe to auth state changes to detect session establishment
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session) {
        void navigate({ to: "/dashboard", replace: true });
      } else if (event === "SIGNED_OUT") {
        setError("Authentication session was signed out.");
      }
    });

    // Check existing session
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError(sessionError.message || "Failed to retrieve session after Google authentication.");
      } else if (data.session) {
        void navigate({ to: "/dashboard", replace: true });
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-border p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-destructive">Authentication Error</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="pt-2">
            <Button onClick={() => void navigate({ to: "/auth", replace: true })}>
              Return to Sign In
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Completing sign in with Google...</p>
        <p className="text-xs text-muted-foreground">Please wait while we verify your account.</p>
      </div>
    </main>
  );
}
