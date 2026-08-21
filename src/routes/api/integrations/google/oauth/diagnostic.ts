import { createFileRoute } from "@tanstack/react-router";

function isBase64EncryptionKeyValid(keyStr: string): boolean {
  try {
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(keyStr)) {
      return false;
    }
    const base64Buf = Buffer.from(keyStr, "base64");
    return base64Buf.length === 32;
  } catch {
    return false;
  }
}

/**
 * Diagnose the SUPABASE_SERVICE_ROLE_KEY safely:
 * - Never returns the key value.
 * - Probes the live Supabase REST endpoint to distinguish:
 *   "missing" | "malformed" | "wrong_project" | "valid"
 */
async function diagnoseServiceRoleKey(
  supabaseUrl: string,
  key: string,
): Promise<{
  present: boolean;
  length: number;
  format: "sb_secret" | "jwt" | "sb_publishable" | "unknown";
  liveCheck: "valid" | "invalid_api_key" | "network_error" | "skipped";
  hint: string;
}> {
  if (!key) {
    return {
      present: false,
      length: 0,
      format: "unknown",
      liveCheck: "skipped",
      hint: "SUPABASE_SERVICE_ROLE_KEY is missing. Set it in .env (local dev) or as a platform secret.",
    };
  }

  const format: "sb_secret" | "jwt" | "sb_publishable" | "unknown" = key.startsWith("sb_secret_")
    ? "sb_secret"
    : key.startsWith("sb_publishable_")
      ? "sb_publishable"
      : key.startsWith("eyJ")
        ? "jwt"
        : "unknown";

  if (format === "sb_publishable") {
    return {
      present: true,
      length: key.length,
      format,
      liveCheck: "skipped",
      hint:
        "SUPABASE_SERVICE_ROLE_KEY is set to a publishable (anon) key. Replace it with the service_role key from the Supabase dashboard.",
    };
  }

  if (!supabaseUrl) {
    return {
      present: true,
      length: key.length,
      format,
      liveCheck: "skipped",
      hint: "SUPABASE_URL is missing; cannot validate key against live project.",
    };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        present: true,
        length: key.length,
        format,
        liveCheck: "invalid_api_key",
        hint:
          "Supabase rejected the key with 401/403 (Invalid API key). The key is either revoked, wrong-project, or malformed.",
      };
    }

    return {
      present: true,
      length: key.length,
      format,
      liveCheck: "valid",
      hint: "Key validated successfully against the live Supabase project.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      present: true,
      length: key.length,
      format,
      liveCheck: "network_error",
      hint: `Could not reach Supabase to validate key: ${message}`,
    };
  }
}

export const Route = createFileRoute("/api/integrations/google/oauth/diagnostic")({
  server: {
    handlers: {
      GET: async () => {
        // Google OAuth env checks
        const googleClientId = process.env["GOOGLE_CLIENT_ID"]?.trim() || "";
        const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim() || "";
        const googleRedirectUri = process.env["GOOGLE_REDIRECT_URI"]?.trim() || "";
        const googleEncryptionKey = process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"]?.trim() || "";

        // Supabase env checks
        const supabaseUrl = process.env["SUPABASE_URL"]?.trim() || "";
        const supabaseAnonKey = process.env["SUPABASE_PUBLISHABLE_KEY"]?.trim() || "";
        const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() || "";

        // Check if the Client ID looks valid (not a mock and has valid format)
        const isClientIdMock = googleClientId.startsWith("mock-");
        const hasGoogleSuffix = googleClientId.endsWith(".apps.googleusercontent.com");
        const googleClientIdLooksValid = googleClientId.length > 0 && !isClientIdMock && hasGoogleSuffix;

        const srkDiagnosis = await diagnoseServiceRoleKey(supabaseUrl, supabaseServiceRoleKey);

        const clientIdSuffix = googleClientId.length > 6 
          ? googleClientId.substring(googleClientId.length - 6) 
          : googleClientId;

        return new Response(
          JSON.stringify({
            googleClientIdConfigured: googleClientId.length > 0,
            googleClientIdLooksValid,
            googleClientSecretConfigured: googleClientSecret.length > 0,
            googleRedirectUri,
            googleEncryptionKeyConfigured: googleEncryptionKey.length > 0,
            supabaseServiceRoleConfigured: supabaseServiceRoleKey.length > 0,
            clientIdSuffix,
            // Keep legacy support keys for backward compatibility:
            googleClientId: googleClientId.length > 0,
            googleClientSecret: googleClientSecret.length > 0,
            googleRedirectUriField: googleRedirectUri.length > 0,
            googleEncryptionKey: googleEncryptionKey.length > 0,
            supabaseUrl: supabaseUrl.length > 0,
            supabaseAnonKey: supabaseAnonKey.length > 0,
            supabaseServiceRoleKey: supabaseServiceRoleKey.length > 0,
            supabaseServiceRoleKeyDiagnosis: srkDiagnosis,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
