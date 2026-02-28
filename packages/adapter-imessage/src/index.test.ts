import { afterEach, describe, expect, it, vi } from "vitest";

const LOCAL_ID_PATTERN = /^local-\d+$/;

const {
  mockStartWatching,
  mockStopWatching,
  mockLocalClose,
  mockSend,
  mockConnect,
  mockClose,
  mockOnce,
  mockSendMessage,
  mockEditMessage,
  mockGetChat,
  mockSendReaction,
  mockStartTyping,
  mockStopTyping,
  mockGatewayConnect,
  mockGatewayClose,
  mockGatewayOn,
  MockAdvancedIMessageKit,
} = vi.hoisted(() => {
  const mockStartWatching = vi.fn();
  const mockStopWatching = vi.fn();
  const mockLocalClose = vi.fn();
  const mockSend = vi.fn();
  const mockConnect = vi.fn();
  const mockClose = vi.fn();
  const mockOn = vi.fn();
  const mockOnce = vi.fn((_event: string, cb: () => void) => cb());
  const mockSendMessage = vi.fn();
  const mockEditMessage = vi.fn();
  const mockGetChat = vi.fn();
  const mockSendReaction = vi.fn();
  const mockStartTyping = vi.fn();
  const mockStopTyping = vi.fn();
  const mockGatewayConnect = vi.fn();
  const mockGatewayClose = vi.fn();
  const mockGatewayOn = vi.fn();

  const MockAdvancedIMessageKit = vi.fn(() => ({
    mocked: true,
    connect: mockGatewayConnect,
    close: mockGatewayClose,
    on: mockGatewayOn,
    once: vi.fn(),
    messages: {},
    chats: {},
  }));
  (MockAdvancedIMessageKit as unknown as Record<string, unknown>).getInstance =
    vi.fn(() => ({
      mocked: true,
      connect: mockConnect,
      close: mockClose,
      on: mockOn,
      once: mockOnce,
      messages: {
        sendMessage: mockSendMessage,
        editMessage: mockEditMessage,
        sendReaction: mockSendReaction,
      },
      chats: {
        getChat: mockGetChat,
        startTyping: mockStartTyping,
        stopTyping: mockStopTyping,
      },
    }));

  return {
    mockStartWatching,
    mockStopWatching,
    mockLocalClose,
    mockSend,
    mockConnect,
    mockClose,
    mockOn,
    mockOnce,
    mockSendMessage,
    mockEditMessage,
    mockGetChat,
    mockSendReaction,
    mockStartTyping,
    mockStopTyping,
    mockGatewayConnect,
    mockGatewayClose,
    mockGatewayOn,
    MockAdvancedIMessageKit,
  };
});

vi.mock("@photon-ai/imessage-kit", () => ({
  IMessageSDK: vi.fn(() => ({
    startWatching: mockStartWatching,
    stopWatching: mockStopWatching,
    close: mockLocalClose,
    send: mockSend,
  })),
}));

vi.mock("@photon-ai/advanced-imessage-kit", () => ({
  AdvancedIMessageKit: MockAdvancedIMessageKit,
}));

vi.mock("chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("chat")>();
  return {
    ...actual,
    parseMarkdown: vi.fn((text: string) => ({
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: text }] },
      ],
    })),
  };
});

import { ValidationError } from "@chat-adapter/shared";
import { createiMessageAdapter, iMessageAdapter } from "./index";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function createMockChat() {
  return {
    handleIncomingMessage: vi.fn(),
  };
}

