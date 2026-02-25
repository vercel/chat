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
  createTelegramAdapter,
  TelegramAdapter,
  type TelegramMessage,
  type TelegramReactionType,
} from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
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

function createMockChat(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("mybot"),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
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

describe("TelegramAdapter", () => {
  it("encodes and decodes thread IDs", () => {
    const adapter = createTelegramAdapter({
      botToken: "token",
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
    expect(sendMessageBody.parse_mode).toBe("Markdown");
    expect(row?.[0]).toEqual({
      text: "Approve",
      callback_data: encodeTelegramCallbackData("approve", "request-123"),
    });
    expect(row?.[1]).toEqual({
      text: "View",
      url: "https://example.com",
    });
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
      logger: mockLogger,
      userName: "mybot",
    });

    await expect(adapter.startTyping("telegram:123")).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});
