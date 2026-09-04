import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const googleAuthSchema = z.object({
  redirectTo: z.string().url(),
});

export const getGoogleAuthUrl = createServerFn({ method: "POST" })
  .validator((input: unknown) => googleAuthSchema.parse(input))
  .handler(async ({ data }) => {
    const supabaseUrl =
      process.env["VITE_SUPABASE_URL"] ||
      process.env["SUPABASE_URL"] ||
      "https://eomsoplysdcdguegsror.supabase.co";

    const authorizeUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(data.redirectTo)}`;

    try {
      // The server uses its DNS lookup fallback (if needed) to query Supabase directly
      const res = await fetch(authorizeUrl, { redirect: "manual" });
      const location = res.headers.get("location");
      if (location && location.includes("accounts.google.com")) {
        return { url: location };
      }
    } catch (err) {
      console.warn("[AUTH_FUNCTIONS] Could not pre-resolve Google OAuth URL from server:", err);
    }

    return { url: authorizeUrl };
  });
