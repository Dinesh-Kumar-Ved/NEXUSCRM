import crypto from "node:crypto";

export interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * Resolves and validates the 32-byte encryption key from GOOGLE_TOKEN_ENCRYPTION_KEY or custom key.
 * Throws a clear error if the key is missing or not exactly 32 bytes.
 */
export function getEncryptionKey(customKey?: string | Buffer): Buffer {
  if (customKey) {
    if (Buffer.isBuffer(customKey)) {
      if (customKey.length !== 32) {
        throw new Error(
          `Invalid encryption key: Expected 32 bytes, received ${customKey.length} bytes.`,
        );
      }
      return customKey;
    }
    return parseKeyString(customKey);
  }

  const envKey = process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"];
  if (!envKey || envKey.trim().length === 0) {
    throw new Error(
      "Missing GOOGLE_TOKEN_ENCRYPTION_KEY environment variable. A 32-byte key is required for token encryption.",
    );
  }

  return parseKeyString(envKey.trim());
}

function parseKeyString(keyStr: string): Buffer {
  // Try Base64 first
  try {
    const base64Buf = Buffer.from(keyStr, "base64");
    if (base64Buf.length === 32) {
      return base64Buf;
    }
  } catch {
    // ignore
  }

  // Try Hex (64 chars)
  if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) {
    const hexBuf = Buffer.from(keyStr, "hex");
    if (hexBuf.length === 32) {
      return hexBuf;
    }
  }

  // Try raw UTF-8 (32 chars)
  const utf8Buf = Buffer.from(keyStr, "utf8");
  if (utf8Buf.length === 32) {
    return utf8Buf;
  }

  throw new Error(
    "Invalid GOOGLE_TOKEN_ENCRYPTION_KEY: Key must decode to exactly 32 bytes (256 bits). Please generate a valid 32-byte base64-encoded key.",
  );
}

/**
 * Encrypts plain text using AES-256-GCM.
 */
export function encryptToken(plainText: string, customKey?: string | Buffer): EncryptedPayload {
  if (!plainText) {
    throw new Error("Plaintext to encrypt cannot be empty.");
  }

  const key = getEncryptionKey(customKey);
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for AES-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let ciphertext = cipher.update(plainText, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext,
  };
}

/**
 * Decrypts an EncryptedPayload using AES-256-GCM.
 */
export function decryptToken(payload: EncryptedPayload, customKey?: string | Buffer): string {
  if (!payload || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new Error("Invalid encrypted payload structure: missing iv, tag, or ciphertext.");
  }

  const key = getEncryptionKey(customKey);
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");

  if (iv.length === 0 || tag.length === 0) {
    throw new Error("Invalid IV or authentication tag in encrypted payload.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(payload.ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
