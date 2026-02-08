/**
 * Tests for X webhook security: CRC challenge handling and signature verification.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleCrcChallenge, verifyWebhookSignature } from "./webhook";

const TEST_SECRET = "test-consumer-secret-12345";

// ============================================================================
// CRC Challenge Tests
// ============================================================================

describe("handleCrcChallenge", () => {
  it("returns correct HMAC-SHA256 response", async () => {
    const crcToken = "test-crc-token";
    const response = handleCrcChallenge(crcToken, TEST_SECRET);

    const body = await response.json();
    const expectedHmac = createHmac("sha256", TEST_SECRET)
      .update(crcToken)
      .digest("base64");

    expect(response.status).toBe(200);
    expect(body.response_token).toBe(`sha256=${expectedHmac}`);
  });

  it("returns 200 status code", () => {
    const response = handleCrcChallenge("any-token", TEST_SECRET);
    expect(response.status).toBe(200);
  });

  it("returns JSON content type", () => {
    const response = handleCrcChallenge("any-token", TEST_SECRET);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("produces different hashes for different tokens", async () => {
    const response1 = handleCrcChallenge("token-a", TEST_SECRET);
    const response2 = handleCrcChallenge("token-b", TEST_SECRET);

    const body1 = await response1.json();
    const body2 = await response2.json();

    expect(body1.response_token).not.toBe(body2.response_token);
  });

  it("produces different hashes for different secrets", async () => {
    const response1 = handleCrcChallenge("same-token", "secret-1");
    const response2 = handleCrcChallenge("same-token", "secret-2");

    const body1 = await response1.json();
    const body2 = await response2.json();

    expect(body1.response_token).not.toBe(body2.response_token);
  });
});

// ============================================================================
// Signature Verification Tests
// ============================================================================

describe("verifyWebhookSignature", () => {
  function makeSignature(body: string, secret: string): string {
    return `sha256=${createHmac("sha256", secret).update(body).digest("base64")}`;
  }

  it("returns true for valid signature", () => {
    const body = '{"tweet_create_events":[]}';
    const signature = makeSignature(body, TEST_SECRET);
    expect(verifyWebhookSignature(body, signature, TEST_SECRET)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const body = '{"tweet_create_events":[]}';
    const badSignature = makeSignature(body, "wrong-secret");
    expect(verifyWebhookSignature(body, badSignature, TEST_SECRET)).toBe(false);
  });

  it("returns false for null signature", () => {
    const body = '{"tweet_create_events":[]}';
    expect(verifyWebhookSignature(body, null, TEST_SECRET)).toBe(false);
  });

  it("returns false for empty string signature", () => {
    const body = '{"tweet_create_events":[]}';
    expect(verifyWebhookSignature(body, "", TEST_SECRET)).toBe(false);
  });

  it("returns false when body has been tampered with", () => {
    const originalBody = '{"tweet_create_events":[]}';
    const signature = makeSignature(originalBody, TEST_SECRET);
    const tamperedBody = '{"tweet_create_events":["tampered"]}';
    expect(verifyWebhookSignature(tamperedBody, signature, TEST_SECRET)).toBe(
      false,
    );
  });

  it("returns false for signature with wrong prefix", () => {
    const body = '{"tweet_create_events":[]}';
    const hmac = createHmac("sha256", TEST_SECRET)
      .update(body)
      .digest("base64");
    const badSignature = `md5=${hmac}`;
    expect(verifyWebhookSignature(body, badSignature, TEST_SECRET)).toBe(false);
  });

  it("verifies signature for empty body", () => {
    const body = "";
    const signature = makeSignature(body, TEST_SECRET);
    expect(verifyWebhookSignature(body, signature, TEST_SECRET)).toBe(true);
  });
});
