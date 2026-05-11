import { ConsoleLogger, NotImplementedError } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MESSAGE_ID_AT_DOMAIN = /@yourdomain\.com$/;
const THREAD_ID_PREFIX = /^email:/;

import { EmailAdapter } from "./adapter";
import { decodeEmailThreadId, stripAngleBrackets } from "./threading";
import type { EmailInbound, EmailTransport, ParsedInboundEmail } from "./types";

interface MockChatInstance {
  getLogger: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  getUserName: ReturnType<typeof vi.fn>;
  processAction: ReturnType<typeof vi.fn>;
  processMessage: ReturnType<typeof vi.fn>;
  processReaction: ReturnType<typeof vi.fn>;
}

function makeMockState() {
  const store = new Map<string, unknown>();
  return {
    store,
    state: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
      forceReleaseLock: vi.fn(),
      extendLock: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      isSubscribed: vi.fn(async () => false),
      connect: vi.fn(),
      disconnect: vi.fn(),
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      queueDepth: vi.fn(),
      setIfNotExists: vi.fn(),
      appendToList: vi.fn(),
      getList: vi.fn(),
    },
  };
}

function makeMockChat(stateStore: ReturnType<typeof makeMockState>) {
  const chat: MockChatInstance = {
    getState: vi.fn(() => stateStore.state),
    getUserName: vi.fn(() => "test-bot"),
    getLogger: vi.fn(() => new ConsoleLogger("silent")),
    processMessage: vi.fn(async () => undefined),
    processAction: vi.fn(async () => undefined),
    processReaction: vi.fn(),
  };
  return chat;
}

function makeAdapter(
  opts: { transport?: EmailTransport; inbound?: EmailInbound } = {}
) {
  return new EmailAdapter({
    fromAddress: "bot@yourdomain.com",
    fromName: "Test Bot",
    messageIdDomain: "yourdomain.com",
    transport: opts.transport,
    inbound: opts.inbound,
    userName: "test-bot",
    logger: new ConsoleLogger("silent"),
  });
}

describe("EmailAdapter#initialize", () => {
  it("stores the chat reference", async () => {
    const adapter = makeAdapter();
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    await adapter.initialize(chat as never);
    expect(adapter.botUserId).toBe("bot@yourdomain.com");
  });
});

describe("EmailAdapter#openDM", () => {
  let stateStore: ReturnType<typeof makeMockState>;
  let chat: MockChatInstance;

  beforeEach(() => {
    stateStore = makeMockState();
    chat = makeMockChat(stateStore);
  });

  it("rejects malformed addresses", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(chat as never);
    await expect(adapter.openDM("not-an-email")).rejects.toThrow(
      "Invalid email address"
    );
  });

  it("returns a stable thread ID and pre-stashes thread state", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(chat as never);
    const threadId = await adapter.openDM("user@example.com");
    const decoded = decodeEmailThreadId(threadId);
    expect(decoded.participantAddress).toBe("user@example.com");
    expect(decoded.rootMessageId).toMatch(MESSAGE_ID_AT_DOMAIN);
    const stored = stateStore.store.get(
      `email:thread:${decoded.rootMessageId}`
    );
    expect(stored).toEqual({
      references: [],
      participantAddress: "user@example.com",
    });
  });
});

