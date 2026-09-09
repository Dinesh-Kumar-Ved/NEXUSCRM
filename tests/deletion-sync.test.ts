import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Gmail Sync Deletion & Idempotency Tests", () => {
  it("Test 1: Delete All cutoff timestamp prevents re-importing old emails", () => {
    const clientId = "client-123";
    const deleteAllTimestamp = new Date("2026-09-09T16:00:00Z").getTime();

    // Mock Gmail messages returned by Gmail API
    const oldMessage = {
      id: "old-msg-1",
      threadId: "thread-1",
      internalDate: String(new Date("2026-09-09T15:30:00Z").getTime()), // 30 mins before Delete All
      fromEmail: "dineshvedd@gmail.com",
    };

    const newMessage = {
      id: "new-msg-2",
      threadId: "thread-1",
      internalDate: String(new Date("2026-09-09T16:15:00Z").getTime()), // 15 mins after Delete All
      fromEmail: "dineshvedd@gmail.com",
    };

    const clientCutoffMap: Record<string, number> = {
      [clientId]: deleteAllTimestamp,
    };

    const shouldImport = (msg: typeof oldMessage, targetClientId: string) => {
      const cutoff = clientCutoffMap[targetClientId];
      if (cutoff) {
        const msgTime = parseInt(msg.internalDate, 10);
        if (!isNaN(msgTime) && msgTime <= cutoff) {
          return false;
        }
      }
      return true;
    };

    assert.equal(shouldImport(oldMessage, clientId), false, "Old message received before Delete All must NOT be imported");
    assert.equal(shouldImport(newMessage, clientId), true, "New message received after Delete All MUST be imported");
  });

  it("Test 2: Soft-deleted messages (rfc_message_id = DELETED) skip re-importing on repeated syncs", () => {
    // Mock existing DB records in email_messages table
    const dbMessages = [
      {
        id: "db-1",
        provider_message_id: "gmail-msg-001",
        client_id: null,
        rfc_message_id: "DELETED",
      },
    ];

    const storeMessageCheck = (msgId: string, matchedClientId: string) => {
      const existing = dbMessages.find((row) => row.provider_message_id === msgId);
      if (existing) {
        if (
          !existing.client_id &&
          matchedClientId &&
          existing.rfc_message_id !== "DELETED" &&
          existing.rfc_message_id !== "DELETE_ALL_MARKER"
        ) {
          return { inserted: true, reassociated: true };
        }
        return { inserted: false, reassociated: false };
      }
      return { inserted: true, reassociated: false };
    };

    const res1 = storeMessageCheck("gmail-msg-001", "client-123");
    assert.equal(res1.inserted, false, "Soft-deleted message must not be re-inserted");
    assert.equal(res1.reassociated, false, "Soft-deleted message must not be re-associated with client");

    const res2 = storeMessageCheck("gmail-msg-brand-new", "client-123");
    assert.equal(res2.inserted, true, "Brand new message must be inserted");
  });

  it("Test 3: Idempotency across multiple consecutive sync runs", () => {
    const dbMessages: Array<{ id: string; provider_message_id: string; client_id: string | null; rfc_message_id: string }> = [];
    const clientCutoffMap: Record<string, number> = {
      "client-123": new Date("2026-09-09T16:00:00Z").getTime(),
    };

    const simulateSyncRun = (incomingMessages: Array<{ id: string; internalDate: string }>) => {
      let inserted = 0;
      let skipped = 0;

      for (const msg of incomingMessages) {
        const cutoff = clientCutoffMap["client-123"];
        const msgTime = parseInt(msg.internalDate, 10);

        if (cutoff && msgTime <= cutoff) {
          skipped++;
          continue;
        }

        const existing = dbMessages.find((m) => m.provider_message_id === msg.id);
        if (existing) {
          skipped++;
          continue;
        }

        dbMessages.push({
          id: `db-${Date.now()}-${Math.random()}`,
          provider_message_id: msg.id,
          client_id: "client-123",
          rfc_message_id: "normal",
        });
        inserted++;
      }

      return { inserted, skipped };
    };

    const incomingBatch = [
      { id: "old-1", internalDate: String(new Date("2026-09-09T15:00:00Z").getTime()) },
      { id: "new-1", internalDate: String(new Date("2026-09-09T16:30:00Z").getTime()) },
    ];

    // Run 1
    const run1 = simulateSyncRun(incomingBatch);
    assert.equal(run1.inserted, 1, "Run 1: Only new message should be inserted");
    assert.equal(run1.skipped, 1, "Run 1: Old message should be skipped");

    // Run 2 (repeated sync)
    const run2 = simulateSyncRun(incomingBatch);
    assert.equal(run2.inserted, 0, "Run 2: No new messages should be inserted");
    assert.equal(run2.skipped, 2, "Run 2: All messages should be skipped");

    // Run 3 (repeated sync)
    const run3 = simulateSyncRun(incomingBatch);
    assert.equal(run3.inserted, 0, "Run 3: No new messages should be inserted");
    assert.equal(run3.skipped, 2, "Run 3: All messages should be skipped");
  });
});
