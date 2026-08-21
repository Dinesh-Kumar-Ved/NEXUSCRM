import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  base64UrlEncode,
  buildMimeEmail,
  sendGmailMessage,
  GOOGLE_OAUTH_SCOPES,
} from "../src/lib/google-auth.server.ts";
import { personalize } from "../src/lib/crm.ts";

describe("Google Auth & MIME Email Builder", () => {
  it("should encode string into base64url format correctly", () => {
    const raw = "Hello World! & Special Characters + / ==";
    const encoded = base64UrlEncode(raw);

    assert.ok(!encoded.includes("+"), "Base64url must not contain +");
    assert.ok(!encoded.includes("/"), "Base64url must not contain /");
    assert.ok(!encoded.includes("="), "Base64url must not contain =");
  });

  it("should build a valid RFC 2822 MIME email with headers and multipart alternative", () => {
    const mime = buildMimeEmail({
      from: "dinesh@gmail.com",
      to: "client@example.com",
      cc: ["colleague@example.com"],
      bcc: ["archive@example.com"],
      subject: "Test Proposal",
      text: "Hello Client,\nHere is the update.",
      html: "<p>Hello Client,<br/>Here is the update.</p>",
    });

    assert.ok(mime.includes("From: dinesh@gmail.com"));
    assert.ok(mime.includes("To: client@example.com"));
    assert.ok(mime.includes("Cc: colleague@example.com"));
    assert.ok(mime.includes("Bcc: archive@example.com"));
    assert.ok(mime.includes("Subject: Test Proposal"));
    assert.ok(mime.includes("Content-Type: multipart/alternative"));
    assert.ok(mime.includes('Content-Type: text/plain; charset="UTF-8"'));
    assert.ok(mime.includes('Content-Type: text/html; charset="UTF-8"'));
  });

  it("Test 1: Custom subject and personalized body in MIME", () => {
    const client = { id: "1", name: "Faizan Khan", email: "faizan@example.com" };
    const rawSubject = "Test Custom Subject 123";
    const rawBody = "Hello {{client_name}},\n\nThis is a broadcast test.";

    const personalizedSubject = personalize(rawSubject, client as any);
    const personalizedBody = personalize(rawBody, client as any);

    assert.equal(personalizedSubject, "Test Custom Subject 123");
    assert.equal(personalizedBody, "Hello Faizan Khan,\n\nThis is a broadcast test.");

    const mime = buildMimeEmail({
      from: "sender@gmail.com",
      to: client.email,
      subject: personalizedSubject,
      text: personalizedBody,
    });

    assert.ok(mime.includes("Subject: Test Custom Subject 123"));
    assert.ok(mime.includes("To: faizan@example.com"));
    // Verify base64 decoded text contains the personalized name
    const b64Body = Buffer.from(personalizedBody, "utf8").toString("base64");
    assert.ok(mime.includes(b64Body.slice(0, 20)));
  });

  it("Test 2: Multi-line custom message with 76-character base64 line wrapping", () => {
    const rawSubject = "Follow-up: Your Project";
    const multiLineBody = `Hello Client,

This is a custom broadcast test from NexusCRM.
Line 1: Detailed specification updates.
Line 2: Project deliverables and milestones.
Line 3: Scheduled review meetings for upcoming sprint.

Please reply to this email to confirm that you received it.

Regards,
NexusCRM Account Team`;

    const mime = buildMimeEmail({
      from: "sender@gmail.com",
      to: "recipient@example.com",
      subject: rawSubject,
      text: multiLineBody,
    });

    assert.ok(mime.includes("Subject: Follow-up: Your Project"));
    // Ensure base64 body is split into lines <= 76 chars
    const lines = mime.split("\r\n");
    for (const line of lines) {
      if (!line.startsWith("Content-") && !line.startsWith("--") && !line.startsWith("Subject:") && !line.startsWith("From:") && !line.startsWith("To:") && !line.startsWith("MIME-Version:")) {
        assert.ok(line.length <= 76, `Base64 line exceeds 76 characters: length ${line.length}`);
      }
    }
  });

  it("Test 3: Subject and body containing punctuation and UTF-8 characters", () => {
    const subject = "NexusCRM Alert 🚀 · Special Offer & Update (2026)!";
    const body = "Bonjour, voici votre mise à jour: €500 remise spéciale! — Equipe NexusCRM 🎉";

    const mime = buildMimeEmail({
      from: "sender@gmail.com",
      to: "client@example.com",
      subject,
      text: body,
    });

    // UTF-8 subject should be RFC 2047 encoded
    assert.ok(mime.includes("Subject: =?UTF-8?B?"));
    assert.ok(mime.includes('Content-Type: text/plain; charset="UTF-8"'));
  });

  it("Test 4: Personalization for multiple recipients with different names", () => {
    const recipients = [
      { id: "1", name: "Alice Wonderland", email: "alice@example.com", company: "Wonderland Inc" },
      { id: "2", name: "Bob Builder", email: "bob@example.com", company: "Bob Co" },
    ];
    const template = "Hi {{client_name}} from {{company}}!";

    const results = recipients.map((r) => personalize(template, r as any));

    assert.equal(results[0], "Hi Alice Wonderland from Wonderland Inc!");
    assert.equal(results[1], "Hi Bob Builder from Bob Co!");
  });

  it("Test 5: Google OAuth scopes and configuration are correct", () => {
    assert.ok(GOOGLE_OAUTH_SCOPES.includes("https://www.googleapis.com/auth/gmail.send"));
    assert.ok(GOOGLE_OAUTH_SCOPES.includes("https://www.googleapis.com/auth/userinfo.email"));
    assert.ok(GOOGLE_OAUTH_SCOPES.includes("https://www.googleapis.com/auth/gmail.readonly"), "Must include gmail.readonly");
  });

  it("Test 6: Regression Test - Selected Template broadcast flow produces valid personalized MIME and payload", () => {
    // Simulate template loaded from database
    const selectedTemplate = {
      id: "987e6543-e89b-12d3-a456-426614174000",
      name: "Quarterly Review Template",
      subject: "Important Update for {{company}} ({{client_name}})",
      body: `Dear {{first_name}},

We are writing to update you regarding {{company}}.
Your current account status is: {{status}}.

Please let us know if you have any questions.

Best regards,
NexusCRM Account Management`,
    };

    const client = {
      id: "client-123",
      name: "Sarah Connor",
      email: "sarah@cyberdyne.com",
      company: "Cyberdyne Systems",
      status: "proposal_sent" as const,
    };

    // 1. Personalize template subject and body per recipient
    const personalizedSubject = personalize(selectedTemplate.subject, client as any);
    const personalizedBody = personalize(selectedTemplate.body, client as any);

    assert.equal(
      personalizedSubject,
      "Important Update for Cyberdyne Systems (Sarah Connor)",
    );
    assert.ok(personalizedBody.includes("Dear Sarah,"));
    assert.ok(personalizedBody.includes("regarding Cyberdyne Systems."));
    assert.ok(personalizedBody.includes("Your current account status is: Proposal Sent."));

    // 2. Build MIME email
    const mime = buildMimeEmail({
      from: "sender@gmail.com",
      to: client.email,
      subject: personalizedSubject,
      text: personalizedBody,
    });

    assert.ok(mime.includes("To: sarah@cyberdyne.com"));
    assert.ok(mime.includes("Subject: Important Update for Cyberdyne Systems (Sarah Connor)"));
    assert.ok(mime.includes("Content-Type: multipart/alternative"));

    // 3. Verify base64url encoding
    const encodedPayload = base64UrlEncode(mime);
    assert.ok(encodedPayload.length > 0);
    assert.ok(!encodedPayload.includes("+"));
    assert.ok(!encodedPayload.includes("/"));
    assert.ok(!encodedPayload.includes("="));
  });

  it("should handle Gmail API error responses gracefully", async () => {
    const result = await sendGmailMessage({
      accessToken: "invalid_dummy_token_123",
      from: "test@gmail.com",
      to: "recipient@example.com",
      subject: "Test",
      text: "Body",
    });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Error message must be present on failure");
  });
});
