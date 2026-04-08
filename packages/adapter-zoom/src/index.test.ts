import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createZoomAdapter } from "./index.js";

const TEST_SECRET = "test-webhook-secret";
const TEST_CREDENTIALS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  robotJid: "test-robot-jid",
  accountId: "test-account-id",
  webhookSecretToken: TEST_SECRET,
};

function makeSignature(body: string, timestamp: string): string {
  const message = `v0:${timestamp}:${body}`;
  const hash = createHmac("sha256", TEST_SECRET).update(message).digest("hex");
  return `v0=${hash}`;
}

function makeZoomRequest(
  body: string,
  overrides?: {
    signature?: string;
    timestamp?: string;
  }
): Request {
  const timestamp =
    overrides?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = overrides?.signature ?? makeSignature(body, timestamp);
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-signature": signature,
      "x-zm-request-timestamp": timestamp,
    },
    body,
  });
}

describe("ZoomAdapter — Webhook Verification (WBHK-01, WBHK-02, WBHK-03)", () => {
  it("WBHK-01: endpoint.url_validation returns { plainToken, encryptedToken } with HTTP 200", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const plainToken = "abc123";
    const body = JSON.stringify({
      event: "endpoint.url_validation",
      payload: { plainToken },
    });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    const expectedEncryptedToken = createHmac("sha256", TEST_SECRET)
      .update(plainToken)
      .digest("hex");
    expect(json).toEqual({ plainToken, encryptedToken: expectedEncryptedToken });
  });

  it("WBHK-02: tampered x-zm-signature returns HTTP 401", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const request = makeZoomRequest(body, { signature: "v0=deadbeef" });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("WBHK-02: missing x-zm-signature returns HTTP 401", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zm-request-timestamp": timestamp,
      },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("WBHK-02: stale timestamp (>5 minutes) returns HTTP 401", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 360);
    const request = makeZoomRequest(body, { timestamp: staleTimestamp });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("WBHK-03: valid signature with correct raw body passes verification", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const request = makeZoomRequest(body);

    const response = await adapter.handleWebhook(request);

    // Verification passed — status should NOT be 401.
    // processEvent is a stub in Phase 1, so 200 ("ok") or any non-401 is acceptable.
    expect(response.status).not.toBe(401);
  });
});

describe("ZoomAdapter — S2S OAuth Token (AUTH-01, AUTH-02, AUTH-04)", () => {
  it.todo(
    "AUTH-01: getAccessToken calls https://zoom.us/oauth/token?grant_type=client_credentials"
  );
  it.todo("AUTH-02: token is reused within 1-hour TTL");
  it.todo("AUTH-02: new token is fetched after TTL expires");
  it.todo(
    "AUTH-04: token fetch uses grant_type=client_credentials (not account_credentials)"
  );
});

describe("ZoomAdapter — Factory Validation (AUTH-03)", () => {
  it.todo("throws ValidationError when clientId is missing");
  it.todo("throws ValidationError when clientSecret is missing");
  it.todo("throws ValidationError when robotJid is missing");
  it.todo("throws ValidationError when accountId is missing");
  it.todo("throws ValidationError when webhookSecretToken is missing");
});
