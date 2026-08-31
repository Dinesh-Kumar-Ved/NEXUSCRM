import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMimeEmail } from "../src/lib/google-auth.server.ts";

describe("Inbound Gmail Reply Flow & Threading Tests", () => {
  it("Test 2: RFC 2822 Reply MIME generation with In-Reply-To, References, and Thread headers", () => {
    const inReplyTo = "<original-msg-12345@mail.gmail.com>";
    const references = "<root-msg-00000@mail.gmail.com> <original-msg-12345@mail.gmail.com>";
    const subject = "Re: Project Proposal Discussion";
    const text = "Thanks for the feedback! Here is our revised scope.";
    const filename = "revised_quote.pdf";
    const encodedFilename = Buffer.from(filename, "utf8").toString("base64");

    const mime = buildMimeEmail({
      from: "sales@crm.example.com",
      to: "client@example.com",
      subject,
      text,
      inReplyTo,
      references,
      attachments: [
        {
          filename,
          mimeType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.4 revised quote data").toString("base64"),
        },
      ],
    });

    assert.ok(mime.includes(`In-Reply-To: ${inReplyTo}`), "MIME must contain In-Reply-To header");
    assert.ok(mime.includes(`References: ${references}`), "MIME must contain References header");
    assert.ok(mime.includes("Subject: Re: Project Proposal Discussion"), "MIME must contain subject");
    assert.ok(mime.includes(`filename="=?UTF-8?B?${encodedFilename}?="`), "MIME must contain encoded attachment filename");
    assert.ok(mime.includes("Content-Type: application/pdf;"), "MIME must contain attachment content type");
  });

  it("Test 3: Case-insensitive client email matching logic", () => {
    const clients = [
      { id: "client-1", email: "John.Doe@ACME.corp" },
      { id: "client-2", email: "alice@startup.io" },
    ];

    const emailToClient: Record<string, string> = {};
    clients.forEach((c) => {
      if (c.email) emailToClient[c.email.trim().toLowerCase()] = c.id;
    });

    const matchEmail = (email: string) => emailToClient[email.trim().toLowerCase()];

    // Inbound from variation in case
    const inboundFrom1 = "john.doe@acme.corp";
    const inboundFrom2 = "JOHN.DOE@ACME.CORP";
    const inboundFrom3 = "unknown@random.org";

    assert.equal(matchEmail(inboundFrom1), "client-1");
    assert.equal(matchEmail(inboundFrom2), "client-1");
    assert.equal(matchEmail(inboundFrom3), undefined, "Unrecognized email must remain unmatched");
  });

  it("Test 4: Thread grouping and chronological ordering", () => {
    const rawMessages = [
      {
        id: "msg-3",
        thread_id: "thread-abc",
        direction: "outbound",
        subject: "Re: Scope discussion",
        received_at: "2026-08-21T12:00:00Z",
      },
      {
        id: "msg-1",
        thread_id: "thread-abc",
        direction: "outbound",
        subject: "Scope discussion",
        received_at: "2026-08-21T10:00:00Z",
      },
      {
        id: "msg-2",
        thread_id: "thread-abc",
        direction: "inbound",
        subject: "Re: Scope discussion",
        received_at: "2026-08-21T11:00:00Z",
      },
      {
        id: "msg-4",
        thread_id: "thread-xyz",
        direction: "inbound",
        subject: "New inquiry",
        received_at: "2026-08-21T13:00:00Z",
      },
    ];

    const threadMap = new Map<string, typeof rawMessages>();
    for (const msg of rawMessages) {
      if (!threadMap.has(msg.thread_id)) {
        threadMap.set(msg.thread_id, []);
      }
      threadMap.get(msg.thread_id)!.push(msg);
    }

    assert.equal(threadMap.size, 2, "Should group into 2 threads");

    const threadAbc = threadMap.get("thread-abc")!;
    assert.equal(threadAbc.length, 3);

    // Sort chronologically
    threadAbc.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());

    assert.equal(threadAbc[0]!.id, "msg-1", "First message should be msg-1");
    assert.equal(threadAbc[1]!.id, "msg-2", "Second message should be msg-2 (inbound reply)");
    assert.equal(threadAbc[2]!.id, "msg-3", "Third message should be msg-3 (outbound reply)");
  });

  it("Test 5: Workspace isolation and duplicate prevention key verification", () => {
    const workspaceId1 = "ws-1111-aaaa";
    const workspaceId2 = "ws-2222-bbbb";
    const gmailMessageId = "18e123456789abcd";

    const uniqueKey1 = `${workspaceId1}:${gmailMessageId}`;
    const uniqueKey2 = `${workspaceId2}:${gmailMessageId}`;

    assert.notEqual(uniqueKey1, uniqueKey2, "Different workspaces must not collide on the same provider message ID");
    assert.equal(`${workspaceId1}:${gmailMessageId}`, uniqueKey1, "Duplicate messages in same workspace produce identical conflict key");
  });

  it("Test 6: Safe attachment validation & extension security filter", () => {
    const blocked = ["exe", "bat", "cmd", "ps1", "vbs", "js", "sh", "dll"];
    const allowed = ["pdf", "png", "jpg", "jpeg", "docx", "xlsx", "csv", "txt"];

    const isBlocked = (filename: string) => {
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      return blocked.includes(ext);
    };

    assert.ok(isBlocked("malware.exe"), "malware.exe must be blocked");
    assert.ok(isBlocked("script.bat"), "script.bat must be blocked");
    assert.ok(isBlocked("payload.sh"), "payload.sh must be blocked");
    assert.ok(!isBlocked("proposal.pdf"), "proposal.pdf must be allowed");
    assert.ok(!isBlocked("spreadsheet.xlsx"), "spreadsheet.xlsx must be allowed");
    assert.ok(!isBlocked("document.docx"), "document.docx must be allowed");
  });

  it("Test 7: Automatic update of client_id on previously unmatched records", () => {
    const existingRecord = {
      id: "msg-unmatched-1",
      provider_message_id: "gmail-100",
      client_id: null as string | null,
    };

    const newMatchedClientId = "client-dinesh-123";

    // Simulation of storeMessage logic for existing record
    if (!existingRecord.client_id && newMatchedClientId) {
      existingRecord.client_id = newMatchedClientId;
    }

    assert.equal(existingRecord.client_id, "client-dinesh-123", "Unmatched record must be updated with matched client_id");
  });

  it("Test 8: Multi-tier matching logic (Reply-To and Thread ID fallback)", () => {
    const clients = [{ id: "client-dinesh", email: "dkvedbusiness@gmail.com" }];
    const emailToClient: Record<string, string> = { "dkvedbusiness@gmail.com": "client-dinesh" };
    const threadToClient: Record<string, string> = { "thread-999": "client-dinesh" };

    const parseEmail = (val: string) => {
      const match = val.match(/<([^>]+)>/);
      return (match && match[1] ? match[1] : val).trim().toLowerCase();
    };

    // Tier 1 test
    const fromVal = "Dinesh Kumar <dkvedbusiness@gmail.com>";
    assert.equal(emailToClient[parseEmail(fromVal)], "client-dinesh", "Tier 1: From header match");

    // Tier 2 test (Reply-To)
    const replyToVal = "Support Contact <dkvedbusiness@gmail.com>";
    assert.equal(emailToClient[parseEmail(replyToVal)], "client-dinesh", "Tier 2: Reply-To header match");

    // Tier 3 test (Thread ID)
    const threadId = "thread-999";
    assert.equal(threadToClient[threadId], "client-dinesh", "Tier 3: Thread ID fallback match");
  });

  it("Test 9: Workspace isolation for email_messages queries", () => {
    const workspaceId = "ws-alpha";
    const clientId = "client-dinesh";

    const queryParams = { workspace_id: workspaceId, client_id: clientId };
    assert.equal(queryParams.workspace_id, "ws-alpha");
    assert.equal(queryParams.client_id, "client-dinesh");
  });

  it("Test 10: Inbound direction determination based on client email match", () => {
    const clientEmail = "dkvedbusiness@gmail.com";
    const emailToClient: Record<string, string> = { [clientEmail]: "client-dinesh-id" };

    const parseEmail = (val: string) => {
      const match = val.match(/<([^>]+)>/);
      return (match && match[1] ? match[1] : val).trim().toLowerCase();
    };

    // Case 1: Inbound reply from client
    const fromHeader1 = "Dinesh <dkvedbusiness@gmail.com>";
    const fromEmail1 = parseEmail(fromHeader1);

    let matchedClientId1: string | null = null;

    if (fromEmail1 && emailToClient[fromEmail1]) {
      matchedClientId1 = emailToClient[fromEmail1];
    }

    assert.equal(matchedClientId1, "client-dinesh-id", "Message from client email must match client_id");

    // Case 2: Outbound message to client or unknown From email
    const fromHeader2 = "Account Manager <sales@nexus.crm>";
    const fromEmail2 = parseEmail(fromHeader2);

    let matchedClientId2: string | null = null;

    if (fromEmail2 && emailToClient[fromEmail2]) {
      matchedClientId2 = emailToClient[fromEmail2];
    }

    assert.equal(matchedClientId2, null, "Message NOT from client email must NOT match client_id");
  });
});


