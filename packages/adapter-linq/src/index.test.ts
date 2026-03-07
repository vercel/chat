import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinqAdapter, LinqAdapter } from "./index";

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

function createMockChat(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("testbot"),
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
    processMemberJoinedChannel: vi.fn(),
  } as unknown as ChatInstance;
}

function linqOk(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function linqError(status: number): Response {
  return new Response(JSON.stringify({ error: "error" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function generateSignature(
  secret: string,
  timestamp: string,
  body: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("createLinqAdapter", () => {
  it("throws when API token is missing", () => {
    process.env.LINQ_API_TOKEN = "";
    expect(() => createLinqAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );
  });

  it("uses env vars when config is omitted", () => {
    process.env.LINQ_API_TOKEN = "test-token";
    const adapter = createLinqAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(LinqAdapter);
    expect(adapter.name).toBe("linq");
    process.env.LINQ_API_TOKEN = undefined;
  });

  it("creates adapter with explicit token", () => {
    const adapter = createLinqAdapter({
      apiToken: "explicit-token",
      logger: mockLogger,
    });
    expect(adapter.name).toBe("linq");
  });
});

describe("thread ID encoding", () => {
  const adapter = new LinqAdapter({
    apiToken: "test-token",
    logger: mockLogger,
  });

  it("encodes thread ID", () => {
    const threadId = adapter.encodeThreadId({
      chatId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(threadId).toBe("linq:550e8400-e29b-41d4-a716-446655440000");
  });

  it("decodes thread ID", () => {
    const decoded = adapter.decodeThreadId(
      "linq:550e8400-e29b-41d4-a716-446655440000"
    );
    expect(decoded).toEqual({
      chatId: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("throws on invalid thread ID", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:123:456")).toThrow(
      ValidationError
    );
  });

  it("channelIdFromThreadId returns chatId", () => {
    expect(
      adapter.channelIdFromThreadId("linq:550e8400-e29b-41d4-a716-446655440000")
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("handleWebhook", () => {
  it("rejects missing signature when signingSecret is set", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({ event_type: "message.received" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("verifies valid HMAC signature", async () => {
    const secret = "test-secret";
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      signingSecret: secret,
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "message.received",
      event_id: "evt-123",
      created_at: new Date().toISOString(),
      trace_id: "trace-1",
      partner_id: "partner-1",
      data: {
        chat: { id: "chat-123" },
        id: "msg-123",
        direction: "inbound",
        sender_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
        parts: [{ type: "text", value: "Hello" }],
        service: "iMessage",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await generateSignature(secret, timestamp, body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
      headers: {
        "x-webhook-signature": signature,
        "x-webhook-timestamp": timestamp,
      },
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();
  });

  it("routes reaction.added events", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "reaction.added",
      event_id: "evt-456",
      created_at: new Date().toISOString(),
      trace_id: "trace-2",
      partner_id: "partner-1",
      data: {
        chat_id: "chat-123",
        message_id: "msg-123",
        reaction_type: "love",
        is_from_me: false,
        from_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processReaction).toHaveBeenCalledOnce();

    const reactionCall = (mockChat.processReaction as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(reactionCall.added).toBe(true);
    expect(reactionCall.messageId).toBe("msg-123");
  });

  it("returns 400 for invalid JSON", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "not json",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

describe("postMessage", () => {
  it("sends a text message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk(
        {
          chat_id: "chat-123",
          message: {
            id: "msg-456",
            parts: [{ type: "text", value: "Hello" }],
            status: "queued",
            created_at: "2025-01-01T00:00:00Z",
          },
        },
        202
      )
    );

    const result = await adapter.postMessage("linq:chat-123", "Hello");

    expect(result.id).toBe("msg-456");
    expect(result.threadId).toBe("linq:chat-123");
  });

  it("throws on empty text", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });

    await expect(adapter.postMessage("linq:chat-123", "")).rejects.toThrow(
      ValidationError
    );
  });
});

describe("editMessage", () => {
  it("edits a message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        id: "msg-456",
        chat_id: "chat-123",
        is_from_me: true,
        is_delivered: true,
        is_read: false,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:01:00Z",
        parts: [{ type: "text", value: "Updated", reactions: null }],
      })
    );

    const result = await adapter.editMessage(
      "linq:chat-123",
      "msg-456",
      "Updated"
    );
    expect(result.id).toBe("msg-456");
  });
});

describe("deleteMessage", () => {
  it("deletes a message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      adapter.deleteMessage("linq:chat-123", "msg-456")
    ).resolves.toBeUndefined();
  });
});

describe("API error handling", () => {
  it("throws AuthenticationError on 401", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(linqError(401));

    await expect(adapter.postMessage("linq:chat-123", "Hello")).rejects.toThrow(
      AuthenticationError
    );
  });

  it("throws AdapterRateLimitError on 429", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(linqError(429));

    await expect(adapter.postMessage("linq:chat-123", "Hello")).rejects.toThrow(
      AdapterRateLimitError
    );
  });
});

describe("parseMessage", () => {
  it("parses a raw Linq message", () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-1",
      chat_id: "chat-1",
      is_from_me: false,
      is_delivered: true,
      is_read: true,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      parts: [
        { type: "text", value: "Hello world", reactions: null },
      ] as unknown as null,
      from_handle: {
        id: "h1",
        handle: "+15551234567",
        service: "iMessage" as const,
        joined_at: "2025-01-01T00:00:00Z",
      },
    });

    expect(message.text).toBe("Hello world");
    expect(message.threadId).toBe("linq:chat-1");
    expect(message.author.userId).toBe("+15551234567");
  });
});

describe("startTyping", () => {
  it("sends typing indicator", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(adapter.startTyping("linq:chat-123")).resolves.toBeUndefined();
  });
});

describe("reactions", () => {
  it("adds a reaction", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({ status: "accepted", message: "Reaction processed" }, 202)
    );

    await expect(
      adapter.addReaction("linq:chat-123", "msg-456", "heart")
    ).resolves.toBeUndefined();
  });

  it("removes a reaction", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({ status: "accepted", message: "Reaction processed" }, 202)
    );

    await expect(
      adapter.removeReaction("linq:chat-123", "msg-456", "heart")
    ).resolves.toBeUndefined();
  });
});

describe("isDM", () => {
  it("returns true for all Linq threads", () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    expect(adapter.isDM("linq:chat-123")).toBe(true);
  });
});

