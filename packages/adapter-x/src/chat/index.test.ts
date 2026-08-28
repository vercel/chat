import type { ChatInstance } from "chat";
import { describe, expect, it, vi } from "vitest";

const createChatMock = vi.hoisted(() => vi.fn());
const getPublicKeyMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: [
      {
        publicKeyVersion: "1",
        juiceboxConfig: {
          keyStoreTokenMapJson: JSON.stringify({
            realms: [],
            register_threshold: 0,
            recover_threshold: 0,
          }),
          maxGuessCount: 20,
          tokenMap: [
            {
              key: "testrealm",
              value: { address: "https://juicebox.test", token: "test-token" },
            },
          ],
        },
      },
    ],
  })
);

vi.mock("@xdevplatform/chat-xdk", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@xdevplatform/chat-xdk")>();
  return {
    ...actual,
    createChat: (...args: unknown[]) => createChatMock(...args),
  };
});

vi.mock("@xdevplatform/xdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xdevplatform/xdk")>();
  return {
    ...actual,
    Client: class MockClient {
      users = { getPublicKey: getPublicKeyMock };
      chat = {
        getConversationEvents: vi.fn(),
        sendMessage: vi.fn(),
        sendTypingIndicator: vi.fn(),
      };
      headers: Headers;
      constructor(config?: { headers?: Record<string, string> }) {
        // Mirror the real client: defaults first, config headers win.
        this.headers = new Headers({
          "User-Agent": "xdk-typescript/0.0.0-test",
          ...config?.headers,
        });
      }
    },
  };
});

import {
  conversationPathId,
  dashConversationId,
  detectEntities,
  extractMediaEntries,
  extractPostAttachments,
  mentionHandlesFromEntities,
  withChatSdkUserAgent,
  XchatAdapter,
} from "./index";
import {
  b64ToBytes,
  createInitializedTestAdapter,
  createMockChatInstance,
  createTestCryptoEngine,
  loadVectors,
  type MockXdkClient,
  mockLogger,
  TEST_CANONICAL_CONVERSATION_ID,
  TEST_CONVERSATION_ID,
  TEST_OTHER_USER_ID,
  TEST_PIN,
  TEST_THREAD_ID,
  TEST_USER_ID,
} from "./test-utils";
import type { XchatRawMessage } from "./types";

// ── Error-message patterns asserted in tests ────────────────────────
const MISSING_ACCESS_TOKEN_RE = /accessToken|botToken/i;
const UNINITIALIZED_RE = /uninitialized/;
const NOT_INITIALIZED_RE = /not initialized/i;
const NO_CONVERSATION_KEY_RE = /No conversation key/;
const NO_REGISTERED_CHAT_KEYS_RE = /no registered chat keys/;
const NO_SEQUENCE_ID_RE = /No sequence id known/;
const NO_JUICEBOX_CONFIG_RE = /no Juicebox config/;
const HTTP_404_RE = /HTTP 404/;
const CHAT_SDK_UA_TOKEN_RE = /^chat-sdk-xchat\/\d+\.\d+\.\d+/;
const CHAT_SDK_THEN_XDK_UA_RE =
  /^chat-sdk-xchat\/\d+\.\d+\.\d+ xdk-typescript\//;

/**
 * Create a minimal XchatAdapter for testing.
 * Crypto and API calls are not initialized — only thread ID and parsing methods work.
 */
function createTestAdapter(): XchatAdapter {
  return new XchatAdapter({
    accessToken: "test-token",
    userId: TEST_USER_ID,
    userName: "test-bot",
    logger: mockLogger,
    // These tests exercise routing and parsing, not webhook authentication,
    // so they opt out of the signature check the adapter otherwise requires.
    disableWebhookVerification: true,
  });
}

describe("conversationPathId", () => {
  it("returns the other participant for hyphen 1:1 ids", () => {
    expect(conversationPathId(TEST_CONVERSATION_ID, TEST_USER_ID)).toBe(
      TEST_OTHER_USER_ID
    );
  });

  it("returns the other participant for colon 1:1 ids", () => {
    expect(
      conversationPathId(TEST_CANONICAL_CONVERSATION_ID, TEST_USER_ID)
    ).toBe(TEST_OTHER_USER_ID);
  });

  it("returns group ids unchanged", () => {
    expect(conversationPathId("gABCDE", TEST_USER_ID)).toBe("gABCDE");
  });
});

describe("dashConversationId", () => {
  it("dash-joins colon 1:1 ids", () => {
    expect(dashConversationId(TEST_CANONICAL_CONVERSATION_ID)).toBe(
      TEST_CONVERSATION_ID
    );
  });

  it("keeps dash 1:1 ids unchanged", () => {
    expect(dashConversationId(TEST_CONVERSATION_ID)).toBe(TEST_CONVERSATION_ID);
  });

  it("returns group ids unchanged", () => {
    expect(dashConversationId("gABCDE")).toBe("gABCDE");
  });
});

describe("encodeThreadId", () => {
  it("should encode a 1:1 conversation ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({ conversationId: "12345-67890" });
    expect(result).toBe("xchat:12345-67890");
  });

  it("should encode a group conversation ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({ conversationId: "gABCDE" });
    expect(result).toBe("xchat:gABCDE");
  });
});

describe("decodeThreadId", () => {
  it("should decode a valid 1:1 thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("xchat:12345-67890");
    expect(result).toEqual({ conversationId: "12345-67890" });
  });

  it("should decode a valid group thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("xchat:gABCDE");
    expect(result).toEqual({ conversationId: "gABCDE" });
  });

  it("should throw on invalid prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("slack:C123:ts123")).toThrow(
      "Invalid XChat thread ID"
    );
  });

  it("should throw on empty after prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("xchat:")).toThrow(
      "Invalid XChat thread ID format"
    );
  });
});

describe("isDM", () => {
  it("should return true for 1:1 conversation", () => {
    const adapter = createTestAdapter();
    expect(adapter.isDM("xchat:12345-67890")).toBe(true);
  });

  it("should return false for group conversation", () => {
    const adapter = createTestAdapter();
    expect(adapter.isDM("xchat:gABCDE")).toBe(false);
  });
});

describe("channelIdFromThreadId", () => {
  it("should return the same thread ID", () => {
    const adapter = createTestAdapter();
    expect(adapter.channelIdFromThreadId("xchat:12345-67890")).toBe(
      "xchat:12345-67890"
    );
  });
});

describe("parseMessage", () => {
  it("should parse a decrypted text message", () => {
    const adapter = createTestAdapter();
    const raw: XchatRawMessage = {
      event: {
        id: "msg-1",
        conversationId: "12345-67890",
        senderId: "67890",
        encodedEvent: "base64data",
        createdAtMsec: "1700000000000",
      },
      decrypted: {
        type: "message",
        id: "msg-1",
        senderId: "67890",
        conversationId: "12345:67890",
        createdAtMsec: 1700000000000,
        content: { text: "Hello world", contentType: "Text" },
        verified: true,
      },
    };

    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("msg-1");
    expect(message.text).toBe("Hello world");
    expect(message.author.userId).toBe("67890");
    expect(message.author.isMe).toBe(false);
    expect(message.threadId).toBe("xchat:12345-67890");
  });

  it("should handle messages with no decrypted content", () => {
    const adapter = createTestAdapter();
    const raw: XchatRawMessage = {
      event: {
        id: "msg-2",
        conversationId: "12345-67890",
        senderId: "67890",
        encodedEvent: "base64data",
      },
      decrypted: null,
    };

    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("msg-2");
    expect(message.text).toBe("");
  });

  it("should detect self messages", () => {
    const adapter = createTestAdapter();
    const raw: XchatRawMessage = {
      event: {
        id: "msg-3",
        conversationId: "12345-67890",
        senderId: "12345",
        encodedEvent: "base64data",
      },
      decrypted: {
        type: "message",
        senderId: "12345",
        content: { text: "My message" },
      },
    };

    const message = adapter.parseMessage(raw);
    expect(message.author.isMe).toBe(true);
  });
});