describe("iMessageAdapter", () => {
  it("should have the correct name", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(adapter.name).toBe("imessage");
  });

  it("should store local mode config", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBeUndefined();
    expect(adapter.apiKey).toBeUndefined();
  });

  it("should store local mode config with optional serverUrl", () => {
    const adapter = new iMessageAdapter({
      local: true,
      logger: mockLogger,
      serverUrl: "http://localhost:1234",
    });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBe("http://localhost:1234");
  });

  it("should store remote mode config", () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://example.com");
    expect(adapter.apiKey).toBe("test-key");
  });

  it("should create IMessageSDK for local mode", async () => {
    const { IMessageSDK } = await import("@photon-ai/imessage-kit");
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(IMessageSDK).toHaveBeenCalled();
    expect(adapter.sdk).toBeDefined();
  });

  it("should create AdvancedIMessageKit for remote mode", async () => {
    const { AdvancedIMessageKit } = await import(
      "@photon-ai/advanced-imessage-kit"
    );
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(AdvancedIMessageKit.getInstance).toHaveBeenCalledWith({
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(adapter.sdk).toBeDefined();
  });

  it("should throw on non-macOS platform in local mode", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(
        () => new iMessageAdapter({ local: true, logger: mockLogger })
      ).toThrow("iMessage adapter local mode requires macOS");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("should allow remote mode on non-macOS platforms", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      const adapter = new iMessageAdapter({
        local: false,
        logger: mockLogger,
        serverUrl: "https://example.com",
        apiKey: "test-key",
      });
      expect(adapter.local).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

describe("initialize", () => {
  it("should store chat instance and not throw", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat as never);
    // Logger is set in constructor, not in initialize
    expect(adapter.name).toBe("imessage");
  });

  it("should connect and wait for ready in remote mode", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat as never);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockOnce).toHaveBeenCalledWith("ready", expect.any(Function));
  });
});

describe("encodeThreadId / decodeThreadId", () => {
  it("should encode thread ID", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    const threadId = adapter.encodeThreadId({
      chatGuid: "iMessage;-;+1234567890",
    });
    expect(threadId).toBe("imessage:iMessage;-;+1234567890");
  });

  it("should decode thread ID", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    const result = adapter.decodeThreadId("imessage:iMessage;-;+1234567890");
    expect(result).toEqual({ chatGuid: "iMessage;-;+1234567890" });
  });

  it("should roundtrip encode/decode", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    const original = { chatGuid: "iMessage;+;chat123456" };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("should throw on thread ID from another adapter", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(() => adapter.decodeThreadId("slack:C123:1234567890.123")).toThrow(
      "Invalid iMessage thread ID"
    );
  });
});

describe("isDM", () => {
  it("should return true for DM thread IDs (;-; pattern)", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(adapter.isDM("imessage:iMessage;-;+1234567890")).toBe(true);
  });

  it("should return false for group thread IDs (;+; pattern)", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(adapter.isDM("imessage:iMessage;+;chat493787071395575843")).toBe(
      false
    );
  });

  it("should return true for SMS DMs", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    expect(adapter.isDM("imessage:SMS;-;+1234567890")).toBe(true);
  });
});

describe("handleWebhook", () => {
  it("should return 501 (not supported)", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "{}",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(501);
  });
});

