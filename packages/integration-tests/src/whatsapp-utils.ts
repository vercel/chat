/**
 * WhatsApp test utilities for replay/integration tests.
 */

import { createHmac } from "node:crypto";
import { vi } from "vitest";

export const WHATSAPP_ACCESS_TOKEN = "test-whatsapp-access-token";
export const WHATSAPP_APP_SECRET = "test-whatsapp-app-secret";
export const WHATSAPP_VERIFY_TOKEN = "test-whatsapp-verify-token";

const GRAPH_API_PATH_REGEX = /\/v[\d.]+(\/.+)/;

interface MockWhatsAppApiCall {
  body: Record<string, unknown>;
  path: string;
}

interface SentWhatsAppMessage {
  text: string;
  to: string;
}

export interface MockWhatsAppApi {
  calls: MockWhatsAppApiCall[];
  clearMocks: () => void;
  sentMessages: SentWhatsAppMessage[];
}

export function createMockWhatsAppApi(): MockWhatsAppApi {
  const calls: MockWhatsAppApiCall[] = [];
  const sentMessages: SentWhatsAppMessage[] = [];

  return {
    calls,
    sentMessages,
    clearMocks: () => {
      calls.length = 0;
      sentMessages.length = 0;
    },
  };
}

export function createWhatsAppWebhookRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", WHATSAPP_APP_SECRET).update(body).digest("hex")}`;

  return new Request("https://example.com/webhook/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });
}

export function setupWhatsAppFetchMock(
  mockApi: MockWhatsAppApi,
  options: {
    phoneNumberId: string;
  }
): () => void {
  const originalFetch = globalThis.fetch;
  let nextMessageId = 10_000;

  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }

      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname !== "graph.facebook.com") {
          return originalFetch(input, init);
        }
      } catch {
        return originalFetch(input, init);
      }

      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      const pathMatch = url.match(GRAPH_API_PATH_REGEX);
      const path = pathMatch?.[1] ?? url;

      mockApi.calls.push({ path, body });

      // Handle sendMessage
      if (
        path.includes(`/${options.phoneNumberId}/messages`) &&
        body.type === "text"
      ) {
        const messageId = `wamid.MOCK_${nextMessageId}`;
        nextMessageId += 1;
        const text =
          typeof body.text === "object" && body.text !== null
            ? (body.text as { body: string }).body
            : "";
        const to = String(body.to ?? "");

        mockApi.sentMessages.push({ text, to });

        return new Response(
          JSON.stringify({
            messaging_product: "whatsapp",
            contacts: [{ wa_id: to }],
            messages: [{ id: messageId }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Default OK response for other API calls
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  );

  return () => {
    globalThis.fetch = originalFetch;
  };
}
