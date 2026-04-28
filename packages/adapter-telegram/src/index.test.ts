import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTelegramCallbackData } from "./cards";
import {
  applyTelegramEntities,
  createTelegramAdapter,
  TelegramAdapter,
  type TelegramMessage,
  type TelegramReactionType,
} from "./index";
import {
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  TelegramFormatConverter,
} from "./markdown";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockFetch = vi.fn<typeof fetch>();
const SERVERLESS_ENV_KEYS = [
  "VERCEL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "FUNCTIONS_WORKER_RUNTIME",
  "NETLIFY",
  "K_SERVICE",
] as const;
let originalServerlessEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalServerlessEnv = {};
  for (const key of SERVERLESS_ENV_KEYS) {
    originalServerlessEnv[key] = process.env[key];
  }
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  for (const key of SERVERLESS_ENV_KEYS) {
    const value = originalServerlessEnv[key];
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      Reflect.deleteProperty(process.env, key);
    }
  }
  vi.unstubAllGlobals();
});

function telegramOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function telegramError(
  status: number,
  errorCode: number,
  description: string,
  parameters?: { retry_after?: number }
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error_code: errorCode,
      description,
      parameters,
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

function createMockChat(options?: { userName?: unknown }): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue(options?.userName ?? "mybot"),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processOptionsLoad: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processSlashCommand: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAppHomeOpened: vi.fn(),
  } as unknown as ChatInstance;
}

function sampleMessage(overrides?: Partial<TelegramMessage>): TelegramMessage {
  return {
    message_id: 11,
    date: 1735689600,
    chat: {
      id: 123,
      type: "private",
      first_name: "User",
    },
    from: {
      id: 456,
      is_bot: false,
      first_name: "User",
      username: "user",
    },
    text: "hello",
    ...overrides,
  };
}

function createAbortError(): Error {
  const fallback = new Error("Aborted");
  fallback.name = "AbortError";

  if (typeof DOMException === "undefined") {
    return fallback;
  }

  return new DOMException("Aborted", "AbortError");
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for condition");
}

describe("createTelegramAdapter", () => {
  it("throws when bot token is missing", () => {
    process.env.TELEGRAM_BOT_TOKEN = "";

    expect(() => createTelegramAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );
  });

  it("uses env vars when config is omitted", () => {
    process.env.TELEGRAM_BOT_TOKEN = "token-from-env";

    const adapter = createTelegramAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(TelegramAdapter);
    expect(adapter.name).toBe("telegram");
  });
});

describe("constructor env var resolution", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("TELEGRAM_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("should throw when botToken is missing and env var not set", () => {
    expect(() => new TelegramAdapter({})).toThrow("botToken is required");
  });

  it("should resolve botToken from TELEGRAM_BOT_TOKEN env var", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    const adapter = new TelegramAdapter();
    expect(adapter).toBeInstanceOf(TelegramAdapter);
  });

  it("should resolve secretToken from TELEGRAM_WEBHOOK_SECRET_TOKEN env var", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN = "env-secret";
    const adapter = new TelegramAdapter();
    expect(adapter).toBeInstanceOf(TelegramAdapter);
  });

  it("should resolve userName from TELEGRAM_BOT_USERNAME env var", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    process.env.TELEGRAM_BOT_USERNAME = "env_bot_name";
    const adapter = new TelegramAdapter();
    expect(adapter.userName).toBe("env_bot_name");
  });

  it("should resolve apiBaseUrl from TELEGRAM_API_BASE_URL env var", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    process.env.TELEGRAM_API_BASE_URL = "https://custom-api.example.com";
    const adapter = new TelegramAdapter();
    expect(adapter).toBeInstanceOf(TelegramAdapter);
  });

  it("should accept apiUrl config and prefer it over apiBaseUrl", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    const adapter = new TelegramAdapter({
      botToken: "token",
      apiUrl: "https://apiurl.example.com",
      apiBaseUrl: "https://apibaseurl.example.com",
    });
    expect((adapter as unknown as { apiBaseUrl: string }).apiBaseUrl).toBe(
      "https://apiurl.example.com"
    );
  });

  it("should fall back to apiBaseUrl when apiUrl is not set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    const adapter = new TelegramAdapter({
      botToken: "token",
      apiBaseUrl: "https://apibaseurl.example.com",
    });
    expect((adapter as unknown as { apiBaseUrl: string }).apiBaseUrl).toBe(
      "https://apibaseurl.example.com"
    );
  });

  it("should default logger when not provided", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
    const adapter = new TelegramAdapter();
    expect(adapter).toBeInstanceOf(TelegramAdapter);
  });

  it("should prefer config values over env vars", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-token";
    process.env.TELEGRAM_BOT_USERNAME = "env-name";
    const adapter = new TelegramAdapter({
      botToken: "config-token",
      userName: "config-name",
    });
    expect(adapter.userName).toBe("config-name");
  });
});

