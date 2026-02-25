/**
 * Feishu event decryption and verification utilities.
 *
 * Feishu encrypts event payloads using AES-256-CBC when Encrypt Key is configured.
 * Encryption process:
 * 1. SHA256(encryptKey) → 256-bit AES key
 * 2. First 16 bytes of ciphertext → IV
 * 3. Remaining bytes → AES-256-CBC encrypted content
 * 4. Base64 encode(IV + encrypted content)
 */

import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

/**
 * Decrypt a Feishu encrypted event payload.
 *
 * @param encrypt - Base64-encoded encrypted string from event body
 * @param encryptKey - The Encrypt Key configured in Feishu developer console
 * @returns Decrypted JSON string
 */
export function decryptFeishuEvent(
  encrypt: string,
  encryptKey: string
): string {
  const key = createHash("sha256").update(encryptKey).digest();
  const encryptedBuffer = Buffer.from(encrypt, "base64");
  const iv = encryptedBuffer.subarray(0, 16);
  const cipherText = encryptedBuffer.subarray(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(cipherText, undefined, "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}

/**
 * Verify that an event's token matches the configured Verification Token.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyFeishuToken(
  eventToken: string,
  configuredToken: string
): boolean {
  const a = Buffer.from(eventToken);
  const b = Buffer.from(configuredToken);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
