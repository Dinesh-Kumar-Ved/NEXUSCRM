import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PostalMime from "postal-mime";

import {
  buildMimeEmail,
  type EmailAttachment,
} from "../src/lib/google-auth.server.ts";

/**
 * Creates a minimal valid, uncorrupted PDF binary buffer.
 */
function createSamplePdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 700 Td (NexusCRM Proposal) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000202 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
296
%%EOF`;
  return Buffer.from(content, "utf8");
}

describe("E2E PDF Attachment & Reply Verification", () => {
  const originalPdfBuffer = createSamplePdf();
  const pdfBase64 = originalPdfBuffer.toString("base64");

  it("Step 1-4: Should construct a valid RFC 2822 email with an uncorrupted PDF attachment", async () => {
    const attachment: EmailAttachment = {
      filename: "Client_Proposal_2026.pdf",
      mimeType: "application/pdf",
      contentBase64: pdfBase64,
    };

    const rfcMessage = buildMimeEmail({
      from: "Sales Rep <rep@nexuscrm.internal>",
      to: "acme.corp@client.example",
      subject: "Your Custom Proposal & Terms",
      text: "Please find attached the signed contract and proposal.",
      html: "<p>Please find attached the signed contract and proposal.</p>",
      attachments: [attachment],
    });

    assert.ok(rfcMessage.length > 0, "RFC message should not be empty");
    assert.match(rfcMessage, /multipart\/mixed/);
    assert.match(rfcMessage, /filename="=\?UTF-8\?B\?[^"]+\?="/);

    // Step 6-8: Parse with postal-mime and verify attachment integrity
    const parser = new PostalMime();
    const parsed = await parser.parse(rfcMessage);

    assert.equal(parsed.subject, "Your Custom Proposal & Terms");
    assert.equal(parsed.from?.address, "rep@nexuscrm.internal");
    assert.equal(parsed.to?.[0]?.address, "acme.corp@client.example");
    assert.equal(parsed.attachments.length, 1, "Should contain exactly 1 attachment");

    const parsedAtt = parsed.attachments[0];
    assert.equal(parsedAtt.filename, "Client_Proposal_2026.pdf");
    assert.equal(parsedAtt.mimeType, "application/pdf");

    // Verify binary integrity (byte-for-byte match with original PDF)
    const parsedBuffer = Buffer.from(parsedAtt.content as ArrayBuffer);
    assert.equal(
      parsedBuffer.length,
      originalPdfBuffer.length,
      "Attachment byte length must match original PDF exactly",
    );
    assert.deepEqual(
      parsedBuffer,
      originalPdfBuffer,
      "Decoded PDF content must match original PDF byte-for-byte without corruption",
    );
    assert.ok(
      parsedBuffer.toString("utf8").startsWith("%PDF-1.4"),
      "PDF header must be valid",
    );
    assert.ok(
      parsedBuffer.toString("utf8").includes("%%EOF"),
      "PDF EOF trailer must be intact",
    );
  });

  it("Step 9-10: Should support replying in a thread with a PDF attachment", async () => {
    const threadId = "thread_18f9a2bc901";
    const originalMessageId = "<msg-1001@client.example>";
    const replyPdf = Buffer.from("%PDF-1.4\n% Reply attachment\n%%EOF", "utf8");

    const replyAttachment: EmailAttachment = {
      filename: "Signed_Revision_Addendum.pdf",
      mimeType: "application/pdf",
      contentBase64: replyPdf.toString("base64"),
    };

    const rfcReply = buildMimeEmail({
      from: "Sales Rep <rep@nexuscrm.internal>",
      to: "acme.corp@client.example",
      subject: "Re: Your Custom Proposal & Terms",
      text: "Thanks for the feedback, attaching the revised addendum.",
      html: "<p>Thanks for the feedback, attaching the revised addendum.</p>",
      inReplyTo: originalMessageId,
      references: originalMessageId,
      attachments: [replyAttachment],
    });

    assert.match(rfcReply, /In-Reply-To: <msg-1001@client\.example>/);
    assert.match(rfcReply, /References: <msg-1001@client\.example>/);

    const parser = new PostalMime();
    const parsedReply = await parser.parse(rfcReply);

    assert.equal(parsedReply.inReplyTo, "<msg-1001@client.example>");
    assert.equal(parsedReply.attachments.length, 1);
    assert.equal(parsedReply.attachments[0].filename, "Signed_Revision_Addendum.pdf");

    const replyBuffer = Buffer.from(parsedReply.attachments[0].content as ArrayBuffer);
    assert.deepEqual(replyBuffer, replyPdf, "Reply PDF must match original bytes");
  });
});
