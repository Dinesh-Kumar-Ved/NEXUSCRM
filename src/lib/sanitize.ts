// src/lib/sanitize.ts
// Sanitizes inbound HTML email bodies using DOMPurify in a Node.js environment.

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * Sanitizes HTML content safely on the server.
 * @param rawHtml - raw HTML string from inbound email.
 * @returns sanitized HTML string safe for rendering.
 */
export function sanitizeHtml(rawHtml: string): string {
  const { window } = new JSDOM('');
  const DOMPurify = createDOMPurify(window);
  const clean = DOMPurify.sanitize(rawHtml, {
    RETURN_DOM: false,
    RETURN_TRUSTED_TYPE: false,
    ADD_ATTR: [],
    ADD_TAGS: []
  });
  return clean;
}
