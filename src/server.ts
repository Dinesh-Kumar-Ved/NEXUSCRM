import "./lib/error-capture";

import dns from "node:dns";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// Ensure Supabase endpoints resolve even if the local network's DNS server fails to resolve supabase.co subdomains
const origLookup = dns.lookup;
dns.lookup = ((hostname: string, options: any, callback: any) => {
  let cb = callback;
  let opts = options;
  if (typeof options === "function") {
    cb = options;
    opts = {};
  }
  if (typeof hostname === "string" && hostname.endsWith(".supabase.co")) {
    if (opts && typeof opts === "object" && opts.all) {
      return cb(null, [{ address: "104.18.38.10", family: 4 }]);
    }
    return cb(null, "104.18.38.10", 4);
  }
  return (origLookup as any)(hostname, options, callback);
}) as typeof dns.lookup;

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Ensure process and process.env exist safely in any environment
if (typeof process === "undefined") {
  globalThis.process = { env: {} } as any;
} else if (!process.env) {
  process.env = {};
}

function populateProcessEnv(env: unknown) {
  if (env && typeof env === "object") {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && (!process.env[key] || process.env[key].trim().length === 0)) {
        process.env[key] = value;
      }
    }
  }
}

let isEnvValidated = false;
function validateEnvOnce() {
  if (isEnvValidated) return;
  isEnvValidated = true;

  const requiredGoogle = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
  ];

  const missingGoogle = requiredGoogle.filter((key) => {
    const val = process.env[key];
    return !val || val.trim().length === 0;
  });

  if (missingGoogle.length > 0) {
    console.warn(`Google OAuth configuration missing: ${missingGoogle.join(", ")}`);
  } else {
    console.info("Google OAuth configuration: OK");
  }

  // Supabase server-side check
  const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const supabaseUrl = process.env["SUPABASE_URL"];
  if (!supabaseUrl || supabaseUrl.trim().length === 0) {
    console.warn("Supabase configuration missing: SUPABASE_URL");
  } else if (!supabaseServiceRoleKey || supabaseServiceRoleKey.trim().length === 0) {
    console.warn(
      "Supabase service role key missing: SUPABASE_SERVICE_ROLE_KEY. " +
      "Add it to .env (local dev) or set it as a platform secret in Lovable Cloud. " +
      "Obtain from: https://supabase.com/dashboard/project/eomsoplysdcdguegsror/settings/api",
    );
  } else {
    console.info("Supabase server configuration: OK");
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    populateProcessEnv(env);
    validateEnvOnce();
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