describe("startGatewayListener", () => {
  afterEach(() => {
    mockGatewayConnect.mockReset();
    mockGatewayClose.mockReset();
    mockGatewayOn.mockReset();
    mockClose.mockReset();
  });

  it("should return 500 without chat instance", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    const response = await adapter.startGatewayListener({
      waitUntil: vi.fn(),
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe("Chat instance not initialized");
  });

  it("should return 500 without waitUntil", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    const response = await adapter.startGatewayListener({});
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe("waitUntil not provided");
  });

  it("should start listening and return success response", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    const waitUntil = vi.fn();
    const response = await adapter.startGatewayListener({ waitUntil }, 5000);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("listening");
    expect(body.durationMs).toBe(5000);
    expect(body.mode).toBe("local");
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("should use abort signal to stop early", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    const controller = new AbortController();
    const waitUntil = vi.fn();

    await adapter.startGatewayListener({ waitUntil }, 60000, controller.signal);

    // The listener promise was passed to waitUntil
    expect(waitUntil).toHaveBeenCalledOnce();
    const listenerPromise = waitUntil.mock.calls[0][0] as Promise<void>;

    // Abort immediately
    controller.abort();

    // The promise should resolve after abort
    await listenerPromise;
    expect(mockStopWatching).toHaveBeenCalled();
  });

  it("should create a dedicated SDK instance in remote mode and close only that", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    const controller = new AbortController();
    const waitUntil = vi.fn();

    // Track constructor calls before starting listener
    const callCountBefore = MockAdvancedIMessageKit.mock.calls.length;

    await adapter.startGatewayListener(
      { waitUntil },
      60000,
      controller.signal
    );

    // A new AdvancedIMessageKit instance should have been created (not getInstance)
    expect(MockAdvancedIMessageKit.mock.calls.length).toBe(
      callCountBefore + 1
    );
    expect(MockAdvancedIMessageKit).toHaveBeenLastCalledWith({
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });

    // The gateway SDK should have been connected and had listener attached
    expect(mockGatewayConnect).toHaveBeenCalled();
    expect(mockGatewayOn).toHaveBeenCalledWith(
      "new-message",
      expect.any(Function)
    );

    controller.abort();
    const listenerPromise = waitUntil.mock.calls[0][0] as Promise<void>;
    await listenerPromise;

    // Only the gateway SDK should be closed, not the shared singleton
    expect(mockGatewayClose).toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

});

describe("postMessage", () => {
  afterEach(() => {
    mockSend.mockReset();
    mockSendMessage.mockReset();
  });

  it("should send via local SDK with DM chatGuid", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    mockSend.mockResolvedValue({
      sentAt: new Date(),
      message: { guid: "sent-msg-001" },
    });

    const result = await adapter.postMessage(
      "imessage:iMessage;-;+1234567890",
      "Hello!"
    );

    expect(mockSend).toHaveBeenCalledWith("+1234567890", "Hello!");
    expect(result.id).toBe("sent-msg-001");
    expect(result.threadId).toBe("imessage:iMessage;-;+1234567890");
    expect(result.raw).toEqual({
      sentAt: expect.any(Date),
      message: { guid: "sent-msg-001" },
    });
  });

  it("should send via local SDK with group chatGuid", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    mockSend.mockResolvedValue({
      sentAt: new Date(),
      message: { guid: "sent-msg-002" },
    });

    const result = await adapter.postMessage(
      "imessage:iMessage;+;chat493787071395575843",
      "Hello group!"
    );

    expect(mockSend).toHaveBeenCalledWith(
      "chat493787071395575843",
      "Hello group!"
    );
    expect(result.id).toBe("sent-msg-002");
  });

  it("should fallback to generated ID when local SDK has no message guid", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    mockSend.mockResolvedValue({ sentAt: new Date() });

    const result = await adapter.postMessage(
      "imessage:iMessage;-;+1234567890",
      "Hi"
    );

    expect(result.id).toMatch(LOCAL_ID_PATTERN);
  });

  it("should send via remote SDK", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockSendMessage.mockResolvedValue({
      guid: "remote-msg-001",
      text: "Hello!",
    });

    const result = await adapter.postMessage(
      "imessage:iMessage;-;+1234567890",
      "Hello!"
    );

    expect(mockSendMessage).toHaveBeenCalledWith({
      chatGuid: "iMessage;-;+1234567890",
      message: "Hello!",
    });
    expect(result.id).toBe("remote-msg-001");
    expect(result.threadId).toBe("imessage:iMessage;-;+1234567890");
    expect(result.raw).toEqual({
      guid: "remote-msg-001",
      text: "Hello!",
    });
  });
});

describe("editMessage", () => {
  afterEach(() => {
    mockEditMessage.mockReset();
  });

  it("should throw NotImplementedError in local mode", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    await expect(
      adapter.editMessage(
        "imessage:iMessage;-;+1234567890",
        "msg-guid-001",
        "Updated text"
      )
    ).rejects.toThrow("editMessage is not supported in local mode");
  });

  it("should edit via remote SDK", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockEditMessage.mockResolvedValue({
      guid: "msg-guid-001",
      text: "Updated text",
      dateEdited: 1234567890,
    });

    const result = await adapter.editMessage(
      "imessage:iMessage;-;+1234567890",
      "msg-guid-001",
      "Updated text"
    );

    expect(mockEditMessage).toHaveBeenCalledWith({
      messageGuid: "msg-guid-001",
      editedMessage: "Updated text",
      backwardsCompatibilityMessage: "Updated text",
    });
    expect(result.id).toBe("msg-guid-001");
    expect(result.threadId).toBe("imessage:iMessage;-;+1234567890");
    expect(result.raw).toEqual({
      guid: "msg-guid-001",
      text: "Updated text",
      dateEdited: 1234567890,
    });
  });
});