describe("fetchMessages", () => {
  it("fetches messages with pagination cursor", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        messages: [
          {
            id: "msg-1",
            chat_id: "chat-123",
            is_from_me: false,
            is_delivered: true,
            is_read: true,
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
            parts: [{ type: "text", value: "Hello", reactions: null }],
            from_handle: {
              id: "h1",
              handle: "+15551234567",
              service: "iMessage",
              joined_at: "2025-01-01T00:00:00Z",
            },
          },
        ],
        next_cursor: "cursor-abc",
      })
    );

    const result = await adapter.fetchMessages("linq:chat-123", {
      cursor: "prev-cursor",
      limit: 10,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Hello");
    expect(result.nextCursor).toBe("cursor-abc");
  });

  it("returns undefined nextCursor when no more pages", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        messages: [],
        next_cursor: null,
      })
    );

    const result = await adapter.fetchMessages("linq:chat-123");
    expect(result.messages).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe("fetchThread", () => {
  it("fetches thread info from chat API", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        id: "chat-123",
        display_name: "Test Chat",
        is_group: false,
        handles: [
          {
            id: "h1",
            handle: "+15551234567",
            service: "iMessage",
            joined_at: "2025-01-01T00:00:00Z",
          },
        ],
      })
    );

    const info = await adapter.fetchThread("linq:chat-123");
    expect(info.id).toBe("linq:chat-123");
    expect(info.channelId).toBe("chat-123");
    expect(info.channelName).toBe("Test Chat");
    expect(info.isDM).toBe(true);
  });
});

