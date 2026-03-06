/**
 * Telegram test utilities for replay/integration tests.
 */

import { vi } from "vitest";

export const TELEGRAM_BOT_TOKEN = "test-telegram-bot-token";

interface MockTelegramApiCall {
  method: string;
  payload: Record<string, unknown>;
  url: string;
}

interface SentTelegramMessage {
  chatId: number;
  messageId: number;
  text: string;
}

export interface MockTelegramApi {
  calls: MockTelegramApiCall[];
  clearMocks: () => void;
  sentMessages: SentTelegramMessage[];
}

const TELEGRAM_METHOD_PATH_REGEX = /\/bot[^/]+\/([^/?]+)/;

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    return JSON.parse(body) as Record<string, unknown>;
  }
  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  if (body instanceof FormData) {
    const parsed: Record<string, unknown> = {};
    body.forEach((value, key) => {
      parsed[key] = typeof value === "string" ? value : "[binary]";
    });
    return parsed;
  }

  return {};
}

function telegramOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function parseChatId(payload: Record<string, unknown>): number {
  return Number.parseInt(String(payload.chat_id ?? "0"), 10);
}

function parseOptionalMessageThreadId(
  payload: Record<string, unknown>
): number | undefined {
  const raw = payload.message_thread_id;
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createMockTelegramApi(): MockTelegramApi {
  const calls: MockTelegramApiCall[] = [];
  const sentMessages: SentTelegramMessage[] = [];

  return {
    calls,
    sentMessages,
    clearMocks: () => {
      calls.length = 0;
      sentMessages.length = 0;
    },
  };
}

export function createTelegramWebhookRequest(payload: unknown): Request {
  return new Request("https://example.com/webhook/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function setupTelegramFetchMock(
  mockApi: MockTelegramApi,
  options: {
    botUserId: string;
    userName: string;
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

      if (!url.startsWith("https://api.telegram.org/")) {
        return originalFetch(input, init);
      }

      const methodMatch = url.match(TELEGRAM_METHOD_PATH_REGEX);
      const method = methodMatch?.[1] ?? "";
      const payload = parseBody(init?.body);

      mockApi.calls.push({ method, payload, url });

      if (method === "getMe") {
        return telegramOk({
          first_name: options.userName,
          id: Number.parseInt(options.botUserId, 10),
          is_bot: true,
          username: options.userName,
        });
      }

      if (method === "sendMessage") {
        const chatId = parseChatId(payload);
        const messageId = nextMessageId;
        nextMessageId += 1;
        const text = String(payload.text ?? "");
        const messageThreadId = parseOptionalMessageThreadId(payload);

        mockApi.sentMessages.push({
          chatId,
          messageId,
          text,
        });

        return telegramOk({
          chat: {
            id: chatId,
            type: chatId < 0 ? "group" : "private",
          },
          date: Math.floor(Date.now() / 1000),
          from: {
            first_name: options.userName,
            id: Number.parseInt(options.botUserId, 10),
            is_bot: true,
            username: options.userName,
          },
          message_id: messageId,
          message_thread_id: messageThreadId,
          text,
        });
      }

      return telegramOk(true);
    }
  );

  return () => {
    globalThis.fetch = originalFetch;
  };
}