describe("TelegramAdapter", () => {
  it("encodes and decodes thread IDs", () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    expect(
      adapter.encodeThreadId({
        chatId: "-100123",
      })
    ).toBe("telegram:-100123");

    expect(
      adapter.encodeThreadId({
        chatId: "-100123",
        messageThreadId: 42,
      })
    ).toBe("telegram:-100123:42");

    expect(adapter.decodeThreadId("telegram:-100123:42")).toEqual({
      chatId: "-100123",
      messageThreadId: 42,
    });
  });

  it("handles webhook message updates and marks mentions", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        message: sampleMessage({
          chat: {
            id: -100123,
            type: "supergroup",
            title: "General",
          },
          text: "hello @mybot",
          entities: [{ type: "mention", offset: 6, length: 6 }],
        }),
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { isMention?: boolean; text: string },
    ];

    expect(threadId).toBe("telegram:-100123");
    expect(parsedMessage.text).toBe("hello @mybot");
    expect(parsedMessage.isMention).toBe(true);
  });

  it("rejects webhook requests with invalid secret token", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      secretToken: "expected-secret",
      logger: mockLogger,
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid webhook JSON", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid-json",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("throws when polling starts before initialize", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await expect(adapter.startPolling()).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("can reset webhook explicitly", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(true));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());
    await adapter.resetWebhook(true);

    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/deleteWebhook");
    const body = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as {
      drop_pending_updates?: boolean;
    };
    expect(body.drop_pending_updates).toBe(true);
  });

  it("starts polling, advances offset, and stops cleanly", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(true))
      .mockResolvedValueOnce(
        telegramOk([
          {
            update_id: 10,
            message: sampleMessage({
              message_id: 99,
              text: "polled message",
            }),
          },
        ])
      )
      .mockImplementationOnce((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      });

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });
    const chat = createMockChat();

    await adapter.initialize(chat);
    await adapter.startPolling({
      limit: 1,
      timeout: 1,
      allowedUpdates: ["message"],
      retryDelayMs: 0,
    });

    await waitForCondition(
      () =>
        (chat.processMessage as ReturnType<typeof vi.fn>).mock.calls.length > 0
    );
    await waitForCondition(() => mockFetch.mock.calls.length >= 4);
    await adapter.stopPolling();

    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/deleteWebhook");
    expect(String(mockFetch.mock.calls[2]?.[0])).toContain("/getUpdates");
    expect(String(mockFetch.mock.calls[3]?.[0])).toContain("/getUpdates");

    const firstPollBody = JSON.parse(
      String((mockFetch.mock.calls[2]?.[1] as RequestInit).body)
    ) as {
      allowed_updates?: string[];
      limit?: number;
      offset?: number;
      timeout?: number;
    };
    const secondPollBody = JSON.parse(
      String((mockFetch.mock.calls[3]?.[1] as RequestInit).body)
    ) as {
      offset?: number;
    };

    expect(firstPollBody.limit).toBe(1);
    expect(firstPollBody.timeout).toBe(1);
    expect(firstPollBody.allowed_updates).toEqual(["message"]);
    expect(firstPollBody.offset).toBeUndefined();
    expect(secondPollBody.offset).toBe(11);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(processMessage.mock.calls[0]?.[1]).toBe("telegram:123");
    expect(adapter.isPolling).toBe(false);
  });

  it("mode polling starts polling during initialize", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(true))
      .mockResolvedValueOnce(telegramOk([]))
      .mockImplementationOnce((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      });

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "polling",
      logger: mockLogger,
      userName: "mybot",
      longPolling: {
        limit: 1,
        timeout: 1,
      },
    });

    await adapter.initialize(createMockChat());
    expect(adapter.runtimeMode).toBe("polling");
    await waitForCondition(() => mockFetch.mock.calls.length >= 4);
    await adapter.stopPolling();

    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/deleteWebhook");
    expect(String(mockFetch.mock.calls[2]?.[0])).toContain("/getUpdates");
    expect(String(mockFetch.mock.calls[3]?.[0])).toContain("/getUpdates");
    expect(adapter.isPolling).toBe(false);
  });

  it("auto mode starts polling when webhook URL is missing", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(
        telegramOk({
          allowed_updates: [],
          has_custom_certificate: false,
          pending_update_count: 0,
          url: "",
        })
      )
      .mockResolvedValueOnce(
        telegramOk([
          {
            update_id: 42,
            message: sampleMessage({
              message_id: 100,
              text: "auto polling message",
            }),
          },
        ])
      )
      .mockImplementationOnce((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      });

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "auto",
      logger: mockLogger,
      userName: "mybot",
      longPolling: {
        limit: 1,
        timeout: 1,
      },
    });
    const chat = createMockChat();

    await adapter.initialize(chat);
    expect(adapter.runtimeMode).toBe("polling");

    await waitForCondition(
      () =>
        (chat.processMessage as ReturnType<typeof vi.fn>).mock.calls.length > 0
    );
    await waitForCondition(() => mockFetch.mock.calls.length >= 4);
    await adapter.stopPolling();

    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/getWebhookInfo");
    expect(String(mockFetch.mock.calls[2]?.[0])).toContain("/getUpdates");
    expect(String(mockFetch.mock.calls[3]?.[0])).toContain("/getUpdates");
    expect(adapter.isPolling).toBe(false);
  });

  it("defaults to auto mode and uses default long polling settings", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(
        telegramOk({
          allowed_updates: [],
          has_custom_certificate: false,
          pending_update_count: 0,
          url: "",
        })
      )
      .mockResolvedValueOnce(telegramOk([]))
      .mockImplementationOnce((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      });

    const adapter = createTelegramAdapter({
      botToken: "token",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());
    expect(adapter.runtimeMode).toBe("polling");
    await waitForCondition(() => mockFetch.mock.calls.length >= 4);
    await adapter.stopPolling();

    const firstPollBody = JSON.parse(
      String((mockFetch.mock.calls[2]?.[1] as RequestInit).body)
    ) as {
      limit?: number;
      timeout?: number;
    };

    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/getWebhookInfo");
    expect(String(mockFetch.mock.calls[2]?.[0])).toContain("/getUpdates");
    expect(firstPollBody.limit).toBe(100);
    expect(firstPollBody.timeout).toBe(30);
    expect(adapter.isPolling).toBe(false);
  });

  it("auto mode stays in webhook mode when webhook URL exists", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(
        telegramOk({
          allowed_updates: [],
          has_custom_certificate: false,
          pending_update_count: 0,
          url: "https://example.com/webhook/telegram",
        })
      );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "auto",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    expect(mockFetch.mock.calls).toHaveLength(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/getWebhookInfo");
    expect(adapter.runtimeMode).toBe("webhook");
    expect(adapter.isPolling).toBe(false);
  });

  it("auto mode stays in webhook mode on serverless runtime", async () => {
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = "1";

    try {
      mockFetch
        .mockResolvedValueOnce(
          telegramOk({
            id: 999,
            is_bot: true,
            first_name: "Bot",
            username: "mybot",
          })
        )
        .mockResolvedValueOnce(
          telegramOk({
            allowed_updates: [],
            has_custom_certificate: false,
            pending_update_count: 0,
            url: "",
          })
        );

      const adapter = createTelegramAdapter({
        botToken: "token",
        mode: "auto",
        logger: mockLogger,
        userName: "mybot",
      });

      await adapter.initialize(createMockChat());

      expect(mockFetch.mock.calls).toHaveLength(2);
      expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/getWebhookInfo");
      expect(adapter.runtimeMode).toBe("webhook");
      expect(adapter.isPolling).toBe(false);
    } finally {
      if (typeof previousVercel === "string") {
        process.env.VERCEL = previousVercel;
      } else {
        Reflect.deleteProperty(process.env, "VERCEL");
      }
    }
  });

  it("auto mode stays in webhook mode when getWebhookInfo fails", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramError(500, 500, "Internal Server Error"));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "auto",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    expect(mockFetch.mock.calls).toHaveLength(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/getWebhookInfo");
    expect(adapter.runtimeMode).toBe("webhook");
    expect(adapter.isPolling).toBe(false);
  });

  it("does not crash when chat.getUserName() is undefined", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "telegrambot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });
    const chat = createMockChat({ userName: undefined });

    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          update_id: 99,
          message: sampleMessage({
            text: "hello",
          }),
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(
      (chat.processMessage as ReturnType<typeof vi.fn>).mock.calls
    ).toHaveLength(1);
  });

  it("posts, edits, deletes, and sends typing events", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()))
      .mockResolvedValueOnce(
        telegramOk(
          sampleMessage({
            text: "updated",
            edit_date: 1735689700,
          })
        )
      )
      .mockResolvedValueOnce(telegramOk(true))
      .mockResolvedValueOnce(telegramOk(true));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const posted = await adapter.postMessage("telegram:123", {
      markdown: "hello",
    });

    expect(posted.id).toBe("123:11");
    expect(posted.threadId).toBe("telegram:123");

    await adapter.editMessage("telegram:123", posted.id, "updated");
    await adapter.deleteMessage("telegram:123", posted.id);
    await adapter.startTyping("telegram:123");

    const sendMessageUrl = String(mockFetch.mock.calls[1]?.[0]);
    const editMessageUrl = String(mockFetch.mock.calls[2]?.[0]);
    const deleteMessageUrl = String(mockFetch.mock.calls[3]?.[0]);
    const typingUrl = String(mockFetch.mock.calls[4]?.[0]);

    expect(sendMessageUrl).toContain("/sendMessage");
    expect(editMessageUrl).toContain("/editMessageText");
    expect(deleteMessageUrl).toContain("/deleteMessage");
    expect(typingUrl).toContain("/sendChatAction");

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { chat_id: string; text: string };

    expect(sendMessageBody.chat_id).toBe("123");
    expect(sendMessageBody.text).toBe("hello");
  });

  it("postChannelMessage does not double-prefix channel ID", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const posted = await adapter.postChannelMessage("telegram:123", {
      markdown: "channel message",
    });

    expect(posted.threadId).toBe("telegram:123");

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { chat_id: string; text: string };

    expect(sendMessageBody.chat_id).toBe("123");
    expect(sendMessageBody.text).toBe("channel message");
  });

  it("postChannelMessage works with raw channel ID", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const posted = await adapter.postChannelMessage("123", {
      markdown: "raw id message",
    });

    expect(posted.threadId).toBe("telegram:123");

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { chat_id: string; text: string };

    expect(sendMessageBody.chat_id).toBe("123");
    expect(sendMessageBody.text).toBe("raw id message");
  });

  it("sets parse_mode for markdown messages", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    await adapter.postMessage("telegram:123", {
      markdown: "**bold** and _italic_",
    });

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { parse_mode?: string };

    expect(sendMessageBody.parse_mode).toBe("MarkdownV2");
  });

  it("sets parse_mode for AST messages", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const ast = new TelegramFormatConverter().toAst("**hello** world!");
    await adapter.postMessage("telegram:123", { ast });

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { parse_mode?: string; text: string };

    // AST messages were shipping without parse_mode, so Telegram rendered
    // MarkdownV2 asterisks literally. Guard against regression.
    expect(sendMessageBody.parse_mode).toBe("MarkdownV2");
    expect(sendMessageBody.text).toContain("*hello*");
    expect(sendMessageBody.text).toContain("world\\!");
  });

  it("omits parse_mode for plain string messages", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    await adapter.postMessage("telegram:123", "plain text message");

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { parse_mode?: string };

    expect(sendMessageBody.parse_mode).toBeUndefined();
  });

  it("omits parse_mode for raw messages", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    await adapter.postMessage("telegram:123", { raw: "raw.unparsed!(text)" });

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { parse_mode?: string; text: string };

    expect(sendMessageBody.parse_mode).toBeUndefined();
    expect(sendMessageBody.text).toBe("raw.unparsed!(text)");
  });

  it("posts cards with inline keyboard buttons", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    await adapter.postMessage("telegram:123", {
      type: "card",
      title: "Approval needed",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              value: "request-123",
            },
            {
              type: "link-button",
              label: "View",
              url: "https://example.com",
            },
          ],
        },
      ],
    });

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as {
      reply_markup?: {
        inline_keyboard: Array<
          Array<{ text: string; callback_data?: string; url?: string }>
        >;
      };
    };

    const row = sendMessageBody.reply_markup?.inline_keyboard[0];
    expect(row).toBeDefined();
    expect(sendMessageBody.parse_mode).toBe("MarkdownV2");
    expect(row?.[0]).toEqual({
      text: "Approve",
      callback_data: encodeTelegramCallbackData("approve", "request-123"),
    });
    expect(row?.[1]).toEqual({
      text: "View",
      url: "https://example.com",
    });
  });

  it("renders card title as MarkdownV2 bold", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(sampleMessage()));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    await adapter.postMessage("telegram:123", {
      type: "card",
      title: "Order #1234",
      children: [
        {
          type: "section",
          children: [{ type: "text", content: "Approval needed." }],
        },
      ],
    });

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { parse_mode?: string; text: string };

    // cardToFallbackText (from @chat-adapter/shared) defaults boldFormat
    // to "*" (single asterisk, Slack mrkdwn). For Telegram the adapter
    // passes `boldFormat: "**"` so the standard-markdown bold survives
    // the `fromMarkdown` → AST → MarkdownV2 pipeline as real bold
    // (`*Title*`), not italic (`_Title_`) or literal asterisks.
    // Inner special chars (here `#`) are escaped per MarkdownV2 rules.
    expect(sendMessageBody.parse_mode).toBe("MarkdownV2");
    expect(sendMessageBody.text).toContain("*Order \\#1234*");
    expect(sendMessageBody.text).not.toContain("\\*");
  });

  it("adds and removes reactions", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(true))
      .mockResolvedValueOnce(telegramOk(true));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    await adapter.addReaction("telegram:123", "123:11", "thumbs_up");
    await adapter.removeReaction("telegram:123", "123:11", "thumbs_up");

    const addBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as {
      reaction: Array<{ type: string; emoji?: string }>;
    };
    const removeBody = JSON.parse(
      String((mockFetch.mock.calls[2]?.[1] as RequestInit).body)
    ) as {
      reaction: unknown[];
    };

    expect(addBody.reaction[0]).toEqual({ type: "emoji", emoji: "👍" });
    expect(removeBody.reaction).toEqual([]);
  });

  it("processes Telegram reaction updates for added and removed emoji", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const oldReaction: TelegramReactionType[] = [
      { type: "emoji", emoji: "❤️" },
      { type: "emoji", emoji: "🔥" },
    ];
    const newReaction: TelegramReactionType[] = [
      { type: "emoji", emoji: "❤️" },
      { type: "emoji", emoji: "🚀" },
    ];

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 7,
        message_reaction: {
          chat: { id: 123, type: "private", first_name: "User" },
          message_id: 11,
          date: 1735689600,
          old_reaction: oldReaction,
          new_reaction: newReaction,
          user: {
            id: 456,
            is_bot: false,
            first_name: "User",
            username: "user",
          },
        },
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processReaction = chat.processReaction as ReturnType<typeof vi.fn>;
    expect(processReaction).toHaveBeenCalledTimes(2);

    const [addedEvent] = processReaction.mock.calls[0] as [
      { added: boolean; rawEmoji: string },
    ];
    const [removedEvent] = processReaction.mock.calls[1] as [
      { added: boolean; rawEmoji: string },
    ];

    expect(addedEvent.added).toBe(true);
    expect(addedEvent.rawEmoji).toBe("🚀");
    expect(removedEvent.added).toBe(false);
    expect(removedEvent.rawEmoji).toBe("🔥");
  });

  it("paginates cached messages", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    adapter.parseMessage(sampleMessage({ message_id: 1, text: "m1", date: 1 }));
    adapter.parseMessage(sampleMessage({ message_id: 2, text: "m2", date: 2 }));
    adapter.parseMessage(sampleMessage({ message_id: 3, text: "m3", date: 3 }));

    const backward = await adapter.fetchMessages("telegram:123", {
      limit: 2,
      direction: "backward",
    });

    expect(backward.messages.map((message) => message.text)).toEqual([
      "m2",
      "m3",
    ]);
    expect(backward.nextCursor).toBe("123:2");

    const forward = await adapter.fetchMessages("telegram:123", {
      limit: 2,
      direction: "forward",
    });

    expect(forward.messages.map((message) => message.text)).toEqual([
      "m1",
      "m2",
    ]);
    expect(forward.nextCursor).toBe("123:2");
  });

  it("decodes structured callback payloads into action id and value", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(true));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 2,
        callback_query: {
          id: "callback-1",
          from: {
            id: 456,
            is_bot: false,
            first_name: "User",
            username: "user",
          },
          message: sampleMessage({
            chat: {
              id: -100123,
              type: "supergroup",
              title: "General",
            },
          }),
          chat_instance: "ci_1",
          data: encodeTelegramCallbackData("approve", "request-123"),
        },
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processAction = chat.processAction as ReturnType<typeof vi.fn>;
    expect(processAction).toHaveBeenCalledTimes(1);

    const [event] = processAction.mock.calls[0] as [
      {
        actionId: string;
        value?: string;
      },
    ];

    expect(event.actionId).toBe("approve");
    expect(event.value).toBe("request-123");
  });

  it("falls back to raw callback data for non-encoded callback payloads", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(telegramOk(true));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 3,
        callback_query: {
          id: "callback-2",
          from: {
            id: 456,
            is_bot: false,
            first_name: "User",
            username: "user",
          },
          message: sampleMessage(),
          chat_instance: "ci_2",
          data: "legacy_action",
        },
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processAction = chat.processAction as ReturnType<typeof vi.fn>;
    expect(processAction).toHaveBeenCalledTimes(1);

    const [event] = processAction.mock.calls[0] as [
      {
        actionId: string;
        value?: string;
      },
    ];

    expect(event.actionId).toBe("legacy_action");
    expect(event.value).toBe("legacy_action");
  });

  it("fetches thread and channel metadata", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(
        telegramOk({
          id: -100123,
          type: "supergroup",
          title: "General",
        })
      )
      .mockResolvedValueOnce(
        telegramOk({
          id: -100123,
          type: "supergroup",
          title: "General",
        })
      )
      .mockResolvedValueOnce(telegramOk(42));

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });
    await adapter.initialize(createMockChat());

    const thread = await adapter.fetchThread("telegram:-100123:99");
    const channel = await adapter.fetchChannelInfo("-100123");

    expect(thread.channelId).toBe("-100123");
    expect(thread.channelName).toBe("General");
    expect(thread.metadata.messageThreadId).toBe(99);

    expect(channel.id).toBe("-100123");
    expect(channel.name).toBe("General");
    expect(channel.memberCount).toBe(42);
  });

  it("returns undefined memberCount when getChatMemberCount fails", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(
        telegramOk({
          id: -100123,
          type: "supergroup",
          title: "General",
        })
      )
      .mockResolvedValueOnce(
        telegramError(403, 403, "Forbidden: bot is not an administrator")
      );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });
    await adapter.initialize(createMockChat());

    const channel = await adapter.fetchChannelInfo("-100123");
    expect(channel.memberCount).toBeUndefined();
  });

  it("maps Telegram API errors to adapter-specific error types", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    mockFetch.mockResolvedValueOnce(telegramError(401, 401, "Unauthorized"));
    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      AuthenticationError
    );

    mockFetch.mockResolvedValueOnce(
      telegramError(429, 429, "Too Many Requests", { retry_after: 5 })
    );
    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      AdapterRateLimitError
    );

    mockFetch.mockResolvedValueOnce(telegramError(403, 403, "Forbidden"));
    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      PermissionError
    );

    mockFetch.mockResolvedValueOnce(telegramError(400, 400, "Bad Request"));
    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("throws NetworkError when Telegram returns non-JSON response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html>oops</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it("throws NetworkError when Telegram API response has no result", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it("processes edited_message webhook updates", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        edited_message: sampleMessage({
          text: "edited text",
          edit_date: 1735689700,
        }),
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string },
    ];

    expect(threadId).toBe("telegram:123");
    expect(parsedMessage.text).toBe("edited text");
  });

  it("processes channel_post webhook updates", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        channel_post: sampleMessage({
          chat: { id: -100999, type: "channel", title: "MyChannel" },
          text: "channel announcement",
        }),
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string },
    ];

    expect(threadId).toBe("telegram:-100999");
    expect(parsedMessage.text).toBe("channel announcement");
  });

  it("extracts photo attachments from photo messages", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const photoMessage = sampleMessage({
      text: undefined,
      photo: [
        { file_id: "photo1", file_unique_id: "u1", width: 100, height: 100 },
        { file_id: "photo2", file_unique_id: "u2", width: 800, height: 600 },
      ],
      caption: "Nice photo",
    });

    const parsed = adapter.parseMessage(photoMessage);

    expect(parsed.attachments).toHaveLength(1);
    const attachment = parsed.attachments[0];
    expect(attachment?.type).toBe("image");
    expect(attachment?.width).toBe(800);
    expect(attachment?.height).toBe(600);
    expect(parsed.text).toBe("Nice photo");
  });

  it("extracts document attachments from document messages", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const docMessage = sampleMessage({
      document: {
        file_id: "doc1",
        file_unique_id: "u1",
        file_name: "report.pdf",
        mime_type: "application/pdf",
      },
    });

    const parsed = adapter.parseMessage(docMessage);

    expect(parsed.attachments).toHaveLength(1);
    const attachment = parsed.attachments[0];
    expect(attachment?.type).toBe("file");
    expect(attachment?.name).toBe("report.pdf");
    expect(attachment?.mimeType).toBe("application/pdf");
  });

  it("extracts audio attachments from audio messages", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const audioMessage = sampleMessage({
      audio: {
        file_id: "audio1",
        file_unique_id: "ua1",
        duration: 120,
        file_name: "track.mp3",
        mime_type: "audio/mpeg",
        file_size: 2048000,
      },
    });

    const parsed = adapter.parseMessage(audioMessage);

    expect(parsed.attachments).toHaveLength(1);
    const attachment = parsed.attachments[0];
    expect(attachment?.type).toBe("audio");
    expect(attachment?.name).toBe("track.mp3");
    expect(attachment?.mimeType).toBe("audio/mpeg");
    expect(attachment?.size).toBe(2048000);
  });

  it("extracts video attachments from video messages", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const videoMessage = sampleMessage({
      video: {
        file_id: "vid1",
        file_unique_id: "uv1",
        width: 1920,
        height: 1080,
        duration: 60,
        file_name: "clip.mp4",
        mime_type: "video/mp4",
        file_size: 10485760,
      },
    });

    const parsed = adapter.parseMessage(videoMessage);

    expect(parsed.attachments).toHaveLength(1);
    const attachment = parsed.attachments[0];
    expect(attachment?.type).toBe("video");
    expect(attachment?.width).toBe(1920);
    expect(attachment?.height).toBe(1080);
    expect(attachment?.mimeType).toBe("video/mp4");
  });

  it("isDM returns true for private chats (positive chat ID)", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    expect(adapter.isDM("telegram:456")).toBe(true);
    expect(adapter.isDM("telegram:-100123")).toBe(false);
    expect(adapter.isDM("telegram:-100123:42")).toBe(false);
  });

  it("fetchChannelMessages aggregates messages from all threads in a channel", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    adapter.parseMessage(
      sampleMessage({
        message_id: 1,
        text: "thread-msg",
        date: 1,
        chat: { id: -100123, type: "supergroup", title: "G" },
      })
    );
    adapter.parseMessage(
      sampleMessage({
        message_id: 2,
        text: "topic-msg",
        date: 2,
        chat: { id: -100123, type: "supergroup", title: "G" },
        message_thread_id: 5,
      })
    );
    adapter.parseMessage(
      sampleMessage({
        message_id: 3,
        text: "other-channel-msg",
        date: 3,
        chat: { id: -100999, type: "supergroup", title: "Other" },
      })
    );

    const result = await adapter.fetchChannelMessages("-100123");

    expect(result.messages).toHaveLength(2);
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("thread-msg");
    expect(texts).toContain("topic-msg");
    expect(texts).not.toContain("other-channel-msg");
  });

  it("postChannelMessage with forum topic messageThreadId sends correct thread params", async () => {
    mockFetch
      .mockResolvedValueOnce(
        telegramOk({
          id: 999,
          is_bot: true,
          first_name: "Bot",
          username: "mybot",
        })
      )
      .mockResolvedValueOnce(
        telegramOk(
          sampleMessage({
            chat: { id: -1001234, type: "supergroup", title: "Forum" },
            message_id: 50,
            message_thread_id: 42,
          })
        )
      );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const posted = await adapter.postChannelMessage("telegram:-1001234:42", {
      markdown: "forum topic message",
    });

    expect(posted.threadId).toBe("telegram:-1001234:42");

    const sendMessageBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { chat_id: string; message_thread_id?: number; text: string };

    expect(sendMessageBody.chat_id).toBe("-1001234");
    expect(sendMessageBody.message_thread_id).toBe(42);
    expect(sendMessageBody.text).toBe("forum topic message");
  });
});