describe("EmailAdapter#postMessage", () => {
  let stateStore: ReturnType<typeof makeMockState>;
  let chat: MockChatInstance;
  let send: ReturnType<typeof vi.fn>;
  let transport: EmailTransport;

  beforeEach(() => {
    stateStore = makeMockState();
    chat = makeMockChat(stateStore);
    send = vi.fn(async () => ({ providerMessageId: "p_1", raw: { ok: true } }));
    transport = { name: "mock", send };
  });

  it("throws when no transport is configured", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(chat as never);
    const threadId = `email:${Buffer.from("root@x").toString("base64url")}`;
    await expect(adapter.postMessage(threadId, "hi")).rejects.toThrow(
      "No transport configured"
    );
  });

  it("requires a participant address in the thread ID", async () => {
    const adapter = makeAdapter({ transport });
    await adapter.initialize(chat as never);
    const threadId = `email:${Buffer.from("root@x").toString("base64url")}`;
    await expect(adapter.postMessage(threadId, "hi")).rejects.toThrow(
      "recipient address is unknown"
    );
  });

  it("sends an outbound-initiated email reusing the reserved root as Message-ID", async () => {
    const adapter = makeAdapter({ transport });
    await adapter.initialize(chat as never);
    const threadId = await adapter.openDM("user@example.com");
    const decoded = decodeEmailThreadId(threadId);

    const result = await adapter.postMessage(threadId, "Hello world");

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]?.[0];
    expect(sent.from).toEqual({
      address: "bot@yourdomain.com",
      name: "Test Bot",
    });
    expect(sent.to).toEqual(["user@example.com"]);
    expect(sent.subject).toBe("Hello world");
    expect(sent.text).toBe("Hello world");
    expect(sent.html).toContain("<p>Hello world</p>");
    expect(sent.messageId).toBe(decoded.rootMessageId);
    expect(sent.threadRootMessageId).toBe(decoded.rootMessageId);
    expect(sent.inReplyTo).toBeUndefined();
    expect(sent.references).toBeUndefined();

    expect(result.threadId).toBe(threadId);
    expect(result.id).toBe(decoded.rootMessageId);

    const stored = stateStore.store.get(
      `email:thread:${decoded.rootMessageId}`
    ) as { references: string[] };
    expect(stored.references).toEqual([decoded.rootMessageId]);
  });

  it("sends a reply with In-Reply-To and References when the thread already has messages", async () => {
    const adapter = makeAdapter({ transport });
    await adapter.initialize(chat as never);
    // Simulate an inbound message landing first.
    const inbound = makeInboundFixture({
      messageId: "<inbound-1@example.com>",
      from: "user@example.com",
      subject: "Hello bot",
      text: "Original message",
    });
    const inboundProvider: EmailInbound = {
      name: "fixture",
      verifySignature: () => true,
      parse: () => inbound,
    };
    const adapterWithInbound = makeAdapter({
      transport,
      inbound: inboundProvider,
    });
    await adapterWithInbound.initialize(chat as never);

    const req = new Request("https://example.com/wh", {
      method: "POST",
      body: "{}",
    });
    const response = await adapterWithInbound.handleWebhook(req);
    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const [, threadIdReceived] = chat.processMessage.mock.calls[0] ?? [];

    // Now reply via postMessage.
    await adapterWithInbound.postMessage(
      threadIdReceived as string,
      "Reply body"
    );

    const sent = send.mock.calls[0]?.[0];
    expect(sent.subject).toBe("Re: Hello bot");
    expect(sent.inReplyTo).toBe("inbound-1@example.com");
    expect(sent.references).toEqual(["inbound-1@example.com"]);
    expect(sent.threadRootMessageId).toBe("inbound-1@example.com");
    expect(sent.messageId).not.toBe("inbound-1@example.com");
  });

  it("renders a card to HTML and falls back to plain text", async () => {
    const adapter = makeAdapter({ transport });
    await adapter.initialize(chat as never);
    const threadId = await adapter.openDM("user@example.com");
    await adapter.postMessage(threadId, {
      card: {
        type: "card",
        title: "Hi",
        children: [{ type: "text", content: "Body" }],
      },
    });
    const sent = send.mock.calls[0]?.[0];
    expect(sent.html).toContain("Hi");
    expect(sent.html).toContain("Body");
    expect(sent.text).toContain("Hi");
    expect(sent.text).toContain("Body");
    expect(sent.subject).toBe("Hi");
  });
});

describe("EmailAdapter#handleWebhook", () => {
  let stateStore: ReturnType<typeof makeMockState>;
  let chat: MockChatInstance;

  beforeEach(() => {
    stateStore = makeMockState();
    chat = makeMockChat(stateStore);
  });

  it("returns 404 when no inbound provider is configured", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(chat as never);
    const response = await adapter.handleWebhook(
      new Request("https://example.com/wh", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 when signature verification fails", async () => {
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => false,
        parse: () => null,
      },
    });
    await adapter.initialize(chat as never);
    const response = await adapter.handleWebhook(
      new Request("https://example.com/wh", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 and skips dispatch when parse returns null", async () => {
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => null,
      },
    });
    await adapter.initialize(chat as never);
    const response = await adapter.handleWebhook(
      new Request("https://example.com/wh", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("dispatches a parsed inbound message to chat.processMessage", async () => {
    const inbound = makeInboundFixture({
      messageId: "msg-1@example.com",
      from: "user@example.com",
      subject: "Hi",
      text: "Test body",
    });
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => inbound,
      },
    });
    await adapter.initialize(chat as never);
    const response = await adapter.handleWebhook(
      new Request("https://example.com/wh", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const args = chat.processMessage.mock.calls[0];
    if (!args) {
      throw new Error("processMessage was not called");
    }
    const [adapterArg, threadId, message] = args as [
      unknown,
      string,
      { text: string },
    ];
    expect(adapterArg).toBe(adapter);
    expect(threadId).toMatch(THREAD_ID_PREFIX);
    expect(message.text).toBe("Test body");
  });

  it("returns 400 when parse throws", async () => {
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => {
          throw new Error("boom");
        },
      },
    });
    await adapter.initialize(chat as never);
    const response = await adapter.handleWebhook(
      new Request("https://example.com/wh", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(400);
  });
});

