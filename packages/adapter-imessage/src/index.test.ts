import { afterEach, describe, expect, it, vi } from "vitest";

const LOCAL_ID_PATTERN = /^local-\d+$/;
const mockStartWatching = vi.fn();
const mockStopWatching = vi.fn();
const mockLocalClose = vi.fn();
const mockSend = vi.fn();

vi.mock("@photon-ai/imessage-kit", () => ({
  IMessageSDK: vi.fn(() => ({
    startWatching: mockStartWatching,
    stopWatching: mockStopWatching,
    close: mockLocalClose,
    send: mockSend,
  })),
}));

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();
const mockSendMessage = vi.fn();

vi.mock("@photon-ai/advanced-imessage-kit", () => ({
  AdvancedIMessageKit: {
    getInstance: vi.fn(() => ({
      mocked: true,
      connect: mockConnect,
      close: mockClose,
      on: mockOn,
      messages: { sendMessage: mockSendMessage },
    })),
  },
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

import { createiMessageAdapter, iMessageAdapter } from "./index";
import type { iMessageGatewayMessageData } from "./types";

function createMockChat() {
  return {
    getLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
    handleIncomingMessage: vi.fn(),
  };
}

describe("iMessageAdapter", () => {
  it("should have the correct name", () => {
    const adapter = new iMessageAdapter({ local: true });
    expect(adapter.name).toBe("imessage");
  });

  it("should store local mode config", () => {
    const adapter = new iMessageAdapter({ local: true });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBeUndefined();
    expect(adapter.apiKey).toBeUndefined();
  });

  it("should store local mode config with optional serverUrl", () => {
    const adapter = new iMessageAdapter({
      local: true,
      serverUrl: "http://localhost:1234",
    });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBe("http://localhost:1234");
  });

  it("should store remote mode config", () => {
    const adapter = new iMessageAdapter({
      local: false,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://example.com");
    expect(adapter.apiKey).toBe("test-key");
  });

  it("should create IMessageSDK for local mode", async () => {
    const { IMessageSDK } = await import("@photon-ai/imessage-kit");
    const adapter = new iMessageAdapter({ local: true });
    expect(IMessageSDK).toHaveBeenCalled();
    expect(adapter.sdk).toBeDefined();
  });

  it("should create AdvancedIMessageKit for remote mode", async () => {
    const { AdvancedIMessageKit } = await import(
      "@photon-ai/advanced-imessage-kit"
    );
    const adapter = new iMessageAdapter({
      local: false,
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
      expect(() => new iMessageAdapter({ local: true })).toThrow(
        "iMessage adapter local mode requires macOS"
      );
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
    const adapter = new iMessageAdapter({ local: true });
    const mockChat = createMockChat();
    await adapter.initialize(mockChat as never);
    expect(mockChat.getLogger).toHaveBeenCalledWith("imessage");
  });
});

describe("encodeThreadId / decodeThreadId", () => {
  it("should encode thread ID", () => {
    const adapter = new iMessageAdapter({ local: true });
    const threadId = adapter.encodeThreadId({
      chatGuid: "iMessage;-;+1234567890",
    });
    expect(threadId).toBe("imessage:iMessage;-;+1234567890");
  });

  it("should decode thread ID", () => {
    const adapter = new iMessageAdapter({ local: true });
    const result = adapter.decodeThreadId("imessage:iMessage;-;+1234567890");
    expect(result).toEqual({ chatGuid: "iMessage;-;+1234567890" });
  });

  it("should roundtrip encode/decode", () => {
    const adapter = new iMessageAdapter({ local: true });
    const original = { chatGuid: "iMessage;+;chat123456" };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("handleWebhook", () => {
  it("should reject invalid gateway token", async () => {
    const adapter = new iMessageAdapter({
      local: false,
      serverUrl: "https://example.com",
      apiKey: "correct-key",
    });
    await adapter.initialize(createMockChat() as never);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-imessage-gateway-token": "wrong-key",
      },
      body: JSON.stringify({
        type: "GATEWAY_NEW_MESSAGE",
        timestamp: 0,
        data: {},
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("should reject invalid JSON body", async () => {
    const adapter = new iMessageAdapter({ local: true, apiKey: "key" });
    await adapter.initialize(createMockChat() as never);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-imessage-gateway-token": "key",
      },
      body: "not json",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("should process forwarded GATEWAY_NEW_MESSAGE event", async () => {
    const mockChat = createMockChat();
    const adapter = new iMessageAdapter({ local: true, apiKey: "key" });
    await adapter.initialize(mockChat as never);

    const messageData: iMessageGatewayMessageData = {
      guid: "msg-123",
      text: "Hello!",
      sender: "+1234567890",
      senderName: "John",
      chatId: "iMessage;-;+1234567890",
      isGroupChat: false,
      isFromMe: false,
      date: new Date().toISOString(),
      attachments: [],
      source: "local",
    };

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-imessage-gateway-token": "key",
      },
      body: JSON.stringify({
        type: "GATEWAY_NEW_MESSAGE",
        timestamp: Date.now(),
        data: messageData,
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(mockChat.handleIncomingMessage).toHaveBeenCalledOnce();

    const [calledAdapter, calledThreadId, calledMessage] =
      mockChat.handleIncomingMessage.mock.calls[0];
    expect(calledAdapter).toBe(adapter);
    expect(calledThreadId).toBe("imessage:iMessage;-;+1234567890");
    expect(calledMessage.text).toBe("Hello!");
    expect(calledMessage.author.userId).toBe("+1234567890");
    expect(calledMessage.author.userName).toBe("John");
    expect(calledMessage.isMention).toBe(true);
  });

  it("should set isMention to false for group chats", async () => {
    const mockChat = createMockChat();
    const adapter = new iMessageAdapter({ local: true, apiKey: "key" });
    await adapter.initialize(mockChat as never);

    const messageData: iMessageGatewayMessageData = {
      guid: "msg-456",
      text: "Group hello",
      sender: "+1234567890",
      senderName: null,
      chatId: "iMessage;+;chat789",
      isGroupChat: true,
      isFromMe: false,
      date: new Date().toISOString(),
      attachments: [],
      source: "local",
    };

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-imessage-gateway-token": "key",
      },
      body: JSON.stringify({
        type: "GATEWAY_NEW_MESSAGE",
        timestamp: Date.now(),
        data: messageData,
      }),
    });

    await adapter.handleWebhook(request);
    const [, , calledMessage] = mockChat.handleIncomingMessage.mock.calls[0];
    expect(calledMessage.isMention).toBe(false);
    expect(calledMessage.author.userName).toBe("+1234567890");
  });

  it("should process native imessage-kit webhook payload", async () => {
    const mockChat = createMockChat();
    const adapter = new iMessageAdapter({ local: true, apiKey: "key" });
    await adapter.initialize(mockChat as never);

    const nativePayload = {
      guid: "native-msg-001",
      text: "Hello from native webhook!",
      sender: "+1987654321",
      senderName: "Jane",
      chatId: "iMessage;-;+1987654321",
      isGroupChat: false,
      isFromMe: false,
      isReaction: false,
      service: "iMessage",
      date: new Date().toISOString(),
      attachments: [
        {
          id: "att-1",
          filename: "photo.jpg",
          mimeType: "image/jpeg",
          size: 12345,
          path: "/tmp/photo.jpg",
          isImage: true,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-imessage-gateway-token": "key",
      },
      body: JSON.stringify(nativePayload),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.handleIncomingMessage).toHaveBeenCalledOnce();

    const [, calledThreadId, calledMessage] =
      mockChat.handleIncomingMessage.mock.calls[0];
    expect(calledThreadId).toBe("imessage:iMessage;-;+1987654321");
    expect(calledMessage.text).toBe("Hello from native webhook!");
    expect(calledMessage.author.userId).toBe("+1987654321");
    expect(calledMessage.author.userName).toBe("Jane");
    expect(calledMessage.isMention).toBe(true);
    expect(calledMessage.attachments).toHaveLength(1);
    expect(calledMessage.attachments[0].type).toBe("image");
    expect(calledMessage.attachments[0].name).toBe("photo.jpg");
  });

  it("should return 400 for unrecognized payload with gateway token", async () => {
    const adapter = new iMessageAdapter({ local: true, apiKey: "key" });
    await adapter.initialize(createMockChat() as never);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-imessage-gateway-token": "key",
      },
      body: JSON.stringify({ something: "unknown" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toBe("Unrecognized payload");
  });

  it("should return 400 for requests without gateway token", async () => {
    const adapter = new iMessageAdapter({ local: true });
    await adapter.initialize(createMockChat() as never);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "{}",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

describe("startGatewayListener", () => {
  it("should return 500 without chat instance", async () => {
    const adapter = new iMessageAdapter({ local: true });
    const response = await adapter.startGatewayListener({
      waitUntil: vi.fn(),
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe("Chat instance not initialized");
  });

  it("should return 500 without waitUntil", async () => {
    const adapter = new iMessageAdapter({ local: true });
    await adapter.initialize(createMockChat() as never);

    const response = await adapter.startGatewayListener({});
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe("waitUntil not provided");
  });

  it("should start listening and return success response", async () => {
    const adapter = new iMessageAdapter({ local: true });
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
    const adapter = new iMessageAdapter({ local: true });
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

  it("should create a new SDK instance with webhook config in local mode", async () => {
    const { IMessageSDK } = await import("@photon-ai/imessage-kit");
    const adapter = new iMessageAdapter({ local: true, apiKey: "my-key" });
    await adapter.initialize(createMockChat() as never);

    const callCountBefore = (IMessageSDK as ReturnType<typeof vi.fn>).mock.calls
      .length;

    const controller = new AbortController();
    const waitUntil = vi.fn();

    await adapter.startGatewayListener(
      { waitUntil },
      60000,
      controller.signal,
      "https://example.com/webhook"
    );

    // A new IMessageSDK instance should have been created with webhook config
    const callCountAfter = (IMessageSDK as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(callCountAfter).toBe(callCountBefore + 1);
    const lastCall = (IMessageSDK as ReturnType<typeof vi.fn>).mock.calls[
      callCountAfter - 1
    ];
    expect(lastCall[0]).toEqual({
      webhook: {
        url: "https://example.com/webhook",
        headers: { "x-imessage-gateway-token": "my-key" },
        retries: 2,
        backoffMs: 500,
      },
      watcher: { excludeOwnMessages: true },
    });

    controller.abort();
    const listenerPromise = waitUntil.mock.calls[0][0] as Promise<void>;
    await listenerPromise;
  });
});

describe("postMessage", () => {
  afterEach(() => {
    mockSend.mockReset();
    mockSendMessage.mockReset();
  });

  it("should send via local SDK with DM chatGuid", async () => {
    const adapter = new iMessageAdapter({ local: true });
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
    const adapter = new iMessageAdapter({ local: true });
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
    const adapter = new iMessageAdapter({ local: true });
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

  it("should throw when remote mode is missing serverUrl", () => {
    expect(() => createiMessageAdapter({ local: false })).toThrow(
      "serverUrl is required when local is false"
    );
  });

  it("should throw when remote mode is missing apiKey", () => {
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
