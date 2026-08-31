// src/lib/sanitize.ts
// Basic sanitization for inbound HTML email bodies.

export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml) return "";

  return rawHtml
    // Remove script tags and their contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Remove iframe/object/embed tags
    .replace(
      /<(iframe|object|embed|applet)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    )
    // Remove inline event handlers such as onclick, onerror, etc.
    .replace(/\s+on\w+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "")
    // Remove javascript: URLs
    .replace(/javascript\s*:/gi, "");
}