describe("EmailAdapter#stream", () => {
  it("buffers chunks and posts a single email at the end", async () => {
    const send = vi.fn(async () => ({ providerMessageId: "p_1", raw: {} }));
    const transport: EmailTransport = { name: "mock", send };
    const adapter = makeAdapter({ transport });
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    await adapter.initialize(chat as never);
    const threadId = await adapter.openDM("user@example.com");

    async function* gen() {
      yield "Hello ";
      yield { type: "markdown_text" as const, text: "world" };
      yield {
        type: "task_update" as const,
        status: "complete" as const,
        id: "t",
        title: "t",
      };
    }

    await adapter.stream(threadId, gen());
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]?.[0];
    expect(sent.text).toBe("Hello world");
  });
});

describe("EmailAdapter unsupported operations", () => {
  it("rejects edit/delete/reactions with NotImplementedError", async () => {
    const adapter = makeAdapter();
    await expect(
      // @ts-expect-error: testing the runtime guard, not the type
      adapter.editMessage("t", "m", "x")
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(adapter.deleteMessage("t", "m")).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(adapter.addReaction("t", "m", "x")).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(adapter.removeReaction("t", "m", "x")).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });

  it("startTyping resolves without doing anything", async () => {
    const adapter = makeAdapter();
    await expect(adapter.startTyping()).resolves.toBeUndefined();
  });
});

describe("EmailAdapter#handleWebhook (additional)", () => {
  it("returns 200 and skips processing when Chat is not yet initialized", async () => {
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => ({
          messageId: "x@y",
          from: { address: "a@b" },
          to: ["bot@yourdomain.com"],
          subject: "",
          receivedAt: new Date(),
          raw: {},
        }),
      },
    });
    // NOTE: deliberately NOT calling adapter.initialize()
    const response = await adapter.handleWebhook(
      new Request("https://x", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(200);
  });

  it("returns 500 when dispatch throws", async () => {
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    // Make state.set reject so dispatchInbound throws.
    stateStore.state.set = vi.fn(async () => {
      throw new Error("state explosion");
    });
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => ({
          messageId: "x@y",
          from: { address: "a@b" },
          to: ["bot@yourdomain.com"],
          subject: "",
          receivedAt: new Date(),
          raw: {},
        }),
      },
    });
    await adapter.initialize(chat as never);
    const response = await adapter.handleWebhook(
      new Request("https://x", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(500);
  });

  it("attaches inbound attachments to the dispatched Message", async () => {
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    const fetchData = vi.fn(async () => Buffer.from("data"));
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => ({
          messageId: "x@y",
          from: { address: "a@b", name: "A" },
          to: ["bot@yourdomain.com"],
          subject: "Hi",
          receivedAt: new Date(),
          text: "body",
          attachments: [
            {
              filename: "f.pdf",
              contentType: "application/pdf",
              size: 100,
              url: "https://example.com/f.pdf",
              fetchData,
            },
            {
              filename: "img.png",
              contentType: "image/png",
            },
            {
              filename: "movie.mp4",
              contentType: "video/mp4",
            },
            {
              filename: "song.mp3",
              contentType: "audio/mp3",
            },
            {
              filename: "unknown.bin",
              // no contentType -> infers "file"
            },
          ],
          raw: {},
        }),
      },
    });
    await adapter.initialize(chat as never);
    await adapter.handleWebhook(
      new Request("https://x", { method: "POST", body: "{}" })
    );
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const [, , message] = chat.processMessage.mock.calls[0] as [
      unknown,
      string,
      { attachments: Array<{ type: string; name: string }> },
    ];
    const types = message.attachments.map((a) => a.type).sort();
    expect(types).toEqual(["audio", "file", "file", "image", "video"]);
  });
});