describe("addReaction / removeReaction", () => {
  afterEach(() => {
    mockSendReaction.mockReset();
  });

  it("should throw NotImplementedError in local mode for addReaction", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    await expect(
      adapter.addReaction("imessage:iMessage;-;+1234567890", "msg-001", "heart")
    ).rejects.toThrow("addReaction is not supported in local mode");
  });

  it("should throw NotImplementedError in local mode for removeReaction", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    await expect(
      adapter.removeReaction(
        "imessage:iMessage;-;+1234567890",
        "msg-001",
        "heart"
      )
    ).rejects.toThrow("removeReaction is not supported in local mode");
  });

  it("should send tapback via remote SDK for addReaction", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockSendReaction.mockResolvedValue({ guid: "reaction-001" });

    await adapter.addReaction(
      "imessage:iMessage;-;+1234567890",
      "msg-001",
      "heart"
    );

    expect(mockSendReaction).toHaveBeenCalledWith({
      chatGuid: "iMessage;-;+1234567890",
      messageGuid: "msg-001",
      reaction: "love",
    });
  });

  it("should map thumbs_up to like tapback", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockSendReaction.mockResolvedValue({ guid: "reaction-002" });

    await adapter.addReaction(
      "imessage:iMessage;-;+1234567890",
      "msg-001",
      "thumbs_up"
    );

    expect(mockSendReaction).toHaveBeenCalledWith({
      chatGuid: "iMessage;-;+1234567890",
      messageGuid: "msg-001",
      reaction: "like",
    });
  });

  it("should send remove tapback with dash prefix for removeReaction", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockSendReaction.mockResolvedValue({ guid: "reaction-003" });

    await adapter.removeReaction(
      "imessage:iMessage;-;+1234567890",
      "msg-001",
      "laugh"
    );

    expect(mockSendReaction).toHaveBeenCalledWith({
      chatGuid: "iMessage;-;+1234567890",
      messageGuid: "msg-001",
      reaction: "-laugh",
    });
  });

  it("should throw for unsupported emoji", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    await expect(
      adapter.addReaction("imessage:iMessage;-;+1234567890", "msg-001", "fire")
    ).rejects.toThrow('Unsupported iMessage tapback: "fire"');
  });
});

describe("startTyping", () => {
  afterEach(() => {
    mockStartTyping.mockReset();
    mockStopTyping.mockReset();
  });

  it("should throw NotImplementedError in local mode", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    await expect(
      adapter.startTyping("imessage:iMessage;-;+1234567890")
    ).rejects.toThrow("startTyping is not supported in local mode");
  });

  it("should call startTyping via remote SDK", async () => {
    vi.useFakeTimers();
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockStartTyping.mockResolvedValue(undefined);
    mockStopTyping.mockResolvedValue(undefined);

    await adapter.startTyping("imessage:iMessage;-;+1234567890");

    expect(mockStartTyping).toHaveBeenCalledWith("iMessage;-;+1234567890");
    expect(mockStopTyping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);

    expect(mockStopTyping).toHaveBeenCalledWith("iMessage;-;+1234567890");
    vi.useRealTimers();
  });
});

