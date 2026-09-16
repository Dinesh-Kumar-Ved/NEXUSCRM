import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMessageIds, normalizeSubject } from "../src/lib/email-utils.ts";

describe("Hostinger Email Threading & Conversation Resolution Tests", () => {
  it("Test 1: Subject normalization strips Re:, Fwd:, FW:, whitespace and lowercases", () => {
    assert.equal(normalizeSubject("Re: Project Proposal"), "project proposal");
    assert.equal(normalizeSubject("RE:  Fwd: Project Proposal "), "project proposal");
    assert.equal(normalizeSubject("FW: Re: Project Proposal"), "project proposal");
    assert.equal(normalizeSubject("  project proposal  "), "project proposal");
    assert.equal(normalizeSubject("No Prefix Subject"), "no prefix subject");
    assert.equal(normalizeSubject(""), "");
    assert.equal(normalizeSubject(null), "");
  });

  it("Test 2: RFC 2822 Message-ID extraction from In-Reply-To and References headers", () => {
    const rawSingle = "<msg-12345@hostinger.com>";
    const rawMultiple = "<root-001@client.com> <reply-002@hostinger.com> <reply-003@client.com>";

    const extractedSingle = extractMessageIds(rawSingle);
    assert.deepEqual(extractedSingle, ["<msg-12345@hostinger.com>"]);

    const extractedMultiple = extractMessageIds(rawMultiple);
    assert.deepEqual(extractedMultiple, [
      "<root-001@client.com>",
      "<reply-002@hostinger.com>",
      "<reply-003@client.com>",
    ]);

    assert.deepEqual(extractMessageIds(null), []);
    assert.deepEqual(extractMessageIds(""), []);
  });

  it("Test 3: Header-based multi-level reply chain resolution into ONE single thread", () => {
    const rootMsgId = "<root-outbound-001@hostinger.com>";

    // Simulated DB message-to-thread map
    const messageToThread = new Map<string, string>();
    messageToThread.set(rootMsgId, rootMsgId);

    const resolveThreadId = (
      rfcMessageId: string,
      inReplyTo: string | null,
      references: string | null,
      _subject: string,
    ) => {
      const inReplyToIds = extractMessageIds(inReplyTo);
      const referencesIds = extractMessageIds(references);
      const allRefs = [...inReplyToIds, ...referencesIds];

      let resolved: string | null = null;
      for (const refId of allRefs) {
        if (messageToThread.has(refId)) {
          resolved = messageToThread.get(refId)!;
          break;
        }
      }

      if (!resolved) {
        if (referencesIds.length > 0) resolved = referencesIds[0]!;
        else if (inReplyToIds.length > 0) resolved = inReplyToIds[0]!;
      }

      const tid = resolved || rfcMessageId;
      messageToThread.set(rfcMessageId, tid);
      return tid;
    };

    // Msg 1: Outbound sent from CRM (Root)
    const t1 = resolveThreadId(rootMsgId, null, null, "Project Proposal");
    assert.equal(t1, rootMsgId, "Root message threadId must be its own messageId");

    // Msg 2: Inbound reply 1 from client
    const msg2Id = "<client-reply-001@gmail.com>";
    const t2 = resolveThreadId(msg2Id, rootMsgId, rootMsgId, "Re: Project Proposal");
    assert.equal(t2, rootMsgId, "First reply must resolve to root threadId");

    // Msg 3: Outbound reply 2 sent from CRM
    const msg3Id = "<outbound-reply-002@hostinger.com>";
    const refs3 = `${rootMsgId} ${msg2Id}`;
    const t3 = resolveThreadId(msg3Id, msg2Id, refs3, "Re: Project Proposal");
    assert.equal(t3, rootMsgId, "Outbound reply 2 must resolve to root threadId");

    // Msg 4: Inbound reply 3 from client (replying to Msg 3)
    const msg4Id = "<client-reply-003@gmail.com>";
    const refs4 = `${rootMsgId} ${msg2Id} ${msg3Id}`;
    const t4 = resolveThreadId(msg4Id, msg3Id, refs4, "Re: Project Proposal");
    assert.equal(t4, rootMsgId, "Deep inbound reply must stay in the original root thread");

    assert.equal(messageToThread.size, 4, "All 4 messages recorded");
  });

  it("Test 4: Fallback to normalized Subject matching when headers are missing", () => {
    const subjectToThread = new Map<string, string>();
    const rootThreadId = "<msg-original-999@hostinger.com>";

    subjectToThread.set("invoice issue #1042", rootThreadId);

    const resolveThreadIdWithSubject = (subject: string) => {
      const normSub = normalizeSubject(subject);
      if (normSub && subjectToThread.has(normSub)) {
        return subjectToThread.get(normSub)!;
      }
      return "<new-thread>";
    };

    assert.equal(
      resolveThreadIdWithSubject("Re: Invoice Issue #1042"),
      rootThreadId,
      "Normalized subject must match existing thread",
    );
    assert.equal(
      resolveThreadIdWithSubject("FWD: Re: invoice issue #1042 "),
      rootThreadId,
      "Fwd + Re prefix stripped subject must match existing thread",
    );
    assert.equal(
      resolveThreadIdWithSubject("Unrelated New Topic"),
      "<new-thread>",
      "Unrelated subject creates a new thread",
    );
  });

  it("Test 5: Conversation thread filtering (inbound-only list with internal sent messages)", () => {
    const messages = [
      {
        id: "msg-1",
        thread_id: "thread-active",
        direction: "outbound" as const,
        received_at: "2026-08-21T10:00:00Z",
      },
      {
        id: "msg-2",
        thread_id: "thread-active",
        direction: "inbound" as const,
        received_at: "2026-08-21T11:00:00Z",
      },
      {
        id: "msg-3",
        thread_id: "thread-active",
        direction: "outbound" as const,
        received_at: "2026-08-21T12:00:00Z",
      },
      {
        id: "msg-4",
        thread_id: "thread-outbound-only",
        direction: "outbound" as const,
        received_at: "2026-08-21T09:00:00Z",
      },
    ];

    // Grouping logic (simulating getClientEmailThreads)
    const threadMap = new Map<string, typeof messages>();
    for (const msg of messages) {
      if (!threadMap.has(msg.thread_id)) {
        threadMap.set(msg.thread_id, []);
      }
      threadMap.get(msg.thread_id)!.push(msg);
    }

    const threads = [];
    for (const [threadId, msgs] of threadMap.entries()) {
      const inboundCount = msgs.filter((m) => m.direction === "inbound").length;
      const outboundCount = msgs.filter((m) => m.direction === "outbound").length;
      threads.push({
        threadId,
        inboundCount,
        outboundCount,
        messages: msgs,
      });
    }

    // Filter to inbound-only threads view list
    const conversationList = threads.filter((t) => t.inboundCount > 0);

    assert.equal(conversationList.length, 1, "Only threads containing client/inbound replies display in conversation list");
    assert.equal(conversationList[0]!.threadId, "thread-active");
    assert.equal(conversationList[0]!.messages.length, 3, "Thread contains all 3 messages internally (sent + received)");
    assert.equal(conversationList[0]!.inboundCount, 1);
    assert.equal(conversationList[0]!.outboundCount, 2);
  });
});