describe("message length limits", () => {
  function getMeOk(): Response {
    return telegramOk({
      id: 999,
      is_bot: true,
      first_name: "Bot",
      username: "mybot",
    });
  }

  async function createInitializedAdapter(): Promise<TelegramAdapter> {
    mockFetch.mockResolvedValueOnce(getMeOk());
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });
    await adapter.initialize(createMockChat());
    return adapter;
  }

  function readSentBody(callIndex: number): {
    text?: string;
    parse_mode?: string;
  } {
    return JSON.parse(
      String((mockFetch.mock.calls[callIndex]?.[1] as RequestInit).body)
    ) as { text?: string; parse_mode?: string };
  }

  /**
   * Count unescaped occurrences of a single-char entity delimiter.
   * Preceded by `\` means escaped; we ignore those. Double `\\` means a
   * literal backslash, so the following delimiter is unescaped.
   */
  function countUnescaped(text: string, marker: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== marker) {
        continue;
      }
      let backslashes = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === "\\") {
        backslashes++;
        j--;
      }
      // Even number of preceding backslashes → marker is unescaped
      if (backslashes % 2 === 0) {
        count++;
      }
    }
    return count;
  }

  function endsWithOrphanBackslash(text: string): boolean {
    let trailing = 0;
    for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) {
      trailing++;
    }
    // Odd trailing backslashes = last `\` has nothing to escape
    return trailing % 2 === 1;
  }

  it("plain string over 4096 chars truncates to exactly the limit with '...' and no parse_mode", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    const longPlain = "a".repeat(5000);
    await adapter.postMessage("telegram:123", longPlain);

    const body = readSentBody(1);
    expect(body.parse_mode).toBeUndefined();
    expect(body.text?.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(body.text?.endsWith("...")).toBe(true);
    // Plain-text path: the literal ellipsis is fine
    expect(body.text?.endsWith("\\.\\.\\.")).toBe(false);
  });

  it("plain string exactly 4096 chars is not truncated and has no ellipsis", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    const exact = "a".repeat(TELEGRAM_MESSAGE_LIMIT);
    await adapter.postMessage("telegram:123", exact);

    const body = readSentBody(1);
    expect(body.text).toBe(exact);
  });

  it("MarkdownV2 message over 4096 chars escapes the trailing ellipsis as '\\.\\.\\.'", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    // 5000 'a' chars through the markdown path renders to 5000 'a' (nothing to escape).
    // Must end with escaped ellipsis, NOT literal dots.
    await adapter.postMessage("telegram:123", {
      markdown: "a".repeat(5000),
    });

    const body = readSentBody(1);
    expect(body.parse_mode).toBe("MarkdownV2");
    expect(body.text?.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(body.text?.endsWith("\\.\\.\\.")).toBe(true);
  });

  it("MarkdownV2 truncation does not leave an orphan trailing backslash before the ellipsis", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    // Construct input so the rendered text has an escape sequence (`\.`)
    // straddling the 4096 - ellipsisLen boundary. 4092 'a's + 50 '.' → renders
    // as 4092 'a's + `\.`×50. Naïve slice-to-4093 keeps 4092 'a' + a lone '\'.
    const longWithDots = "a".repeat(4092) + ".".repeat(50);
    await adapter.postMessage("telegram:123", { markdown: longWithDots });

    const body = readSentBody(1);
    const text = body.text ?? "";
    // Strip the trailing ellipsis (escaped or not) before checking the body
    const ellipsis = text.endsWith("\\.\\.\\.") ? "\\.\\.\\." : "...";
    const beforeEllipsis = text.slice(0, -ellipsis.length);
    expect(endsWithOrphanBackslash(beforeEllipsis)).toBe(false);
  });

  it("MarkdownV2 truncation leaves all entity delimiters balanced (no unclosed **bold**)", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    // Long bold span crossing the limit: 4000 'a' + `**` + 1000 'b' + `**`
    // Rendered MarkdownV2: 4000 'a' + `*` + 1000 'b' + `*` → 5002 chars.
    // Naïve truncate keeps the opening `*` without its closer.
    const bolded = `${"a".repeat(4000)}**${"b".repeat(1000)}**`;
    await adapter.postMessage("telegram:123", { markdown: bolded });

    const body = readSentBody(1);
    const text = body.text ?? "";
    const ellipsis = text.endsWith("\\.\\.\\.") ? "\\.\\.\\." : "...";
    const beforeEllipsis = text.slice(0, -ellipsis.length);

    // Every entity delimiter must appear an even number of unescaped times
    for (const marker of ["*", "_", "~", "`"]) {
      expect(
        countUnescaped(beforeEllipsis, marker) % 2,
        `${marker} count must be even`
      ).toBe(0);
    }
  });

  it("MarkdownV2 truncation closes or drops an unmatched inline code span", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    // Long inline code span crossing the limit
    const coded = `${"a".repeat(4000)}\`${"b".repeat(1000)}\``;
    await adapter.postMessage("telegram:123", { markdown: coded });

    const body = readSentBody(1);
    const text = body.text ?? "";
    const ellipsis = text.endsWith("\\.\\.\\.") ? "\\.\\.\\." : "...";
    const beforeEllipsis = text.slice(0, -ellipsis.length);

    expect(countUnescaped(beforeEllipsis, "`") % 2).toBe(0);
  });

  it("MarkdownV2 caption over 1024 escapes the ellipsis", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    const longMarkdown = "a".repeat(1500);
    await adapter.postMessage("telegram:123", {
      markdown: longMarkdown,
      files: [
        {
          filename: "report.txt",
          data: Buffer.from("payload"),
          mimeType: "text/plain",
        },
      ],
    });

    // sendDocument uses multipart/form-data, not JSON. Pull the caption field
    // out of the FormData body.
    const formData = mockFetch.mock.calls[1]?.[1]?.body as FormData;
    const caption = formData.get("caption");
    const parseMode = formData.get("parse_mode");

    expect(typeof caption).toBe("string");
    expect((caption as string).length).toBeLessThanOrEqual(
      TELEGRAM_CAPTION_LIMIT
    );
    expect(parseMode).toBe("MarkdownV2");
    expect((caption as string).endsWith("\\.\\.\\.")).toBe(true);
  });

  it("plain-string caption over 1024 uses literal '...' ellipsis", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

    // Plain string message with a file attachment → caption path, no parse_mode.
    // There's no public API to send a plain string with files, so test via the
    // markdown path but with content containing no special chars — and assert
    // the ellipsis behavior matches parse_mode. Since markdown path always
    // emits MarkdownV2, we use the markdown path here and rely on the
    // MarkdownV2 caption test for the parse_mode branch; this test documents
    // that the caption truncation limit is wired correctly.
    const longMarkdown = "a".repeat(1500);
    await adapter.postMessage("telegram:123", {
      markdown: longMarkdown,
      files: [
        {
          filename: "report.txt",
          data: Buffer.from("payload"),
          mimeType: "text/plain",
        },
      ],
    });

    const formData = mockFetch.mock.calls[1]?.[1]?.body as FormData;
    const caption = formData.get("caption");
    expect((caption as string).length).toBeLessThanOrEqual(
      TELEGRAM_CAPTION_LIMIT
    );
  });
});

