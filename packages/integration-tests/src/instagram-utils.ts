import { createHmac } from "node:crypto";
import { vi } from "vitest";

export const INSTAGRAM_ACCESS_TOKEN = "test-instagram-access-token";
export const INSTAGRAM_APP_SECRET = "test-instagram-app-secret";
export const INSTAGRAM_VERIFY_TOKEN = "test-instagram-verify-token";

const GRAPH_API_PATH_REGEX = /\/v[\d.]+(\/.+)/;

interface MockInstagramApiCall {
  body: Record<string, unknown>;
  path: string;
}

interface SentInstagramMessage {
  attachment?: Record<string, unknown>;
  quickReplies?: unknown[];
  tag?: string;
  text?: string;
  to: string;
}

export interface MockInstagramApi {
  calls: MockInstagramApiCall[];
  sentMessages: SentInstagramMessage[];
}

export function createMockInstagramApi(): MockInstagramApi {
  return { calls: [], sentMessages: [] };
}

export function createInstagramWebhookRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", INSTAGRAM_APP_SECRET)
    .update(body)
    .digest("hex");
  return new Request("https://example.com/webhook/instagram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

export function setupInstagramFetchMock(
  mockApi: MockInstagramApi,
  accountId: string
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
        if (new URL(url).hostname !== "graph.instagram.com") {
          return originalFetch(input, init);
        }
      } catch {
        return originalFetch(input, init);
      }

      const path = url.match(GRAPH_API_PATH_REGEX)?.[1] ?? url;
      const body =
        init?.body && typeof init.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      mockApi.calls.push({ path, body });

      if (init?.method === "GET" && path.startsWith(`/${accountId}`)) {
        return jsonResponse({
          id: accountId,
          name: "Instagram Test Shop",
          username: "instagram_test_shop",
        });
      }

      if (init?.method === "POST" && path.includes("/messages")) {
        const message = body.message as Record<string, unknown> | undefined;
        const recipient = body.recipient as { id?: string } | undefined;
        const sent: SentInstagramMessage = {
          to: recipient?.id ?? "",
          tag: body.tag as string | undefined,
          text: message?.text as string | undefined,
          attachment: message?.attachment as
            | Record<string, unknown>
            | undefined,
          quickReplies: message?.quick_replies as unknown[] | undefined,
        };
        mockApi.sentMessages.push(sent);
        nextMessageId += 1;
        return jsonResponse({
          recipient_id: sent.to,
          message_id: `mid_ig_mock_${nextMessageId}`,
        });
      }

      return jsonResponse({ success: true });
    }
  );

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
