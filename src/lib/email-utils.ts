/**
 * Centralized email parsing, validation, deduplication, and comparison utilities for NexusCRM.
 * All client email handling must go through these functions.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates a single email address string.
 */
export function isValidSingleEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Parses any raw email input string (single email, comma-separated, semicolon-separated,
 * or newline-separated) into a clean, deduplicated array of valid email addresses.
 * Preserves original order (first valid email remains primary).
 */
export function parseClientEmails(emailInput: string | null | undefined): string[] {
  if (!emailInput || typeof emailInput !== "string") return [];

  // Split on comma, semicolon, newline, or multiple spaces
  const parts = emailInput.split(/[,;\n\r\s]+/);
  const result: string[] = [];
  const seenLower = new Set<string>();

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (isValidSingleEmail(trimmed)) {
      const lower = trimmed.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        result.push(trimmed);
      }
    }
  }

  return result;
}

/**
 * Returns the primary (first valid) email address for a client, or null if none.
 */
export function getPrimaryEmail(emailInput: string | null | undefined): string | null {
  const emails = parseClientEmails(emailInput);
  return emails[0] ?? null;
}

/**
 * Returns all additional valid email addresses for a client (excluding the primary email).
 */
export function getAdditionalEmails(emailInput: string | null | undefined): string[] {
  const emails = parseClientEmails(emailInput);
  return emails.slice(1);
}

/**
 * Formats an array of email addresses into a clean, comma-separated string for DB storage.
 */
export function formatClientEmails(emails: string[] | string | null | undefined): string | null {
  if (Array.isArray(emails)) {
    const parsed = parseClientEmails(emails.join(","));
    return parsed.length > 0 ? parsed.join(", ") : null;
  }
  const parsed = parseClientEmails(emails);
  return parsed.length > 0 ? parsed.join(", ") : null;
}

/**
 * Checks if a given email address belongs to a client's email set (case-insensitive).
 */
export function clientHasEmail(clientEmailInput: string | null | undefined, emailToTest: string): boolean {
  if (!emailToTest || typeof emailToTest !== "string") return false;
  const testLower = emailToTest.trim().toLowerCase();
  const emails = parseClientEmails(clientEmailInput);
  return emails.some((e) => e.toLowerCase() === testLower);
}

/**
 * Validates a list of emails (e.g. from form input) and returns any invalid entries.
 */
export function getInvalidEmails(emailInput: string | null | undefined): string[] {
  if (!emailInput || typeof emailInput !== "string") return [];
  const parts = emailInput.split(/[,;\n\r]+/).map((p) => p.trim()).filter(Boolean);
  return parts.filter((p) => !isValidSingleEmail(p));
}