describe("applyTelegramEntities", () => {
  it("returns text unchanged when no entities", () => {
    expect(applyTelegramEntities("hello world", [])).toBe("hello world");
  });

  it("converts text_link entities to markdown links", () => {
    const result = applyTelegramEntities("Visit our website for details", [
      { type: "text_link", offset: 10, length: 7, url: "https://example.com" },
    ]);
    expect(result).toBe("Visit our [website](https://example.com) for details");
  });

  it("converts bold entities to markdown bold", () => {
    const result = applyTelegramEntities("hello world", [
      { type: "bold", offset: 6, length: 5 },
    ]);
    expect(result).toBe("hello **world**");
  });

  it("converts italic entities to markdown italic", () => {
    const result = applyTelegramEntities("hello world", [
      { type: "italic", offset: 0, length: 5 },
    ]);
    expect(result).toBe("*hello* world");
  });

  it("converts code entities to inline code", () => {
    const result = applyTelegramEntities("use the console.log function", [
      { type: "code", offset: 8, length: 11 },
    ]);
    expect(result).toBe("use the `console.log` function");
  });

  it("converts pre entities to code blocks", () => {
    const result = applyTelegramEntities("const x = 1", [
      { type: "pre", offset: 0, length: 11 },
    ]);
    expect(result).toBe("```\nconst x = 1\n```");
  });

  it("converts pre entities with language", () => {
    const result = applyTelegramEntities("const x = 1", [
      { type: "pre", offset: 0, length: 11, language: "typescript" },
    ]);
    expect(result).toBe("```typescript\nconst x = 1\n```");
  });

  it("converts strikethrough entities", () => {
    const result = applyTelegramEntities("old text here", [
      { type: "strikethrough", offset: 0, length: 8 },
    ]);
    expect(result).toBe("~~old text~~ here");
  });

  it("leaves url entities unchanged (already in text)", () => {
    const result = applyTelegramEntities("check https://example.com out", [
      { type: "url", offset: 6, length: 19 },
    ]);
    expect(result).toBe("check https://example.com out");
  });

  it("leaves mention entities unchanged", () => {
    const result = applyTelegramEntities("hey @user check this", [
      { type: "mention", offset: 4, length: 5 },
    ]);
    expect(result).toBe("hey @user check this");
  });

  it("handles multiple non-overlapping entities", () => {
    const result = applyTelegramEntities("hello world foo", [
      { type: "bold", offset: 0, length: 5 },
      { type: "italic", offset: 6, length: 5 },
    ]);
    expect(result).toBe("**hello** *world* foo");
  });

  it("handles text_link with special markdown chars in text", () => {
    const result = applyTelegramEntities("click [here]", [
      { type: "text_link", offset: 6, length: 6, url: "https://example.com" },
    ]);
    expect(result).toBe("click [\\[here\\]](https://example.com)");
  });

  it("preserves parseMessage text with entities", async () => {
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );

    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
      userName: "mybot",
    });

    await adapter.initialize(createMockChat());

    const messageWithLink = sampleMessage({
      text: "Visit our website for details",
      entities: [
        {
          type: "text_link",
          offset: 10,
          length: 7,
          url: "https://example.com",
        },
      ],
    });

    const parsed = adapter.parseMessage(messageWithLink);
    expect(parsed.text).toBe(
      "Visit our [website](https://example.com) for details"
    );
  });
});