describe("EmailAdapter#postMessage (additional)", () => {
  it("rethrows transport errors after logging", async () => {
    const send = vi.fn(async () => {
      throw new Error("transport boom");
    });
    const transport: EmailTransport = { name: "mock", send };
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    const adapter = makeAdapter({ transport });
    await adapter.initialize(chat as never);
    const threadId = await adapter.openDM("user@example.com");
    await expect(adapter.postMessage(threadId, "hi")).rejects.toThrow(
      "transport boom"
    );
  });

  describe("renderBodies (via postMessage)", () => {
    function makeSendingAdapter() {
      const send = vi.fn(async () => ({ providerMessageId: "x", raw: {} }));
      const transport: EmailTransport = { name: "mock", send };
      const stateStore = makeMockState();
      const chat = makeMockChat(stateStore);
      const adapter = makeAdapter({ transport });
      return { adapter, send, chat };
    }

    it("renders the raw passthrough body", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, { raw: "raw body text" });
      const sent = send.mock.calls[0]?.[0];
      expect(sent.text).toBe("raw body text");
      expect(sent.html).toContain("raw body text");
    });

    it("renders an AST postable body", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, {
        ast: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "ast-body" }],
            },
          ],
        },
      });
      const sent = send.mock.calls[0]?.[0];
      expect(sent.text.trim()).toBe("ast-body");
      expect(sent.html).toContain("ast-body");
    });
  });

  describe("deriveInitialSubject", () => {
    function makeSendingAdapter() {
      const send = vi.fn(async () => ({ providerMessageId: "x", raw: {} }));
      const transport: EmailTransport = { name: "mock", send };
      const stateStore = makeMockState();
      const chat = makeMockChat(stateStore);
      const adapter = makeAdapter({ transport });
      return { adapter, send, chat };
    }

    it("derives subject from the first line of a raw body", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, { raw: "first line\nsecond" });
      expect(send.mock.calls[0]?.[0].subject).toBe("first line");
    });

    it("derives subject from the first line of a markdown body", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, {
        markdown: "# Heading\n\nbody",
      });
      expect(send.mock.calls[0]?.[0].subject).toBe("Heading");
    });

    it("uses card.title from a PostableCard", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, {
        card: { type: "card", title: "Card Title", children: [] },
      });
      expect(send.mock.calls[0]?.[0].subject).toBe("Card Title");
    });

    it("uses card.title from a direct CardElement", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, {
        type: "card",
        title: "Direct Card Title",
        children: [],
      });
      expect(send.mock.calls[0]?.[0].subject).toBe("Direct Card Title");
    });

    it("falls back to `Message from <userName>` when no candidate is present", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      await adapter.postMessage(threadId, "   \n   ");
      expect(send.mock.calls[0]?.[0].subject).toBe("Message from test-bot");
    });

    it("truncates subjects longer than 80 characters", async () => {
      const { adapter, send, chat } = makeSendingAdapter();
      await adapter.initialize(chat as never);
      const threadId = await adapter.openDM("user@example.com");
      const longText = "x".repeat(200);
      await adapter.postMessage(threadId, longText);
      const subject = send.mock.calls[0]?.[0].subject;
      expect(subject).toHaveLength(80);
      expect(subject.endsWith("...")).toBe(true);
    });
  });
});

