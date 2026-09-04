import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptToken } from "@/lib/crypto";
import { exchangeGoogleAuthCode, fetchGmailProfile } from "@/lib/google-auth.server";

export const Route = createFileRoute("/api/integrations/google/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        const redirectBase = `${url.origin}/settings`;

        // Handle Google OAuth errors (e.g. user canceled/denied access)
        if (error) {
          const message = errorDescription || error;
          return Response.redirect(
            `${redirectBase}?error=${encodeURIComponent(`Google authorization denied: ${message}`)}`,
            302,
          );
        }

        if (!code || !state) {
          return Response.redirect(
            `${redirectBase}?error=${encodeURIComponent("Missing authorization code or security state from Google.")}`,
            302,
          );
        }

        try {
          // 1. Validate CSRF state from workspace_oauth_states
          const { data: stateRecord, error: stateError } = await (supabaseAdmin as any)
            .from("workspace_oauth_states")
            .select("*")
            .eq("state", state)
            .maybeSingle();

          if (stateError || !stateRecord) {
            return Response.redirect(
              `${redirectBase}?error=${encodeURIComponent("Invalid or expired OAuth state session. Please try connecting again.")}`,
              302,
            );
          }

          // Check expiration (15 min)
          if (new Date(stateRecord.expires_at).getTime() < Date.now()) {
            await (supabaseAdmin as any).from("workspace_oauth_states").delete().eq("state", state);
            return Response.redirect(
              `${redirectBase}?error=${encodeURIComponent("OAuth session expired. Please connect Gmail again.")}`,
              302,
            );
          }

          // Delete state immediately to prevent CSRF replay
          await (supabaseAdmin as any).from("workspace_oauth_states").delete().eq("state", state);

          const workspaceId = stateRecord.workspace_id;

          // Invalidate any in-memory cached access token for this workspace immediately
          const { invalidateWorkspaceAccessTokenCache } = await import("@/lib/integrations.server");
          invalidateWorkspaceAccessTokenCache(workspaceId);

          // 2. Exchange authorization code for tokens
          const tokenResult = await exchangeGoogleAuthCode(code);
          const refreshToken = tokenResult.refreshToken;

          // 3. Fetch authenticated Gmail address using access token
          const { emailAddress } = await fetchGmailProfile(tokenResult.accessToken);

          // Query any existing integration for this workspace to detect account switching
          const { data: existingIntegration } = await (supabaseAdmin as any)
            .from("workspace_integrations")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("provider_type", "email")
            .maybeSingle();

          const existingDetails = (existingIntegration?.details ?? {}) as Record<string, any>;
          const previousEmail =
            existingDetails["connectedEmail"] ||
            existingDetails["fromEmail"] ||
            (existingIntegration?.config as Record<string, any> | undefined)?.["fromEmail"];

          const isSameAccount = previousEmail && previousEmail.toLowerCase() === emailAddress.toLowerCase();

          // 4. Validate and encrypt the refresh token
          let encryptedPayload: import("@/lib/crypto").EncryptedPayload | null = null;

          if (refreshToken) {
            encryptedPayload = encryptToken(refreshToken);
          } else if (isSameAccount && existingIntegration?.encrypted_refresh_token) {
            // Test if retained refresh token is actually valid with Google API
            try {
              const { decryptToken } = await import("@/lib/crypto");
              const { refreshGmailAccessToken } = await import("@/lib/google-auth.server");
              const oldRefreshToken = decryptToken(
                existingIntegration.encrypted_refresh_token as unknown as import("@/lib/crypto").EncryptedPayload,
              );
              await refreshGmailAccessToken(oldRefreshToken);
              encryptedPayload = existingIntegration.encrypted_refresh_token as unknown as import("@/lib/crypto").EncryptedPayload;
            } catch (testErr) {
              const errTxt = testErr instanceof Error ? testErr.message : "Invalid token";
              console.warn(`[GMAIL_CALLBACK] Retained refresh token failed validation: ${errTxt}`);
              return Response.redirect(
                `${redirectBase}?error=${encodeURIComponent(
                  `Stored authorization for ${emailAddress} is invalid or expired. Please visit https://myaccount.google.com/permissions, remove access for this app, and click Connect Gmail again.`,
                )}`,
                302,
              );
            }
          } else {
            return Response.redirect(
              `${redirectBase}?error=${encodeURIComponent(
                `Google did not return a refresh token for ${emailAddress}. Please ensure you check all permission boxes on the Google consent screen.`,
              )}`,
              302,
            );
          }

          // 5. Update/replace workspace_integrations with the newly authorized account
          const { error: upsertError } = await (supabaseAdmin as any)
            .from("workspace_integrations")
            .upsert(
              {
                workspace_id: workspaceId,
                provider_type: "email",
                provider: "gmail",
                config: {
                  provider: "gmail",
                  fromEmail: emailAddress,
                  fromName: "",
                },
                details: {
                  provider: "gmail",
                  fromEmail: emailAddress,
                  fromName: "",
                  connectedEmail: emailAddress,
                },
                encrypted_refresh_token: encryptedPayload as unknown as import("@/integrations/supabase/types").Json,
                status: "connected",
                is_active: true,
                last_tested_at: new Date().toISOString(),
                last_test_error: null,
              },
              {
                onConflict: "workspace_id,provider_type",
              },
            );

          if (upsertError) {
            console.error("Failed to save Gmail integration:", upsertError.message);
            return Response.redirect(
              `${redirectBase}?error=${encodeURIComponent(`Failed to save Gmail integration: ${upsertError.message}`)}`,
              302,
            );
          }

          return Response.redirect(
            `${redirectBase}?integration=gmail_connected&email=${encodeURIComponent(emailAddress)}`,
            302,
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Failed to complete Google OAuth.";
          console.error("Google OAuth callback error:", errMsg);
          return Response.redirect(`${redirectBase}?error=${encodeURIComponent(errMsg)}`, 302);
        }
      },
    },
  },
});
