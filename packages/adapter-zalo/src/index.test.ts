import {
  AdapterError,
  AdapterRateLimitError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZaloAdapter, splitMessage, ZaloAdapter } from "./index";
import type { ZaloInboundMessage } from "./types";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

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

function zaloOk<T>(result: T): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function zaloError(
  status: number,
  errorCode: number,
  description: string
): Response {
  return new Response(
    JSON.stringify({ ok: false, error_code: errorCode, description }),
    { status, headers: { "content-type": "application/json" } }
  );
}

function createMockChat(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("zalo-bot"),
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

function sampleInboundMessage(
  overrides?: Partial<ZaloInboundMessage>
): ZaloInboundMessage {
  return {
    message_id: "msg-001",
    date: 1735689600000,
    chat: { id: "chat-123", chat_type: "PRIVATE" },
    from: { id: "user-456", display_name: "Alice", is_bot: false },
    text: "Hello",
    ...overrides,
  };
}

const getMeResponse = {
  id: "bot-999",
  account_name: "my-zalo-bot",
  account_type: "OA",
  can_join_groups: false,
};

function createAdapter(overrides?: {
  botToken?: string;
  webhookSecret?: string;
}) {
  return new ZaloAdapter({
    botToken: overrides?.botToken ?? "test-token",
    webhookSecret: overrides?.webhookSecret ?? "super-secret",
    userName: "zalo-bot",
    logger: mockLogger,
  });
}

async function createInitializedAdapter() {
  const adapter = createAdapter();
  mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
  await adapter.initialize(createMockChat());
  // Reset so subsequent tests start with a clean call history
  mockFetch.mockReset();
  return adapter;
}

// ---------------------------------------------------------------------------
// createZaloAdapter
// ---------------------------------------------------------------------------

describe("createZaloAdapter", () => {
  let savedToken: string | undefined;
  let savedSecret: string | undefined;
  let savedUsername: string | undefined;

  beforeEach(() => {
    savedToken = process.env.ZALO_BOT_TOKEN;
    savedSecret = process.env.ZALO_WEBHOOK_SECRET;
    savedUsername = process.env.ZALO_BOT_USERNAME;
  });

  afterEach(() => {
    if (savedToken === undefined) {
      Reflect.deleteProperty(process.env, "ZALO_BOT_TOKEN");
    } else {
      process.env.ZALO_BOT_TOKEN = savedToken;
    }
    if (savedSecret === undefined) {
      Reflect.deleteProperty(process.env, "ZALO_WEBHOOK_SECRET");
    } else {
      process.env.ZALO_WEBHOOK_SECRET = savedSecret;
    }
    if (savedUsername === undefined) {
      Reflect.deleteProperty(process.env, "ZALO_BOT_USERNAME");
    } else {
      process.env.ZALO_BOT_USERNAME = savedUsername;
    }
  });

  it("throws when botToken is missing", () => {
    Reflect.deleteProperty(process.env, "ZALO_BOT_TOKEN");
    Reflect.deleteProperty(process.env, "ZALO_WEBHOOK_SECRET");
    expect(() => createZaloAdapter()).toThrow(ValidationError);
  });

  it("throws when webhookSecret is missing", () => {
    process.env.ZALO_BOT_TOKEN = "some-token";
    Reflect.deleteProperty(process.env, "ZALO_WEBHOOK_SECRET");
    expect(() => createZaloAdapter()).toThrow(ValidationError);
  });

  it("uses env vars when config omitted", () => {
    process.env.ZALO_BOT_TOKEN = "env-token";
    process.env.ZALO_WEBHOOK_SECRET = "env-secret";
    const adapter = createZaloAdapter();
    expect(adapter).toBeInstanceOf(ZaloAdapter);
  });

  it("uses config values over env vars", () => {
    process.env.ZALO_BOT_TOKEN = "env-token";
    process.env.ZALO_WEBHOOK_SECRET = "env-secret";
    const adapter = createZaloAdapter({
      botToken: "cfg-token",
      webhookSecret: "cfg-secret",
    });
    expect(adapter).toBeInstanceOf(ZaloAdapter);
    expect(adapter.userName).toBe("zalo-bot");
  });

  it("defaults userName to 'zalo-bot' when env var not set", () => {
    process.env.ZALO_BOT_TOKEN = "tok";
    process.env.ZALO_WEBHOOK_SECRET = "sec";
    Reflect.deleteProperty(process.env, "ZALO_BOT_USERNAME");
    const adapter = createZaloAdapter();
    expect(adapter.userName).toBe("zalo-bot");
  });

  it("reads ZALO_BOT_USERNAME from env", () => {
    process.env.ZALO_BOT_TOKEN = "tok";
    process.env.ZALO_WEBHOOK_SECRET = "sec";
    process.env.ZALO_BOT_USERNAME = "my-custom-bot";
    const adapter = createZaloAdapter();
    expect(adapter.userName).toBe("my-custom-bot");
  });
});

// ---------------------------------------------------------------------------
// Thread ID
// ---------------------------------------------------------------------------

describe("ZaloAdapter — thread ID", () => {
  const adapter = createAdapter();

  it("botUserId returns undefined before initialize", () => {
    expect(adapter.botUserId).toBeUndefined();
  });

  it("encodes thread ID", () => {
    expect(adapter.encodeThreadId({ chatId: "chat-123" })).toBe(
      "zalo:chat-123"
    );
  });

  it("decodes thread ID", () => {
    expect(adapter.decodeThreadId("zalo:chat-123")).toEqual({
      chatId: "chat-123",
    });
  });

  it("throws on invalid thread ID prefix", () => {
    expect(() => adapter.decodeThreadId("slack:foo")).toThrow(ValidationError);
  });

  it("throws on empty chatId", () => {
    expect(() => adapter.decodeThreadId("zalo:")).toThrow(ValidationError);
  });

  it("channelIdFromThreadId returns threadId unchanged", () => {
    expect(adapter.channelIdFromThreadId("zalo:abc")).toBe("zalo:abc");
  });

  it("isDM always returns true", () => {
    expect(adapter.isDM("zalo:chat-123")).toBe(true);
    expect(adapter.isDM("zalo:anything")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe("ZaloAdapter — initialize", () => {
  it("calls getMe and stores botUserId", async () => {
    const adapter = createAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
    await adapter.initialize(createMockChat());
    expect(adapter.botUserId).toBe("bot-999");
  });

  it("throws AdapterError when getMe fails with HTTP error", async () => {
    const adapter = createAdapter();
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );
    await expect(adapter.initialize(createMockChat())).rejects.toThrow(
      AdapterError
    );
  });
});

// ---------------------------------------------------------------------------
// handleWebhook
// ---------------------------------------------------------------------------

describe("ZaloAdapter — handleWebhook", () => {
  function makeRequest(
    body: string,
    secretHeader?: string,
    method = "POST"
  ): Request {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (secretHeader !== undefined) {
      headers["x-bot-api-secret-token"] = secretHeader;
    }
    return new Request("https://example.com/webhook", {
      method,
      headers,
      body,
    });
  }

  function textEvent(
    eventName: string,
    overrides?: Partial<ZaloInboundMessage>
  ): string {
    return JSON.stringify({
      event_name: eventName,
      message: sampleInboundMessage(overrides),
    });
  }

  it("returns 401 for missing secret token", async () => {
    const adapter = await createInitializedAdapter();
    const req = makeRequest(textEvent("message.text.received"));
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong secret token", async () => {
    const adapter = await createInitializedAdapter();
    const req = makeRequest(textEvent("message.text.received"), "wrong-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const adapter = await createInitializedAdapter();
    const req = makeRequest("not-json", "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(400);
  });

  it("dispatches text message and returns 200", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
    await adapter.initialize(chat);
    mockFetch.mockReset();

    const req = makeRequest(textEvent("message.text.received"), "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId] = (chat.processMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(threadId).toBe("zalo:chat-123");
  });

  it("dispatches image message", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
    await adapter.initialize(chat);

    const body = JSON.stringify({
      event_name: "message.image.received",
      message: sampleInboundMessage({
        photo: "https://img.example.com/1.jpg",
        text: undefined,
      }),
    });
    const req = makeRequest(body, "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledOnce();
  });

  it("dispatches sticker message", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
    await adapter.initialize(chat);

    const body = JSON.stringify({
      event_name: "message.sticker.received",
      message: sampleInboundMessage({ sticker: "sticker-id", text: undefined }),
    });
    const req = makeRequest(body, "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledOnce();
  });

  it("ignores unsupported messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
    await adapter.initialize(chat);

    const body = JSON.stringify({
      event_name: "message.unsupported.received",
      message: sampleInboundMessage(),
    });
    const req = makeRequest(body, "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("ignores unknown events", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    mockFetch.mockResolvedValueOnce(zaloOk(getMeResponse));
    await adapter.initialize(chat);

    const body = JSON.stringify({
      event_name: "some.other.event",
      message: sampleInboundMessage(),
    });
    const req = makeRequest(body, "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 200 when JSON.parse returns null/falsy", async () => {
    const adapter = await createInitializedAdapter();
    // JSON.stringify(null) === "null" which parses to null (falsy)
    const req = makeRequest("null", "super-secret");
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
  });

  it("verifySecretToken catches error for mismatched-length secrets", async () => {
    // timingSafeEqual throws when buffer lengths differ — adapter should return 401, not throw
    const adapter = await createInitializedAdapter();
    const req = makeRequest(
      JSON.stringify({
        event_name: "message.text.received",
        message: sampleInboundMessage(),
      }),
      "short" // length differs from "super-secret" (12) — timingSafeEqual throws
    );
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(401);
  });

  it("ignores message dispatch when chat not initialized", async () => {
    // handleInboundMessage guard: chat === null
    const adapter = createAdapter();
    // Do NOT call initialize — chat remains null
    const body = JSON.stringify({
      event_name: "message.text.received",
      message: sampleInboundMessage(),
    });
    const req = makeRequest(body, "super-secret");
    // Should still return 200 (webhook handling is separate from dispatch)
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe("ZaloAdapter — parseMessage", () => {
  it("parses text message", async () => {
    const adapter = await createInitializedAdapter();
    const raw = { message: sampleInboundMessage({ text: "Hello world" }) };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("Hello world");
    expect(msg.attachments).toHaveLength(0);
  });

  it("parses image message with caption", async () => {
    const adapter = await createInitializedAdapter();
    const raw = {
      message: sampleInboundMessage({
        text: undefined,
        photo: "https://img.example.com/1.jpg",
        caption: "Nice photo",
      }),
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("Nice photo");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].type).toBe("image");
    expect(msg.attachments[0].url).toBe("https://img.example.com/1.jpg");
  });

  it("parses image without caption uses [Image]", async () => {
    const adapter = await createInitializedAdapter();
    const raw = {
      message: sampleInboundMessage({
        text: undefined,
        photo: "https://img.example.com/1.jpg",
      }),
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("[Image]");
  });

  it("parses sticker message", async () => {
    const adapter = await createInitializedAdapter();
    const raw = {
      message: sampleInboundMessage({
        text: undefined,
        sticker: "sticker-123",
      }),
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("[Sticker]");
    expect(msg.attachments).toHaveLength(0);
  });

  it("parses unsupported message", async () => {
    const adapter = await createInitializedAdapter();
    const raw = {
      message: sampleInboundMessage({ text: undefined }),
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("[Unsupported message]");
  });

  it("sets correct author fields", async () => {
    const adapter = await createInitializedAdapter();
    const raw = { message: sampleInboundMessage() };
    const msg = adapter.parseMessage(raw);
    expect(msg.author.userId).toBe("user-456");
    expect(msg.author.userName).toBe("Alice");
    expect(msg.author.fullName).toBe("Alice");
    expect(msg.author.isBot).toBe(false);
  });

  it("sets isMe = false for user messages", async () => {
    const adapter = await createInitializedAdapter();
    const raw = { message: sampleInboundMessage() };
    const msg = adapter.parseMessage(raw);
    expect(msg.author.isMe).toBe(false);
  });

  it("sets isMe = true for bot's own messages", async () => {
    const adapter = await createInitializedAdapter();
    const raw = {
      message: sampleInboundMessage({
        from: { id: "bot-999", display_name: "my-zalo-bot", is_bot: true },
      }),
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.author.isMe).toBe(true);
  });

  it("sets dateSent from message.date", async () => {
    const adapter = await createInitializedAdapter();
    const raw = { message: sampleInboundMessage({ date: 1735689600000 }) };
    const msg = adapter.parseMessage(raw);
    expect(msg.metadata.dateSent).toEqual(new Date(1735689600000));
  });

  it("sets correct threadId", async () => {
    const adapter = await createInitializedAdapter();
    const raw = {
      message: sampleInboundMessage({
        chat: { id: "chat-xyz", chat_type: "PRIVATE" },
      }),
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.threadId).toBe("zalo:chat-xyz");
  });

  it("sets message id", async () => {
    const adapter = await createInitializedAdapter();
    const raw = { message: sampleInboundMessage({ message_id: "msg-abc" }) };
    const msg = adapter.parseMessage(raw);
    expect(msg.id).toBe("msg-abc");
  });
});

// ---------------------------------------------------------------------------
// postMessage
// ---------------------------------------------------------------------------

describe("ZaloAdapter — postMessage", () => {
  const sendResponse = {
    message_id: "sent-001",
    date: 1735689601000,
    message_type: "TEXT" as const,
  };

  it("sends text message to correct URL", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    await adapter.postMessage("zalo:chat-123", "Hello");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/sendMessage");
    const body = JSON.parse(init?.body as string);
    expect(body.chat_id).toBe("chat-123");
    expect(body.text).toBe("Hello");
  });

  it("returns correct RawMessage", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    const result = await adapter.postMessage("zalo:chat-123", "Hello");
    expect(result.id).toBe("sent-001");
    expect(result.threadId).toBe("zalo:chat-123");
  });

  it("sends photo via raw message without caption", async () => {
    const adapter = await createInitializedAdapter();
    const photoResp = {
      message_id: "photo-002",
      date: 1735689602000,
      message_type: "CHAT_PHOTO" as const,
    };
    mockFetch.mockResolvedValueOnce(zaloOk(photoResp));
    await adapter.postMessage("zalo:chat-123", {
      raw: JSON.stringify({ photo: "https://img.example.com/pic.jpg" }),
    });
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/sendPhoto");
  });

  it("sends photo via raw message", async () => {
    const adapter = await createInitializedAdapter();
    const photoResp = {
      message_id: "photo-001",
      date: 1735689602000,
      message_type: "CHAT_PHOTO" as const,
    };
    mockFetch.mockResolvedValueOnce(zaloOk(photoResp));
    const result = await adapter.postMessage("zalo:chat-123", {
      raw: JSON.stringify({
        photo: "https://img.example.com/pic.jpg",
        caption: "Nice",
      }),
    });
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/sendPhoto");
    expect(result.id).toBe("photo-001");
  });

  it("throws AdapterError for card messages", async () => {
    const adapter = await createInitializedAdapter();
    await expect(
      adapter.postMessage("zalo:chat-123", {
        card: { title: "Card", sections: [] },
      } as unknown as string)
    ).rejects.toThrow(AdapterError);
  });

  it("splits long messages into multiple calls", async () => {
    const adapter = await createInitializedAdapter();
    const longText = "A".repeat(2001);
    mockFetch
      .mockResolvedValueOnce(zaloOk(sendResponse))
      .mockResolvedValueOnce(zaloOk(sendResponse));
    await adapter.postMessage("zalo:chat-123", longText);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("renders markdown to plain text", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    await adapter.postMessage("zalo:chat-123", { markdown: "**bold**" });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.text).not.toContain("**");
    expect(body.text).toContain("bold");
  });

  it("renders ast message to text", async () => {
    const adapter = await createInitializedAdapter();
    const { ZaloFormatConverter } = await import("./markdown");
    const converter = new ZaloFormatConverter();
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    await adapter.postMessage("zalo:chat-123", {
      ast: converter.toAst("hello world"),
    });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain("hello world");
  });

  it("raw.message.from.id is empty string when adapter not initialized", async () => {
    // Covers the `this._botUserId ?? ""` branch when _botUserId is null (line 369)
    const adapter = createAdapter();
    const sendResponse = {
      message_id: "sent-uninit",
      date: 1735689601000,
      message_type: "TEXT" as const,
    };
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    const result = await adapter.postMessage("zalo:chat-123", "Hello");
    expect(result.raw.message.from.id).toBe("");
  });

  it("raw.message.from.id is empty string for photo when not initialized", async () => {
    // Covers `this._botUserId ?? ""` branch in sendPhoto response (line 316)
    const adapter = createAdapter();
    const photoResp = {
      message_id: "photo-uninit",
      date: 1735689602000,
      message_type: "CHAT_PHOTO" as const,
    };
    mockFetch.mockResolvedValueOnce(zaloOk(photoResp));
    const result = await adapter.postMessage("zalo:chat-123", {
      raw: JSON.stringify({ photo: "https://img.example.com/pic.jpg" }),
    });
    expect(result.raw.message.from.id).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Unsupported operations
// ---------------------------------------------------------------------------

describe("ZaloAdapter — unsupported operations", () => {
  it("editMessage throws", async () => {
    const adapter = await createInitializedAdapter();
    await expect(
      adapter.editMessage("zalo:chat-123", "msg-1", "new text")
    ).rejects.toThrow(Error);
  });

  it("deleteMessage throws", async () => {
    const adapter = await createInitializedAdapter();
    await expect(
      adapter.deleteMessage("zalo:chat-123", "msg-1")
    ).rejects.toThrow(Error);
  });

  it("addReaction throws", async () => {
    const adapter = await createInitializedAdapter();
    await expect(
      adapter.addReaction("zalo:chat-123", "msg-1", "thumbsup")
    ).rejects.toThrow(Error);
  });

  it("removeReaction throws", async () => {
    const adapter = await createInitializedAdapter();
    await expect(
      adapter.removeReaction("zalo:chat-123", "msg-1", "thumbsup")
    ).rejects.toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// startTyping
// ---------------------------------------------------------------------------

describe("ZaloAdapter — startTyping", () => {
  it("calls sendChatAction with action=typing", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk({}));
    await adapter.startTyping("zalo:chat-123");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/sendChatAction");
    const body = JSON.parse(init?.body as string);
    expect(body.action).toBe("typing");
    expect(body.chat_id).toBe("chat-123");
  });

  it("does not throw when sendChatAction fails", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(new Response("Error", { status: 500 }));
    await expect(adapter.startTyping("zalo:chat-123")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stream
// ---------------------------------------------------------------------------

describe("ZaloAdapter — stream", () => {
  const sendResponse = {
    message_id: "stream-001",
    date: 1735689601000,
    message_type: "TEXT" as const,
  };

  async function* stringChunks(...parts: string[]): AsyncIterable<string> {
    for (const part of parts) {
      yield part;
    }
  }

  async function* mixedChunks(): AsyncIterable<{ type: string; text: string }> {
    yield { type: "markdown_text", text: "Hello " };
    yield { type: "thinking_text", text: "this is internal" };
    yield { type: "markdown_text", text: "world" };
  }

  it("buffers string chunks and sends as single message", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    await adapter.stream("zalo:chat-123", stringChunks("Hello", " ", "world"));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain("Hello");
    expect(body.text).toContain("world");
  });

  it("buffers markdown_text StreamChunks and sends", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloOk(sendResponse));
    await adapter.stream("zalo:chat-123", mixedChunks());
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain("Hello");
    expect(body.text).toContain("world");
    expect(body.text).not.toContain("this is internal");
  });
});

// ---------------------------------------------------------------------------
// fetchMessages
// ---------------------------------------------------------------------------

describe("ZaloAdapter — fetchMessages", () => {
  it("returns empty messages array", async () => {
    const adapter = await createInitializedAdapter();
    const result = await adapter.fetchMessages("zalo:chat-123");
    expect(result).toEqual({ messages: [] });
  });
});

// ---------------------------------------------------------------------------
// fetchThread
// ---------------------------------------------------------------------------

describe("ZaloAdapter — fetchThread", () => {
  it("returns ThreadInfo with isDM=true", async () => {
    const adapter = await createInitializedAdapter();
    const info = await adapter.fetchThread("zalo:chat-123");
    expect(info.isDM).toBe(true);
    expect(info.channelId).toBe("zalo:chat-123");
  });

  it("channelName contains chatId", async () => {
    const adapter = await createInitializedAdapter();
    const info = await adapter.fetchThread("zalo:chat-123");
    expect(info.channelName).toContain("chat-123");
  });
});

// ---------------------------------------------------------------------------
// openDM
// ---------------------------------------------------------------------------

describe("ZaloAdapter — openDM", () => {
  it("returns encoded thread ID for userId", async () => {
    const adapter = await createInitializedAdapter();
    const threadId = await adapter.openDM("user-42");
    expect(threadId).toBe("zalo:user-42");
  });
});

// ---------------------------------------------------------------------------
// renderFormatted
// ---------------------------------------------------------------------------

describe("ZaloAdapter — renderFormatted", () => {
  it("renders AST to plain text", async () => {
    const adapter = await createInitializedAdapter();
    const { ZaloFormatConverter } = await import("./markdown");
    const converter = new ZaloFormatConverter();
    const ast = converter.toAst("**bold** text");
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("bold");
    expect(result).not.toContain("**");
  });
});

// ---------------------------------------------------------------------------
// API error handling
// ---------------------------------------------------------------------------

describe("ZaloAdapter — API error handling", () => {
  it("HTTP 429 → AdapterRateLimitError", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(
      new Response("Too Many Requests", { status: 429 })
    );
    await expect(adapter.postMessage("zalo:chat-123", "Hello")).rejects.toThrow(
      AdapterRateLimitError
    );
  });

  it("HTTP 5xx → AdapterError", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );
    await expect(adapter.postMessage("zalo:chat-123", "Hello")).rejects.toThrow(
      AdapterError
    );
  });

  it("ok=false with error_code=429 → AdapterRateLimitError", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Rate limited",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    await expect(adapter.postMessage("zalo:chat-123", "Hello")).rejects.toThrow(
      AdapterRateLimitError
    );
  });

  it("ok=false with other error code → AdapterError", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(zaloError(200, 400, "Bad Request"));
    await expect(adapter.postMessage("zalo:chat-123", "Hello")).rejects.toThrow(
      AdapterError
    );
  });

  it("ok=false without error_code or description → AdapterError with 'unknown'", async () => {
    const adapter = await createInitializedAdapter();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(adapter.postMessage("zalo:chat-123", "Hello")).rejects.toThrow(
      AdapterError
    );
  });
});

// ---------------------------------------------------------------------------
// splitMessage (standalone export)
// ---------------------------------------------------------------------------

describe("splitMessage", () => {
  it("returns single-element array for short text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns single-element array for exactly 2000 chars", () => {
    const text = "A".repeat(2000);
    expect(splitMessage(text)).toHaveLength(1);
  });

  it("splits on paragraph boundary", () => {
    const para1 = "A".repeat(1200);
    const para2 = "B".repeat(1200);
    const text = `${para1}\n\n${para2}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("A");
    expect(chunks[1]).toContain("B");
  });

  it("splits on line boundary when no paragraph break", () => {
    const line1 = "A".repeat(1200);
    const line2 = "B".repeat(1200);
    const text = `${line1}\n${line2}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("hard-breaks at 2000 when no whitespace", () => {
    const text = "X".repeat(4000);
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it("empty string returns ['']", () => {
    expect(splitMessage("")).toEqual([""]);
  });

  it("loop exits with no remainder when text splits exactly at boundary", () => {
    // Hard-break at 2000; trimStart on "\n\n" leaves "" → if(remaining.length>0) false
    const text = `${"X".repeat(2000)}\n\n`;
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("X".repeat(2000));
  });

  it("returns correct chunk count for 6000-char text", () => {
    // Use paragraphs so we get clean splits
    const para = "A".repeat(1900);
    const text = [para, para, para].join("\n\n");
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(3);
  });
});