describe("EmailAdapter thread / channel introspection", () => {
  let stateStore: ReturnType<typeof makeMockState>;
  let chat: MockChatInstance;

  beforeEach(() => {
    stateStore = makeMockState();
    chat = makeMockChat(stateStore);
  });

  it("fetchMessages returns an empty result (server-side history not supported)", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(chat as never);
    const result = await adapter.fetchMessages("email:foo");
    expect(result).toEqual({ messages: [] });
  });

  it("fetchThread returns a normalized ThreadInfo with stored subject", async () => {
    const send = vi.fn(async () => ({ providerMessageId: "x", raw: {} }));
    const transport: EmailTransport = { name: "mock", send };
    const adapter = makeAdapter({ transport });
    await adapter.initialize(chat as never);
    const threadId = await adapter.openDM("user@example.com");
    // Post once so the thread has subject state persisted.
    await adapter.postMessage(threadId, "Hello topic");

    const info = await adapter.fetchThread(threadId);
    expect(info.id).toBe(threadId);
    expect(info.isDM).toBe(true);
    expect(info.channelName).toBe("Hello topic");
  });

  it("fetchThread defaults channelName when no subject is stored", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(chat as never);
    const root = Buffer.from("solo@x").toString("base64url");
    const info = await adapter.fetchThread(`email:${root}`);
    expect(info.channelName).toBe("Email conversation");
  });

  it("encodeThreadId / decodeThreadId roundtrip", () => {
    const adapter = makeAdapter();
    const data = {
      rootMessageId: "abc@x.com",
      participantAddress: "user@x.com",
    };
    const encoded = adapter.encodeThreadId(data);
    expect(adapter.decodeThreadId(encoded)).toEqual(data);
  });

  it("channelIdFromThreadId returns the thread id unchanged", () => {
    const adapter = makeAdapter();
    expect(adapter.channelIdFromThreadId("email:foo")).toBe("email:foo");
  });

  it("isDM always returns true", () => {
    const adapter = makeAdapter();
    expect(adapter.isDM("anything")).toBe(true);
  });

  it("renderFormatted delegates to the format converter", () => {
    const adapter = makeAdapter();
    const out = adapter.renderFormatted({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "hi" }],
        },
      ],
    });
    expect(out.trim()).toBe("hi");
  });
});

