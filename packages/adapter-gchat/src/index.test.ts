import { AdapterRateLimitError } from "@chat-adapter/shared";
import { auth } from "@googleapis/chat";
import type { ChatInstance, Lock, Logger, StateAdapter } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleChatAdapter,
  GoogleChatAdapter,
  type GoogleChatEvent,
  type GoogleChatMessage,
} from "./index";
import type {
  PubSubPushMessage,
  WorkspaceEventNotification,
} from "./workspace-events";

const GCHAT_PREFIX_PATTERN = /^gchat:/;
const DM_SUFFIX_PATTERN = /:dm$/;

// Test credentials
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const TEST_CREDENTIALS = {
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
};

// Mock StateAdapter for testing
function createMockStateAdapter(): StateAdapter & {
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  return {
    storage,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi
      .fn()
      .mockResolvedValue({ threadId: "", token: "", expiresAt: 0 } as Lock),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(storage.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
  };
}

// Mock ChatInstance for testing
function createMockChatInstance(state: StateAdapter): ChatInstance {
  return {
    getState: () => state,
    getLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
  } as unknown as ChatInstance;
}

/** Helper: build a minimal GoogleChatEvent with a message payload */
function makeMessageEvent(
  overrides: {
    spaceName?: string;
    spaceType?: string;
    messageText?: string;
    messageName?: string;
    senderName?: string;
    senderDisplayName?: string;
    senderType?: string;
    threadName?: string;
    annotations?: GoogleChatMessage["annotations"];
    attachment?: GoogleChatMessage["attachment"];
  } = {}
): GoogleChatEvent {
  return {
    chat: {
      messagePayload: {
        space: {
          name: overrides.spaceName ?? "spaces/ABC123",
          type: overrides.spaceType ?? "ROOM",
        },
        message: {
          name: overrides.messageName ?? "spaces/ABC123/messages/msg1",
          sender: {
            name: overrides.senderName ?? "users/100",
            displayName: overrides.senderDisplayName ?? "Test User",
            type: overrides.senderType ?? "HUMAN",
          },
          text: overrides.messageText ?? "Hello",
          createTime: new Date().toISOString(),
          thread: overrides.threadName
            ? { name: overrides.threadName }
            : undefined,
          annotations: overrides.annotations,
          attachment: overrides.attachment,
        },
      },
    },
  };
}

/** Helper: create a Pub/Sub push message wrapping a notification */
function makePubSubPushMessage(
  notification: {
    message?: Partial<GoogleChatMessage>;
    reaction?: {
      name: string;
      emoji?: { unicode?: string };
      user?: { name: string; displayName?: string; type?: string };
    };
  },
  eventType = "google.workspace.chat.message.v1.created",
  targetResource = "//chat.googleapis.com/spaces/ABC123"
): PubSubPushMessage {
  const data = Buffer.from(JSON.stringify(notification)).toString("base64");
  return {
    message: {
      data,
      messageId: "pubsub-msg-1",
      publishTime: new Date().toISOString(),
      attributes: {
        "ce-type": eventType,
        "ce-subject": targetResource,
        "ce-time": new Date().toISOString(),
      },
    },
    subscription: "projects/test/subscriptions/test-sub",
  };
}

/** Helper: create an initialized adapter with mocks */
async function createInitializedAdapter(opts?: {
  pubsubTopic?: string;
  userName?: string;
  endpointUrl?: string;
  googleChatProjectNumber?: string;
  pubsubAudience?: string;
}) {
  const adapter = createGoogleChatAdapter({
    credentials: TEST_CREDENTIALS,
    logger: mockLogger,
    pubsubTopic: opts?.pubsubTopic,
    userName: opts?.userName,
    endpointUrl: opts?.endpointUrl,
    googleChatProjectNumber: opts?.googleChatProjectNumber,
    pubsubAudience: opts?.pubsubAudience,
  });
  const mockState = createMockStateAdapter();
  const mockChat = createMockChatInstance(mockState);
  await adapter.initialize(mockChat);
  return { adapter, mockState, mockChat };
}

describe("GoogleChatAdapter", () => {
  it("should export createGoogleChatAdapter function", () => {
    expect(typeof createGoogleChatAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createGoogleChatAdapter({
      credentials: TEST_CREDENTIALS,
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    expect(adapter.name).toBe("gchat");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs without thread name", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const original = {
        spaceName: "spaces/ABC123",
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(GCHAT_PREFIX_PATTERN);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
    });

    it("should encode and decode thread IDs with thread name", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const original = {
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/XYZ789",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      expect(decoded.spaceName).toBe(original.spaceName);
      expect(decoded.threadName).toBe(original.threadName);
    });

    it("should encode and decode DM thread IDs", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const original = {
        spaceName: "spaces/DM123",
        isDM: true,
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(DM_SUFFIX_PATTERN);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
      expect(decoded.isDM).toBe(true);
    });

    it("should throw on invalid thread ID", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      expect(() => adapter.decodeThreadId("invalid")).toThrow();
    });
  });

  describe("constructor / initialization", () => {
    const savedEnv = { ...process.env };

    beforeEach(() => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("GOOGLE_CHAT_")) {
          delete process.env[key];
        }
      }
    });

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it("should use provided userName", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        userName: "mybot",
      });
      expect(adapter.userName).toBe("mybot");
    });

    it("should default userName to 'bot'", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      expect(adapter.userName).toBe("bot");
    });

    it("should throw when no auth is configured", () => {
      expect(() => {
        new GoogleChatAdapter({
          logger: mockLogger,
        } as any);
      }).toThrow();
    });

    it("should accept ADC config", () => {
      const adapter = new GoogleChatAdapter({
        useApplicationDefaultCredentials: true,
        logger: mockLogger,
      });
      expect(adapter.name).toBe("gchat");
    });

    it("should default logger when not provided", () => {
      const adapter = new GoogleChatAdapter({
        useApplicationDefaultCredentials: true,
      });
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should restore bot user ID from state on initialize", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      const mockState = createMockStateAdapter();
      mockState.storage.set("gchat:botUserId", "users/BOT999");
      const mockChat = createMockChatInstance(mockState);

      await adapter.initialize(mockChat);

      expect(adapter.botUserId).toBe("users/BOT999");
    });

    it("should not overwrite existing botUserId on initialize", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      (adapter as any).botUserId = "users/EXISTING";

      const mockState = createMockStateAdapter();
      mockState.storage.set("gchat:botUserId", "users/OTHERFROMSTATE");
      const mockChat = createMockChatInstance(mockState);

      await adapter.initialize(mockChat);

      expect(adapter.botUserId).toBe("users/EXISTING");
    });
  });

  describe("constructor env var resolution", () => {
    const savedEnv = { ...process.env };

    beforeEach(() => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("GOOGLE_CHAT_")) {
          delete process.env[key];
        }
      }
    });

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it("should throw when no auth is configured and no env vars set", () => {
      expect(() => new GoogleChatAdapter()).toThrow(
        "Authentication is required"
      );
    });

    it("should resolve credentials from GOOGLE_CHAT_CREDENTIALS env var", () => {
      process.env.GOOGLE_CHAT_CREDENTIALS = JSON.stringify(TEST_CREDENTIALS);
      const adapter = new GoogleChatAdapter();
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should resolve ADC from GOOGLE_CHAT_USE_ADC env var", () => {
      process.env.GOOGLE_CHAT_USE_ADC = "true";
      const adapter = new GoogleChatAdapter();
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should resolve pubsubTopic from GOOGLE_CHAT_PUBSUB_TOPIC env var", () => {
      process.env.GOOGLE_CHAT_CREDENTIALS = JSON.stringify(TEST_CREDENTIALS);
      process.env.GOOGLE_CHAT_PUBSUB_TOPIC = "projects/test/topics/test";
      const adapter = new GoogleChatAdapter();
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should resolve impersonateUser from GOOGLE_CHAT_IMPERSONATE_USER env var", () => {
      process.env.GOOGLE_CHAT_CREDENTIALS = JSON.stringify(TEST_CREDENTIALS);
      process.env.GOOGLE_CHAT_IMPERSONATE_USER = "user@example.com";
      const adapter = new GoogleChatAdapter();
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should prefer config credentials over env vars", () => {
      process.env.GOOGLE_CHAT_USE_ADC = "true";
      const adapter = new GoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
      });
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });
  });

  describe("isDM", () => {
    it("should return true for DM thread IDs", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/DM123",
        isDM: true,
      });
      expect(adapter.isDM(threadId)).toBe(true);
    });

    it("should return false for non-DM thread IDs", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ROOM456",
      });
      expect(adapter.isDM(threadId)).toBe(false);
    });
  });

  describe("parseMessage", () => {
    it("should parse a basic message event", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        messageText: "Hello world",
        senderDisplayName: "Alice",
        senderName: "users/ALICE1",
      });

      const msg = adapter.parseMessage(event);

      expect(msg.text).toContain("Hello world");
      expect(msg.author.fullName).toBe("Alice");
      expect(msg.author.userId).toBe("users/ALICE1");
      expect(msg.author.isBot).toBe(false);
    });

    it("should throw when event has no messagePayload", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      expect(() => adapter.parseMessage({})).toThrow();
    });

    it("should detect bot sender", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        senderType: "BOT",
        senderDisplayName: "BotUser",
      });

      const msg = adapter.parseMessage(event);

      expect(msg.author.isBot).toBe(true);
    });

    it("should include attachments in parsed message", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        attachment: [
          {
            name: "att1",
            contentName: "photo.png",
            contentType: "image/png",
            downloadUri: "https://example.com/photo.png",
          },
        ],
      });

      const msg = adapter.parseMessage(event);

      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0].type).toBe("image");
      expect(msg.attachments[0].name).toBe("photo.png");
    });

    it("should classify video and audio attachment types", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        attachment: [
          {
            name: "vid1",
            contentName: "video.mp4",
            contentType: "video/mp4",
            downloadUri: "https://example.com/video.mp4",
          },
          {
            name: "aud1",
            contentName: "audio.mp3",
            contentType: "audio/mpeg",
            downloadUri: "https://example.com/audio.mp3",
          },
        ],
      });

      const msg = adapter.parseMessage(event);

      expect(msg.attachments).toHaveLength(2);
      expect(msg.attachments[0].type).toBe("video");
      expect(msg.attachments[1].type).toBe("audio");
    });

    it("should use media.download API when attachmentDataRef is present", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockDownload = vi.fn().mockResolvedValue({
        data: new ArrayBuffer(4),
      });
      (adapter as any).chatApi = {
        media: { download: mockDownload },
      };

      const event = makeMessageEvent({
        attachment: [
          {
            name: "att1",
            contentName: "photo.png",
            contentType: "image/png",
            downloadUri: "https://example.com/photo.png",
            attachmentDataRef: {
              resourceName: "spaces/ABC123/attachments/att1",
            },
          },
        ],
      });

      const msg = adapter.parseMessage(event);
      expect(msg.attachments[0].fetchData).toBeDefined();

      const data = await msg.attachments[0].fetchData?.();
      expect(data).toBeInstanceOf(Buffer);
      expect(mockDownload).toHaveBeenCalledWith(
        { resourceName: "spaces/ABC123/attachments/att1" },
        { responseType: "arraybuffer" }
      );
    });

    it("should provide fetchData when only attachmentDataRef is present (no downloadUri)", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockDownload = vi.fn().mockResolvedValue({
        data: new ArrayBuffer(4),
      });
      (adapter as any).chatApi = {
        media: { download: mockDownload },
      };

      const event = makeMessageEvent({
        attachment: [
          {
            name: "att1",
            contentName: "photo.png",
            contentType: "image/png",
            attachmentDataRef: {
              resourceName: "spaces/ABC123/attachments/att1",
            },
          },
        ],
      });

      const msg = adapter.parseMessage(event);
      expect(msg.attachments[0].fetchData).toBeDefined();

      const data = await msg.attachments[0].fetchData?.();
      expect(data).toBeInstanceOf(Buffer);
      expect(mockDownload).toHaveBeenCalledWith(
        { resourceName: "spaces/ABC123/attachments/att1" },
        { responseType: "arraybuffer" }
      );
    });

    it("should fall back to direct URL fetch when no attachmentDataRef", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        attachment: [
          {
            name: "att1",
            contentName: "photo.png",
            contentType: "image/png",
            downloadUri: "https://example.com/photo.png",
          },
        ],
      });

      const msg = adapter.parseMessage(event);
      expect(msg.attachments[0].fetchData).toBeDefined();
      // fetchData is present because downloadUri exists
      expect(msg.attachments[0].url).toBe("https://example.com/photo.png");
    });

    it("should not provide fetchData when neither resourceName nor downloadUri exist", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        attachment: [
          {
            name: "att1",
            contentName: "unknown.bin",
            contentType: "application/octet-stream",
          },
        ],
      });

      const msg = adapter.parseMessage(event);
      expect(msg.attachments[0].fetchData).toBeUndefined();
    });
  });

  describe("normalizeBotMentions (via parseMessage)", () => {
    it("should replace bot mention with adapter userName", async () => {
      const { adapter } = await createInitializedAdapter({ userName: "mybot" });
      const event = makeMessageEvent({
        messageText: "@Chat SDK Demo hello",
        annotations: [
          {
            type: "USER_MENTION",
            startIndex: 0,
            length: 14,
            userMention: {
              user: {
                name: "users/BOT123",
                displayName: "Chat SDK Demo",
                type: "BOT",
              },
              type: "MENTION",
            },
          },
        ],
      });

      const msg = adapter.parseMessage(event);

      expect(msg.text).toContain("@mybot");
      expect(msg.text).not.toContain("@Chat SDK Demo");
    });

    it("should learn bot user ID from annotations", async () => {
      const { adapter } = await createInitializedAdapter();

      expect(adapter.botUserId).toBeUndefined();

      const event = makeMessageEvent({
        messageText: "@BotName hi",
        annotations: [
          {
            type: "USER_MENTION",
            startIndex: 0,
            length: 8,
            userMention: {
              user: {
                name: "users/LEARNED_BOT_ID",
                displayName: "BotName",
                type: "BOT",
              },
              type: "MENTION",
            },
          },
        ],
      });

      adapter.parseMessage(event);

      expect(adapter.botUserId).toBe("users/LEARNED_BOT_ID");
    });

    it("should not overwrite botUserId once learned", async () => {
      const { adapter } = await createInitializedAdapter();
      (adapter as any).botUserId = "users/FIRST_BOT";

      const event = makeMessageEvent({
        messageText: "@AnotherBot hi",
        annotations: [
          {
            type: "USER_MENTION",
            startIndex: 0,
            length: 11,
            userMention: {
              user: {
                name: "users/SECOND_BOT",
                displayName: "AnotherBot",
                type: "BOT",
              },
              type: "MENTION",
            },
          },
        ],
      });

      adapter.parseMessage(event);

      expect(adapter.botUserId).toBe("users/FIRST_BOT");
    });
  });

  describe("isMessageFromSelf (via parseMessage)", () => {
    it("should detect self messages when botUserId is known", async () => {
      const { adapter } = await createInitializedAdapter();
      (adapter as any).botUserId = "users/BOT123";

      const event = makeMessageEvent({
        senderName: "users/BOT123",
        senderType: "BOT",
        senderDisplayName: "MyBot",
      });

      const msg = adapter.parseMessage(event);
      expect(msg.author.isMe).toBe(true);
    });

    it("should not mark other bots as self", async () => {
      const { adapter } = await createInitializedAdapter();
      (adapter as any).botUserId = "users/BOT123";

      const event = makeMessageEvent({
        senderName: "users/OTHER_BOT",
        senderType: "BOT",
        senderDisplayName: "OtherBot",
      });

      const msg = adapter.parseMessage(event);
      expect(msg.author.isMe).toBe(false);
    });

    it("should return false when botUserId is unknown", async () => {
      const { adapter } = await createInitializedAdapter();

      const event = makeMessageEvent({
        senderType: "BOT",
        senderDisplayName: "SomeBot",
      });

      const msg = adapter.parseMessage(event);
      expect(msg.author.isMe).toBe(false);
    });
  });

  describe("handleWebhook", () => {
    it("should return 400 for invalid JSON", async () => {
      const { adapter } = await createInitializedAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "not json{{{",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(400);
    });

    it("should route message events to processMessage", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event = makeMessageEvent({ messageText: "test message" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalled();
    });

    it("should handle ADDED_TO_SPACE events", async () => {
      const { adapter } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        chat: {
          addedToSpacePayload: {
            space: { name: "spaces/NEWSPACE", type: "ROOM" },
          },
        },
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
    });

    it("should handle REMOVED_FROM_SPACE events", async () => {
      const { adapter } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        chat: {
          removedFromSpacePayload: {
            space: { name: "spaces/LEFTSPACE", type: "ROOM" },
          },
        },
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
    });

    it("should handle card button click events", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        chat: {
          buttonClickedPayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: {
                name: "users/100",
                displayName: "User",
                type: "HUMAN",
              },
              text: "",
              createTime: new Date().toISOString(),
            },
            user: {
              name: "users/200",
              displayName: "Clicker",
              type: "HUMAN",
              email: "clicker@example.com",
            },
          },
        },
        commonEventObject: {
          invokedFunction: "myAction",
          parameters: { actionId: "btn_approve", value: "42" },
        },
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);

      // Card clicks return empty JSON to acknowledge
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({});
      expect(mockChat.processAction).toHaveBeenCalled();
    });

    it("should handle non-message events gracefully", async () => {
      const { adapter } = await createInitializedAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify({ chat: {} }),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
    });

    it("should auto-detect endpoint URL from request", async () => {
      const { adapter } = await createInitializedAdapter();
      const event: GoogleChatEvent = { chat: {} };
      const request = new Request(
        "https://my-app.vercel.app/api/webhooks/gchat",
        {
          method: "POST",
          body: JSON.stringify(event),
        }
      );

      await adapter.handleWebhook(request);

      expect((adapter as any).endpointUrl).toBe(
        "https://my-app.vercel.app/api/webhooks/gchat"
      );
    });

    it("should not overwrite existing endpointUrl", async () => {
      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://original.com/webhook",
      });
      const event: GoogleChatEvent = { chat: {} };
      const request = new Request("https://other.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);

      expect((adapter as any).endpointUrl).toBe("https://original.com/webhook");
    });

    it("should route Pub/Sub push messages", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const pubsubMessage = makePubSubPushMessage({
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/100",
            displayName: "PubSub User",
            type: "HUMAN",
          },
          text: "pub sub message",
          createTime: new Date().toISOString(),
        },
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalled();
    });

    it("should skip unsupported Pub/Sub event types", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const pubsubMessage = makePubSubPushMessage(
        {
          message: {
            name: "m1",
            sender: { name: "u1", displayName: "U", type: "HUMAN" },
            text: "t",
            createTime: new Date().toISOString(),
          },
        },
        "google.workspace.chat.message.v1.updated"
      );
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      // Updated event not in allowed list, should not process
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it("should handle malformed Pub/Sub data gracefully", async () => {
      const { adapter } = await createInitializedAdapter();
      const pubsubMessage: PubSubPushMessage = {
        message: {
          data: "not-valid-base64!!!",
          messageId: "msg-1",
          publishTime: new Date().toISOString(),
          attributes: {
            "ce-type": "google.workspace.chat.message.v1.created",
          },
        },
        subscription: "projects/test/subscriptions/test-sub",
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);

      // Should return 200 to avoid retries
      expect(response.status).toBe(200);
    });
  });

  describe("handleCardClick (via handleWebhook)", () => {
    it("should ignore card click when chat is not initialized", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      // Don't initialize

      const event: GoogleChatEvent = {
        chat: {
          buttonClickedPayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: { name: "users/1", displayName: "U", type: "HUMAN" },
              text: "",
              createTime: new Date().toISOString(),
            },
            user: {
              name: "users/2",
              displayName: "Clicker",
              type: "HUMAN",
              email: "",
            },
          },
        },
        commonEventObject: {
          invokedFunction: "doSomething",
        },
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it("should ignore card click when missing actionId", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        chat: {
          buttonClickedPayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: { name: "users/1", displayName: "U", type: "HUMAN" },
              text: "",
              createTime: new Date().toISOString(),
            },
            user: {
              name: "users/2",
              displayName: "Clicker",
              type: "HUMAN",
              email: "",
            },
          },
        },
        commonEventObject: {
          // No invokedFunction, no parameters.actionId
          parameters: {},
        },
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);
      expect(mockChat.processAction).not.toHaveBeenCalled();
    });

    it("should use invokedFunction as actionId", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        commonEventObject: {
          invokedFunction: "handleApprove",
        },
        chat: {
          buttonClickedPayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: { name: "users/1", displayName: "U", type: "HUMAN" },
              text: "",
              createTime: new Date().toISOString(),
            },
            user: {
              name: "users/2",
              displayName: "Clicker",
              type: "HUMAN",
              email: "",
            },
          },
        },
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);

      expect(mockChat.processAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: "handleApprove" }),
        undefined
      );
    });

    it("should ignore card click when space is missing", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        commonEventObject: {
          invokedFunction: "myAction",
        },
        // buttonClickedPayload has no space
        chat: {},
      };
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);
      expect(mockChat.processAction).not.toHaveBeenCalled();
    });
  });

  describe("handleMessageEvent (via handleWebhook)", () => {
    it("should not process when chat instance is not initialized", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      const event = makeMessageEvent();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it("should use space-only thread ID for DM messages", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event = makeMessageEvent({
        spaceType: "DM",
        spaceName: "spaces/DM_SPACE",
        threadName: "spaces/DM_SPACE/threads/thread1",
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);

      expect(mockChat.processMessage).toHaveBeenCalled();
      const call = (mockChat.processMessage as any).mock.calls[0];
      // threadId for DM should end with :dm and not include thread name
      expect(call[1]).toMatch(DM_SUFFIX_PATTERN);
    });

    it("should include thread name for room messages", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event = makeMessageEvent({
        spaceType: "ROOM",
        threadName: "spaces/ABC123/threads/XYZ",
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);

      expect(mockChat.processMessage).toHaveBeenCalled();
      const call = (mockChat.processMessage as any).mock.calls[0];
      // threadId should NOT end with :dm
      expect(call[1]).not.toMatch(DM_SUFFIX_PATTERN);
    });
  });

  describe("Pub/Sub message handling", () => {
    it("should handle Pub/Sub reaction.created events", async () => {
      const { adapter } = await createInitializedAdapter();

      // Mock the chatApi.spaces.messages.get call for reaction thread lookup
      (adapter as any).chatApi = {
        spaces: {
          messages: {
            get: vi.fn().mockResolvedValue({
              data: { thread: { name: "spaces/ABC123/threads/T1" } },
            }),
          },
        },
      };

      const pubsubMessage = makePubSubPushMessage(
        {
          reaction: {
            name: "spaces/ABC123/messages/msg1/reactions/react1",
            emoji: { unicode: "\u{1f44d}" },
            user: { name: "users/100", displayName: "Reactor", type: "HUMAN" },
          },
        },
        "google.workspace.chat.reaction.v1.created",
        "//chat.googleapis.com/spaces/ABC123"
      );
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      // processReaction is called async via the buildReactionEvent -> processTask chain
    });

    it("should handle Pub/Sub reaction.deleted events", async () => {
      const { adapter } = await createInitializedAdapter();
      const pubsubMessage = makePubSubPushMessage(
        {
          reaction: {
            name: "spaces/ABC123/messages/msg1/reactions/react1",
            emoji: { unicode: "\u{1f44d}" },
            user: { name: "users/100", type: "HUMAN" },
          },
        },
        "google.workspace.chat.reaction.v1.deleted",
        "//chat.googleapis.com/spaces/ABC123"
      );
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });
  });

  describe("parsePubSubMessage", () => {
    it("should throw when notification has no message", async () => {
      const { adapter } = await createInitializedAdapter();
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        eventTime: new Date().toISOString(),
        subscription: "sub1",
      };

      await expect(
        (adapter as any).parsePubSubMessage(notification, "gchat:spaces/ABC123")
      ).rejects.toThrow();
    });

    it("should detect bot messages", async () => {
      const { adapter } = await createInitializedAdapter();
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: { name: "users/BOT1", displayName: "BotUser", type: "BOT" },
          text: "Bot message",
          createTime: new Date().toISOString(),
        },
      };

      const msg = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(msg.author.isBot).toBe(true);
    });

    it("should detect self messages when botUserId matches", async () => {
      const { adapter } = await createInitializedAdapter();
      (adapter as any).botUserId = "users/MYBOT";

      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: { name: "users/MYBOT", displayName: "MyBot", type: "BOT" },
          text: "Self message",
          createTime: new Date().toISOString(),
        },
      };

      const msg = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(msg.author.isMe).toBe(true);
    });

    it("should include attachments from Pub/Sub messages", async () => {
      const { adapter } = await createInitializedAdapter();
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: { name: "users/100", displayName: "User", type: "HUMAN" },
          text: "With file",
          createTime: new Date().toISOString(),
          attachment: [
            {
              name: "att1",
              contentName: "doc.pdf",
              contentType: "application/pdf",
              downloadUri: "https://example.com/doc.pdf",
            },
          ],
        },
      };

      const msg = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0].type).toBe("file");
      expect(msg.attachments[0].name).toBe("doc.pdf");
    });
  });

  describe("postMessage", () => {
    it("should call chatApi.spaces.messages.create for text", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });

      const mockCreate = vi.fn().mockResolvedValue({
        data: { name: "spaces/ABC123/messages/new1" },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      const result = await adapter.postMessage(threadId, "Hello from bot");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: "spaces/ABC123",
          messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
          requestBody: expect.objectContaining({
            text: expect.any(String),
          }),
        })
      );
      expect(result.id).toBe("spaces/ABC123/messages/new1");
    });

    it("should not set messageReplyOption when no thread name", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockCreate = vi.fn().mockResolvedValue({
        data: { name: "spaces/ABC123/messages/new1" },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      await adapter.postMessage(threadId, "Top level message");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messageReplyOption: undefined,
        })
      );
    });

    it("should throw on API error", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockCreate = vi
        .fn()
        .mockRejectedValue({ code: 500, message: "Internal error" });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      await expect(
        adapter.postMessage(threadId, "Will fail")
      ).rejects.toBeTruthy();
    });

    it("should throw AdapterRateLimitError on 429", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockCreate = vi
        .fn()
        .mockRejectedValue({ code: 429, message: "Rate limited" });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      await expect(
        adapter.postMessage(threadId, "Rate limited")
      ).rejects.toThrow(AdapterRateLimitError);
    });
  });

  describe("editMessage", () => {
    it("should call chatApi.spaces.messages.update for text", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockUpdate = vi.fn().mockResolvedValue({
        data: { name: "spaces/ABC123/messages/msg1" },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { update: mockUpdate } },
      };

      const result = await adapter.editMessage(
        threadId,
        "spaces/ABC123/messages/msg1",
        "Updated text"
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "spaces/ABC123/messages/msg1",
          updateMask: "text",
          requestBody: expect.objectContaining({
            text: expect.any(String),
          }),
        })
      );
      expect(result.id).toBe("spaces/ABC123/messages/msg1");
    });

    it("should throw on API error", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockUpdate = vi
        .fn()
        .mockRejectedValue({ code: 403, message: "Forbidden" });
      (adapter as any).chatApi = {
        spaces: { messages: { update: mockUpdate } },
      };

      await expect(
        adapter.editMessage(threadId, "msg1", "edit")
      ).rejects.toBeTruthy();
    });
  });

  describe("deleteMessage", () => {
    it("should call chatApi.spaces.messages.delete", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockDelete = vi.fn().mockResolvedValue({});
      (adapter as any).chatApi = {
        spaces: { messages: { delete: mockDelete } },
      };

      await adapter.deleteMessage(
        "gchat:spaces/ABC123",
        "spaces/ABC123/messages/msg1"
      );

      expect(mockDelete).toHaveBeenCalledWith({
        name: "spaces/ABC123/messages/msg1",
      });
    });

    it("should throw on API error", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockDelete = vi
        .fn()
        .mockRejectedValue({ code: 404, message: "Not found" });
      (adapter as any).chatApi = {
        spaces: { messages: { delete: mockDelete } },
      };

      await expect(
        adapter.deleteMessage("gchat:spaces/ABC123", "msg1")
      ).rejects.toBeTruthy();
    });
  });

  describe("addReaction", () => {
    it("should call chatApi.spaces.messages.reactions.create", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockCreate = vi.fn().mockResolvedValue({});
      (adapter as any).chatApi = {
        spaces: {
          messages: {
            reactions: { create: mockCreate },
          },
        },
      };

      await adapter.addReaction(
        "gchat:spaces/ABC123",
        "spaces/ABC123/messages/msg1",
        "\u{1f44d}"
      );

      expect(mockCreate).toHaveBeenCalledWith({
        parent: "spaces/ABC123/messages/msg1",
        requestBody: {
          emoji: { unicode: expect.any(String) },
        },
      });
    });

    it("should throw AdapterRateLimitError on 429", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockCreate = vi
        .fn()
        .mockRejectedValue({ code: 429, message: "Rate limited" });
      (adapter as any).chatApi = {
        spaces: {
          messages: {
            reactions: { create: mockCreate },
          },
        },
      };

      await expect(
        adapter.addReaction("gchat:spaces/ABC123", "msg1", "\u{1f44d}")
      ).rejects.toThrow(AdapterRateLimitError);
    });
  });

  describe("removeReaction", () => {
    it("should list reactions and delete the matching one", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: {
          reactions: [
            {
              name: "spaces/ABC123/messages/msg1/reactions/react1",
              emoji: { unicode: "\u{1f44d}" },
            },
            {
              name: "spaces/ABC123/messages/msg1/reactions/react2",
              emoji: { unicode: "\u{2764}\u{fe0f}" },
            },
          ],
        },
      });
      const mockDelete = vi.fn().mockResolvedValue({});
      (adapter as any).chatApi = {
        spaces: {
          messages: {
            reactions: { list: mockList, delete: mockDelete },
          },
        },
      };

      await adapter.removeReaction(
        "gchat:spaces/ABC123",
        "spaces/ABC123/messages/msg1",
        "\u{1f44d}"
      );

      expect(mockList).toHaveBeenCalledWith({
        parent: "spaces/ABC123/messages/msg1",
      });
      expect(mockDelete).toHaveBeenCalledWith({
        name: "spaces/ABC123/messages/msg1/reactions/react1",
      });
    });

    it("should not delete when reaction not found", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: { reactions: [] },
      });
      const mockDelete = vi.fn();
      (adapter as any).chatApi = {
        spaces: {
          messages: {
            reactions: { list: mockList, delete: mockDelete },
          },
        },
      };

      await adapter.removeReaction(
        "gchat:spaces/ABC123",
        "spaces/ABC123/messages/msg1",
        "\u{1f44d}"
      );

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe("startTyping", () => {
    it("should be a no-op (GChat has no typing indicator API)", async () => {
      const { adapter } = await createInitializedAdapter();
      // Should not throw
      await adapter.startTyping("gchat:spaces/ABC123");
    });
  });

  describe("handleGoogleChatError", () => {
    it("should throw AdapterRateLimitError for 429", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      expect(() => {
        (adapter as any).handleGoogleChatError(
          { code: 429, message: "Too many requests" },
          "test"
        );
      }).toThrow(AdapterRateLimitError);
    });

    it("should rethrow the original error for non-429 codes", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const originalError = { code: 500, message: "Server error" };
      let thrown: unknown;
      try {
        (adapter as any).handleGoogleChatError(originalError, "test");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(originalError);
    });

    it("should log context information", () => {
      const localLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: localLogger,
      });

      try {
        (adapter as any).handleGoogleChatError(
          { code: 500, message: "Fail" },
          "postMessage"
        );
      } catch {
        // expected
      }

      expect(localLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("postMessage"),
        expect.objectContaining({ code: 500 })
      );
    });
  });

  describe("ensureSpaceSubscription", () => {
    it("should skip when no pubsubTopic configured", async () => {
      const { adapter, mockState } = await createInitializedAdapter();
      // No pubsubTopic
      await (adapter as any).ensureSpaceSubscription("spaces/ABC123");
      // Should not attempt any cache lookups
      expect(mockState.get).not.toHaveBeenCalledWith(
        expect.stringContaining("gchat:space-sub:")
      );
    });

    it("should skip when no state configured", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        pubsubTopic: "projects/test/topics/test",
      });
      // Not initialized, so state is null
      await (adapter as any).ensureSpaceSubscription("spaces/ABC123");
      // Should not throw
    });

    it("should skip when cached subscription is still valid", async () => {
      const { adapter, mockState } = await createInitializedAdapter({
        pubsubTopic: "projects/test/topics/test",
      });

      // Cache a valid subscription (expires far in the future)
      const futureExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h from now
      mockState.storage.set("gchat:space-sub:spaces/ABC123", {
        subscriptionName: "subscriptions/existing",
        expireTime: futureExpiry,
      });

      await (adapter as any).ensureSpaceSubscription("spaces/ABC123");

      // Should have checked cache but not tried to create
      expect(mockState.get).toHaveBeenCalled();
    });

    it("should deduplicate concurrent subscription requests", async () => {
      const { adapter } = await createInitializedAdapter({
        pubsubTopic: "projects/test/topics/test",
      });

      // The first call will start creating, second should reuse
      const promise1 = (adapter as any).ensureSpaceSubscription("spaces/DEDUP");
      const promise2 = (adapter as any).ensureSpaceSubscription("spaces/DEDUP");

      // Both should resolve (possibly with errors from actual API, but not crash)
      await Promise.allSettled([promise1, promise2]);
    });
  });

  describe("onThreadSubscribe", () => {
    it("should warn when no pubsubTopic configured", async () => {
      const localLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: localLogger,
      });
      const mockState = createMockStateAdapter();
      const mockChat = createMockChatInstance(mockState);
      await adapter.initialize(mockChat);

      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      await adapter.onThreadSubscribe(threadId);

      expect(localLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("pubsubTopic")
      );
    });
  });

  describe("channelIdFromThreadId", () => {
    it("should derive channel ID from thread ID", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });

      const channelId = adapter.channelIdFromThreadId(threadId);
      expect(channelId).toBe("gchat:spaces/ABC123");
    });
  });

  describe("renderFormatted", () => {
    it("should convert mdast to platform format", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      // Simple root with paragraph + text
      const content = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "Hello world" }],
          },
        ],
      };

      const result = adapter.renderFormatted(content);
      expect(result).toContain("Hello world");
    });
  });

  describe("fetchThread", () => {
    it("should call chatApi.spaces.get and return ThreadInfo", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockGet = vi.fn().mockResolvedValue({
        data: { displayName: "My Space", name: "spaces/ABC123" },
      });
      (adapter as any).chatApi = { spaces: { get: mockGet } };

      const result = await adapter.fetchThread(threadId);

      expect(mockGet).toHaveBeenCalledWith({ name: "spaces/ABC123" });
      expect(result.id).toBe(threadId);
      expect(result.channelName).toBe("My Space");
    });

    it("should throw on API error", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockGet = vi
        .fn()
        .mockRejectedValue({ code: 404, message: "Not found" });
      (adapter as any).chatApi = { spaces: { get: mockGet } };

      await expect(adapter.fetchThread(threadId)).rejects.toBeTruthy();
    });
  });

  describe("fetchChannelInfo", () => {
    it("should return channel info with member count", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockGet = vi.fn().mockResolvedValue({
        data: {
          displayName: "Engineering",
          spaceType: "SPACE",
          spaceThreadingState: "THREADED_MESSAGES",
        },
      });
      const mockMembersList = vi.fn().mockResolvedValue({
        data: { memberships: [{ member: { name: "users/1" } }] },
      });
      (adapter as any).chatApi = {
        spaces: { get: mockGet, members: { list: mockMembersList } },
      };

      const result = await adapter.fetchChannelInfo("gchat:spaces/ABC123");

      expect(result.name).toBe("Engineering");
      expect(result.isDM).toBe(false);
      expect(result.memberCount).toBe(1);
    });

    it("should detect DM channels", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockGet = vi.fn().mockResolvedValue({
        data: {
          spaceType: "DIRECT_MESSAGE",
          singleUserBotDm: true,
        },
      });
      const mockMembersList = vi.fn().mockRejectedValue(new Error("no access"));
      (adapter as any).chatApi = {
        spaces: { get: mockGet, members: { list: mockMembersList } },
      };

      const result = await adapter.fetchChannelInfo("gchat:spaces/DM123");

      expect(result.isDM).toBe(true);
    });

    it("should throw on invalid channel ID", async () => {
      const { adapter } = await createInitializedAdapter();

      await expect(adapter.fetchChannelInfo("gchat:")).rejects.toThrow();
    });
  });

  describe("fetchMessages", () => {
    it("should fetch messages backward (default)", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/ABC123/messages/msg2",
              text: "Newer",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
            {
              name: "spaces/ABC123/messages/msg1",
              text: "Older",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
          ],
          nextPageToken: "next_page",
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchMessages(threadId, { limit: 10 });

      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: "createTime desc",
        })
      );
      // Messages are reversed to chronological order
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Older");
      expect(result.messages[1].text).toBe("Newer");
      expect(result.nextCursor).toBe("next_page");
    });

    it("should throw on API error", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockList = vi
        .fn()
        .mockRejectedValue({ code: 500, message: "Internal" });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      await expect(adapter.fetchMessages(threadId)).rejects.toBeTruthy();
    });
  });

  describe("postChannelMessage", () => {
    it("should post a top-level message without thread", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockCreate = vi.fn().mockResolvedValue({
        data: { name: "spaces/ABC123/messages/new1" },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      const result = await adapter.postChannelMessage(
        "gchat:spaces/ABC123",
        "Top level"
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: "spaces/ABC123",
          requestBody: expect.objectContaining({
            text: expect.any(String),
          }),
        })
      );
      // No thread field in requestBody
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.requestBody.thread).toBeUndefined();
      expect(result.id).toBe("spaces/ABC123/messages/new1");
    });

    it("should throw on invalid channel ID", async () => {
      const { adapter } = await createInitializedAdapter();

      await expect(
        adapter.postChannelMessage("gchat:", "message")
      ).rejects.toThrow();
    });
  });

  describe("listThreads", () => {
    it("should deduplicate messages by thread name", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/S1/messages/m3",
              text: "Reply in T1",
              createTime: "2024-01-03T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/T1" },
            },
            {
              name: "spaces/S1/messages/m2",
              text: "Start T2",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/T2" },
            },
            {
              name: "spaces/S1/messages/m1",
              text: "Start T1",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/T1" },
            },
          ],
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.listThreads("gchat:spaces/S1");

      // Two unique threads: T1 (count 2) and T2 (count 1)
      expect(result.threads).toHaveLength(2);
      expect(result.threads[0].replyCount).toBe(2);
      expect(result.threads[1].replyCount).toBe(1);
    });

    it("should throw on invalid channel ID", async () => {
      const { adapter } = await createInitializedAdapter();

      await expect(adapter.listThreads("gchat:")).rejects.toThrow();
    });
  });

  describe("postEphemeral", () => {
    it("should create ephemeral text message with privateMessageViewer", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });

      const mockCreate = vi.fn().mockResolvedValue({
        data: { name: "spaces/ABC123/messages/eph1" },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      const result = await adapter.postEphemeral(
        threadId,
        "users/TARGET",
        "Only you can see this"
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: "spaces/ABC123",
          requestBody: expect.objectContaining({
            privateMessageViewer: { name: "users/TARGET" },
            text: expect.any(String),
          }),
        })
      );
      expect(result.id).toBe("spaces/ABC123/messages/eph1");
      expect(result.usedFallback).toBe(false);
    });

    it("should throw on API error", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
      });

      const mockCreate = vi
        .fn()
        .mockRejectedValue({ code: 500, message: "Error" });
      (adapter as any).chatApi = {
        spaces: { messages: { create: mockCreate } },
      };

      await expect(
        adapter.postEphemeral(threadId, "users/1", "fail")
      ).rejects.toBeTruthy();
    });
  });

  describe("openDM", () => {
    it("should find existing DM space", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockFindDM = vi.fn().mockResolvedValue({
        data: { name: "spaces/DM_EXISTING" },
      });
      (adapter as any).chatApi = {
        spaces: { findDirectMessage: mockFindDM },
      };

      const threadId = await adapter.openDM("users/TARGET");

      expect(mockFindDM).toHaveBeenCalledWith({ name: "users/TARGET" });
      expect(threadId).toMatch(DM_SUFFIX_PATTERN);
    });

    it("should create DM when not found (404)", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockFindDM = vi
        .fn()
        .mockRejectedValue({ code: 404, message: "Not found" });
      const mockSetup = vi.fn().mockResolvedValue({
        data: { name: "spaces/NEW_DM" },
      });
      (adapter as any).chatApi = {
        spaces: { findDirectMessage: mockFindDM, setup: mockSetup },
      };

      const threadId = await adapter.openDM("users/TARGET");

      expect(mockSetup).toHaveBeenCalled();
      expect(threadId).toMatch(DM_SUFFIX_PATTERN);
    });

    it("should throw when DM creation fails", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockFindDM = vi
        .fn()
        .mockRejectedValue({ code: 404, message: "Not found" });
      const mockSetup = vi
        .fn()
        .mockRejectedValue({ code: 403, message: "Forbidden" });
      (adapter as any).chatApi = {
        spaces: { findDirectMessage: mockFindDM, setup: mockSetup },
      };

      await expect(adapter.openDM("users/TARGET")).rejects.toBeTruthy();
    });

    it("should throw when setup returns no space name", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockFindDM = vi
        .fn()
        .mockRejectedValue({ code: 404, message: "Not found" });
      const mockSetup = vi.fn().mockResolvedValue({
        data: { name: null },
      });
      (adapter as any).chatApi = {
        spaces: { findDirectMessage: mockFindDM, setup: mockSetup },
      };

      await expect(adapter.openDM("users/TARGET")).rejects.toThrow();
    });

    it("should rethrow non-404 errors from findDirectMessage", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockFindDM = vi
        .fn()
        .mockRejectedValue({ code: 500, message: "Server error" });
      const mockSetup = vi.fn().mockResolvedValue({
        data: { name: "spaces/FALLBACK_DM" },
      });
      (adapter as any).chatApi = {
        spaces: { findDirectMessage: mockFindDM, setup: mockSetup },
      };

      // Non-404 doesn't prevent trying setup, just logs
      const threadId = await adapter.openDM("users/TARGET");
      expect(threadId).toMatch(DM_SUFFIX_PATTERN);
    });
  });

  describe("fetchMessages (forward direction)", () => {
    it("should fetch all messages forward and paginate", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/ABC123/messages/msg1",
              text: "First",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
            {
              name: "spaces/ABC123/messages/msg2",
              text: "Second",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
            {
              name: "spaces/ABC123/messages/msg3",
              text: "Third",
              createTime: "2024-01-03T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
          ],
          nextPageToken: undefined,
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchMessages(threadId, {
        direction: "forward",
        limit: 2,
      });

      // Oldest first, limited to 2
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("First");
      expect(result.messages[1].text).toBe("Second");
      // Should have cursor since there are more messages
      expect(result.nextCursor).toBe("spaces/ABC123/messages/msg2");
    });

    it("should support cursor-based forward pagination", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/ABC123/messages/msg1",
              text: "First",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
            {
              name: "spaces/ABC123/messages/msg2",
              text: "Second",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
            {
              name: "spaces/ABC123/messages/msg3",
              text: "Third",
              createTime: "2024-01-03T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/ABC123/threads/T1" },
            },
          ],
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      // Start after msg1
      const result = await adapter.fetchMessages(threadId, {
        direction: "forward",
        limit: 10,
        cursor: "spaces/ABC123/messages/msg1",
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Second");
      expect(result.messages[1].text).toBe("Third");
    });
  });

  describe("fetchChannelMessages", () => {
    it("should filter to thread roots only (backward)", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            // Thread root: message ID matches thread ID pattern
            {
              name: "spaces/S1/messages/ABC.ABC",
              text: "Thread root",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/ABC" },
            },
            // Reply: message ID parts differ
            {
              name: "spaces/S1/messages/ABC.DEF",
              text: "Reply",
              createTime: "2024-01-02T01:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/ABC" },
            },
            // Another thread root
            {
              name: "spaces/S1/messages/XYZ.XYZ",
              text: "Another root",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/XYZ" },
            },
          ],
          nextPageToken: undefined,
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchChannelMessages("gchat:spaces/S1", {
        direction: "backward",
        limit: 10,
      });

      // Should only include thread roots, not replies
      expect(result.messages).toHaveLength(2);
    });

    it("should filter to thread roots only (forward)", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/S1/messages/ABC.ABC",
              text: "Root 1",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/ABC" },
            },
            {
              name: "spaces/S1/messages/ABC.DEF",
              text: "Reply",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/ABC" },
            },
          ],
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchChannelMessages("gchat:spaces/S1", {
        direction: "forward",
        limit: 10,
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toContain("Root 1");
    });

    it("should throw on invalid channel ID", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(adapter.fetchChannelMessages("gchat:")).rejects.toThrow();
    });

    it("should handle messages without thread info as top-level", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/S1/messages/simple",
              text: "No thread",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              // No thread field
            },
          ],
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchChannelMessages("gchat:spaces/S1", {
        direction: "backward",
        limit: 10,
      });

      expect(result.messages).toHaveLength(1);
    });

    it("should support forward pagination with cursor", async () => {
      const { adapter } = await createInitializedAdapter();

      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              name: "spaces/S1/messages/A.A",
              text: "First",
              createTime: "2024-01-01T00:00:00Z",
              sender: { name: "users/1", displayName: "A", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/A" },
            },
            {
              name: "spaces/S1/messages/B.B",
              text: "Second",
              createTime: "2024-01-02T00:00:00Z",
              sender: { name: "users/2", displayName: "B", type: "HUMAN" },
              thread: { name: "spaces/S1/threads/B" },
            },
          ],
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchChannelMessages("gchat:spaces/S1", {
        direction: "forward",
        limit: 10,
        cursor: "spaces/S1/messages/A.A",
      });

      // Should skip past cursor to the second message
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toContain("Second");
    });
  });

  describe("getAuthOptions", () => {
    it("should return credentials-based auth options", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        impersonateUser: "user@example.com",
      });

      const opts = (adapter as any).getAuthOptions();
      expect(opts).toEqual({
        credentials: TEST_CREDENTIALS,
        impersonateUser: "user@example.com",
      });
    });

    it("should return ADC auth options", () => {
      const adapter = new GoogleChatAdapter({
        useApplicationDefaultCredentials: true,
        logger: mockLogger,
      });

      const opts = (adapter as any).getAuthOptions();
      expect(opts).toEqual({
        useApplicationDefaultCredentials: true,
        impersonateUser: undefined,
      });
    });

    it("should return custom auth options", () => {
      const mockAuth = { getAccessToken: vi.fn() };
      const adapter = createGoogleChatAdapter({
        auth: mockAuth as any,
        logger: mockLogger,
      });

      const opts = (adapter as any).getAuthOptions();
      expect(opts).toEqual({ auth: mockAuth });
    });
  });

  describe("createGoogleChatAdapter factory", () => {
    it("should throw when no auth method is provided", () => {
      const originalCreds = process.env.GOOGLE_CHAT_CREDENTIALS;
      const originalAdc = process.env.GOOGLE_CHAT_USE_ADC;
      try {
        // biome-ignore lint/performance/noDelete: env var removal requires delete
        delete process.env.GOOGLE_CHAT_CREDENTIALS;
        // biome-ignore lint/performance/noDelete: env var removal requires delete
        delete process.env.GOOGLE_CHAT_USE_ADC;
        expect(() => createGoogleChatAdapter({})).toThrow();
      } finally {
        if (originalCreds !== undefined) {
          process.env.GOOGLE_CHAT_CREDENTIALS = originalCreds;
        }
        if (originalAdc !== undefined) {
          process.env.GOOGLE_CHAT_USE_ADC = originalAdc;
        }
      }
    });

    it("should create with custom auth", () => {
      const mockAuth = { getAccessToken: vi.fn() };
      const adapter = createGoogleChatAdapter({
        auth: mockAuth as any,
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should pick up pubsubTopic from config", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        pubsubTopic: "projects/my-project/topics/my-topic",
      });
      expect((adapter as any).pubsubTopic).toBe(
        "projects/my-project/topics/my-topic"
      );
    });

    it("should create with ADC config", () => {
      const adapter = createGoogleChatAdapter({
        useApplicationDefaultCredentials: true,
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should create with GOOGLE_CHAT_CREDENTIALS env var", () => {
      const originalEnv = process.env.GOOGLE_CHAT_CREDENTIALS;
      try {
        process.env.GOOGLE_CHAT_CREDENTIALS = JSON.stringify(TEST_CREDENTIALS);
        const adapter = createGoogleChatAdapter({ logger: mockLogger });
        expect(adapter).toBeInstanceOf(GoogleChatAdapter);
      } finally {
        if (originalEnv !== undefined) {
          process.env.GOOGLE_CHAT_CREDENTIALS = originalEnv;
        } else {
          // biome-ignore lint/performance/noDelete: env var removal requires delete
          delete process.env.GOOGLE_CHAT_CREDENTIALS;
        }
      }
    });

    it("should create with GOOGLE_CHAT_USE_ADC env var", () => {
      const originalEnv = process.env.GOOGLE_CHAT_USE_ADC;
      try {
        process.env.GOOGLE_CHAT_USE_ADC = "true";
        const adapter = createGoogleChatAdapter({ logger: mockLogger });
        expect(adapter).toBeInstanceOf(GoogleChatAdapter);
      } finally {
        if (originalEnv !== undefined) {
          process.env.GOOGLE_CHAT_USE_ADC = originalEnv;
        } else {
          // biome-ignore lint/performance/noDelete: env var removal requires delete
          delete process.env.GOOGLE_CHAT_USE_ADC;
        }
      }
    });

    it("should use default logger when none provided", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
      });
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should pick up impersonateUser from config", () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        impersonateUser: "admin@example.com",
      });
      expect((adapter as any).impersonateUser).toBe("admin@example.com");
    });
  });

  describe("user info caching", () => {
    let adapter: GoogleChatAdapter;
    let mockState: StateAdapter & { storage: Map<string, unknown> };
    let mockChat: ChatInstance;

    beforeEach(async () => {
      adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      mockState = createMockStateAdapter();
      mockChat = createMockChatInstance(mockState);
      await adapter.initialize(mockChat);
    });

    it("should cache user info from direct webhook messages", () => {
      const event: GoogleChatEvent = {
        chat: {
          messagePayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: {
                name: "users/123456789",
                displayName: "John Doe",
                type: "HUMAN",
                email: "john@example.com",
              },
              text: "Hello",
              createTime: new Date().toISOString(),
            },
          },
        },
      };

      adapter.parseMessage(event);

      // Verify user info was cached
      expect(mockState.set).toHaveBeenCalledWith(
        "gchat:user:users/123456789",
        { displayName: "John Doe", email: "john@example.com" },
        expect.any(Number)
      );
    });

    it("should not cache user info when displayName is unknown", () => {
      const event: GoogleChatEvent = {
        chat: {
          messagePayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: {
                name: "users/123456789",
                displayName: "unknown",
                type: "HUMAN",
              },
              text: "Hello",
              createTime: new Date().toISOString(),
            },
          },
        },
      };

      adapter.parseMessage(event);

      // Verify user info was NOT cached
      expect(mockState.set).not.toHaveBeenCalledWith(
        "gchat:user:users/123456789",
        expect.anything(),
        expect.any(Number)
      );
    });

    it("should resolve user display name from cache for Pub/Sub messages", async () => {
      // Pre-populate cache
      mockState.storage.set("gchat:user:users/123456789", {
        displayName: "Jane Smith",
        email: "jane@example.com",
      });

      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/123456789",
            type: "HUMAN",
            // Note: displayName is missing in Pub/Sub messages
          },
          text: "Hello from Pub/Sub",
          createTime: new Date().toISOString(),
        },
      };

      // Access private method via any cast for testing
      const parsedMessage = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(parsedMessage.author.fullName).toBe("Jane Smith");
      expect(parsedMessage.author.userName).toBe("Jane Smith");
    });

    it("should fall back to User ID when cache miss", async () => {
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/987654321",
            type: "HUMAN",
          },
          text: "Hello from unknown user",
          createTime: new Date().toISOString(),
        },
      };

      const parsedMessage = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      // Should fall back to "User {numeric_id}"
      expect(parsedMessage.author.fullName).toBe("User 987654321");
      expect(parsedMessage.author.userName).toBe("User 987654321");
    });

    it("should use provided displayName if available and cache it", async () => {
      const notification: WorkspaceEventNotification = {
        eventType: "google.workspace.chat.message.v1.created",
        targetResource: "//chat.googleapis.com/spaces/ABC123",
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: {
            name: "users/111222333",
            displayName: "Bob Wilson",
            type: "HUMAN",
          },
          text: "Hello with displayName",
          createTime: new Date().toISOString(),
        },
      };

      const parsedMessage = await (adapter as any).parsePubSubMessage(
        notification,
        "gchat:spaces/ABC123"
      );

      expect(parsedMessage.author.fullName).toBe("Bob Wilson");

      // Should also cache the displayName for future use
      // Wait a tick for the async cache operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockState.storage.get("gchat:user:users/111222333")).toEqual({
        displayName: "Bob Wilson",
        email: undefined,
      });
    });
  });

  describe("webhook verification", () => {
    let verifyIdTokenSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      verifyIdTokenSpy = vi
        .spyOn(auth.OAuth2.prototype, "verifyIdToken")
        .mockRejectedValue(new Error("Invalid token"));
    });

    afterEach(() => {
      verifyIdTokenSpy.mockRestore();
    });

    it("should reject direct webhook without Authorization header when project number is configured", async () => {
      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      // Should not even call verifyIdToken — no Bearer token present
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
    });

    it("should reject direct webhook with invalid Bearer token when project number is configured", async () => {
      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer invalid-token",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      expect(verifyIdTokenSpy).toHaveBeenCalledWith({
        idToken: "invalid-token",
        audience: "123456789",
      });
    });

    it("should allow direct webhook with valid Bearer token when project number is configured", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "chat@system.gserviceaccount.com",
          aud: "123456789",
          email: "chat@system.gserviceaccount.com",
        }),
      });

      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer valid-google-jwt",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(verifyIdTokenSpy).toHaveBeenCalledWith({
        idToken: "valid-google-jwt",
        audience: "123456789",
      });
    });

    it("should allow direct webhook without verification when project number is not configured and warn once", async () => {
      const { adapter } = await createInitializedAdapter();

      const event = makeMessageEvent({ messageText: "Hello" });
      const request1 = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      const request2 = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });

      const response1 = await adapter.handleWebhook(request1);
      expect(response1.status).toBe(200);
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("GOOGLE_CHAT_PROJECT_NUMBER")
      );

      // Second call should not warn again
      (mockLogger.warn as ReturnType<typeof vi.fn>).mockClear();
      await adapter.handleWebhook(request2);
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("GOOGLE_CHAT_PROJECT_NUMBER")
      );
    });

    it("should reject Pub/Sub webhook without Authorization header when pubsubAudience is configured", async () => {
      const { adapter } = await createInitializedAdapter({
        pubsubAudience: "https://example.com/webhook/pubsub",
      });

      const pubsubMessage = makePubSubPushMessage({
        message: {
          name: "spaces/ABC123/messages/msg1",
          text: "Hello",
          sender: { name: "users/100", displayName: "User", type: "HUMAN" },
          createTime: new Date().toISOString(),
        },
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("should allow Pub/Sub webhook without verification when pubsubAudience is not configured and warn once", async () => {
      const { adapter } = await createInitializedAdapter();

      const makePubSubRequest = () => {
        const pubsubMessage = makePubSubPushMessage({
          message: {
            name: "spaces/ABC123/messages/msg1",
            text: "Hello",
            sender: { name: "users/100", displayName: "User", type: "HUMAN" },
            createTime: new Date().toISOString(),
          },
        });
        return new Request("https://example.com/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pubsubMessage),
        });
      };

      const response1 = await adapter.handleWebhook(makePubSubRequest());
      expect(response1.status).toBe(200);
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("GOOGLE_CHAT_PUBSUB_AUDIENCE")
      );

      // Second call should not warn again
      (mockLogger.warn as ReturnType<typeof vi.fn>).mockClear();
      await adapter.handleWebhook(makePubSubRequest());
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("GOOGLE_CHAT_PUBSUB_AUDIENCE")
      );
    });

    it("should reject Pub/Sub webhook with invalid token when pubsubAudience is configured", async () => {
      const { adapter } = await createInitializedAdapter({
        pubsubAudience: "https://example.com/webhook/pubsub",
      });

      const pubsubMessage = makePubSubPushMessage({
        message: {
          name: "spaces/ABC123/messages/msg1",
          text: "Hello",
          sender: { name: "users/100", displayName: "User", type: "HUMAN" },
          createTime: new Date().toISOString(),
        },
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer bad-token",
        },
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      expect(verifyIdTokenSpy).toHaveBeenCalledWith({
        idToken: "bad-token",
        audience: "https://example.com/webhook/pubsub",
      });
    });

    it("should allow Pub/Sub webhook with valid token when pubsubAudience is configured", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "accounts.google.com",
          aud: "https://example.com/webhook/pubsub",
          email: "pubsub@my-project.iam.gserviceaccount.com",
        }),
      });

      const { adapter } = await createInitializedAdapter({
        pubsubAudience: "https://example.com/webhook/pubsub",
      });

      const pubsubMessage = makePubSubPushMessage({
        message: {
          name: "spaces/ABC123/messages/msg1",
          text: "Hello",
          sender: { name: "users/100", displayName: "User", type: "HUMAN" },
          createTime: new Date().toISOString(),
        },
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer valid-pubsub-jwt",
        },
        body: JSON.stringify(pubsubMessage),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it("should reject request with non-Bearer Authorization scheme", async () => {
      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Basic dXNlcjpwYXNz",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
    });

    it("should reject when verifyIdToken returns no payload", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => undefined,
      });

      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-no-payload",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });
  });
});