describe("handleWebhook", () => {
  // CRC challenges (GET) are handled at the route level, not by the adapter.
  // The adapter only handles POST requests.

  it("should return 405 for GET requests", async () => {
    const adapter = createTestAdapter();
    const request = new Request("https://example.com/webhook", {
      method: "GET",
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(405);
  });

  it("should return 400 for invalid JSON body", async () => {
    const adapter = createTestAdapter();
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("should return 200 for valid event without conversationId", async () => {
    const adapter = createTestAdapter();
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("should reject POST when no consumerSecret is configured", async () => {
    const adapter = new XchatAdapter({
      accessToken: "test-token",
      userId: TEST_USER_ID,
      userName: "test-bot",
      logger: mockLogger,
    });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("should accept unsigned POST when signature verification is disabled", async () => {
    const adapter = new XchatAdapter({
      accessToken: "test-token",
      userId: TEST_USER_ID,
      userName: "test-bot",
      logger: mockLogger,
      disableWebhookVerification: true,
    });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("should reject POST with missing signature when consumerSecret is set", async () => {
    const adapter = new XchatAdapter({
      accessToken: "test-token",
      userId: TEST_USER_ID,
      consumerSecret: "test-secret",
      userName: "test-bot",
      logger: mockLogger,
    });
    const xaaPayload = {
      data: {
        event_type: "chat.received",
        payload: {
          id: "evt-1",
          conversation_id: TEST_CONVERSATION_ID,
          sender_id: TEST_OTHER_USER_ID,
          encoded_event: "data",
        },
      },
    };
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify(xaaPayload),
      headers: { "Content-Type": "application/json" },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("should reject POST with invalid signature", async () => {
    const adapter = new XchatAdapter({
      accessToken: "test-token",
      userId: TEST_USER_ID,
      consumerSecret: "test-secret",
      userName: "test-bot",
      logger: mockLogger,
    });
    const xaaPayload = {
      data: {
        event_type: "chat.received",
        payload: {
          id: "evt-1",
          conversation_id: TEST_CONVERSATION_ID,
          sender_id: TEST_OTHER_USER_ID,
          encoded_event: "data",
        },
      },
    };
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify(xaaPayload),
      headers: {
        "Content-Type": "application/json",
        "x-twitter-webhooks-signature": "sha256=invalidsignature",
      },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("should accept POST with valid signature", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = "test-secret";
    const adapter = new XchatAdapter({
      accessToken: "test-token",
      userId: TEST_USER_ID,
      consumerSecret: secret,
      userName: "test-bot",
      logger: mockLogger,
    });
    const xaaPayload = {
      data: {
        event_type: "chat.received",
        payload: {
          id: "evt-1",
          conversation_id: TEST_CONVERSATION_ID,
          sender_id: TEST_OTHER_USER_ID,
          encoded_event: "data",
        },
      },
    };
    const body = JSON.stringify(xaaPayload);
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("base64")}`;

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "x-twitter-webhooks-signature": sig,
      },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("should skip chat.sent events", async () => {
    const adapter = createTestAdapter();
    const xaaPayload = {
      data: {
        event_type: "chat.sent",
        payload: {
          id: "evt-1",
          conversation_id: TEST_CONVERSATION_ID,
          sender_id: TEST_OTHER_USER_ID,
          encoded_event: "data",
        },
      },
    };
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify(xaaPayload),
      headers: { "Content-Type": "application/json" },
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

describe("createXchatAdapter", () => {
  it("should throw when accessToken is missing", async () => {
    const { createXchatAdapter } = await import("./index");
    expect(() => createXchatAdapter({})).toThrow(MISSING_ACCESS_TOKEN_RE);
  });

  it("should create adapter with only a token (identity resolved at initialize)", async () => {
    const { createXchatAdapter } = await import("./index");
    const adapter = createXchatAdapter({
      accessToken: "token",
    });
    expect(adapter).toBeInstanceOf(XchatAdapter);
    expect(adapter.name).toBe("xchat");
    expect(adapter.cryptoStatus).toBe("uninitialized");
  });

  it("should accept botToken as accessToken alias", async () => {
    const { createXchatAdapter } = await import("./index");
    const adapter = createXchatAdapter({
      botToken: "token",
    });
    expect(adapter).toBeInstanceOf(XchatAdapter);
  });

  it("should accept optional signingKeyVersion override", async () => {
    const { createXchatAdapter } = await import("./index");
    const adapter = createXchatAdapter({
      accessToken: "token",
      userId: "12345",
      signingKeyVersion: "42",
    });
    expect(adapter).toBeInstanceOf(XchatAdapter);
  });

  it("should accept verifySignatures override", async () => {
    const { createXchatAdapter } = await import("./index");
    const adapter = createXchatAdapter({
      accessToken: "token",
      userId: "12345",
      verifySignatures: false,
    });
    expect(adapter).toBeInstanceOf(XchatAdapter);
  });

  it("should accept pin for Juicebox auto-unlock", async () => {
    const { createXchatAdapter } = await import("./index");
    const adapter = createXchatAdapter({
      botToken: "token",
      userId: "12345",
      pin: "2580",
    });
    expect(adapter).toBeInstanceOf(XchatAdapter);
  });
});

function juiceboxStubFromEngine(
  engine: Awaited<ReturnType<typeof createTestCryptoEngine>>
) {
  return new Proxy(engine as object, {
    get(target, prop, receiver) {
      if (prop === "unlock" || prop === "setup") {
        return async () => engine.getPublicKeys();
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("verifySignatures", () => {
  it("leaves chat-xdk default (reject unverified) when unset", async () => {
    const engine = await createTestCryptoEngine();
    const setRejectSpy = vi.spyOn(engine, "setRejectUnverified");
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));
    getPublicKeyMock.mockClear();

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        pin: TEST_PIN,
        userName: "test-bot",
        logger: mockLogger,
      });
      await adapter.initialize(mockChat as unknown as ChatInstance);
      expect(setRejectSpy).not.toHaveBeenCalled();
      expect(adapter.cryptoStatus).toBe("ready");
    } finally {
      createChatMock.mockReset();
    }
  });

  it("opts out of verification when verifySignatures is false", async () => {
    const engine = await createTestCryptoEngine();
    const setRejectSpy = vi.spyOn(engine, "setRejectUnverified");
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        pin: TEST_PIN,
        verifySignatures: false,
        userName: "test-bot",
        logger: mockLogger,
      });
      await adapter.initialize(mockChat as unknown as ChatInstance);
      expect(setRejectSpy).toHaveBeenCalledWith(false);
    } finally {
      createChatMock.mockReset();
    }
  });
});

describe("unlock", () => {
  it("should throw when called before initialize", async () => {
    const adapter = createTestAdapter();
    await expect(adapter.unlock("1234")).rejects.toThrow(UNINITIALIZED_RE);
  });
});

// =============================================================================
// Integration tests — real chat-xdk WASM crypto, mocked HTTP
// =============================================================================

describe("initialize (Juicebox)", () => {
  it("should auto-unlock when pin is provided", async () => {
    const engine = await createTestCryptoEngine();
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));
    getPublicKeyMock.mockClear();

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        pin: TEST_PIN,
        userName: "test-bot",
        logger: mockLogger,
      });
      expect(adapter.cryptoStatus).toBe("uninitialized");
      await adapter.initialize(mockChat as unknown as ChatInstance);
      expect(adapter.cryptoStatus).toBe("ready");
      expect(createChatMock).toHaveBeenCalled();
      expect(getPublicKeyMock).toHaveBeenCalled();
    } finally {
      createChatMock.mockReset();
    }
  });

  it("stamps the Chat SDK product token on the client User-Agent", async () => {
    const engine = await createTestCryptoEngine();
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        pin: TEST_PIN,
        userName: "test-bot",
        logger: mockLogger,
      });
      await adapter.initialize(mockChat as unknown as ChatInstance);
      const client = (adapter as any).xdkClient as { headers: Headers };
      expect(client.headers.get("user-agent")).toMatch(CHAT_SDK_THEN_XDK_UA_RE);
    } finally {
      createChatMock.mockReset();
    }
  });

  it("leaves a User-Agent supplied via apiHeaders untouched", async () => {
    const engine = await createTestCryptoEngine();
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        apiHeaders: { "User-Agent": "my-bot/1.0" },
        userId: TEST_USER_ID,
        pin: TEST_PIN,
        userName: "test-bot",
        logger: mockLogger,
      });
      await adapter.initialize(mockChat as unknown as ChatInstance);
      const client = (adapter as any).xdkClient as { headers: Headers };
      expect(client.headers.get("user-agent")).toBe("my-bot/1.0");
    } finally {
      createChatMock.mockReset();
    }
  });

  it("establishes the session identity on unlock", async () => {
    const engine = await createTestCryptoEngine();
    const setIdentitySpy = vi.spyOn(engine, "setIdentity");
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        pin: TEST_PIN,
        userName: "test-bot",
        logger: mockLogger,
      });
      await adapter.initialize(mockChat as unknown as ChatInstance);
      // The signing key version comes from the mocked getPublicKey response.
      expect(setIdentitySpy).toHaveBeenCalledWith(TEST_USER_ID, "1");
    } finally {
      createChatMock.mockReset();
    }
  });

  it("should stay locked when pin is omitted", async () => {
    const engine = await createTestCryptoEngine();
    createChatMock.mockResolvedValue(juiceboxStubFromEngine(engine));

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        userName: "test-bot",
        logger: mockLogger,
      });
      await adapter.initialize(mockChat as unknown as ChatInstance);
      expect(adapter.cryptoStatus).toBe("locked");
    } finally {
      createChatMock.mockReset();
    }
  });

  it("should throw and set error status when no juicebox config", async () => {
    createChatMock.mockReset();
    getPublicKeyMock.mockResolvedValueOnce({
      data: [{ publicKeyVersion: "1" }],
    });

    try {
      const mockChat = createMockChatInstance();
      const adapter = new XchatAdapter({
        accessToken: "test-token",
        userId: TEST_USER_ID,
        userName: "test-bot",
        logger: mockLogger,
      });
      await expect(
        adapter.initialize(mockChat as unknown as ChatInstance)
      ).rejects.toThrow(NO_JUICEBOX_CONFIG_RE);
      expect(adapter.cryptoStatus).toBe("error");
      expect(createChatMock).not.toHaveBeenCalled();
    } finally {
      getPublicKeyMock.mockReset();
      getPublicKeyMock.mockResolvedValue({
        data: [
          {
            publicKeyVersion: "1",
            juiceboxConfig: {
              keyStoreTokenMapJson: JSON.stringify({
                realms: [],
                register_threshold: 0,
                recover_threshold: 0,
              }),
              maxGuessCount: 20,
              tokenMap: [
                {
                  key: "testrealm",
                  value: {
                    address: "https://juicebox.test",
                    token: "test-token",
                  },
                },
              ],
            },
          },
        ],
      });
    }
  });
});

describe("postMessage (with real crypto)", () => {
  it("should throw when adapter is not ready", async () => {
    const adapter = createTestAdapter();
    await expect(adapter.postMessage(TEST_THREAD_ID, "Hello")).rejects.toThrow(
      NOT_INITIALIZED_RE
    );
  });

  it("should throw when no conversation key available even after auto-fetch", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();

      // Mock getConversationEvents to return no events
      xdk.chat.getConversationEvents = vi.fn().mockResolvedValue({
        data: [],
        meta: {},
      });

      await expect(
        adapter.postMessage(TEST_THREAD_ID, "Hello")
      ).rejects.toThrow(NO_CONVERSATION_KEY_RE);
    } finally {
      restore();
    }
  });
});

describe("postMessage sends encrypted payload (real crypto)", () => {
  it("should encrypt text and call sendMessage with encrypted payload", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();

      // Inject a conversation key so postMessage can encrypt
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      const vectors = loadVectors();
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });

      // Also inject a conversation token
      const tokensMap = (adapter as any).conversationTokens as Map<
        string,
        string
      >;
      tokensMap.set(TEST_CONVERSATION_ID, "conv-token-123");

      // Mock sendMessage on the XDK client
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({
        data: { id: "sent-msg-123" },
      });

      // Send a message — this uses real chat-xdk WASM encryption
      const result = await adapter.postMessage(TEST_THREAD_ID, "Got it!");

      expect(result.id).toBeDefined();
      expect(result.raw.decrypted?.content?.text).toBe("Got it!");

      // Verify sendMessage was called with encrypted content
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
      const [convId, payload] = (xdk.chat.sendMessage as any).mock.calls[0];
      // 1:1 REST paths use the recipient user id, not the composite conversation id.
      expect(convId).toBe(TEST_OTHER_USER_ID);
      expect(payload.encodedMessageCreateEvent).toBeTruthy();
      expect(typeof payload.encodedMessageCreateEvent).toBe("string");
      expect(payload.encodedMessageEventSignature).toBeTruthy();
      expect(payload.messageId).toBeTruthy();
      expect(payload.conversationToken).toBe("conv-token-123");
    } finally {
      restore();
    }
  });
});

describe("fetchMessages with mocked API (adapter logic)", () => {
  it("should parse API response events into messages", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();

      // Mock getConversationEvents to return raw events.
      // Note: since we can't create real decryptable events in unit tests
      // (encryptMessage output ≠ what the API returns in encoded_event),
      // we test the adapter's parsing logic with events that fail decryption.
      // The adapter should gracefully skip undecryptable events.
      xdk.chat.getConversationEvents = vi.fn().mockResolvedValue({
        data: [
          {
            id: "evt-1",
            sequenceId: "seq-1",
            senderId: TEST_OTHER_USER_ID,
            conversationId: TEST_CONVERSATION_ID,
            createdAtMsec: "1700000000000",
            encodedEvent: "not-a-real-encrypted-event",
            conversationToken: "conv-token-456",
          },
        ],
        meta: {},
      });

      // Signing-key lookup hits the API — return no usable keys so decryption
      // proceeds unverified and the bogus event is skipped.
      xdk.users.getPublicKey = vi.fn().mockResolvedValue({ data: [] });

      const result = await adapter.fetchMessages(TEST_THREAD_ID, { limit: 50 });

      // The event should fail decryption gracefully → 0 messages
      expect(result.messages.length).toBe(0);

      // But the conversation token should have been cached
      const tokensMap = (adapter as any).conversationTokens as Map<
        string,
        string
      >;
      expect(tokensMap.get(TEST_CONVERSATION_ID)).toBe("conv-token-456");

      // Verify getConversationEvents was called with the recipient user id
      expect(xdk.chat.getConversationEvents).toHaveBeenCalledOnce();
      expect(xdk.chat.getConversationEvents).toHaveBeenCalledWith(
        TEST_OTHER_USER_ID,
        expect.objectContaining({ maxResults: 50 })
      );
    } finally {
      restore();
    }
  });
});

describe("handleWebhook full flow (real crypto)", () => {
  it("should route a decryptable XAA chat.received event to handleIncomingMessage", async () => {
    const { adapter, mockChat, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const vectors = loadVectors();
      const xdk = getXdkClient();

      // Serve the fixture sender's signing keys so the event signature
      // verifies for real.
      xdk.users.getPublicKey = vi.fn().mockResolvedValue({
        data: [
          {
            publicKeyVersion: vectors.event_signing_key_version,
            signingPublicKey: vectors.signing_public_b64,
            publicKey: vectors.identity_public_b64,
            identityPublicKeySignature:
              vectors.identity_public_key_signature_b64,
          },
        ],
      });

      // Cache the conversation key the fixture event was encrypted with.
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(vectors.event_conversation_id, {
        keys: {
          [vectors.event_conversation_key_version]: b64ToBytes(
            vectors.conversation_key_b64
          ),
        },
        latestVersion: vectors.event_conversation_key_version,
      });

      const xaaPayload = {
        data: {
          event_type: "chat.received",
          payload: {
            id: "webhook-evt-1",
            conversation_id: vectors.event_conversation_id,
            sender_id: vectors.event_sender_id,
            encoded_event: vectors.event_message_b64,
            conversation_key_version: vectors.event_conversation_key_version,
          },
        },
      };

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(xaaPayload),
        headers: { "Content-Type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      // The webhook decrypts in the background, then hands the parsed
      // message to handleIncomingMessage.
      await vi.waitFor(() => {
        expect(mockChat.handleIncomingMessage).toHaveBeenCalledOnce();
      });
      const [, threadId, message] = (
        mockChat.handleIncomingMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(threadId).toBe(`xchat:${vectors.event_conversation_id}`);
      expect(message.text).toBe(vectors.event_message_text);
      expect(message.author.userId).toBe(vectors.event_sender_id);
      expect(message.author.isMe).toBe(false);
    } finally {
      restore();
    }
  });

  it("drops webhook events that cannot be decrypted", async () => {
    const { adapter, mockChat, restore } = await createInitializedTestAdapter();
    try {
      // No conversation key is cached, so decryption fails; the event must
      // be dropped (same as the poll path), not delivered as an empty
      // message.
      const xaaPayload = {
        data: {
          event_type: "chat.received",
          payload: {
            id: "webhook-evt-undecryptable",
            conversation_id: TEST_CONVERSATION_ID,
            sender_id: TEST_OTHER_USER_ID,
            encoded_event: "some-encrypted-data",
            conversation_key_version: "1",
          },
        },
      };

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(xaaPayload),
        headers: { "Content-Type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      // Give the background decrypt task a chance to run.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockChat.handleIncomingMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("should skip self-messages in webhook", async () => {
    const { adapter, mockChat, restore } = await createInitializedTestAdapter();
    try {
      const xaaPayload = {
        data: {
          event_type: "chat.received",
          payload: {
            id: "self-evt-1",
            conversation_id: TEST_CONVERSATION_ID,
            sender_id: TEST_USER_ID, // from self
            encoded_event: "irrelevant",
          },
        },
      };

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(xaaPayload),
        headers: { "Content-Type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      // Give any (incorrect) background task a chance to run
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockChat.handleIncomingMessage).not.toHaveBeenCalled();
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("read receipts on delivery (real crypto)", () => {
  /** Build the fixture chat.received webhook request and prime the adapter. */
  function primeFixtureDelivery(
    adapter: XchatAdapter,
    xdk: MockXdkClient
  ): Request {
    const vectors = loadVectors();

    xdk.users.getPublicKey = vi.fn().mockResolvedValue({
      data: [
        {
          publicKeyVersion: vectors.event_signing_key_version,
          signingPublicKey: vectors.signing_public_b64,
          publicKey: vectors.identity_public_b64,
          identityPublicKeySignature: vectors.identity_public_key_signature_b64,
        },
      ],
    });
    // Fallback watermark for markAsRead when the event carries no sequence id.
    xdk.chat.getConversationEvents = vi.fn().mockResolvedValue({
      data: [{ id: "evt-latest", sequenceId: "seq-42" }],
    });

    const keysMap = (adapter as any).conversationKeys as Map<string, any>;
    keysMap.set(vectors.event_conversation_id, {
      keys: {
        [vectors.event_conversation_key_version]: b64ToBytes(
          vectors.conversation_key_b64
        ),
      },
      latestVersion: vectors.event_conversation_key_version,
    });

    return new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({
        data: {
          event_type: "chat.received",
          payload: {
            id: "webhook-evt-rr",
            conversation_id: vectors.event_conversation_id,
            sender_id: vectors.event_sender_id,
            encoded_event: vectors.event_message_b64,
            conversation_key_version: vectors.event_conversation_key_version,
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("sends a read receipt for each delivered message by default", async () => {
    const { adapter, mockChat, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const request = primeFixtureDelivery(adapter, xdk);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      await vi.waitFor(() => {
        expect(mockChat.handleIncomingMessage).toHaveBeenCalledOnce();
      });
      expect(xdk.chat.markConversationRead).toHaveBeenCalledOnce();
      const [, body] = xdk.chat.markConversationRead.mock.calls[0];
      expect(typeof body.seenUntilSequenceId).toBe("string");
      expect(body.seenUntilSequenceId.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("suppresses read receipts when sendReadReceipts is false", async () => {
    const { adapter, mockChat, getXdkClient, restore } =
      await createInitializedTestAdapter({ sendReadReceipts: false });
    try {
      const xdk = getXdkClient();
      const request = primeFixtureDelivery(adapter, xdk);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      await vi.waitFor(() => {
        expect(mockChat.handleIncomingMessage).toHaveBeenCalledOnce();
      });
      expect(xdk.chat.markConversationRead).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("delivers messages when an automatic read receipt fails", async () => {
    const { adapter, mockChat, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const request = primeFixtureDelivery(adapter, xdk);
      xdk.chat.markConversationRead = vi
        .fn()
        .mockRejectedValue(new Error("receipt failed"));

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      await vi.waitFor(() => {
        expect(mockChat.handleIncomingMessage).toHaveBeenCalledOnce();
      });
    } finally {
      restore();
    }
  });
});

describe("withChatSdkUserAgent", () => {
  it("prepends the product token to the xdk client's default", () => {
    const ua = withChatSdkUserAgent("xdk-typescript/0.6.6");
    expect(ua).toMatch(CHAT_SDK_UA_TOKEN_RE);
    expect(ua.endsWith(" xdk-typescript/0.6.6")).toBe(true);
  });

  it("stands alone when there is no existing User-Agent", () => {
    expect(withChatSdkUserAgent(null)).toMatch(CHAT_SDK_UA_TOKEN_RE);
  });

  it("does not stack tokens when applied twice", () => {
    const once = withChatSdkUserAgent("xdk-typescript/0.6.6");
    expect(withChatSdkUserAgent(once)).toBe(once);
  });
});

describe("detectEntities", () => {
  it("detects URLs and mentions with correct spans", () => {
    const text = "hey @alice check https://example.com/x now";
    const entities = detectEntities(text);
    expect(entities).toEqual([
      [4, 10, "mention"],
      [17, 38, "url"],
    ]);
    expect(text.slice(4, 10)).toBe("@alice");
    expect(text.slice(17, 38)).toBe("https://example.com/x");
  });

  it("skips mentions inside detected URLs and emails", () => {
    const entities = detectEntities("mail foo@bar.com or https://a.io/@baz");
    expect(entities?.every(([, , kind]) => kind === "url")).toBe(true);
  });

  it("returns null when nothing matches", () => {
    expect(detectEntities("plain text only")).toBeNull();
  });
});

describe("extractPostAttachments", () => {
  it("extracts x.com post URLs as post cards, deduped by id", () => {
    const text =
      "see https://x.com/foo/status/123 and https://twitter.com/foo/status/123 and https://x.com/bar/status/456";
    expect(extractPostAttachments(text)).toEqual([
      {
        attachment_type: "post",
        rest_id: "123",
        post_url: "https://x.com/foo/status/123",
      },
      {
        attachment_type: "post",
        rest_id: "456",
        post_url: "https://x.com/bar/status/456",
      },
    ]);
  });

  it("returns null when no post URLs are present", () => {
    expect(extractPostAttachments("no posts here")).toBeNull();
  });
});

describe("mentionHandlesFromEntities", () => {
  const text = "hey @Test_Bot and @other";

  it("extracts handles from snake_case entity spans", () => {
    const entities = [
      { start_index: 4, end_index: 13, content: { mention: {} } },
      { start_index: 18, end_index: 24, content: { mention: {} } },
    ];
    expect(mentionHandlesFromEntities(text, entities)).toEqual([
      "test_bot",
      "other",
    ]);
  });

  it("extracts handles from camelCase entity spans", () => {
    const entities = [
      { startIndex: 4, endIndex: 13, content: { mention: {} } },
    ];
    expect(mentionHandlesFromEntities(text, entities)).toEqual(["test_bot"]);
  });

  it("ignores non-mention entities", () => {
    const entities = [{ start_index: 4, end_index: 13, content: { url: {} } }];
    expect(mentionHandlesFromEntities(text, entities)).toEqual([]);
  });
});

describe("parseMessage mention + attachment mapping", () => {
  function rawFor(decrypted: Record<string, unknown>): XchatRawMessage {
    return {
      event: {
        id: "evt-m1",
        conversationId: "gGROUP1",
        senderId: TEST_OTHER_USER_ID,
        encodedEvent: "x",
      },
      decrypted: decrypted as XchatRawMessage["decrypted"],
    };
  }

  it("sets isMention when an entity mention targets the bot handle", () => {
    const adapter = createTestAdapter();
    const text = "yo @test-bot help";
    const message = adapter.parseMessage(
      rawFor({
        type: "message",
        senderId: TEST_OTHER_USER_ID,
        content: {
          contentType: "text",
          text,
          entities: [
            { start_index: 3, end_index: 12, content: { mention: {} } },
          ],
        },
      })
    );
    expect(message.isMention).toBe(true);
  });

  it("sets isMention on a swipe-reply to the bot", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage(
      rawFor({
        type: "message",
        senderId: TEST_OTHER_USER_ID,
        content: {
          contentType: "text",
          text: "what about this?",
          replyingToPreview: { sender_id: TEST_USER_ID, text: "earlier" },
        },
      })
    );
    expect(message.isMention).toBe(true);
  });

  it("ignores a swipe-reply whose preview failed validation", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage(
      rawFor({
        type: "message",
        senderId: TEST_OTHER_USER_ID,
        replyPreviewValidation: "invalid",
        content: {
          contentType: "text",
          text: "what about this?",
          replyingToPreview: { sender_id: TEST_USER_ID, text: "earlier" },
        },
      })
    );
    expect(message.isMention).toBeUndefined();
  });

  it("leaves isMention unset for plain group text", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage(
      rawFor({
        type: "message",
        senderId: TEST_OTHER_USER_ID,
        content: { contentType: "text", text: "just chatting" },
      })
    );
    expect(message.isMention).toBeUndefined();
  });

  it("maps media attachments with lazy fetchData", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage(
      rawFor({
        type: "message",
        senderId: TEST_OTHER_USER_ID,
        keyVersion: "1",
        content: { contentType: "media", text: "" },
        attachments: [
          {
            media: {
              media_hash_key: "hash-abc",
              type: "image",
              filename: "pic.jpg",
              filesize_bytes: 1234,
              dimensions: { width: 640, height: 480 },
            },
          },
        ],
      })
    );
    expect(message.attachments).toHaveLength(1);
    const att = message.attachments[0];
    expect(att.type).toBe("image");
    expect(att.name).toBe("pic.jpg");
    expect(att.width).toBe(640);
    expect(typeof att.fetchData).toBe("function");
  });
});

describe("extractMediaEntries", () => {
  it("collects media from attachments, content, and mediaHashes without dupes", () => {
    const entries = extractMediaEntries({
      type: "message",
      attachments: [
        { media: { media_hash_key: "h1", type: "image" } },
        { attachmentType: "media", mediaHashKey: "h2", mediaType: "video" },
      ],
      content: {
        attachments: [{ media: { media_hash_key: "h1", type: "image" } }],
      },
      mediaHashes: [{ source: "gif_attachment", mediaHashKey: "h3" }],
    });
    expect(entries.map((e) => e.hashKey)).toEqual(["h1", "h2", "h3"]);
    expect(entries.map((e) => e.mediaType)).toEqual(["image", "video", "gif"]);
  });
});

describe("group quote-replies (real crypto)", () => {
  it("replies with the raw inbound event (replyToEvent) in groups", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const groupConvId = "gGROUP1";
      const groupThreadId = `xchat:${groupConvId}`;
      const vectors = loadVectors();
      const convKey = b64ToBytes(vectors.conversation_key_b64);

      // Cache the conversation key under the version the fixture raw event
      // was encrypted with, so the SDK can decrypt the original to derive
      // the reply preview.
      const keyVersion = vectors.event_conversation_key_version;
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(groupConvId, {
        keys: { [keyVersion]: convKey },
        latestVersion: keyVersion,
      });

      // Record inbound context by parsing a group message that carries the
      // fixture's genuine server-shaped raw signed event.
      adapter.parseMessage({
        event: {
          id: "evt-g1",
          conversationId: groupConvId,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: vectors.event_message_b64,
        },
        decrypted: {
          type: "message",
          id: "msg-g1",
          senderId: TEST_OTHER_USER_ID,
          sequenceId: "seq-42",
          content: { contentType: "text", text: vectors.event_message_text },
        },
      });

      const engine = (adapter as any).cryptoEngine;
      const replySpy = vi.spyOn(engine, "encryptReply");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });

      const result = await adapter.postMessage(groupThreadId, "quoted reply");

      expect(replySpy).toHaveBeenCalledOnce();
      const params = replySpy.mock.calls[0][0] as Record<string, unknown>;
      expect(params.replyToEvent).toBe(vectors.event_message_b64);
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
      // The message id chat-xdk generated for the payload reaches the API
      // and the returned RawMessage unchanged
      const payload = replySpy.mock.results[0].value as { messageId: string };
      const sent = xdk.chat.sendMessage.mock.calls[0][1];
      expect(payload.messageId).toBeTruthy();
      expect(sent.messageId).toBe(payload.messageId);
      expect(result.id).toBe(payload.messageId);
    } finally {
      restore();
    }
  });

  it("quote-replies the newest inbound message even when older history is parsed after it", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const groupConvId = "gGROUP3";
      const groupThreadId = `xchat:${groupConvId}`;
      const vectors = loadVectors();

      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(groupConvId, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });

      const parseAt = (id: string, createdAtMsec: number) =>
        adapter.parseMessage({
          event: {
            id: `evt-${id}`,
            conversationId: groupConvId,
            senderId: TEST_OTHER_USER_ID,
            encodedEvent: `raw-${id}`,
          },
          decrypted: {
            type: "message",
            id,
            senderId: TEST_OTHER_USER_ID,
            sequenceId: `seq-${id}`,
            createdAtMsec,
            content: { contentType: "text", text: id },
          },
        });

      // Webhook delivers the triggering message, then a history fetch parses
      // the page newest-first, ending on the oldest message.
      parseAt("newest", 3000);
      parseAt("older", 2000);
      parseAt("oldest", 1000);

      const engine = (adapter as any).cryptoEngine;
      const replySpy = vi.spyOn(engine, "encryptReply");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });

      await adapter.postMessage(groupThreadId, "reply");

      // Both encryptReply calls (event-based, then override fallback for the
      // unparseable raw event) must target the newest message.
      for (const call of replySpy.mock.calls) {
        const params = call[0] as Record<string, unknown>;
        if (params.replyToEvent !== undefined) {
          expect(params.replyToEvent).toBe("raw-newest");
        } else {
          expect(params.replyToSequenceId).toBe("seq-newest");
        }
      }
    } finally {
      restore();
    }
  });

  it("falls back to preview overrides when the raw event is unusable", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const groupConvId = "gGROUP2";
      const groupThreadId = `xchat:${groupConvId}`;
      const vectors = loadVectors();

      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(groupConvId, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });

      // Inbound context with an encoded event that is not a parseable event
      adapter.parseMessage({
        event: {
          id: "evt-g2",
          conversationId: groupConvId,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
        },
        decrypted: {
          type: "message",
          id: "msg-g2",
          senderId: TEST_OTHER_USER_ID,
          sequenceId: "seq-42",
          content: { contentType: "text", text: "original" },
        },
      });

      const engine = (adapter as any).cryptoEngine;
      const replySpy = vi.spyOn(engine, "encryptReply");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });

      await adapter.postMessage(groupThreadId, "quoted reply");

      // First call with replyToEvent throws inside chat-xdk; the fallback
      // retries with the explicit preview overrides.
      expect(replySpy).toHaveBeenCalledTimes(2);
      const params = replySpy.mock.calls[1][0] as Record<string, unknown>;
      expect(params.replyToEvent).toBeUndefined();
      expect(params.replyToSequenceId).toBe("seq-42");
      expect(params.replyToSenderId).toBe(TEST_OTHER_USER_ID);
      expect(params.replyToText).toBe("original");
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("uses encryptMessage for 1:1 conversations", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });

      const engine = (adapter as any).cryptoEngine;
      const replySpy = vi.spyOn(engine, "encryptReply");
      const messageSpy = vi.spyOn(engine, "encryptMessage");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });

      await adapter.postMessage(TEST_THREAD_ID, "dm reply");

      expect(replySpy).not.toHaveBeenCalled();
      expect(messageSpy).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });
});

describe("reactions (real crypto)", () => {
  it("encrypts and sends a reaction for a cached sequence id", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });
      // Cache the message → sequence mapping via parseMessage
      adapter.parseMessage({
        event: {
          id: "evt-r1",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
        },
        decrypted: {
          type: "message",
          id: "msg-r1",
          senderId: TEST_OTHER_USER_ID,
          sequenceId: "seq-7",
          content: { contentType: "text", text: "react to me" },
        },
      });

      const engine = (adapter as any).cryptoEngine;
      const reactSpy = vi.spyOn(engine, "encryptAddReaction");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });
      await adapter.addReaction(TEST_THREAD_ID, "msg-r1", "👍");

      expect(reactSpy).toHaveBeenCalledOnce();
      const params = reactSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(params.targetMessageSequenceId).toBe("seq-7");
      // The API receives the message id chat-xdk generated for the payload
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
      const payload = reactSpy.mock.results[0].value as { messageId: string };
      const sent = xdk.chat.sendMessage.mock.calls[0][1];
      expect(sent.messageId).toBe(payload.messageId);
      expect(sent.encodedMessageCreateEvent).toBe(payload.encryptedContent);
    } finally {
      restore();
    }
  });

  it("skips reactions without a cached sequence id", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.sendMessage = vi.fn();
      await adapter.addReaction(TEST_THREAD_ID, "unknown-msg", "👍");
      expect(xdk.chat.sendMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("inbound reaction routing", () => {
  const reactionRaw = (targetSequenceId: string): XchatRawMessage => ({
    event: {
      id: "evt-react",
      conversationId: TEST_CONVERSATION_ID,
      senderId: TEST_OTHER_USER_ID,
      encodedEvent: "y",
    },
    decrypted: {
      type: "message",
      id: "react-1",
      senderId: TEST_OTHER_USER_ID,
      content: {
        contentType: "reaction",
        emoji: "👍",
        targetMessageId: targetSequenceId,
      },
    },
  });

  it("resolves the reaction's target sequence id back to the message id", async () => {
    const { adapter, mockChat, restore } = await createInitializedTestAdapter();
    try {
      // Seed the messageId ⇄ sequenceId mapping via a parsed message.
      adapter.parseMessage({
        event: {
          id: "evt-r2",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
        },
        decrypted: {
          type: "message",
          id: "msg-r2",
          senderId: TEST_OTHER_USER_ID,
          sequenceId: "seq-9",
          content: { contentType: "text", text: "react to me" },
        },
      });

      const parsed = adapter.parseMessage(reactionRaw("seq-9"));
      (adapter as any).routeReaction(TEST_THREAD_ID, parsed, true, undefined);

      expect(mockChat.processReaction).toHaveBeenCalledOnce();
      const [event] = (mockChat.processReaction as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(event.messageId).toBe("msg-r2");
      expect(event.added).toBe(true);
      expect(event.rawEmoji).toBe("👍");
    } finally {
      restore();
    }
  });

  it("falls back to the raw sequence id when the target is unknown", async () => {
    const { adapter, mockChat, restore } = await createInitializedTestAdapter();
    try {
      const parsed = adapter.parseMessage(reactionRaw("seq-unseen"));
      (adapter as any).routeReaction(TEST_THREAD_ID, parsed, false, undefined);

      expect(mockChat.processReaction).toHaveBeenCalledOnce();
      const [event] = (mockChat.processReaction as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(event.messageId).toBe("seq-unseen");
      expect(event.added).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("media upload/download via the XDK client (real crypto)", () => {
  it("encrypt-streams and uploads outgoing files through the 3-step flow", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const convKey = b64ToBytes(vectors.conversation_key_b64);
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": convKey },
        latestVersion: "1",
      });

      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });
      xdk.chat.mediaUploadInitialize.mockResolvedValue({
        data: { sessionId: "sess-1", mediaHashKey: "hash-up-1" },
      });
      xdk.chat.mediaUploadAppend.mockResolvedValue({ data: {} });
      xdk.chat.mediaUploadFinalize.mockResolvedValue({ data: {} });

      const engine = (adapter as any).cryptoEngine;
      const messageSpy = vi.spyOn(engine, "encryptMessage");
      const fileBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      await adapter.postMessage(TEST_THREAD_ID, {
        markdown: "here you go",
        files: [
          {
            filename: "pic.png",
            data: fileBytes.buffer,
            mimeType: "image/png",
          },
        ],
      });

      // Initialize with the encrypted (not plaintext) size
      expect(xdk.chat.mediaUploadInitialize).toHaveBeenCalledOnce();
      const initBody = xdk.chat.mediaUploadInitialize.mock.calls[0][0];
      expect(initBody.conversationId).toBe(TEST_CONVERSATION_ID);
      expect(initBody.totalBytes).toBeGreaterThan(fileBytes.length);

      // One appended segment whose payload decrypts back to the file bytes
      expect(xdk.chat.mediaUploadAppend).toHaveBeenCalledOnce();
      const [appendSession, appendBody] =
        xdk.chat.mediaUploadAppend.mock.calls[0];
      expect(appendSession).toBe("sess-1");
      expect(appendBody.mediaHashKey).toBe("hash-up-1");
      expect(appendBody.segmentIndex).toBe(0);
      const roundTrip = engine.decryptStream(
        b64ToBytes(appendBody.media),
        convKey
      );
      expect(new Uint8Array(roundTrip)).toEqual(fileBytes);

      expect(xdk.chat.mediaUploadFinalize).toHaveBeenCalledWith("sess-1", {
        conversationId: TEST_CONVERSATION_ID,
        mediaHashKey: "hash-up-1",
        numParts: "1",
      });

      // The encrypted message references the uploaded media
      const params = messageSpy.mock.calls[0][0] as {
        attachments: Record<string, unknown>[];
      };
      expect(params.attachments[0].media_hash_key).toBe("hash-up-1");
      expect(params.attachments[0].filename).toBe("pic.png");
    } finally {
      restore();
    }
  });

  it("downloads and decrypt-streams media attachments", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const convKey = b64ToBytes(vectors.conversation_key_b64);
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": convKey },
        latestVersion: "1",
      });

      const engine = (adapter as any).cryptoEngine;
      const plaintext = new Uint8Array([9, 8, 7, 6, 5]);
      const encrypted = engine.encryptStream(plaintext, convKey);
      xdk.chat.mediaDownload.mockResolvedValue(
        encrypted.buffer.slice(
          encrypted.byteOffset,
          encrypted.byteOffset + encrypted.byteLength
        )
      );

      const result = await adapter.fetchMediaAttachment(
        TEST_CONVERSATION_ID,
        "hash-down-1",
        "1"
      );

      // Media routes take the dash-joined participant pair, not the peer id
      expect(xdk.chat.mediaDownload).toHaveBeenCalledWith(
        TEST_CONVERSATION_ID,
        "hash-down-1"
      );
      expect(new Uint8Array(result)).toEqual(plaintext);
    } finally {
      restore();
    }
  });
});

describe("markAsRead", () => {
  it("uses message context from the shared adapter capability", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.markConversationRead = vi
        .fn()
        .mockResolvedValue({ data: { success: true } });
      const message = adapter.parseMessage({
        event: {
          id: "evt-read",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
          sequenceId: "seq-77",
        },
        decrypted: null,
      });

      await adapter.markAsRead(TEST_THREAD_ID, message.id, message);

      expect(xdk.chat.markConversationRead).toHaveBeenCalledWith(
        TEST_OTHER_USER_ID,
        { seenUntilSequenceId: "seq-77" }
      );
    } finally {
      restore();
    }
  });

  it("falls back to the latest event sequence id when the message has none", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.getConversationEvents = vi.fn().mockResolvedValue({
        data: [{ id: "evt-l", sequenceId: "seq-99" }],
      });
      xdk.chat.markConversationRead = vi
        .fn()
        .mockResolvedValue({ data: { success: true } });

      const message = adapter.parseMessage({
        event: {
          id: "evt-nr",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
        },
        decrypted: null,
      });
      await adapter.markAsRead(TEST_THREAD_ID, message);

      expect(xdk.chat.markConversationRead).toHaveBeenCalledWith(
        TEST_OTHER_USER_ID,
        { seenUntilSequenceId: "seq-99" }
      );
    } finally {
      restore();
    }
  });

  it("reaches the latest-event fallback when called with a message id", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      // Serves both the history replay inside resolveSequenceId and the
      // latest-event fallback. The event is undecryptable, so the replay
      // caches no sequence id for our message.
      xdk.chat.getConversationEvents = vi.fn().mockResolvedValue({
        data: [
          {
            id: "evt-latest",
            sequenceId: "seq-99",
            senderId: TEST_OTHER_USER_ID,
            conversationId: TEST_CONVERSATION_ID,
            encodedEvent: "not-a-real-encrypted-event",
          },
        ],
        meta: {},
      });
      xdk.users.getPublicKey = vi.fn().mockResolvedValue({ data: [] });
      xdk.chat.markConversationRead = vi
        .fn()
        .mockResolvedValue({ data: { success: true } });

      const message = adapter.parseMessage({
        event: {
          id: "evt-no-seq",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
        },
        decrypted: null,
      });

      // The argument shape Thread.markAsRead() uses: id in slot two, message
      // in slot three. A resolveSequenceId miss must not abort the receipt.
      await adapter.markAsRead(TEST_THREAD_ID, message.id, message);

      expect(xdk.chat.markConversationRead).toHaveBeenCalledWith(
        TEST_OTHER_USER_ID,
        { seenUntilSequenceId: "seq-99" }
      );
    } finally {
      restore();
    }
  });

  it("rejects an unresolved explicit message id", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.getConversationEvents = vi.fn().mockResolvedValue({
        data: [
          {
            id: "evt-latest",
            sequenceId: "seq-99",
            senderId: TEST_OTHER_USER_ID,
            conversationId: TEST_CONVERSATION_ID,
            encodedEvent: "not-a-real-encrypted-event",
          },
        ],
        meta: {},
      });
      xdk.users.getPublicKey = vi.fn().mockResolvedValue({ data: [] });
      xdk.chat.markConversationRead = vi
        .fn()
        .mockResolvedValue({ data: { success: true } });

      await expect(
        adapter.markAsRead(TEST_THREAD_ID, "missing-message")
      ).rejects.toThrow(NO_SEQUENCE_ID_RE);

      expect(xdk.chat.getConversationEvents).toHaveBeenCalledOnce();
      expect(xdk.chat.markConversationRead).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("propagates explicit read receipt failures", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.markConversationRead = vi
        .fn()
        .mockRejectedValue(new Error("receipt failed"));
      const message = adapter.parseMessage({
        event: {
          id: "evt-read-fail",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
          sequenceId: "seq-fail",
        },
        decrypted: null,
      });

      await expect(
        adapter.markAsRead(TEST_THREAD_ID, message.id, message)
      ).rejects.toThrow("receipt failed");
    } finally {
      restore();
    }
  });

  it("rejects an unsuccessful read receipt response", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.markConversationRead = vi
        .fn()
        .mockResolvedValue({ data: { success: false } });
      const message = adapter.parseMessage({
        event: {
          id: "evt-read-unsuccessful",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          encodedEvent: "x",
          sequenceId: "seq-unsuccessful",
        },
        decrypted: null,
      });

      await expect(
        adapter.markAsRead(TEST_THREAD_ID, message.id, message)
      ).rejects.toThrow("XChat mark as read failed");
    } finally {
      restore();
    }
  });
});

describe("conversation_join welcome", () => {
  it("posts the welcome message when added to a group", async () => {
    const { adapter, restore } = await createInitializedTestAdapter();
    try {
      const postSpy = vi
        .spyOn(adapter, "postMessage")
        .mockResolvedValue({ id: "w1", raw: {} as any, threadId: "t" });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify({
          data: {
            event_type: "chat.conversation_join",
            payload: {
              id: "join-1",
              conversation_id: "gNEWGROUP",
              sender_id: TEST_USER_ID,
              encoded_event: "x",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      await vi.waitFor(() => {
        expect(postSpy).toHaveBeenCalledOnce();
      });
      const [threadId, welcome] = postSpy.mock.calls[0];
      expect(threadId).toBe("xchat:gNEWGROUP");
      expect(String(welcome)).toContain("@test-bot");
    } finally {
      restore();
    }
  });

  it("does not post a welcome for 1:1 joins", async () => {
    const { adapter, restore } = await createInitializedTestAdapter();
    try {
      const postSpy = vi
        .spyOn(adapter, "postMessage")
        .mockResolvedValue({ id: "w1", raw: {} as any, threadId: "t" });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify({
          data: {
            event_type: "chat.conversation_join",
            payload: {
              id: "join-2",
              conversation_id: TEST_CONVERSATION_ID,
              sender_id: TEST_USER_ID,
              encoded_event: "x",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      await adapter.handleWebhook(request);
      await new Promise((resolve) => setImmediate(resolve));
      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("postMessage with a card (real crypto)", () => {
  it("degrades the card to text + link entities + a url preview attachment", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });

      const engine = (adapter as any).cryptoEngine;
      const messageSpy = vi.spyOn(engine, "encryptMessage");

      await adapter.postMessage(TEST_THREAD_ID, {
        card: {
          type: "card",
          title: "Deploy ready",
          children: [
            { type: "text", content: "All checks passed." },
            {
              type: "actions",
              children: [
                {
                  type: "link-button",
                  label: "View logs",
                  url: "https://ci.example.com/logs",
                },
              ],
            },
          ],
        },
      } as any);

      const params = messageSpy.mock.calls[0][0] as {
        text: string;
        entities: [number, number, string][] | null;
        attachments: Record<string, unknown>[] | null;
      };
      expect(params.text).toBe(
        "Deploy ready\nAll checks passed.\nView logs: https://ci.example.com/logs"
      );
      // The appended link line becomes a tappable url entity
      expect(params.entities?.some(([, , kind]) => kind === "url")).toBe(true);
      // The primary link rides along as a URL preview card
      expect(params.attachments).toEqual([
        {
          attachment_type: "url",
          url: "https://ci.example.com/logs",
          display_title: "Deploy ready",
        },
      ]);
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });
});

describe("urlCardAttachment banner upload (real crypto)", () => {
  it("fetches, encrypts, and uploads the banner image", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    const originalFetch = globalThis.fetch;
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keyInfo = {
        key: b64ToBytes(vectors.conversation_key_b64),
        version: "1",
      };
      xdk.chat.mediaUploadInitialize.mockResolvedValue({
        data: { sessionId: "sess-b", mediaHashKey: "hash-banner" },
      });
      xdk.chat.mediaUploadAppend.mockResolvedValue({ data: {} });
      xdk.chat.mediaUploadFinalize.mockResolvedValue({ data: {} });

      const bannerBytes = new Uint8Array([1, 2, 3, 4, 5]);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response(bannerBytes, { status: 200 }));

      const attachment = await (adapter as any).urlCardAttachment(
        TEST_CONVERSATION_ID,
        keyInfo,
        {
          url: "https://example.com/notes",
          displayTitle: "Release notes",
          imageUrl: "https://cdn.example.com/banner.png?v=2",
        }
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://cdn.example.com/banner.png?v=2"
      );
      expect(xdk.chat.mediaUploadFinalize).toHaveBeenCalledOnce();
      expect(attachment.attachment_type).toBe("url");
      expect(attachment.url).toBe("https://example.com/notes");
      expect(attachment.display_title).toBe("Release notes");
      expect(attachment.banner_image.media_hash_key).toBe("hash-banner");
      // Wire size is the encrypted blob, and the query string is stripped
      expect(attachment.banner_image.filesize_bytes).toBeGreaterThan(
        bannerBytes.length
      );
      expect(attachment.banner_image.filename).toBe("banner.png");
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("degrades to a card without a banner when the image fetch fails", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    const originalFetch = globalThis.fetch;
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom"));

      const attachment = await (adapter as any).urlCardAttachment(
        TEST_CONVERSATION_ID,
        { key: b64ToBytes(vectors.conversation_key_b64), version: "1" },
        {
          url: "https://example.com/notes",
          imageUrl: "https://cdn.example.com/x.png",
        }
      );

      expect(attachment).toEqual({
        attachment_type: "url",
        url: "https://example.com/notes",
      });
      expect(xdk.chat.mediaUploadInitialize).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });
});

describe("parseMessage edit events", () => {
  it("renders an edit event as the edited message and maps its target sequence id", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage({
      event: {
        id: "edit-evt-1",
        conversationId: TEST_CONVERSATION_ID,
        senderId: TEST_OTHER_USER_ID,
        encodedEvent: "x",
        sequenceId: "seq-edit-event",
        createdAtMsec: "1700000000000",
      },
      decrypted: {
        type: "message",
        id: "edit-evt-1",
        senderId: TEST_OTHER_USER_ID,
        conversationId: TEST_CANONICAL_CONVERSATION_ID,
        createdAtMsec: 1700000000000,
        sequenceId: "seq-edit-event",
        content: {
          contentType: "edit",
          targetMessageId: "seq-original",
          newText: "the corrected words",
        },
        verified: true,
      } as any,
    });

    expect(message.text).toBe("the corrected words");
    // Later reactions/edits/deletes through this message must hit the
    // original, not the edit event.
    expect((adapter as any).sequenceIdByMessageId.get("edit-evt-1")).toBe(
      "seq-original"
    );
  });
});

describe("editMessage (real crypto)", () => {
  it("encrypts an edit targeting the cached sequence id and sends it", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });
      (adapter as any).sequenceIdByMessageId.set("orig-1", "seq-orig");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });

      const engine = (adapter as any).cryptoEngine;
      const editSpy = vi.spyOn(engine, "encryptEdit");

      const result = await adapter.editMessage(
        TEST_THREAD_ID,
        "orig-1",
        "fixed: see https://example.com"
      );

      const params = editSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(params.targetMessageSequenceId).toBe("seq-orig");
      expect(params.updatedText).toBe("fixed: see https://example.com");
      // The URL in the replacement text stays tappable.
      expect(
        (params.entities as [number, number, string][]).some(
          ([, , kind]) => kind === "url"
        )
      ).toBe(true);

      // The edit ships through the regular send channel with its own id.
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
      const [, payload] = (xdk.chat.sendMessage as any).mock.calls[0];
      expect(payload.encodedMessageCreateEvent).toBeTruthy();
      expect(payload.messageId).not.toBe("orig-1");
      // The returned message keeps the edited message's id.
      expect(result.id).toBe("orig-1");
    } finally {
      restore();
    }
  });

  it("holds the first edit until the original message settles", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });
      const tokensMap = (adapter as any).conversationTokens as Map<
        string,
        string
      >;
      tokensMap.set(TEST_CONVERSATION_ID, "conv-token-123");
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });
      (adapter as any).editSafetyDelayMs = 120;

      const posted = await adapter.postMessage(TEST_THREAD_ID, "v1");
      (adapter as any).sequenceIdByMessageId.set(posted.id, "seq-v1");

      const started = Date.now();
      await adapter.editMessage(TEST_THREAD_ID, posted.id, "v2");
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);

      // A message not posted in this process (no recorded post time) is not
      // delayed.
      (adapter as any).sequenceIdByMessageId.set("old-msg", "seq-old");
      const startedOld = Date.now();
      await adapter.editMessage(TEST_THREAD_ID, "old-msg", "v2");
      expect(Date.now() - startedOld).toBeLessThan(100);
    } finally {
      restore();
    }
  });

  it("recovers the sequence id from history when it is not cached", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(TEST_CONVERSATION_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });
      xdk.chat.sendMessage = vi.fn().mockResolvedValue({ data: {} });
      // History replay repopulates the sequence-id cache via parseMessage.
      vi.spyOn(adapter, "fetchMessages").mockImplementation(async () => {
        (adapter as any).sequenceIdByMessageId.set("orig-2", "seq-2");
        return { messages: [] };
      });

      await adapter.editMessage(TEST_THREAD_ID, "orig-2", "updated");

      expect(adapter.fetchMessages).toHaveBeenCalledWith(TEST_THREAD_ID, {
        limit: 50,
      });
      expect(xdk.chat.sendMessage).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("throws when the sequence id cannot be resolved", async () => {
    const { adapter, restore } = await createInitializedTestAdapter();
    try {
      vi.spyOn(adapter, "fetchMessages").mockResolvedValue({ messages: [] });
      await expect(
        adapter.editMessage(TEST_THREAD_ID, "unknown-msg", "text")
      ).rejects.toThrow(NO_SEQUENCE_ID_RE);
    } finally {
      restore();
    }
  });
});

describe("deleteMessage (real crypto)", () => {
  it("sends a signed delete-for-all through the typed client", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      (adapter as any).sequenceIdByMessageId.set("msg-del", "seq-del");
      xdk.chat.deleteMessages.mockResolvedValue({ data: {} });

      await adapter.deleteMessage(TEST_THREAD_ID, "msg-del");

      expect(xdk.chat.deleteMessages).toHaveBeenCalledOnce();
      const [convId, body] = xdk.chat.deleteMessages.mock.calls[0];
      // Delete routes take the dash-joined pair id in the URL.
      expect(convId).toBe(TEST_CONVERSATION_ID);
      expect(body.sequenceIds).toEqual(["seq-del"]);
      expect(body.deleteMessageAction).toBe("delete_for_all");
      const sig = body.actionSignatures[0];
      expect(sig.messageId).toBeTruthy();
      expect(sig.encodedMessageEventDetail).toBeTruthy();
      // The signed payload covers the canonical colon-form conversation id.
      expect(sig.signaturePayload).toBe(
        `MessageDeleteEvent,${sig.messageId},${TEST_USER_ID},${TEST_CANONICAL_CONVERSATION_ID},2,seq-del`
      );
      expect(sig.messageEventSignature.signature).toBeTruthy();
      expect(sig.messageEventSignature.signatureVersion).toBe("7");
      expect(sig.messageEventSignature.publicKeyVersion).toBe("1");
      expect(sig.messageEventSignature.signingPublicKey).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("propagates client errors from the delete call", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      (adapter as any).sequenceIdByMessageId.set("msg-404", "seq-404");
      xdk.chat.deleteMessages.mockRejectedValue(new Error("HTTP 404"));

      await expect(
        adapter.deleteMessage(TEST_THREAD_ID, "msg-404")
      ).rejects.toThrow(HTTP_404_RE);
    } finally {
      restore();
    }
  });
});

describe("openDM (real crypto)", () => {
  const CANONICAL_ID = TEST_CANONICAL_CONVERSATION_ID; // "12345:67890"
  const EXPECTED_THREAD_ID = `xchat:${CANONICAL_ID}`;

  function makeSigningKeyData() {
    const vectors = loadVectors();
    return {
      publicKeyVersion: "1",
      publicKey: vectors.identity_public_b64,
      signingPublicKey: vectors.signing_public_b64,
      identityPublicKeySignature: vectors.identity_public_key_signature_b64,
    };
  }

  it("returns the existing thread when a conversation key is already cached", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      keysMap.set(CANONICAL_ID, {
        keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
        latestVersion: "1",
      });

      const threadId = await adapter.openDM(TEST_OTHER_USER_ID);

      expect(threadId).toBe(EXPECTED_THREAD_ID);
      expect(xdk.chat.getConversationEvents).not.toHaveBeenCalled();
      expect(xdk.chat.addConversationKeys).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("reuses a key recovered from conversation history without a key exchange", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      const vectors = loadVectors();
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      vi.spyOn(adapter, "fetchMessages").mockImplementation(async () => {
        // History replay extracts the conversation key into the cache.
        keysMap.set(CANONICAL_ID, {
          keys: { "1": b64ToBytes(vectors.conversation_key_b64) },
          latestVersion: "1",
        });
        return { messages: [] };
      });

      const threadId = await adapter.openDM(TEST_OTHER_USER_ID);

      expect(threadId).toBe(EXPECTED_THREAD_ID);
      expect(adapter.fetchMessages).toHaveBeenCalledWith(EXPECTED_THREAD_ID, {
        limit: 50,
      });
      expect(xdk.chat.addConversationKeys).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("performs a key exchange for a brand-new conversation", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.getConversationEvents = vi
        .fn()
        .mockResolvedValue({ data: [], meta: {} });
      xdk.users.getPublicKey = vi
        .fn()
        .mockResolvedValue({ data: [makeSigningKeyData()] });
      xdk.chat.addConversationKeys.mockResolvedValue({ data: {} });

      const threadId = await adapter.openDM(TEST_OTHER_USER_ID);

      expect(threadId).toBe(EXPECTED_THREAD_ID);
      expect(xdk.chat.addConversationKeys).toHaveBeenCalledOnce();
      const [pathId, body] = xdk.chat.addConversationKeys.mock.calls[0];
      // Key-initialization path params take the dash-joined pair id
      expect(pathId).toBe(TEST_CONVERSATION_ID);
      expect(body.conversationKeyVersion).toBeTruthy();
      expect(body.conversationParticipantKeys).toHaveLength(2);
      const participantIds = body.conversationParticipantKeys.map(
        (k: { userId: string }) => k.userId
      );
      expect(participantIds).toContain(TEST_USER_ID);
      expect(participantIds).toContain(TEST_OTHER_USER_ID);
      for (const key of body.conversationParticipantKeys) {
        expect(key.encryptedConversationKey).toBeTruthy();
        expect(key.publicKeyVersion).toBe("1");
      }
      expect(body.actionSignatures.length).toBeGreaterThan(0);
      for (const sig of body.actionSignatures) {
        expect(sig.messageId).toBeTruthy();
        expect(sig.encodedMessageEventDetail).toBeTruthy();
        expect(sig.messageEventSignature.signature).toBeTruthy();
        expect(sig.messageEventSignature.signingPublicKey).toBeTruthy();
      }

      // The new key is cached, so the bot can post immediately.
      const keysMap = (adapter as any).conversationKeys as Map<string, any>;
      const cached = keysMap.get(CANONICAL_ID);
      expect(cached?.latestVersion).toBe(body.conversationKeyVersion);
      expect(cached?.keys[body.conversationKeyVersion]).toBeInstanceOf(
        Uint8Array
      );
    } finally {
      restore();
    }
  });

  it("throws when the recipient has no registered chat keys", async () => {
    const { adapter, getXdkClient, restore } =
      await createInitializedTestAdapter();
    try {
      const xdk = getXdkClient();
      xdk.chat.getConversationEvents = vi
        .fn()
        .mockResolvedValue({ data: [], meta: {} });
      xdk.users.getPublicKey = vi
        .fn()
        .mockImplementation(async (userId: string) =>
          userId === TEST_USER_ID
            ? { data: [makeSigningKeyData()] }
            : { data: [] }
        );

      await expect(adapter.openDM(TEST_OTHER_USER_ID)).rejects.toThrow(
        NO_REGISTERED_CHAT_KEYS_RE
      );
      expect(xdk.chat.addConversationKeys).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
