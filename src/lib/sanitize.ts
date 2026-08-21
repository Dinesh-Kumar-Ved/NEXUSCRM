// src/lib/sanitize.ts
// Sanitizes inbound HTML email bodies using DOMPurify.

import createDOMPurify from "dompurify";

let _serverPurify: any = null;

function getServerPurify() {
  if (_serverPurify) return _serverPurify;
  try {
    // Dynamic import to prevent Nitro/Cloudflare build from bundling jsdom & tr46 punycode
    const req = typeof require !== "undefined" ? require : null;
    if (req) {
      const { JSDOM } = req("jsdom");
      const { window } = new JSDOM("");
      _serverPurify = createDOMPurify(window);
      return _serverPurify;
    }
  } catch {
    // Fallback if jsdom is not available in edge runtime
  }
  return null;
}

/**
 * Sanitizes HTML content safely on the server and client.
 * @param rawHtml - raw HTML string from inbound email.
 * @returns sanitized HTML string safe for rendering.
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml) return "";

  if (typeof window !== "undefined") {
    const DOMPurify = createDOMPurify(window);
    return DOMPurify.sanitize(rawHtml);
  }

  const serverPurify = getServerPurify();
  if (serverPurify) {
    return serverPurify.sanitize(rawHtml, {
      RETURN_DOM: false,
      RETURN_TRUSTED_TYPE: false,
    });
  }

  // Safe fallback regex sanitizer if jsdom cannot be initialized
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\bon\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:[^"']*/gi, "");
}

