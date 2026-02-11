import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeKey,
  decryptToken,
  encryptToken,
  isEncryptedTokenData,
} from "./crypto";

const TEST_KEY = crypto.randomBytes(32);
const TEST_KEY_BASE64 = TEST_KEY.toString("base64");
const TEST_KEY_HEX = TEST_KEY.toString("hex");

describe("encryptToken / decryptToken", () => {
  it("round-trips a token correctly", () => {
    const token = "xoxb-test-bot-token-12345";
    const encrypted = encryptToken(token, TEST_KEY);
    const decrypted = decryptToken(encrypted, TEST_KEY);
    expect(decrypted).toBe(token);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const token = "xoxb-same-token";
    const a = encryptToken(token, TEST_KEY);
    const b = encryptToken(token, TEST_KEY);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });

  it("decryption with wrong key throws", () => {
    const token = "xoxb-secret";
    const encrypted = encryptToken(token, TEST_KEY);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decryptToken(encrypted, wrongKey)).toThrow();
  });

  it("decryption with tampered ciphertext throws", () => {
    const token = "xoxb-secret";
    const encrypted = encryptToken(token, TEST_KEY);
    encrypted.data = Buffer.from("tampered").toString("base64");
    expect(() => decryptToken(encrypted, TEST_KEY)).toThrow();
  });
});

describe("decodeKey", () => {
  it("decodes a valid 32-byte base64 key", () => {
    const key = decodeKey(TEST_KEY_BASE64);
    expect(key.length).toBe(32);
    expect(Buffer.compare(key, TEST_KEY)).toBe(0);
  });

  it("decodes a valid 64-char hex key", () => {
    const key = decodeKey(TEST_KEY_HEX);
    expect(key.length).toBe(32);
    expect(Buffer.compare(key, TEST_KEY)).toBe(0);
  });

  it("trims whitespace", () => {
    const key = decodeKey(`  ${TEST_KEY_BASE64}  `);
    expect(key.length).toBe(32);
  });

  it("throws for non-32-byte key", () => {
    const shortKey = crypto.randomBytes(16).toString("base64");
    expect(() => decodeKey(shortKey)).toThrow(
      "Encryption key must decode to exactly 32 bytes",
    );
  });

  it("throws for empty string", () => {
    expect(() => decodeKey("")).toThrow();
  });
});

describe("isEncryptedTokenData", () => {
  it("returns true for valid encrypted data", () => {
    const encrypted = encryptToken("test", TEST_KEY);
    expect(isEncryptedTokenData(encrypted)).toBe(true);
  });

  it("returns false for plain string", () => {
    expect(isEncryptedTokenData("xoxb-token")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isEncryptedTokenData(null)).toBe(false);
    expect(isEncryptedTokenData(undefined)).toBe(false);
  });

  it("returns false for object missing fields", () => {
    expect(isEncryptedTokenData({ iv: "a", data: "b" })).toBe(false);
    expect(isEncryptedTokenData({ iv: "a", tag: "c" })).toBe(false);
  });

  it("returns false for object with non-string fields", () => {
    expect(isEncryptedTokenData({ iv: 1, data: 2, tag: 3 })).toBe(false);
  });
});
