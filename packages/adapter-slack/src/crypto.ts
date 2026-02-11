import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedTokenData {
  iv: string;
  data: string;
  tag: string;
}

export function encryptToken(
  plaintext: string,
  key: Buffer,
): EncryptedTokenData {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    data: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptToken(
  encrypted: EncryptedTokenData,
  key: Buffer,
): string {
  const iv = Buffer.from(encrypted.iv, "base64");
  const ciphertext = Buffer.from(encrypted.data, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedTokenData(
  value: unknown,
): value is EncryptedTokenData {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.iv === "string" &&
    typeof obj.data === "string" &&
    typeof obj.tag === "string"
  );
}

export function decodeKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  // Detect hex encoding: 64 hex chars = 32 bytes
  const isHex = /^[0-9a-fA-F]{64}$/.test(trimmed);
  const key = Buffer.from(trimmed, isHex ? "hex" : "base64");
  if (key.length !== 32) {
    throw new Error(
      `Encryption key must decode to exactly 32 bytes (received ${key.length}). Use a 64-char hex string or 44-char base64 string.`,
    );
  }
  return key;
}