describe("fetchChannelInfo", () => {
  it("fetches channel info from chat API", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        id: "chat-123",
        display_name: "Group Chat",
        is_group: true,
        handles: [
          {
            id: "h1",
            handle: "+15551234567",
            service: "iMessage",
            joined_at: "2025-01-01T00:00:00Z",
          },
          {
            id: "h2",
            handle: "+15559876543",
            service: "iMessage",
            joined_at: "2025-01-01T00:00:00Z",
          },
        ],
      })
    );

    const info = await adapter.fetchChannelInfo("chat-123");
    expect(info.id).toBe("chat-123");
    expect(info.name).toBe("Group Chat");
    expect(info.isDM).toBe(false);
    expect(info.memberCount).toBe(2);
  });
});

describe("fetchMessage", () => {
  it("fetches a single message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        id: "msg-1",
        chat_id: "chat-123",
        is_from_me: false,
        is_delivered: true,
        is_read: true,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        parts: [{ type: "text", value: "Hi there", reactions: null }],
        from_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
      })
    );

    const message = await adapter.fetchMessage("linq:chat-123", "msg-1");
    expect(message).not.toBeNull();
    expect(message?.text).toBe("Hi there");
    expect(message?.id).toBe("msg-1");
  });

  it("returns null on API error", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(linqError(404));

    const message = await adapter.fetchMessage("linq:chat-123", "nonexistent");
    expect(message).toBeNull();
  });
});

describe("editMessage result", () => {
  it("returns correct structure from edit", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        id: "msg-456",
        chat_id: "chat-123",
        is_from_me: true,
        is_delivered: true,
        is_read: false,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:01:00Z",
        parts: [{ type: "text", value: "Edited text", reactions: null }],
      })
    );

    const result = await adapter.editMessage(
      "linq:chat-123",
      "msg-456",
      "Edited text"
    );
    expect(result.id).toBe("msg-456");
    expect(result.threadId).toBe("linq:chat-123");
    expect(result.raw.chat_id).toBe("chat-123");
  });
});

describe("webhook edge cases", () => {
  it("rejects invalid signature", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "message.received",
      event_id: "evt-123",
      created_at: new Date().toISOString(),
      trace_id: "trace-1",
      partner_id: "partner-1",
      data: {
        chat: { id: "chat-123" },
        id: "msg-123",
        direction: "inbound",
        sender_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
        parts: [{ type: "text", value: "Hello" }],
        service: "iMessage",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
      headers: {
        "x-webhook-signature": "deadbeef1234567890abcdef",
        "x-webhook-timestamp": timestamp,
      },
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("routes reaction.removed events", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "reaction.removed",
      event_id: "evt-789",
      created_at: new Date().toISOString(),
      trace_id: "trace-3",
      partner_id: "partner-1",
      data: {
        chat_id: "chat-123",
        message_id: "msg-123",
        reaction_type: "like",
        is_from_me: false,
        from_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processReaction).toHaveBeenCalledOnce();

    const reactionCall = (mockChat.processReaction as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(reactionCall.added).toBe(false);
    expect(reactionCall.emoji.name).toBe("thumbsup");
  });

  it("routes message.edited events", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "message.edited",
      event_id: "evt-edit-1",
      created_at: new Date().toISOString(),
      trace_id: "trace-4",
      partner_id: "partner-1",
      data: {
        chat: { id: "chat-123" },
        id: "msg-edited",
        direction: "inbound",
        sender_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
        parts: [{ type: "text", value: "Edited content" }],
        service: "iMessage",
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();

    const messageCall = (mockChat.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    expect(messageCall.metadata.edited).toBe(true);
  });

  it("silently ignores unknown event types", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "chat.typing_indicator.started",
      event_id: "evt-unknown",
      created_at: new Date().toISOString(),
      trace_id: "trace-5",
      partner_id: "partner-1",
      data: {},
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
    expect(mockChat.processReaction).not.toHaveBeenCalled();
  });

  it("parses media attachments from webhook message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "message.received",
      event_id: "evt-media",
      created_at: new Date().toISOString(),
      trace_id: "trace-6",
      partner_id: "partner-1",
      data: {
        chat: { id: "chat-123" },
        id: "msg-media",
        direction: "inbound",
        sender_handle: {
          id: "h1",
          handle: "+15551234567",
          service: "iMessage",
          joined_at: "2025-01-01T00:00:00Z",
        },
        parts: [
          { type: "text", value: "Check this out" },
          {
            type: "media",
            id: "att-1",
            url: "https://example.com/image.png",
            filename: "image.png",
            mime_type: "image/png",
            size_bytes: 12345,
          },
        ],
        service: "iMessage",
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const messageCall = (mockChat.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    expect(messageCall.text).toBe("Check this out");
    expect(messageCall.attachments).toHaveLength(1);
    expect(messageCall.attachments[0].type).toBe("image");
    expect(messageCall.attachments[0].name).toBe("image.png");
  });
});

describe("API error handling extended", () => {
  it("throws ResourceNotFoundError on 404", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(linqError(404));

    await expect(adapter.fetchThread("linq:chat-123")).rejects.toThrow(
      ResourceNotFoundError
    );
  });

  it("throws NetworkError on 500", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(linqError(500));

    await expect(adapter.postMessage("linq:chat-123", "Hello")).rejects.toThrow(
      NetworkError
    );
  });
});

describe("openDM", () => {
  it("throws when phoneNumber is not configured", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });

    await expect(adapter.openDM("+15559876543")).rejects.toThrow(
      ValidationError
    );
  });

  it("creates a chat and returns thread ID", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      phoneNumber: "+15551234567",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk(
        {
          chat: { id: "new-chat-id", display_name: "+15559876543" },
          message: { id: "msg-init", status: "queued" },
        },
        201
      )
    );

    const threadId = await adapter.openDM("+15559876543");
    expect(threadId).toBe("linq:new-chat-id");
  });
});

