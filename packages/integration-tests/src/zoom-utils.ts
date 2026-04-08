/**
 * Zoom test utilities for replay/integration tests.
 */

import { createHmac } from "node:crypto";
import { vi } from "vitest";

export const ZOOM_WEBHOOK_SECRET = "test-zoom-webhook-secret";

export const ZOOM_CREDENTIALS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  robotJid: "bot@xmpp.zoom.us",
  accountId: "test-account-id",
  webhookSecretToken: ZOOM_WEBHOOK_SECRET,
};

/**
 * Creates a signed Zoom webhook Request.
 * Zoom HMAC format: v0:{timestamp_seconds}:{body}
 */
export function createZoomWebhookRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `v0:${timestamp}:${body}`;
  const hash = createHmac("sha256", ZOOM_WEBHOOK_SECRET)
    .update(message)
    .digest("hex");

  return new Request("https://example.com/webhook/zoom", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-signature": `v0=${hash}`,
      "x-zm-request-timestamp": String(timestamp),
    },
    body,
  });
}

/**
 * Stubs global fetch to intercept Zoom API calls.
 * Returns a cleanup function that restores the original fetch.
 */
export function setupZoomFetchMock(): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }

      if (url.includes("zoom.us/oauth/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "test-token", expires_in: 3600 }),
        } as Response;
      }

      if (url.includes("api.zoom.us/v2/chat")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message_id: "msg-test-123" }),
          text: async () => "",
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }
  );

  return () => {
    globalThis.fetch = originalFetch;
  };
}
