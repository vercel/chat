import { describe, expect, it, vi } from "vitest";
import { handleIncomingMessage } from "./events";
import { WhatsAppFormatConverter } from "./markdown";

function createMockMessage(overrides: {
  from?: string;
  author?: string;
  id?: { _serialized: string };
  body?: string;
  hasMedia?: boolean;
  type?: string;
  fromMe?: boolean;
  timestamp?: number;
  getContact?: () => Promise<{ id: { _serialized: string }; pushname?: string; name?: string }>;
  getMentions?: () => Promise<{ id: { _serialized: string } }[]>;
  downloadMedia?: () => Promise<unknown>;
} = {}) {
  return {
    from: "34689396755@c.us",
    author: undefined,
    id: { _serialized: "msg-123" },
    body: "hello",
    hasMedia: false,
    type: "chat",
    fromMe: false,
    timestamp: Date.now() / 1000,
    getContact: vi.fn().mockResolvedValue({
      id: {
        _serialized:
          overrides?.author ?? overrides?.from ?? "34689396755@c.us",
      },
      pushname: "Test",
      name: "Test User",
    }),
    getMentions: vi.fn().mockResolvedValue([]),
    downloadMedia: vi.fn(),
    ...overrides,
  };
}

function createMockContext(overrides: Partial<{
  allowedNumbers: Set<string>;
  blockedNumbers: Set<string>;
  allowedGroups: Set<string>;
  requireMentionInGroups: boolean;
  botUserId: string;
}>) {
  const processMessage = vi.fn();
  const ctx = {
    chat: { processMessage },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    formatConverter: new WhatsAppFormatConverter(),
    botUserId: "bot@c.us",
    allowedNumbers: new Set<string>(),
    blockedNumbers: new Set<string>(),
    allowedGroups: new Set<string>(),
    requireMentionInGroups: false,
    encodeThreadId: (data: { chatId: string }) => `whatsapp:${data.chatId}`,
    adapter: {},
    ...overrides,
  };
  return { ...ctx, processMessage };
}

describe("handleIncomingMessage filtering", () => {
  it("blocks messages from blockedNumbers", async () => {
    const message = createMockMessage({ author: "34600000000@c.us", from: "34600000000@c.us" });
    const ctx = createMockContext({
      blockedNumbers: new Set(["34600000000@c.us"]),
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).not.toHaveBeenCalled();
  });

  it("allows messages when allowedNumbers is empty", async () => {
    const message = createMockMessage();
    const ctx = createMockContext();

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).toHaveBeenCalled();
  });

  it("blocks messages from non-allowed numbers when allowedNumbers is set", async () => {
    const message = createMockMessage({ author: "34600000000@c.us", from: "34600000000@c.us" });
    const ctx = createMockContext({
      allowedNumbers: new Set(["34689396755@c.us"]),
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).not.toHaveBeenCalled();
  });

  it("allows messages from allowed numbers", async () => {
    const message = createMockMessage({ author: "34689396755@c.us", from: "34689396755@c.us" });
    const ctx = createMockContext({
      allowedNumbers: new Set(["34689396755@c.us"]),
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).toHaveBeenCalled();
  });

  it("blocks messages from non-allowed groups when allowedGroups is set", async () => {
    const message = createMockMessage({
      from: "999999999-9999999999@g.us",
      author: "34689396755@c.us",
    });
    const ctx = createMockContext({
      allowedGroups: new Set(["123456789-1234567890@g.us"]),
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).not.toHaveBeenCalled();
  });

  it("allows messages from allowed groups", async () => {
    const message = createMockMessage({
      from: "123456789-1234567890@g.us",
      author: "34689396755@c.us",
    });
    const ctx = createMockContext({
      allowedGroups: new Set(["123456789-1234567890@g.us"]),
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).toHaveBeenCalled();
  });

  it("blocks group messages without mention when requireMentionInGroups is true", async () => {
    const message = createMockMessage({
      from: "123456789-1234567890@g.us",
      author: "34689396755@c.us",
      getMentions: vi.fn().mockResolvedValue([]),
    });
    const ctx = createMockContext({
      requireMentionInGroups: true,
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).not.toHaveBeenCalled();
  });

  it("allows group messages with mention when requireMentionInGroups is true", async () => {
    const message = createMockMessage({
      from: "123456789-1234567890@g.us",
      author: "34689396755@c.us",
      getMentions: vi.fn().mockResolvedValue([{ id: { _serialized: "bot@c.us" } }]),
    });
    const ctx = createMockContext({
      requireMentionInGroups: true,
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).toHaveBeenCalled();
  });

  it("blockedNumbers takes precedence over allowedNumbers", async () => {
    const message = createMockMessage({ author: "34689396755@c.us", from: "34689396755@c.us" });
    const ctx = createMockContext({
      allowedNumbers: new Set(["34689396755@c.us"]),
      blockedNumbers: new Set(["34689396755@c.us"]),
    });

    await handleIncomingMessage(message as never, ctx as never);

    expect(ctx.chat.processMessage).not.toHaveBeenCalled();
  });
});