describe("EmailAdapter#parseMessage", () => {
  it("rebuilds an inbound Message from a raw payload", () => {
    const adapter = makeAdapter();
    const parsed = makeInboundFixture({
      messageId: "<m@x>",
      from: "alice@x.com",
      subject: "Hi",
      text: "Hello",
      references: ["<root@x>"],
    });
    const msg = adapter.parseMessage({ direction: "inbound", email: parsed });
    expect(msg.text).toBe("Hello");
    expect(msg.author.userId).toBe("alice@x.com");
    expect(msg.threadId).toMatch(THREAD_ID_PREFIX);
  });

  it("falls back to messageId as the thread root for inbound messages with no chain", () => {
    const adapter = makeAdapter();
    const parsed = makeInboundFixture({
      messageId: "first@x",
      from: "alice@x.com",
    });
    const msg = adapter.parseMessage({ direction: "inbound", email: parsed });
    const decoded = decodeEmailThreadId(msg.threadId);
    expect(decoded.rootMessageId).toBe("first@x");
  });

  it("rebuilds an outbound Message with isMe: true", () => {
    const adapter = makeAdapter();
    const out = {
      from: { address: "bot@yourdomain.com", name: "Test Bot" },
      to: ["user@example.com"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      messageId: "out-1@yourdomain.com",
      threadRootMessageId: "out-1@yourdomain.com",
    };
    const msg = adapter.parseMessage({
      direction: "outbound",
      email: out,
      result: { providerMessageId: undefined, raw: {} },
    });
    expect(msg.author.isMe).toBe(true);
    expect(msg.author.isBot).toBe(true);
    expect(msg.text).toBe("Hi");
  });

  it("encodes an empty recipient when parseMessage gets an outbound with no `to`", () => {
    const adapter = makeAdapter();
    const out = {
      from: { address: "bot@yourdomain.com" },
      to: [] as string[],
      subject: "x",
      html: "",
      text: "",
      messageId: "out@x",
      threadRootMessageId: "out@x",
    };
    const msg = adapter.parseMessage({
      direction: "outbound",
      email: out,
      result: { raw: {} },
    });
    expect(msg.threadId).toMatch(THREAD_ID_PREFIX);
  });

  it("uses userName as the fullName when fromName is not configured", () => {
    // Build an adapter without fromName via the public createEmailAdapter
    // factory — the EmailAdapter ctor itself accepts fromName as optional.
    const adapter = new EmailAdapter({
      fromAddress: "bot@yourdomain.com",
      messageIdDomain: "yourdomain.com",
      transport: { name: "noop", send: vi.fn() },
      userName: "test-bot",
      logger: new ConsoleLogger("silent"),
    });
    const out = {
      from: { address: "bot@yourdomain.com" },
      to: ["user@example.com"],
      subject: "x",
      html: "",
      text: "",
      messageId: "m@x",
      threadRootMessageId: "m@x",
    };
    const msg = adapter.parseMessage({
      direction: "outbound",
      email: out,
      result: { raw: {} },
    });
    expect(msg.author.fullName).toBe("test-bot");
  });

  it("preserves inbound In-Reply-To when building the threadId for parseMessage", () => {
    const adapter = makeAdapter();
    const parsed: ParsedInboundEmail = {
      messageId: "child@x",
      inReplyTo: "<parent@x>",
      from: { address: "alice@x.com" },
      to: ["bot@yourdomain.com"],
      subject: "Re",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      raw: {},
    };
    const msg = adapter.parseMessage({ direction: "inbound", email: parsed });
    const decoded = decodeEmailThreadId(msg.threadId);
    // findThreadRoot prefers In-Reply-To when references is empty/missing.
    expect(decoded.rootMessageId).toBe("parent@x");
  });

  it("handles inbound messages where the sender has no display name", async () => {
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    const adapter = makeAdapter({
      inbound: {
        name: "mock",
        verifySignature: () => true,
        parse: () => ({
          messageId: "x@y",
          inReplyTo: "<parent@x>",
          from: { address: "noname@x.com" }, // no `name`
          to: ["bot@yourdomain.com"],
          subject: "Hi",
          receivedAt: new Date(),
          raw: {},
        }),
      },
    });
    await adapter.initialize(chat as never);
    await adapter.handleWebhook(
      new Request("https://x", { method: "POST", body: "{}" })
    );
    const [, , msg] = chat.processMessage.mock.calls[0] as [
      unknown,
      string,
      { author: { fullName: string } },
    ];
    // fullName falls back to the address when no name is provided.
    expect(msg.author.fullName).toBe("noname@x.com");
  });

  it("detects isMe for an inbound message sent from the bot's own address", async () => {
    const adapter = makeAdapter();
    const stateStore = makeMockState();
    const chat = makeMockChat(stateStore);
    await adapter.initialize(chat as never);
    const parsed = makeInboundFixture({
      messageId: "self@x",
      from: "BOT@yourdomain.com", // case-insensitive match
    });
    const msg = adapter.parseMessage({ direction: "inbound", email: parsed });
    expect(msg.author.isMe).toBe(true);
  });
});

describe("EmailAdapter state helpers when chat is null", () => {
  it("loadThreadState returns empty state when chat is not initialized", async () => {
    // Reach through a subclass to call the protected method without
    // initializing chat first.
    class TestAdapter extends EmailAdapter {
      exposed(rootMessageId: string) {
        return this.loadThreadState(rootMessageId);
      }
    }
    const adapter = new TestAdapter({
      fromAddress: "bot@yourdomain.com",
      messageIdDomain: "yourdomain.com",
      transport: NOOP_TRANSPORT_FOR_HELPERS,
      userName: "test-bot",
      logger: new ConsoleLogger("silent"),
    });
    const state = await adapter.exposed("any@x");
    expect(state).toEqual({ references: [] });
  });

  it("persistThreadState is a no-op when chat is not initialized", async () => {
    class TestAdapter extends EmailAdapter {
      exposed(rootMessageId: string) {
        return this.persistThreadState(rootMessageId, { references: [] });
      }
    }
    const adapter = new TestAdapter({
      fromAddress: "bot@yourdomain.com",
      messageIdDomain: "yourdomain.com",
      transport: NOOP_TRANSPORT_FOR_HELPERS,
      userName: "test-bot",
      logger: new ConsoleLogger("silent"),
    });
    await expect(adapter.exposed("any@x")).resolves.toBeUndefined();
  });
});

const NOOP_TRANSPORT_FOR_HELPERS: EmailTransport = {
  name: "noop",
  send: vi.fn(async () => ({ providerMessageId: "x", raw: {} })),
};

function makeInboundFixture(args: {
  messageId: string;
  from: string;
  subject?: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
}): ParsedInboundEmail {
  return {
    messageId: stripAngleBrackets(args.messageId),
    from: { address: args.from, name: args.from },
    to: ["bot@yourdomain.com"],
    subject: args.subject ?? "",
    text: args.text,
    inReplyTo: args.inReplyTo,
    references: args.references,
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    raw: { fixture: true },
  };
}