describe("botUserId", () => {
  it("returns phoneNumber when configured", () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      phoneNumber: "+15551234567",
      logger: mockLogger,
    });
    expect(adapter.botUserId).toBe("+15551234567");
  });

  it("returns undefined when phoneNumber is not configured", () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    expect(adapter.botUserId).toBeUndefined();
  });
});

describe("postMessage with file attachments", () => {
  it("uploads files and includes attachment_id in message parts", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    // First call: POST /v3/attachments (pre-upload)
    mockFetch.mockResolvedValueOnce(
      linqOk({
        attachment_id: "att-uuid-123",
        upload_url: "https://uploads.example.com/presigned",
        download_url: "https://cdn.example.com/photo.jpg",
        http_method: "PUT",
        expires_at: "2025-01-15T10:45:00Z",
        required_headers: { "Content-Type": "image/jpeg" },
      })
    );

    // Second call: PUT to upload_url
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // Third call: POST /v3/chats/{chatId}/messages
    mockFetch.mockResolvedValueOnce(
      linqOk(
        {
          chat_id: "chat-123",
          message: {
            id: "msg-with-file",
            parts: [
              { type: "text", value: "Check this photo" },
              { type: "media", attachment_id: "att-uuid-123" },
            ],
            status: "queued",
            created_at: "2025-01-01T00:00:00Z",
          },
        },
        202
      )
    );

    const result = await adapter.postMessage("linq:chat-123", {
      markdown: "Check this photo",
      files: [
        {
          data: Buffer.from("fake-image-data"),
          filename: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(result.id).toBe("msg-with-file");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("skips failed uploads and still sends message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    // First call: POST /v3/attachments fails
    mockFetch.mockResolvedValueOnce(linqError(500));

    // Second call: POST /v3/chats/{chatId}/messages (text only)
    mockFetch.mockResolvedValueOnce(
      linqOk(
        {
          chat_id: "chat-123",
          message: {
            id: "msg-text-only",
            parts: [{ type: "text", value: "Hello" }],
            status: "queued",
            created_at: "2025-01-01T00:00:00Z",
          },
        },
        202
      )
    );

    const result = await adapter.postMessage("linq:chat-123", {
      markdown: "Hello",
      files: [
        {
          data: Buffer.from("bad-data"),
          filename: "doc.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    expect(result.id).toBe("msg-text-only");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Failed to upload file, skipping attachment",
      expect.objectContaining({ filename: "doc.pdf" })
    );
  });
});

describe("fetchChannelMessages", () => {
  it("delegates to fetchMessages with encoded thread ID", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk({
        messages: [
          {
            id: "msg-1",
            chat_id: "chat-123",
            is_from_me: false,
            is_delivered: true,
            is_read: true,
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
            parts: [{ type: "text", value: "Hello", reactions: null }],
            from_handle: {
              id: "h1",
              handle: "+15551234567",
              service: "iMessage",
              joined_at: "2025-01-01T00:00:00Z",
            },
          },
        ],
        next_cursor: null,
      })
    );

    const result = await adapter.fetchChannelMessages("chat-123", {
      limit: 10,
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Hello");
  });
});

describe("listThreads", () => {
  it("throws when phoneNumber is not configured", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });

    await expect(adapter.listThreads("any")).rejects.toThrow(ValidationError);
  });

  it("lists chats as threads", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      phoneNumber: "+15551234567",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    // First call: GET /v3/chats
    mockFetch.mockResolvedValueOnce(
      linqOk({
        chats: [
          {
            id: "chat-aaa",
            display_name: "Chat A",
            is_group: false,
            is_archived: false,
            handles: [],
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-02T00:00:00Z",
          },
        ],
        next_cursor: "cursor-next",
      })
    );

    // Second call: GET /v3/chats/{chatId}/messages (for root message)
    mockFetch.mockResolvedValueOnce(
      linqOk({
        messages: [
          {
            id: "msg-root",
            chat_id: "chat-aaa",
            is_from_me: false,
            is_delivered: true,
            is_read: true,
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
            parts: [{ type: "text", value: "First msg", reactions: null }],
            from_handle: {
              id: "h1",
              handle: "+15559876543",
              service: "iMessage",
              joined_at: "2025-01-01T00:00:00Z",
            },
          },
        ],
        next_cursor: null,
      })
    );

    const result = await adapter.listThreads("any-channel", { limit: 5 });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].id).toBe("linq:chat-aaa");
    expect(result.threads[0].rootMessage.text).toBe("First msg");
    expect(result.nextCursor).toBe("cursor-next");
  });
});

describe("message.failed webhook", () => {
  it("logs error for failed messages", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "message.failed",
      event_id: "evt-fail-1",
      created_at: new Date().toISOString(),
      trace_id: "trace-f",
      partner_id: "partner-1",
      data: {
        chat_id: "chat-123",
        message_id: "msg-failed",
        code: 3007,
        reason: "Request expired before being processed",
        failed_at: "2025-11-23T17:35:00Z",
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Linq message send failed",
      expect.objectContaining({
        chatId: "chat-123",
        messageId: "msg-failed",
        code: 3007,
        reason: "Request expired before being processed",
      })
    );
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });
});

describe("message.delivered webhook", () => {
  it("logs delivery status without processing as message", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat);

    const body = JSON.stringify({
      api_version: "v3",
      webhook_version: "2026-02-03",
      event_type: "message.delivered",
      event_id: "evt-del-1",
      created_at: new Date().toISOString(),
      trace_id: "trace-d",
      partner_id: "partner-1",
      data: {
        chat: { id: "chat-123" },
        id: "msg-123",
        direction: "outbound",
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });
});

describe("postChannelMessage", () => {
  it("delegates to postMessage with encoded thread ID", async () => {
    const adapter = new LinqAdapter({
      apiToken: "test-token",
      logger: mockLogger,
    });
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      linqOk(
        {
          chat_id: "chat-123",
          message: {
            id: "msg-789",
            parts: [{ type: "text", value: "Channel msg" }],
            status: "queued",
            created_at: "2025-01-01T00:00:00Z",
          },
        },
        202
      )
    );

    const result = await adapter.postChannelMessage("chat-123", "Channel msg");
    expect(result.id).toBe("msg-789");
    expect(result.threadId).toBe("linq:chat-123");
  });
});