describe("fetchThread", () => {
  afterEach(() => {
    mockGetChat.mockReset();
  });

  it("should throw NotImplementedError in local mode", async () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    await adapter.initialize(createMockChat() as never);

    await expect(
      adapter.fetchThread("imessage:iMessage;-;+1234567890")
    ).rejects.toThrow("fetchThread is not supported in local mode");
  });

  it("should fetch DM thread via remote SDK", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockGetChat.mockResolvedValue({
      originalROWID: 1,
      guid: "iMessage;-;+1234567890",
      style: 43,
      chatIdentifier: "+1234567890",
      isArchived: false,
      displayName: "",
      participants: [{ address: "+1234567890" }],
    });

    const result = await adapter.fetchThread("imessage:iMessage;-;+1234567890");

    expect(mockGetChat).toHaveBeenCalledWith("iMessage;-;+1234567890");
    expect(result.id).toBe("imessage:iMessage;-;+1234567890");
    expect(result.channelId).toBe("iMessage;-;+1234567890");
    expect(result.isDM).toBe(true);
    expect(result.channelName).toBeUndefined();
    expect(result.metadata.chatIdentifier).toBe("+1234567890");
  });

  it("should fetch group thread via remote SDK", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    await adapter.initialize(createMockChat() as never);

    mockGetChat.mockResolvedValue({
      originalROWID: 2,
      guid: "iMessage;+;chat493787071395575843",
      style: 45,
      chatIdentifier: "chat493787071395575843",
      isArchived: false,
      displayName: "Family Group",
      participants: [{ address: "+1234567890" }, { address: "+1987654321" }],
    });

    const result = await adapter.fetchThread(
      "imessage:iMessage;+;chat493787071395575843"
    );

    expect(result.isDM).toBe(false);
    expect(result.channelName).toBe("Family Group");
    expect(result.metadata.style).toBe(45);
  });
});

describe("parseMessage", () => {
  it("should parse local imessage-kit Message when local is true", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    adapter.initialize(createMockChat() as never);

    const localRaw = {
      id: "123",
      guid: "msg-local-001",
      text: "Hello from local",
      sender: "+1234567890",
      senderName: "Alice",
      chatId: "iMessage;-;+1234567890",
      isGroupChat: false,
      service: "iMessage",
      isRead: true,
      isFromMe: false,
      isReaction: false,
      reactionType: null,
      isReactionRemoval: false,
      associatedMessageGuid: null,
      attachments: [],
      date: new Date("2026-01-15T12:00:00Z"),
    };

    const message = adapter.parseMessage(localRaw);
    expect(message.id).toBe("msg-local-001");
    expect(message.text).toBe("Hello from local");
    expect(message.author.userId).toBe("+1234567890");
    expect(message.author.userName).toBe("Alice");
    expect(message.threadId).toBe("imessage:iMessage;-;+1234567890");
    expect(message.isMention).toBe(true);
  });

  it("should parse remote advanced-imessage-kit MessageResponse when local is false", () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    adapter.initialize(createMockChat() as never);

    const remoteRaw = {
      originalROWID: 1,
      guid: "msg-remote-001",
      text: "Hello from remote",
      handleId: 1,
      otherHandle: 0,
      handle: { address: "+1987654321" },
      chats: [{ guid: "iMessage;-;+1987654321", style: 43 }],
      subject: "",
      error: 0,
      dateCreated: new Date("2026-01-15T12:00:00Z").getTime(),
      dateRead: null,
      dateDelivered: null,
      isFromMe: false,
      isArchived: false,
      itemType: 0,
      groupTitle: null,
      groupActionType: 0,
      balloonBundleId: null,
      associatedMessageGuid: null,
      associatedMessageType: null,
      expressiveSendStyleId: null,
      attachments: [],
    };

    const message = adapter.parseMessage(remoteRaw);
    expect(message.id).toBe("msg-remote-001");
    expect(message.text).toBe("Hello from remote");
    expect(message.author.userId).toBe("+1987654321");
    expect(message.threadId).toBe("imessage:iMessage;-;+1987654321");
    expect(message.isMention).toBe(true);
  });

  it("should set isMention to false for group chats in local mode", () => {
    const adapter = new iMessageAdapter({ local: true, logger: mockLogger });
    adapter.initialize(createMockChat() as never);

    const localRaw = {
      id: "123",
      guid: "msg-local-002",
      text: "Group message",
      sender: "+1234567890",
      senderName: null,
      chatId: "iMessage;+;chat123456",
      isGroupChat: true,
      service: "iMessage",
      isRead: true,
      isFromMe: false,
      isReaction: false,
      reactionType: null,
      isReactionRemoval: false,
      associatedMessageGuid: null,
      attachments: [],
      date: new Date("2026-01-15T12:00:00Z"),
    };

    const message = adapter.parseMessage(localRaw);
    expect(message.isMention).toBe(false);
    expect(message.author.userName).toBe("+1234567890");
  });

  it("should handle attachments from remote payload", () => {
    const adapter = new iMessageAdapter({
      local: false,
      logger: mockLogger,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    adapter.initialize(createMockChat() as never);

    const remoteRaw = {
      originalROWID: 2,
      guid: "msg-remote-002",
      text: "Photo",
      handleId: 1,
      otherHandle: 0,
      handle: { address: "+1987654321" },
      chats: [{ guid: "iMessage;-;+1987654321", style: 43 }],
      subject: "",
      error: 0,
      dateCreated: Date.now(),
      dateRead: null,
      dateDelivered: null,
      isFromMe: false,
      isArchived: false,
      itemType: 0,
      groupTitle: null,
      groupActionType: 0,
      balloonBundleId: null,
      associatedMessageGuid: null,
      associatedMessageType: null,
      expressiveSendStyleId: null,
      attachments: [
        {
          guid: "att-001",
          transferName: "photo.jpg",
          mimeType: "image/jpeg",
          totalBytes: 54321,
        },
      ],
    };

    const message = adapter.parseMessage(remoteRaw);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("image");
    expect(message.attachments[0].name).toBe("photo.jpg");
    expect(message.attachments[0].mimeType).toBe("image/jpeg");
  });
});

