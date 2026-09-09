import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientHasEmail,
  formatClientEmails,
  getAdditionalEmails,
  getInvalidEmails,
  getPrimaryEmail,
  isValidSingleEmail,
  parseClientEmails,
} from "../src/lib/email-utils.ts";

describe("Multi-Email Utilities", () => {
  const aditEmails = "aditparekh@gmail.com, adit.parekh@freshworks.com, adit.parekh@serraconsult.com";

  it("correctly identifies primary and additional emails for multi-email client", () => {
    const primary = getPrimaryEmail(aditEmails);
    const additional = getAdditionalEmails(aditEmails);
    const all = parseClientEmails(aditEmails);

    assert.equal(primary, "aditparekh@gmail.com");
    assert.deepEqual(additional, [
      "adit.parekh@freshworks.com",
      "adit.parekh@serraconsult.com",
    ]);
    assert.deepEqual(all, [
      "aditparekh@gmail.com",
      "adit.parekh@freshworks.com",
      "adit.parekh@serraconsult.com",
    ]);
  });

  it("behaves identically for single-email client", () => {
    const single = "john@example.com";
    assert.equal(getPrimaryEmail(single), "john@example.com");
    assert.deepEqual(getAdditionalEmails(single), []);
    assert.deepEqual(parseClientEmails(single), ["john@example.com"]);
  });

  it("deduplicates case-insensitively and handles mixed delimiters", () => {
    const raw = "aditparekh@gmail.com; adit.parekh@freshworks.com\naditparekh@gmail.com, adit.parekh@serraconsult.com";
    const formatted = formatClientEmails(raw);
    assert.equal(formatted, "aditparekh@gmail.com, adit.parekh@freshworks.com, adit.parekh@serraconsult.com");
  });

  it("verifies client email membership and rejects unauthorized emails", () => {
    assert.equal(clientHasEmail(aditEmails, "adit.parekh@serraconsult.com"), true);
    assert.equal(clientHasEmail(aditEmails, "ADITPAREKH@GMAIL.COM"), true);
    assert.equal(clientHasEmail(aditEmails, "unauthorized@external.com"), false);
  });

  it("validates single email addresses and detects invalid ones", () => {
    assert.equal(isValidSingleEmail("test@domain.com"), true);
    assert.equal(isValidSingleEmail("invalid-email"), false);
    assert.deepEqual(getInvalidEmails("valid@domain.com, bad-email, another@domain.com"), ["bad-email"]);
  });

  it("resolves all unique valid email addresses for bulk send across multi-email and single-email clients", () => {
    const dinesh = {
      name: "Dinesh",
      email: "dineshwedd@gmail.com, dkvedbusiness@gmail.com, palakpaneer911@gmail.com, dineshwedd@gmail.com",
    };
    const faizan = {
      name: "Faizan",
      email: "faizan@example.com",
    };

    const dineshRecipients = parseClientEmails(dinesh.email);
    const faizanRecipients = parseClientEmails(faizan.email);

    // Dinesh has 3 unique valid emails (duplicate dineshwedd@gmail.com removed)
    assert.deepEqual(dineshRecipients, [
      "dineshwedd@gmail.com",
      "dkvedbusiness@gmail.com",
      "palakpaneer911@gmail.com",
    ]);

    // Single-email client Faizan resolves to 1 email
    assert.deepEqual(faizanRecipients, ["faizan@example.com"]);

    // Total bulk emails dispatched across both clients = 4 unique email sends
    const allDispatched = [...dineshRecipients, ...faizanRecipients];
    assert.equal(allDispatched.length, 4);
  });
});
