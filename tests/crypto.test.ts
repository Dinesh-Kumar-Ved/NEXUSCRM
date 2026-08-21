import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { decryptToken, encryptToken, getEncryptionKey } from "../src/lib/crypto.ts";

describe("Token Encryption & Decryption (AES-256-GCM)", () => {
  const validKey = crypto.randomBytes(32);
  const validKeyBase64 = validKey.toString("base64");
  const wrongKey = crypto.randomBytes(32);

  it("should encrypt and decrypt a refresh token successfully", () => {
    const originalToken = "1//04ABC_test_refresh_token_xyz_123456789";
    const encrypted = encryptToken(originalToken, validKeyBase64);

    assert.ok(encrypted.iv, "IV must be present");
    assert.ok(encrypted.tag, "Auth tag must be present");
    assert.ok(encrypted.ciphertext, "Ciphertext must be present");
    assert.notEqual(encrypted.ciphertext, originalToken);

    const decrypted = decryptToken(encrypted, validKeyBase64);
    assert.equal(decrypted, originalToken);
  });

  it("should reject decryption with the wrong key", () => {
    const originalToken = "my_secret_token_123";
    const encrypted = encryptToken(originalToken, validKey);

    assert.throws(() => {
      decryptToken(encrypted, wrongKey);
    });
  });

  it("should reject decryption of corrupted ciphertext", () => {
    const originalToken = "my_secret_token_123";
    const encrypted = encryptToken(originalToken, validKey);

    // Corrupt ciphertext
    const corrupted = {
      ...encrypted,
      ciphertext: Buffer.from("corrupted_payload").toString("base64"),
    };

    assert.throws(() => {
      decryptToken(corrupted, validKey);
    });
  });

  it("should reject invalid key lengths", () => {
    const shortKey = "too_short_key";
    assert.throws(() => {
      getEncryptionKey(shortKey);
    }, /Invalid|32 bytes/i);
  });
});