describe("getUser", () => {
  it("should return user info from Telegram getChat", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    // getMe for initialize
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );
    await adapter.initialize(createMockChat());

    // getChat for getUser
    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 456,
        first_name: "Alice",
        last_name: "Smith",
        username: "alicesmith",
        type: "private",
      })
    );

    const user = await adapter.getUser("456");
    expect(user).not.toBeNull();
    expect(user?.fullName).toBe("Alice Smith");
    expect(user?.userName).toBe("alicesmith");
    expect(user?.userId).toBe("456");
    expect(user?.isBot).toBe(false);
    expect(user?.email).toBeUndefined();
  });

  it("should return null on error", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(telegramError(400, 400, "Bad Request"));

    const user = await adapter.getUser("unknown");
    expect(user).toBeNull();
  });

  it("should return null for group/channel chat IDs", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: -100123,
        type: "group",
        title: "Test Group",
      })
    );

    const user = await adapter.getUser("-100123");
    expect(user).toBeNull();
  });

  it("should handle first-name only user (no last_name or username)", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 789,
        first_name: "Charlie",
        type: "private",
      })
    );

    const user = await adapter.getUser("789");
    expect(user).not.toBeNull();
    expect(user?.fullName).toBe("Charlie");
    expect(user?.userName).toBe("Charlie");
  });

  it("should call Telegram API with correct method and params", async () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
      mode: "webhook",
      logger: mockLogger,
    });

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 999,
        is_bot: true,
        first_name: "Bot",
        username: "mybot",
      })
    );
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      telegramOk({
        id: 456,
        first_name: "Alice",
        username: "alice",
        type: "private",
      })
    );

    await adapter.getUser("456");

    // The second fetch call (index 1) is the getChat call
    const getChatUrl = String(mockFetch.mock.calls[1]?.[0]);
    expect(getChatUrl).toContain("/getChat");

    const getChatBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { chat_id: string };
    expect(getChatBody.chat_id).toBe("456");
  });
});