describe("createiMessageAdapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should default to local mode", () => {
    const adapter = createiMessageAdapter();
    expect(adapter.local).toBe(true);
  });

  it("should use remote mode when local is false", () => {
    const adapter = createiMessageAdapter({
      local: false,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://example.com");
    expect(adapter.apiKey).toBe("test-key");
  });

  it("should read IMESSAGE_LOCAL env var", () => {
    vi.stubEnv("IMESSAGE_LOCAL", "false");
    vi.stubEnv("IMESSAGE_SERVER_URL", "https://env.example.com");
    vi.stubEnv("IMESSAGE_API_KEY", "env-key");

    const adapter = createiMessageAdapter();
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://env.example.com");
    expect(adapter.apiKey).toBe("env-key");
  });

  it("should throw ValidationError when remote mode is missing serverUrl", () => {
    expect(() => createiMessageAdapter({ local: false })).toThrow(
      ValidationError
    );
    expect(() => createiMessageAdapter({ local: false })).toThrow(
      "serverUrl is required when local is false"
    );
  });

  it("should throw ValidationError when remote mode is missing apiKey", () => {
    expect(() =>
      createiMessageAdapter({
        local: false,
        serverUrl: "https://example.com",
      })
    ).toThrow(ValidationError);
    expect(() =>
      createiMessageAdapter({
        local: false,
        serverUrl: "https://example.com",
      })
    ).toThrow("apiKey is required when local is false");
  });

  it("should prefer config values over env vars", () => {
    vi.stubEnv("IMESSAGE_SERVER_URL", "https://env.example.com");
    vi.stubEnv("IMESSAGE_API_KEY", "env-key");

    const adapter = createiMessageAdapter({
      local: false,
      serverUrl: "https://config.example.com",
      apiKey: "config-key",
    });
    expect(adapter.serverUrl).toBe("https://config.example.com");
    expect(adapter.apiKey).toBe("config-key");
  });

  it("should read IMESSAGE_SERVER_URL and IMESSAGE_API_KEY for local mode", () => {
    vi.stubEnv("IMESSAGE_SERVER_URL", "http://localhost:5678");
    vi.stubEnv("IMESSAGE_API_KEY", "local-key");

    const adapter = createiMessageAdapter({ local: true });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBe("http://localhost:5678");
    expect(adapter.apiKey).toBe("local-key");
  });

});
