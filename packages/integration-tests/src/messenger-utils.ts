/**
 * Messenger test utilities for replay/integration tests.
 */

import { createHmac } from "node:crypto";
import { vi } from "vitest";

export const MESSENGER_APP_SECRET = "test-messenger-app-secret";
export const MESSENGER_PAGE_ACCESS_TOKEN = "test-messenger-page-token";
export const MESSENGER_VERIFY_TOKEN = "test-messenger-verify-token";

const GRAPH_API_PATH_REGEX = /\/v[\d.]+(\/.+)/;

interface MockMessengerApiCall {
  body: Record<string, unknown>;
  path: string;
}

interface SentMessengerMessage {
  template?: Record<string, unknown>;
  text?: string;
  to: string;
}

export interface MockMessengerApi {
  calls: MockMessengerApiCall[];
  clearMocks: () => void;
  sentMessages: SentMessengerMessage[];
}

export function createMockMessengerApi(): MockMessengerApi {
  const calls: MockMessengerApiCall[] = [];
  const sentMessages: SentMessengerMessage[] = [];

  return {
    calls,
    sentMessages,
    clearMocks: () => {
      calls.length = 0;
      sentMessages.length = 0;
    },
  };
}

export function createMessengerWebhookRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", MESSENGER_APP_SECRET).update(body).digest("hex")}`;

  return new Request("https://example.com/webhook/messenger", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });
}

export function setupMessengerFetchMock(
  mockApi: MockMessengerApi,
  options: {
    pageId: string;
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

      // Handle page identity fetch
      if (path === "/me" || path.includes(`/${options.pageId}`)) {
        return new Response(
          JSON.stringify({
            id: options.pageId,
            name: "Test Page",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Handle sendMessage (text)
      if (path.includes("/messages") && init?.method === "POST") {
        const messageId = `m_MOCK_${nextMessageId}`;
        nextMessageId += 1;

        const message = body.message as Record<string, unknown> | undefined;
        const recipient = body.recipient as { id: string } | undefined;
        const to = recipient?.id ?? "";

        // Extract text or template
        let text: string | undefined;
        let template: Record<string, unknown> | undefined;

        if (message?.text) {
          text = message.text as string;
        } else if (message?.attachment) {
          const attachment = message.attachment as Record<string, unknown>;
          if (attachment.type === "template") {
            template = attachment.payload as Record<string, unknown>;
          }
        }

        mockApi.sentMessages.push({ text, template, to });

        return new Response(
          JSON.stringify({
            recipient_id: to,
            message_id: messageId,
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
