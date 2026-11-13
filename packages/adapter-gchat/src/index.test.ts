import { AdapterRateLimitError } from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  mockLogger,
  threadIdContract,
} from "@chat-adapter/tests";
import { auth } from "@googleapis/chat";
import {
  Card,
  type ChatInstance,
  DEFAULT_MAX_INCOMING_PARSE_LENGTH,
  type Lock,
  type Logger,
  type Message,
  paragraph,
  root,
  type StateAdapter,
  text,
} from "chat";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  createGoogleChatAdapter,
  GoogleChatAdapter,
  type GoogleChatEvent,
  type GoogleChatMessage,
  type GoogleChatThreadId,
  type GoogleChatUser,
} from "./index";
import { GoogleChatFormatConverter } from "./markdown";
import type {
  PubSubPushMessage,
  WorkspaceEventNotification,
} from "./workspace-events";

const FOREIGN_SPACE_REGEX = /does not belong to space/;
const INVALID_MESSAGE_ID_REGEX = /Invalid Google Chat message id/;
const MARKDOWN_BODY = "**bold** with [a link](https://example.com) and `code`";
const MARKDOWN_PLAIN_TEXT = "bold with a link and code";
const OVER_LIMIT_BODY = `**bold** ${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH)}`;

const DM_SUFFIX_PATTERN = /:dm$/;
const VERIFICATION_REQUIRED_PATTERN =
  /Webhook signature verification is required/;

// Test credentials
const TEST_CREDENTIALS = {
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
};

// The adapter now fails closed by default when no JWT verification config is
// provided. Most tests in this file exercise non-security mechanics and don't
// supply one, so set the explicit opt-out env var globally; specific
// verification-behavior tests override it locally.
process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "true";

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
    setIfNotExists: vi
      .fn()
      .mockImplementation((key: string, value: unknown) => {
        if (storage.has(key)) {
          return Promise.resolve(false);
        }
        storage.set(key, value);
        return Promise.resolve(true);
      }),
    delete: vi.fn().mockImplementation((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
  };
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
    senderEmail?: string;
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
            email: overrides.senderEmail,
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

/** Helper: build a card click event, with the user on the payload or on chat.user */
function makeClickEvent(users: {
  chatUser?: GoogleChatUser;
  payloadUser?: GoogleChatUser;
}): GoogleChatEvent {
  return {
    commonEventObject: { parameters: { actionId: "approve" } },
    chat: {
      user: users.chatUser,
      buttonClickedPayload: {
        space: { name: "spaces/ABC123", type: "ROOM" },
        message: {
          name: "spaces/ABC123/messages/msg1",
          sender: { name: "users/1", displayName: "U", type: "HUMAN" },
          text: "",
          createTime: new Date().toISOString(),
        },
        user: users.payloadUser,
      },
    },
  };
}

/** Helper: wrap an event or Pub/Sub push in a webhook request */
function makeWebhookRequest(
  body: GoogleChatEvent | PubSubPushMessage
): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Helper: resolve the message most recently handed to chat.processMessage */
async function lastDispatchedMessage(
  mockChat: ChatInstance
): Promise<Message<unknown>> {
  const call = vi.mocked(mockChat.processMessage).mock.calls.at(-1);
  if (!call) {
    throw new Error("processMessage was not called");
  }
  const messageOrFactory = call[2];
  return typeof messageOrFactory === "function"
    ? await messageOrFactory()
    : messageOrFactory;
}

/** Helper: create an initialized adapter with mocks */
async function createInitializedAdapter(opts?: {
  botUserId?: string;
  pubsubTopic?: string;
  userName?: string;
  endpointUrl?: string;
  googleChatProjectNumber?: string;
  pubsubAudience?: string;
  workspaceAddOnServiceAccountEmail?: string;
  pubsubServiceAccountEmail?: string;
  logger?: Logger;
}) {
  const adapter = createGoogleChatAdapter({
    credentials: TEST_CREDENTIALS,
    logger: opts?.logger ?? mockLogger,
    botUserId: opts?.botUserId,
    pubsubTopic: opts?.pubsubTopic,
    userName: opts?.userName,
    endpointUrl: opts?.endpointUrl,
    googleChatProjectNumber: opts?.googleChatProjectNumber,
    pubsubAudience: opts?.pubsubAudience,
    workspaceAddOnServiceAccountEmail: opts?.workspaceAddOnServiceAccountEmail,
    pubsubServiceAccountEmail: opts?.pubsubServiceAccountEmail,
  });
  const mockState = createMockStateAdapter();
  const mockChat = createMockChatInstance({ state: mockState });
  await adapter.initialize(mockChat);
  return { adapter, mockState, mockChat };
}

// encodeThreadId/decodeThreadId/isDM are pure and need no init or network, so a
// single synchronously-constructed adapter is enough for the shared contract.
const threadIdAdapter = createGoogleChatAdapter({
  credentials: TEST_CREDENTIALS,
  logger: mockLogger,
});

threadIdContract<GoogleChatThreadId>({
  name: "gchat",
  encode: (d) => threadIdAdapter.encodeThreadId(d),
  decode: (id) => threadIdAdapter.decodeThreadId(id),
  cases: [
    {
      decoded: { spaceName: "spaces/ABC123", isDM: false },
      encoded: "gchat:spaces/ABC123",
    },
    {
      decoded: {
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/XYZ789",
        isDM: false,
      },
      // base64url of the thread name segment
      encoded: "gchat:spaces/ABC123:c3BhY2VzL0FCQzEyMy90aHJlYWRzL1hZWjc4OQ",
    },
    {
      decoded: { spaceName: "spaces/DM123", isDM: true },
      encoded: "gchat:spaces/DM123:dm",
    },
  ],
  isDM: {
    fn: (id) => threadIdAdapter.isDM(id),
    dmThreadId: "gchat:spaces/DM123:dm",
    nonDmThreadId: "gchat:spaces/ROOM456",
  },
});

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
      // Restore the opt-out flag so non-security tests can construct adapters
      // without supplying JWT verification config.
      process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "true";
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

    it("should use the configured bot user ID instead of persisted state", async () => {
      const adapter = createGoogleChatAdapter({
        botUserId: "users/BOT_CONFIGURED",
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      const mockState = createMockStateAdapter();
      mockState.storage.set("gchat:botUserId", "users/BOT999");
      const mockChat = createMockChatInstance({ state: mockState });

      await adapter.initialize(mockChat);

      expect(adapter.botUserId).toBe("users/BOT_CONFIGURED");
    });

    it("should not restore an untrusted learned bot ID from state", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });

      const mockState = createMockStateAdapter();
      mockState.storage.set("gchat:botUserId", "users/OTHERFROMSTATE");
      const mockChat = createMockChatInstance({ state: mockState });

      await adapter.initialize(mockChat);

      expect(adapter.botUserId).toBeUndefined();
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
      // Restore the opt-out flag so non-security tests can construct adapters
      // without supplying JWT verification config.
      process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "true";
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

    it("should resolve botUserId from GOOGLE_CHAT_BOT_USER_ID", () => {
      process.env.GOOGLE_CHAT_CREDENTIALS = JSON.stringify(TEST_CREDENTIALS);
      process.env.GOOGLE_CHAT_BOT_USER_ID = "users/BOT_ENV";

      const adapter = new GoogleChatAdapter();

      expect(adapter.botUserId).toBe("users/BOT_ENV");
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

    it("should resolve apiUrl from GOOGLE_CHAT_API_URL env var", () => {
      process.env.GOOGLE_CHAT_CREDENTIALS = JSON.stringify(TEST_CREDENTIALS);
      process.env.GOOGLE_CHAT_API_URL = "https://custom-chat.googleapis.com";
      const adapter = new GoogleChatAdapter();
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
    });

    it("should accept apiUrl config", () => {
      const adapter = new GoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        apiUrl: "https://custom-chat.googleapis.com",
      });
      expect(adapter).toBeInstanceOf(GoogleChatAdapter);
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

    it("should give a DM message the thread ID it was dispatched on", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event = makeMessageEvent({
        spaceType: "DM",
        spaceName: "spaces/DM_SPACE",
        threadName: "spaces/DM_SPACE/threads/thread1",
      });
      await adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          body: JSON.stringify(event),
        })
      );

      const msg = adapter.parseMessage(event);

      expect(msg.threadId).toBe("gchat:spaces/DM_SPACE:dm");
      expect(msg.threadId).toBe(mockChat.processMessage.mock.calls[0]?.[1]);
    });

    it("should give a room message its thread's ID", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({
        spaceType: "ROOM",
        threadName: "spaces/ABC123/threads/XYZ",
      });

      expect(adapter.parseMessage(event).threadId).toBe(
        `gchat:spaces/ABC123:${Buffer.from("spaces/ABC123/threads/XYZ").toString("base64url")}`
      );
    });

    it("should expose the sender email on the author", async () => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({ senderEmail: "alice@example.com" });

      const msg = adapter.parseMessage(event);

      expect(msg.author.email).toBe("alice@example.com");
    });

    it.each([
      ["is absent", undefined],
      ["is an empty string", ""],
    ])("should leave the author email undefined when the sender email %s", async (_case, senderEmail) => {
      const { adapter } = await createInitializedAdapter();
      const event = makeMessageEvent({ senderEmail });

      const msg = adapter.parseMessage(event);

      expect(msg.author).not.toHaveProperty("email", expect.anything());
      expect(msg.author.email).toBeUndefined();
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
        { resourceName: "spaces/ABC123/attachments/att1", alt: "media" },
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
        { resourceName: "spaces/ABC123/attachments/att1", alt: "media" },
        { responseType: "arraybuffer" }
      );
    });

    it("should not fetch downloadUri when media.download fails", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockDownload = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("resource expired"), { code: 403 })
        );
      (adapter as any).chatApi = {
        media: { download: mockDownload },
      };
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      try {
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
        await expect(msg.attachments[0].fetchData?.()).rejects.toThrow(
          "resource expired"
        );
        expect(mockDownload).toHaveBeenCalledTimes(1);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("should throw AdapterRateLimitError when media.download returns 429 and no downloadUri exists", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockDownload = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("rate limited"), { code: 429 })
        );
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
      await expect(msg.attachments[0].fetchData?.()).rejects.toBeInstanceOf(
        AdapterRateLimitError
      );
    });

    it("should not provide fetchData when only downloadUri is present", async () => {
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
      expect(msg.attachments[0].fetchData).toBeUndefined();
      expect(msg.attachments[0].url).toBe("https://example.com/photo.png");
    });

    it("should not rehydrate fetchData from a download URL", async () => {
      const { adapter } = await createInitializedAdapter();
      const attachment = adapter.rehydrateAttachment({
        type: "file",
        url: "https://example.com/document.pdf",
        fetchMetadata: { url: "https://example.com/document.pdf" },
      });

      expect(attachment.fetchData).toBeUndefined();
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
      const { adapter } = await createInitializedAdapter({
        botUserId: "users/BOT123",
        userName: "mybot",
      });
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

    it("should not learn bot user ID from inbound annotations", async () => {
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

      const message = adapter.parseMessage(event);

      expect(adapter.botUserId).toBeUndefined();
      expect(message.text).toBe("@BotName hi");
    });

    it("should ignore mentions of other bots", async () => {
      const { adapter } = await createInitializedAdapter({
        botUserId: "users/FIRST_BOT",
      });

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

      const message = adapter.parseMessage(event);

      expect(adapter.botUserId).toBe("users/FIRST_BOT");
      expect(message.text).toBe("@AnotherBot hi");
    });

    it("should normalize only this app when another bot is mentioned first", async () => {
      const { adapter } = await createInitializedAdapter({
        botUserId: "users/OUR_BOT",
        userName: "ourbot",
      });
      const event = makeMessageEvent({
        messageText: "@OtherBot @OurBot hi",
        annotations: [
          {
            type: "USER_MENTION",
            startIndex: 0,
            length: 9,
            userMention: {
              user: {
                name: "users/OTHER_BOT",
                displayName: "OtherBot",
                type: "BOT",
              },
              type: "MENTION",
            },
          },
          {
            type: "USER_MENTION",
            startIndex: 10,
            length: 7,
            userMention: {
              user: {
                name: "users/OUR_BOT",
                displayName: "OurBot",
                type: "BOT",
              },
              type: "MENTION",
            },
          },
        ],
      });

      const message = adapter.parseMessage(event);

      expect(message.text).toBe("@OtherBot @ourbot hi");
      expect(adapter.botUserId).toBe("users/OUR_BOT");
    });
  });

  describe("mention annotations", () => {
    const BOT_ID = "users/111";
    const SPACE = "spaces/ABC123";
    const THREAD = `${SPACE}/threads/T1`;

    type Annotation = Record<string, unknown>;
    interface Input {
      annotations?: Annotation[] | null;
      text: string;
    }
    type Adapter = Awaited<
      ReturnType<typeof createInitializedAdapter>
    >["adapter"];
    type MockChat = Awaited<
      ReturnType<typeof createInitializedAdapter>
    >["mockChat"];

    const mention = (
      user: Record<string, unknown> | undefined,
      range: { startIndex: number; length: number }
    ): Annotation => ({
      type: "USER_MENTION",
      ...range,
      userMention: user ? { user, type: "MENTION" } : { type: "MENTION" },
    });

    const messageBody = (input: Input) => ({
      name: `${SPACE}/messages/msg1`,
      sender: { name: "users/100", displayName: "Alice", type: "HUMAN" },
      text: input.text,
      createTime: "2024-01-01T00:00:00Z",
      thread: { name: THREAD },
      annotations: input.annotations,
    });

    const post = async (adapter: Adapter, body: unknown) => {
      const response = await adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
      if (response.status !== 200) {
        throw new Error(`Webhook returned ${response.status}`);
      }
    };

    const dispatched = async (mockChat: MockChat): Promise<Message> => {
      const calls = vi.mocked(mockChat.processMessage).mock.calls;
      if (calls.length !== 1) {
        throw new Error(
          `Expected one processMessage call, got ${calls.length}`
        );
      }
      const arg = calls[0][2];
      return typeof arg === "function" ? await arg() : arg;
    };

    // Each transport delivers the same message through the adapter's public
    // entry point, so a parser that stops reading annotations fails here.
    const transports: Record<
      string,
      (adapter: Adapter, mockChat: MockChat, input: Input) => Promise<Message>
    > = {
      "direct webhook": async (adapter, mockChat, input) => {
        await post(adapter, {
          chat: {
            messagePayload: {
              space: { name: SPACE, type: "ROOM" },
              message: messageBody(input),
            },
          },
        });
        return dispatched(mockChat);
      },
      "Pub/Sub": async (adapter, mockChat, input) => {
        await post(
          adapter,
          makePubSubPushMessage({
            message: messageBody(input) as Partial<GoogleChatMessage>,
          })
        );
        return dispatched(mockChat);
      },
      "list API": async (adapter, _mockChat, input) => {
        const list = vi.fn().mockResolvedValue({
          data: { messages: [messageBody(input)] },
        });
        Object.assign(adapter, {
          chatApi: { spaces: { messages: { list } } },
        });
        const result = await adapter.fetchMessages(
          adapter.encodeThreadId({ spaceName: SPACE, threadName: THREAD })
        );
        if (result.messages.length !== 1) {
          throw new Error(
            `Expected one message, got ${result.messages.length}`
          );
        }
        return result.messages[0];
      },
    };

    const bot = { name: BOT_ID, displayName: "Bot Dev", type: "BOT" };
    const range = { startIndex: 0, length: 8 };

    const cases: Array<{
      botUserId?: string;
      input: Input;
      isMention: boolean | undefined;
      name: string;
      text: string;
    }> = [
      {
        name: "the bot is mentioned",
        botUserId: BOT_ID,
        input: { text: "@Bot Dev hi", annotations: [mention(bot, range)] },
        isMention: true,
        text: "@Bot hi",
      },
      {
        name: "another app with the same display name is mentioned",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi",
          annotations: [mention({ ...bot, name: "users/222" }, range)],
        },
        isMention: false,
        text: "@Bot Dev hi",
      },
      {
        name: "a user whose name starts with the bot's is mentioned",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi",
          annotations: [
            mention(
              { name: "users/222", displayName: "Bot Dev", type: "HUMAN" },
              range
            ),
          ],
        },
        isMention: false,
        text: "@Bot Dev hi",
      },
      {
        name: "the bot's annotation is not a USER_MENTION",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi",
          annotations: [{ ...mention(bot, range), type: "SLASH_COMMAND" }],
        },
        isMention: false,
        text: "@Bot Dev hi",
      },
      {
        name: "the mention annotation has no user",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi",
          annotations: [mention(undefined, range)],
        },
        isMention: false,
        text: "@Bot Dev hi",
      },
      {
        name: "the text names the bot without an annotation",
        botUserId: BOT_ID,
        input: { text: "@Bot hi" },
        isMention: false,
        text: "@Bot hi",
      },
      {
        name: "the bot's annotation has no user type",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi",
          annotations: [mention({ name: BOT_ID }, range)],
        },
        isMention: true,
        text: "@Bot hi",
      },
      {
        // Same user shape as the `mention` recording in the gchat replay fixture.
        name: "the bot's annotation has no display name",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi",
          annotations: [mention({ name: BOT_ID, type: "BOT" }, range)],
        },
        isMention: true,
        text: "@Bot hi",
      },
      {
        name: "the bot's annotation has a display name but no range",
        botUserId: BOT_ID,
        input: {
          text: "hi @Bot Dev",
          annotations: [
            {
              type: "USER_MENTION",
              userMention: { user: bot, type: "MENTION" },
            },
          ],
        },
        isMention: true,
        text: "hi @Bot",
      },
      {
        name: "the bot is mentioned twice",
        botUserId: BOT_ID,
        input: {
          text: "@Bot Dev hi @Bot Dev",
          annotations: [
            mention(bot, { startIndex: 0, length: 8 }),
            mention(bot, { startIndex: 12, length: 8 }),
          ],
        },
        isMention: true,
        text: "@Bot hi @Bot",
      },
      {
        // The list API's message type allows null for every field.
        name: "the annotations are null",
        botUserId: BOT_ID,
        input: { text: "@Bot hi", annotations: null },
        isMention: false,
        text: "@Bot hi",
      },
      {
        name: "the bot's annotation has null fields besides the user name",
        botUserId: BOT_ID,
        input: {
          text: "hi @Bot Dev",
          annotations: [
            {
              type: "USER_MENTION",
              startIndex: null,
              length: null,
              userMention: {
                user: { name: BOT_ID, displayName: "Bot Dev", type: null },
              },
            },
          ],
        },
        isMention: true,
        text: "hi @Bot",
      },
      {
        name: "botUserId is unset and a human mention sits beside a link annotation",
        input: {
          text: "@Ann see https://example.com",
          annotations: [
            mention(
              { name: "users/222", displayName: "Ann", type: "HUMAN" },
              { startIndex: 0, length: 4 }
            ),
            {
              type: "RICH_LINK",
              startIndex: 9,
              length: 19,
              richLinkMetadata: { uri: "https://example.com" },
            },
          ],
        },
        isMention: false,
        text: "@Ann see https://example.com",
      },
      {
        name: "the bot is mentioned after another user",
        botUserId: BOT_ID,
        input: {
          text: "@Ann @Bot Dev hi",
          annotations: [
            mention(
              { name: "users/222", displayName: "Ann", type: "HUMAN" },
              { startIndex: 0, length: 4 }
            ),
            mention(bot, { startIndex: 5, length: 8 }),
          ],
        },
        isMention: true,
        text: "@Ann @Bot hi",
      },
      {
        name: "botUserId is unset and only a human is mentioned",
        input: {
          text: "@Bot Dev hi",
          annotations: [
            mention(
              { name: "users/222", displayName: "Bot Dev", type: "HUMAN" },
              range
            ),
          ],
        },
        isMention: false,
        text: "@Bot Dev hi",
      },
      {
        name: "botUserId is unset and an app is mentioned",
        input: { text: "@Bot Dev hi", annotations: [mention(bot, range)] },
        isMention: undefined,
        text: "@Bot Dev hi",
      },
      {
        name: "botUserId is unset and the mentioned user has no type",
        input: {
          text: "@Bot Dev hi",
          annotations: [mention({ name: BOT_ID }, range)],
        },
        isMention: undefined,
        text: "@Bot Dev hi",
      },
      {
        name: "botUserId is unset and a human and an app are mentioned",
        input: {
          text: "@Ann @Bot Dev hi",
          annotations: [
            mention(
              { name: "users/222", displayName: "Ann", type: "HUMAN" },
              { startIndex: 0, length: 4 }
            ),
            mention(bot, { startIndex: 5, length: 8 }),
          ],
        },
        isMention: undefined,
        text: "@Ann @Bot Dev hi",
      },
      {
        name: "botUserId is unset and there are no annotations",
        input: { text: "@Bot hi" },
        isMention: undefined,
        text: "@Bot hi",
      },
    ];

    describe.each(Object.entries(transports))("%s", (_transport, deliver) => {
      it.each(cases)("isMention is $isMention when $name", async (testCase) => {
        const { adapter, mockChat } = await createInitializedAdapter({
          botUserId: testCase.botUserId,
          userName: "Bot",
        });

        const message = await deliver(adapter, mockChat, testCase.input);

        expect(message.isMention).toBe(testCase.isMention);
        expect(message.text).toBe(testCase.text);
      });
    });

    describe("unmatched app mention warning", () => {
      const otherApp = mention({ name: "users/222", type: "BOT" }, range);
      const unmatchedWarnings = (logger: ReturnType<typeof createMockLogger>) =>
        vi.mocked(logger.warn).mock.calls.filter(([, meta]) => {
          const fields = meta as Record<string, unknown> | undefined;
          return fields?.mentionedUserId !== undefined;
        });
      const parse = (adapter: Adapter, annotations?: Annotation[]) =>
        adapter.parseMessage({
          chat: {
            messagePayload: {
              space: { name: SPACE, type: "ROOM" },
              message: messageBody({ text: "@Bot Dev hi", annotations }),
            },
          },
        } as GoogleChatEvent);

      it("is logged once with both IDs across several messages", async () => {
        const logger = createMockLogger();
        const { adapter } = await createInitializedAdapter({
          botUserId: BOT_ID,
          logger,
        });

        parse(adapter, [otherApp]);
        parse(adapter, [otherApp]);

        const warnings = unmatchedWarnings(logger);
        expect(warnings).toHaveLength(1);
        expect(warnings[0][1]).toEqual({
          botUserId: BOT_ID,
          mentionedUserId: "users/222",
        });
      });

      it.each([
        ["the bot is mentioned", BOT_ID, [mention(bot, range)]],
        [
          "the bot is mentioned alongside another app",
          BOT_ID,
          [otherApp, mention(bot, range)],
        ],
        [
          "a human is mentioned",
          BOT_ID,
          [mention({ name: "users/222", type: "HUMAN" }, range)],
        ],
        ["there are no annotations", BOT_ID, undefined],
        [
          "another app appears in an annotation that is not a mention",
          BOT_ID,
          [{ ...otherApp, type: "SLASH_COMMAND" }],
        ],
        ["botUserId is unset", undefined, [otherApp]],
      ])("is not logged when %s", async (_name, botUserId, annotations) => {
        const logger = createMockLogger();
        const { adapter } = await createInitializedAdapter({
          botUserId,
          logger,
        });

        parse(adapter, annotations);

        expect(unmatchedWarnings(logger)).toHaveLength(0);
      });
    });

    describe("botUserId format warning", () => {
      const formatWarnings = (logger: ReturnType<typeof createMockLogger>) =>
        vi
          .mocked(logger.warn)
          .mock.calls.filter(([message]) =>
            String(message).includes("users/{id}")
          );

      it("is logged when botUserId is not a users/ resource name", async () => {
        const logger = createMockLogger();
        await createInitializedAdapter({ botUserId: "111", logger });

        const warnings = formatWarnings(logger);
        expect(warnings).toHaveLength(1);
        expect(warnings[0][1]).toEqual({ botUserId: "111" });
      });

      it.each([
        ["is a users/ resource name", BOT_ID],
        ["is unset", undefined],
      ])("is not logged when botUserId %s", async (_name, botUserId) => {
        const logger = createMockLogger();
        await createInitializedAdapter({ botUserId, logger });

        expect(formatWarnings(logger)).toHaveLength(0);
      });
    });
  });

  describe("isMessageFromSelf (via parseMessage)", () => {
    it("should detect self messages when botUserId is known", async () => {
      const { adapter } = await createInitializedAdapter({
        botUserId: "users/BOT123",
      });

      const event = makeMessageEvent({
        senderName: "users/BOT123",
        senderType: "BOT",
        senderDisplayName: "MyBot",
      });

      const msg = adapter.parseMessage(event);
      expect(msg.author.isMe).toBe(true);
    });

    it("should not mark other bots as self", async () => {
      const { adapter } = await createInitializedAdapter({
        botUserId: "users/BOT123",
      });

      const event = makeMessageEvent({
        senderName: "users/OTHER_BOT",
        senderType: "BOT",
        senderDisplayName: "OtherBot",
      });

      const msg = adapter.parseMessage(event);
      expect(msg.author.isMe).toBe(false);
    });

    it("should fail closed for bot senders when botUserId is unknown", async () => {
      const { adapter } = await createInitializedAdapter();

      const event = makeMessageEvent({
        senderType: "BOT",
        senderDisplayName: "SomeBot",
      });

      const msg = adapter.parseMessage(event);
      expect(msg.author.isMe).toBe(true);
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
      expect(mockChat).toHaveDispatched("processMessage");
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
      expect(mockChat).toHaveDispatched("processAction");
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

    it("should infer button-click endpoint URL from request but never expose it as a verification audience", async () => {
      // The inferred URL is used only for routing button clicks back to the
      // app. It is intentionally NOT used as a JWT audience, because
      // `request.url` derives from the Host header in serverless runtimes
      // and is attacker-controllable.
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

      // Explicit config field stays unset.
      expect((adapter as any).endpointUrl).toBeUndefined();
      // Routing-only inferred field is populated.
      expect((adapter as any).inferredEndpointUrl).toBe(
        "https://my-app.vercel.app/api/webhooks/gchat"
      );
    });

    it("should not overwrite explicitly-configured endpointUrl with a request URL", async () => {
      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://original.example.com/webhook",
      });
      const event: GoogleChatEvent = { chat: {} };
      const request = new Request("https://other.example.com/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);

      expect((adapter as any).endpointUrl).toBe(
        "https://original.example.com/webhook"
      );
      expect((adapter as any).inferredEndpointUrl).toBeUndefined();
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
      expect(mockChat).toHaveDispatched("processMessage");
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
      expect(mockChat).not.toHaveDispatched("processMessage");
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
      expect(mockChat).not.toHaveDispatched("processAction");
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

    it("should read selection values from formInputs when parameters.value is missing", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        commonEventObject: {
          parameters: {
            actionId: "selection",
          },
          formInputs: {
            selection: {
              stringInputs: {
                value: ["option-1"],
              },
            },
          },
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
        expect.objectContaining({
          actionId: "selection",
          value: "option-1",
        }),
        undefined
      );
    });

    it("should prefer parameters.value when both parameters and formInputs are present", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event: GoogleChatEvent = {
        commonEventObject: {
          parameters: {
            actionId: "selection",
            value: "button-value",
          },
          formInputs: {
            selection: {
              stringInputs: {
                value: ["dropdown-value"],
              },
            },
          },
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
        expect.objectContaining({
          actionId: "selection",
          value: "button-value",
        }),
        undefined
      );
    });

    it.each([
      ["a present email", "clicker@example.com", "clicker@example.com"],
      ["an empty email", "", undefined],
      ["no email", undefined, undefined],
    ])("should set the action user email from a click with %s", async (_case, email, expected) => {
      const { adapter, mockChat } = await createInitializedAdapter();

      await adapter.handleWebhook(
        makeWebhookRequest(
          makeClickEvent({
            payloadUser: {
              name: "users/2",
              displayName: "Clicker",
              type: "HUMAN",
              email,
            },
          })
        )
      );

      const calls = vi.mocked(mockChat.processAction).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0].user.userId).toBe("users/2");
      expect(calls[0][0].user.email).toBe(expected);
    });

    it("should read the action user email from chat.user when the click payload has no user", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();

      await adapter.handleWebhook(
        makeWebhookRequest(
          makeClickEvent({
            chatUser: {
              name: "users/3",
              displayName: "Fallback Clicker",
              type: "HUMAN",
              email: "fallback@example.com",
            },
          })
        )
      );

      const calls = vi.mocked(mockChat.processAction).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0].user.userId).toBe("users/3");
      expect(calls[0][0].user.email).toBe("fallback@example.com");
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
      expect(mockChat).not.toHaveDispatched("processAction");
    });

    describe("thread ID", () => {
      const DM_SPACE = "spaces/DM_SPACE";
      const ROOM_SPACE = "spaces/ABC123";
      const THREAD_B64 = Buffer.from("spaces/X/threads/thread1").toString(
        "base64url"
      );
      const MESSAGE_B64 = Buffer.from("spaces/X/messages/msg1").toString(
        "base64url"
      );

      const makeClickEvent = (
        space: GoogleChatSpace,
        threadName?: string
      ): GoogleChatEvent => ({
        commonEventObject: { parameters: { actionId: "approve" } },
        chat: {
          buttonClickedPayload: {
            space,
            message: {
              name: "spaces/X/messages/msg1",
              sender: { name: "users/1", displayName: "Bot", type: "BOT" },
              text: "",
              createTime: new Date().toISOString(),
              thread: threadName ? { name: threadName } : undefined,
            },
            user: { name: "users/2", displayName: "Clicker", type: "HUMAN" },
          },
        },
      });

      const clickThreadId = async (event: GoogleChatEvent) => {
        const { adapter, mockChat } = await createInitializedAdapter();
        await adapter.handleWebhook(
          new Request("https://example.com/webhook", {
            method: "POST",
            body: JSON.stringify(event),
          })
        );
        return mockChat.processAction.mock.calls[0]?.[0].threadId;
      };

      it.each<[string, GoogleChatSpace]>([
        ["legacy type DM", { name: DM_SPACE, type: "DM" }],
        [
          "spaceType DIRECT_MESSAGE",
          { name: DM_SPACE, type: "", spaceType: "DIRECT_MESSAGE" },
        ],
        [
          "singleUserBotDm",
          { name: DM_SPACE, type: "", singleUserBotDm: true },
        ],
        [
          "the captured DM space shape",
          {
            name: DM_SPACE,
            type: "DM",
            singleUserBotDm: true,
            spaceType: "DIRECT_MESSAGE",
          },
        ],
      ])("should use the space-only DM thread ID for %s", async (_label, space) => {
        const threadId = await clickThreadId(
          makeClickEvent(space, "spaces/X/threads/thread1")
        );
        expect(threadId).toBe("gchat:spaces/DM_SPACE:dm");
      });

      it("should use the card message's thread in a room", async () => {
        const threadId = await clickThreadId(
          makeClickEvent(
            { name: ROOM_SPACE, type: "ROOM", spaceType: "SPACE" },
            "spaces/X/threads/thread1"
          )
        );
        expect(threadId).toBe(`gchat:spaces/ABC123:${THREAD_B64}`);
      });

      it("should use the card message's name in a room when it has no thread", async () => {
        const threadId = await clickThreadId(
          makeClickEvent({ name: ROOM_SPACE, type: "ROOM", spaceType: "SPACE" })
        );
        expect(threadId).toBe(`gchat:spaces/ABC123:${MESSAGE_B64}`);
      });

      it("should not treat a group chat as a DM", async () => {
        const threadId = await clickThreadId(
          makeClickEvent(
            { name: ROOM_SPACE, type: "ROOM", spaceType: "GROUP_CHAT" },
            "spaces/X/threads/thread1"
          )
        );
        expect(threadId).toBe(`gchat:spaces/ABC123:${THREAD_B64}`);
      });

      it("should match the thread ID of a message in the same DM", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        const messageEvent = makeMessageEvent({
          spaceType: "DM",
          spaceName: DM_SPACE,
          threadName: "spaces/DM_SPACE/threads/other-thread",
        });
        await adapter.handleWebhook(
          new Request("https://example.com/webhook", {
            method: "POST",
            body: JSON.stringify(messageEvent),
          })
        );
        await adapter.handleWebhook(
          new Request("https://example.com/webhook", {
            method: "POST",
            body: JSON.stringify(
              makeClickEvent(
                { name: DM_SPACE, type: "DM" },
                "spaces/X/threads/thread1"
              )
            ),
          })
        );

        const messageThreadId = mockChat.processMessage.mock.calls[0]?.[1];
        const actionThreadId =
          mockChat.processAction.mock.calls[0]?.[0].threadId;
        expect(messageThreadId).toBe("gchat:spaces/DM_SPACE:dm");
        expect(actionThreadId).toBe(messageThreadId);
        expect(adapter.isDM(actionThreadId)).toBe(true);
      });

      it("should post to the space without a thread from a DM click thread ID", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        await adapter.handleWebhook(
          new Request("https://example.com/webhook", {
            method: "POST",
            body: JSON.stringify(
              makeClickEvent(
                { name: DM_SPACE, type: "DM" },
                "spaces/X/threads/thread1"
              )
            ),
          })
        );
        const threadId = mockChat.processAction.mock.calls[0]?.[0].threadId;

        const mockCreate = vi.fn().mockResolvedValue({
          data: { name: "spaces/DM_SPACE/messages/new1" },
        });
        (adapter as any).chatApi = {
          spaces: { messages: { create: mockCreate } },
        };
        await adapter.postMessage(threadId, "Approved");
        await adapter.postMessage(threadId, Card({ title: "Approved" }));

        expect(mockCreate).toHaveBeenCalledTimes(2);
        const [textRequest, cardRequest] = mockCreate.mock.calls.map(
          (call) => call[0]
        );
        expect(textRequest.requestBody.text).toBe("Approved");
        expect(cardRequest.requestBody.cardsV2).toHaveLength(1);
        for (const request of [textRequest, cardRequest]) {
          expect(request.parent).toBe("spaces/DM_SPACE");
          expect(request.messageReplyOption).toBeUndefined();
          expect(request.requestBody.thread).toBeUndefined();
        }
      });
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

      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
      const [, threadId, message] = mockChat.processMessage.mock.calls[0] ?? [];
      expect(threadId).toBe("gchat:spaces/DM_SPACE:dm");
      expect(message.threadId).toBe(threadId);
    });

    it.each<[string, Partial<GoogleChatSpace>]>([
      ["spaceType DIRECT_MESSAGE", { type: "", spaceType: "DIRECT_MESSAGE" }],
      ["singleUserBotDm", { type: "", singleUserBotDm: true }],
    ])("should use space-only thread ID for a DM identified by %s", async (_label, space) => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event = makeMessageEvent({
        spaceName: "spaces/DM_SPACE",
        threadName: "spaces/DM_SPACE/threads/thread1",
      });
      Object.assign(event.chat?.messagePayload?.space ?? {}, space);

      await adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          body: JSON.stringify(event),
        })
      );

      expect(mockChat.processMessage.mock.calls[0]?.[1]).toBe(
        "gchat:spaces/DM_SPACE:dm"
      );
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

      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
      expect(mockChat.processMessage.mock.calls[0]?.[1]).toBe(
        `gchat:spaces/ABC123:${Buffer.from("spaces/ABC123/threads/XYZ").toString("base64url")}`
      );
    });

    it("should use the message name for a room message without a thread", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      const event = makeMessageEvent({ spaceType: "ROOM" });

      await adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          body: JSON.stringify(event),
        })
      );

      expect(mockChat.processMessage.mock.calls[0]?.[1]).toBe(
        `gchat:spaces/ABC123:${Buffer.from("spaces/ABC123/messages/msg1").toString("base64url")}`
      );
    });
  });

  describe("Pub/Sub message handling", () => {
    it("should handle Pub/Sub reaction.created events", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();

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

      const tasks: Promise<unknown>[] = [];
      const response = await adapter.handleWebhook(request, {
        waitUntil: (task) => {
          tasks.push(task);
        },
      });
      await Promise.all(tasks);

      expect(response.status).toBe(200);
      expect(mockChat.processReaction).toHaveBeenCalledTimes(1);
      expect(mockChat.processReaction.mock.calls[0]?.[0]).toMatchObject({
        added: true,
        messageId: "spaces/ABC123/messages/msg1",
        threadId: `gchat:spaces/ABC123:${Buffer.from("spaces/ABC123/threads/T1").toString("base64url")}`,
      });
    });

    describe("DM thread IDs", () => {
      const DM_TARGET = "//chat.googleapis.com/spaces/DM_SPACE";
      const dmMessage = {
        name: "spaces/DM_SPACE/messages/msg1",
        sender: { name: "users/100", displayName: "User", type: "HUMAN" },
        text: "Hello",
        createTime: "2026-01-01T00:00:00Z",
        thread: { name: "spaces/DM_SPACE/threads/T1" },
      };
      const dmReaction = {
        name: "spaces/DM_SPACE/messages/msg1/reactions/react1",
        emoji: { unicode: "\u{1f44d}" },
        user: { name: "users/100", displayName: "Reactor", type: "HUMAN" },
      };
      const THREADED_ID = `gchat:spaces/DM_SPACE:${Buffer.from("spaces/DM_SPACE/threads/T1").toString("base64url")}`;

      const push = async (
        adapter: GoogleChatAdapter,
        pubsubMessage: PubSubPushMessage
      ) => {
        const tasks: Promise<unknown>[] = [];
        await adapter.handleWebhook(
          new Request("https://example.com/webhook", {
            method: "POST",
            body: JSON.stringify(pubsubMessage),
          }),
          {
            waitUntil: (task) => {
              tasks.push(task);
            },
          }
        );
        await Promise.all(tasks);
      };

      it("should use the space-only DM thread ID when the message space is a DM", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        await push(
          adapter,
          makePubSubPushMessage(
            {
              message: {
                ...dmMessage,
                space: { name: "spaces/DM_SPACE", type: "DM" },
              },
            },
            "google.workspace.chat.message.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processMessage.mock.calls[0]?.[1]).toBe(
          "gchat:spaces/DM_SPACE:dm"
        );
      });

      it("should keep the message's thread when the payload has no space type", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        await push(
          adapter,
          makePubSubPushMessage(
            { message: dmMessage },
            "google.workspace.chat.message.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processMessage.mock.calls[0]?.[1]).toBe(THREADED_ID);
      });

      it("should use the space-only DM thread ID for a reaction when the fetched message is in a DM", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        (adapter as any).chatApi = {
          spaces: {
            messages: {
              get: vi.fn().mockResolvedValue({
                data: {
                  thread: { name: "spaces/DM_SPACE/threads/T1" },
                  space: {
                    name: "spaces/DM_SPACE",
                    spaceType: "DIRECT_MESSAGE",
                  },
                },
              }),
            },
          },
        };
        await push(
          adapter,
          makePubSubPushMessage(
            { reaction: dmReaction },
            "google.workspace.chat.reaction.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processReaction).toHaveBeenCalledTimes(1);
        expect(mockChat.processReaction.mock.calls[0]?.[0].threadId).toBe(
          "gchat:spaces/DM_SPACE:dm"
        );
      });

      it("should fall back to the space-only thread ID for a reaction when the message lookup fails", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        (adapter as any).chatApi = {
          spaces: {
            messages: { get: vi.fn().mockRejectedValue(new Error("denied")) },
          },
        };
        await push(
          adapter,
          makePubSubPushMessage(
            { reaction: dmReaction },
            "google.workspace.chat.reaction.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processReaction.mock.calls[0]?.[0].threadId).toBe(
          "gchat:spaces/DM_SPACE"
        );
      });

      it("should use the message name for a Pub/Sub message without a thread", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        const { thread: _thread, ...unthreaded } = dmMessage;
        await push(
          adapter,
          makePubSubPushMessage(
            { message: unthreaded },
            "google.workspace.chat.message.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processMessage.mock.calls[0]?.[1]).toBe(
          `gchat:spaces/DM_SPACE:${Buffer.from("spaces/DM_SPACE/messages/msg1").toString("base64url")}`
        );
      });

      it("should use the space-only thread ID for a reaction when the fetched message has no thread", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        (adapter as any).chatApi = {
          spaces: {
            messages: {
              get: vi.fn().mockResolvedValue({
                data: {
                  name: "spaces/DM_SPACE/messages/msg1",
                  space: { name: "spaces/DM_SPACE", spaceType: "SPACE" },
                },
              }),
            },
          },
        };
        await push(
          adapter,
          makePubSubPushMessage(
            { reaction: dmReaction },
            "google.workspace.chat.reaction.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processReaction.mock.calls[0]?.[0].threadId).toBe(
          "gchat:spaces/DM_SPACE"
        );
      });

      it("should keep the fetched thread for a reaction in a space that is not a DM", async () => {
        const { adapter, mockChat } = await createInitializedAdapter();
        (adapter as any).chatApi = {
          spaces: {
            messages: {
              get: vi.fn().mockResolvedValue({
                data: {
                  thread: { name: "spaces/DM_SPACE/threads/T1" },
                  space: { name: "spaces/DM_SPACE", spaceType: "SPACE" },
                },
              }),
            },
          },
        };
        await push(
          adapter,
          makePubSubPushMessage(
            { reaction: dmReaction },
            "google.workspace.chat.reaction.v1.created",
            DM_TARGET
          )
        );

        expect(mockChat.processReaction.mock.calls[0]?.[0].threadId).toBe(
          THREADED_ID
        );
      });
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
      const { adapter } = await createInitializedAdapter({
        botUserId: "users/MYBOT",
      });

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

  describe("inbound markdown parsing", () => {
    let toAstSpy: MockInstance<GoogleChatFormatConverter["toAst"]>;

    beforeEach(() => {
      toAstSpy = vi.spyOn(GoogleChatFormatConverter.prototype, "toAst");
    });

    afterEach(() => {
      toAstSpy.mockRestore();
    });

    const receivers: [string, (body: string) => Promise<Message<unknown>>][] = [
      [
        "a webhook message",
        async (body) => {
          const { adapter } = await createInitializedAdapter();
          return adapter.parseMessage(makeMessageEvent({ messageText: body }));
        },
      ],
      [
        "a Pub/Sub message",
        async (body) => {
          const { adapter } = await createInitializedAdapter();
          const notification: WorkspaceEventNotification = {
            eventType: "google.workspace.chat.message.v1.created",
            targetResource: "//chat.googleapis.com/spaces/ABC123",
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: { name: "users/100", displayName: "User", type: "HUMAN" },
              text: body,
              createTime: new Date().toISOString(),
            },
          };
          return (adapter as any).parsePubSubMessage(
            notification,
            "gchat:spaces/ABC123"
          );
        },
      ],
      [
        "a fetched message",
        async (body) => {
          const { adapter } = await createInitializedAdapter();
          const mockGet = vi.fn().mockResolvedValue({
            data: {
              name: "spaces/ABC123/messages/msg1",
              text: body,
              sender: { name: "users/1", displayName: "Alice", type: "HUMAN" },
              createTime: "2024-01-01T00:00:00Z",
            },
          });
          (adapter as any).chatApi = { spaces: { messages: { get: mockGet } } };
          const message = await adapter.fetchMessage(
            "gchat:spaces/ABC123",
            "spaces/ABC123/messages/msg1"
          );
          if (!message) {
            throw new Error("Expected fetchMessage to return a message");
          }
          return message;
        },
      ],
    ];

    it.each(
      receivers
    )("parses %s once into text and formatted", async (_, receive) => {
      const message = await receive(MARKDOWN_BODY);

      expect(message.text).toBe(MARKDOWN_PLAIN_TEXT);
      expect(message.formatted).toMatchObject({
        children: [
          {
            type: "paragraph",
            children: expect.arrayContaining([
              expect.objectContaining({ type: "strong" }),
            ]),
          },
        ],
      });
      expect(toAstSpy).toHaveBeenCalledOnce();
    });

    it.each(
      receivers
    )("keeps %s over the limit verbatim without parsing", async (_, receive) => {
      const message = await receive(OVER_LIMIT_BODY);

      expect(message.text).toBe(OVER_LIMIT_BODY);
      expect(message.formatted).toEqual(
        root([paragraph([text(OVER_LIMIT_BODY)])])
      );
      expect(toAstSpy).not.toHaveBeenCalled();
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
    it("should update text and clear cards when editing to text", async () => {
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
          updateMask: "text,cardsV2",
          requestBody: expect.objectContaining({
            text: expect.any(String),
            cardsV2: [],
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
        adapter.editMessage(threadId, "spaces/ABC123/messages/msg1", "edit")
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
        adapter.deleteMessage(
          "gchat:spaces/ABC123",
          "spaces/ABC123/messages/msg1"
        )
      ).rejects.toBeTruthy();
    });
  });

  describe("message space check", () => {
    const THREAD = "gchat:spaces/ABC123";
    const FOREIGN_MESSAGE = "spaces/OTHER/messages/msg9";

    function installSpyApi(adapter: GoogleChatAdapter) {
      const api = {
        spaces: {
          messages: {
            update: vi.fn().mockResolvedValue({ data: {} }),
            delete: vi.fn().mockResolvedValue({}),
            reactions: {
              create: vi.fn().mockResolvedValue({}),
              list: vi.fn().mockResolvedValue({ data: { reactions: [] } }),
              delete: vi.fn().mockResolvedValue({}),
            },
          },
        },
      };
      (adapter as any).chatApi = api;
      return api;
    }

    it("editMessage rejects a message from another space", async () => {
      const { adapter } = await createInitializedAdapter();
      const api = installSpyApi(adapter);
      await expect(
        adapter.editMessage(THREAD, FOREIGN_MESSAGE, "edit")
      ).rejects.toThrow(FOREIGN_SPACE_REGEX);
      expect(api.spaces.messages.update).not.toHaveBeenCalled();
    });

    it("deleteMessage rejects a message from another space", async () => {
      const { adapter } = await createInitializedAdapter();
      const api = installSpyApi(adapter);
      await expect(
        adapter.deleteMessage(THREAD, FOREIGN_MESSAGE)
      ).rejects.toThrow(FOREIGN_SPACE_REGEX);
      expect(api.spaces.messages.delete).not.toHaveBeenCalled();
    });

    it("addReaction rejects a message from another space", async () => {
      const { adapter } = await createInitializedAdapter();
      const api = installSpyApi(adapter);
      await expect(
        adapter.addReaction(THREAD, FOREIGN_MESSAGE, "\u{1f44d}")
      ).rejects.toThrow(FOREIGN_SPACE_REGEX);
      expect(api.spaces.messages.reactions.create).not.toHaveBeenCalled();
    });

    it("removeReaction rejects a message from another space", async () => {
      const { adapter } = await createInitializedAdapter();
      const api = installSpyApi(adapter);
      await expect(
        adapter.removeReaction(THREAD, FOREIGN_MESSAGE, "\u{1f44d}")
      ).rejects.toThrow(FOREIGN_SPACE_REGEX);
      expect(api.spaces.messages.reactions.list).not.toHaveBeenCalled();
    });

    it.each([
      ["path traversal", "spaces/ABC123/messages/../../OTHER/messages/msg9"],
      ["dot segment", "spaces/ABC123/messages/./msg1"],
      ["extra segment", "spaces/ABC123/messages/msg1/reactions/r1"],
      ["query string", "spaces/ABC123/messages/msg1?alt=json"],
      ["fragment", "spaces/ABC123/messages/msg1#x"],
      ["percent encoding", "spaces/ABC123/messages/%2e%2e/OTHER"],
      ["whitespace", "spaces/ABC123/messages/msg1 "],
      ["bare id", "msg1"],
      ["empty", ""],
    ])("rejects a malformed message id (%s)", async (_label, id) => {
      const { adapter } = await createInitializedAdapter();
      const api = installSpyApi(adapter);
      await expect(adapter.deleteMessage(THREAD, id)).rejects.toThrow(
        INVALID_MESSAGE_ID_REGEX
      );
      expect(api.spaces.messages.delete).not.toHaveBeenCalled();
    });

    it("accepts a message in the thread's space", async () => {
      const { adapter } = await createInitializedAdapter();
      const api = installSpyApi(adapter);
      await adapter.deleteMessage(THREAD, "spaces/ABC123/messages/msg1");
      expect(api.spaces.messages.delete).toHaveBeenCalledWith({
        name: "spaces/ABC123/messages/msg1",
      });
    });
  });

  describe("fetchMessage", () => {
    it("returns the message with the thread Google reports for it", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          name: "spaces/ABC123/messages/msg1",
          text: "hello",
          thread: { name: "spaces/ABC123/threads/other" },
          sender: { name: "users/1", displayName: "Alice", type: "HUMAN" },
          createTime: "2024-01-01T00:00:00Z",
        },
      });
      (adapter as any).chatApi = { spaces: { messages: { get: mockGet } } };

      const message = await adapter.fetchMessage(
        "gchat:spaces/ABC123",
        "spaces/ABC123/messages/msg1"
      );

      expect(mockGet).toHaveBeenCalledWith({
        name: "spaces/ABC123/messages/msg1",
      });
      expect(message?.id).toBe("spaces/ABC123/messages/msg1");
      expect(message?.text).toBe("hello");
      expect(message?.threadId).toBe(
        adapter.encodeThreadId({
          spaceName: "spaces/ABC123",
          threadName: "spaces/ABC123/threads/other",
        })
      );
    });

    it("returns null when the message does not exist", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockGet = vi
        .fn()
        .mockRejectedValue({ code: 404, message: "Not found" });
      (adapter as any).chatApi = { spaces: { messages: { get: mockGet } } };

      await expect(
        adapter.fetchMessage(
          "gchat:spaces/ABC123",
          "spaces/ABC123/messages/gone"
        )
      ).resolves.toBeNull();
    });

    it("rejects a message from another space without calling the API", async () => {
      const { adapter } = await createInitializedAdapter();
      const mockGet = vi.fn();
      (adapter as any).chatApi = { spaces: { messages: { get: mockGet } } };

      await expect(
        adapter.fetchMessage(
          "gchat:spaces/ABC123",
          "spaces/OTHER/messages/msg9"
        )
      ).rejects.toThrow(FOREIGN_SPACE_REGEX);
      expect(mockGet).not.toHaveBeenCalled();
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
        adapter.addReaction(
          "gchat:spaces/ABC123",
          "spaces/ABC123/messages/msg1",
          "\u{1f44d}"
        )
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
      const localLogger = createMockLogger();
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
      const localLogger = createMockLogger();
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: localLogger,
      });
      const mockState = createMockStateAdapter();
      const mockChat = createMockChatInstance({ state: mockState });
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

    it.each([
      ["spaceType DIRECT_MESSAGE", { spaceType: "DIRECT_MESSAGE" }, true],
      ["singleUserBotDm", { singleUserBotDm: true }, true],
      ["legacy type DM", { type: "DM" }, true],
      ["a group chat", { spaceType: "GROUP_CHAT", type: "ROOM" }, false],
    ])("should report isDM for %s", async (_label, space, expected) => {
      const { adapter } = await createInitializedAdapter();
      (adapter as any).chatApi = {
        spaces: {
          get: vi.fn().mockResolvedValue({ data: space }),
          members: { list: vi.fn().mockResolvedValue({ data: {} }) },
        },
      };

      const result = await adapter.fetchChannelInfo("gchat:spaces/DM123");

      expect(result.isDM).toBe(expected);
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
    it("should fetch one bounded forward page", async () => {
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
          ],
          nextPageToken: "page-2",
        },
      });
      (adapter as any).chatApi = {
        spaces: { messages: { list: mockList } },
      };

      const result = await adapter.fetchMessages(threadId, {
        direction: "forward",
        limit: 2,
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("First");
      expect(result.messages[1].text).toBe("Second");
      expect(result.nextCursor).toBe("page-2");
      expect(mockList).toHaveBeenCalledOnce();
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: "createTime asc",
          pageSize: 2,
          pageToken: undefined,
        })
      );
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

      const result = await adapter.fetchMessages(threadId, {
        direction: "forward",
        limit: 10,
        cursor: "page-2",
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Second");
      expect(result.messages[1].text).toBe("Third");
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: "page-2" })
      );
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
      mockChat = createMockChatInstance({ state: mockState });
      await adapter.initialize(mockChat);
    });

    it("should cache user info from direct webhook messages", async () => {
      const event: GoogleChatEvent = {
        chat: {
          messagePayload: {
            space: { name: "spaces/ABC123", type: "ROOM" },
            message: {
              name: "spaces/ABC123/messages/msg1",
              sender: {
                avatarUrl: "https://lh3.googleusercontent.com/a/photo.jpg",
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
      await vi.waitFor(() => {
        expect(mockState.set).toHaveBeenCalledWith(
          "gchat:user:users/123456789",
          {
            avatarUrl: "https://lh3.googleusercontent.com/a/photo.jpg",
            displayName: "John Doe",
            email: "john@example.com",
            isBot: false,
          },
          expect.any(Number)
        );
      });
    });

    it("should not cache user info when displayName is unknown", async () => {
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
      // A later sender's write marks the point by which this one would have landed
      adapter.parseMessage(
        makeMessageEvent({ senderName: "users/later", senderDisplayName: "L" })
      );
      await vi.waitFor(() => {
        expect(mockState.storage.has("gchat:user:users/later")).toBe(true);
      });

      // Verify user info was NOT cached
      expect(mockState.storage.has("gchat:user:users/123456789")).toBe(false);
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
    let verifySignedJwtSpy: ReturnType<typeof vi.spyOn>;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      verifyIdTokenSpy = vi
        .spyOn(auth.OAuth2.prototype, "verifyIdToken")
        .mockRejectedValue(new Error("Invalid token"));
      // Project-number tokens are self-signed by chat@system and verified
      // against its X.509 certs, not via verifyIdToken.
      verifySignedJwtSpy = vi
        .spyOn(auth.OAuth2.prototype, "verifySignedJwtWithCertsAsync")
        .mockRejectedValue(new Error("Invalid token"));
      // Stub the Chat issuer cert fetch — never hit the network in unit tests.
      fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ "test-kid": "test-cert" }));
    });

    afterEach(() => {
      verifyIdTokenSpy.mockRestore();
      verifySignedJwtSpy.mockRestore();
      fetchSpy.mockRestore();
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
      // Should not even attempt verification — no Bearer token present
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
      expect(verifySignedJwtSpy).not.toHaveBeenCalled();
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
      // Project-number tokens are verified against the Chat service
      // account's certs with issuer chat@system.gserviceaccount.com.
      expect(verifySignedJwtSpy).toHaveBeenCalledWith(
        "invalid-token",
        { "test-kid": "test-cert" },
        "123456789",
        ["chat@system.gserviceaccount.com"]
      );
    });

    it("should not infer an endpoint URL from a request that fails verification", async () => {
      // An unauthenticated caller must not be able to poison the
      // button-click routing URL: inference only happens after the request
      // has been verified (or verification explicitly disabled).
      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://attacker.example/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      expect(
        (adapter as unknown as { inferredEndpointUrl?: string })
          .inferredEndpointUrl
      ).toBeUndefined();
    });

    it("should allow direct webhook with valid Bearer token when project number is configured", async () => {
      // Real project-number tokens are self-signed JWTs from
      // chat@system.gserviceaccount.com — verifiable only against that
      // service account's X.509 certs, never via verifyIdToken (whose
      // default issuer allowlist is accounts.google.com).
      verifySignedJwtSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "chat@system.gserviceaccount.com",
          aud: "123456789",
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
      expect(verifySignedJwtSpy).toHaveBeenCalledWith(
        "valid-google-jwt",
        { "test-kid": "test-cert" },
        "123456789",
        ["chat@system.gserviceaccount.com"]
      );
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
    });

    it("should allow direct webhook with valid Bearer token when only endpointUrl is configured (URL audience)", async () => {
      // Chat apps configured with "HTTP endpoint URL" as the authentication
      // audience issue tokens whose `aud` is the endpoint URL rather than
      // the project number. `endpointUrl` should satisfy direct-webhook
      // verification on its own.
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "https://accounts.google.com",
          aud: "https://example.com/webhook",
          email: "chat@system.gserviceaccount.com",
          email_verified: true,
        }),
      });

      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://example.com/webhook",
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
        audience: "https://example.com/webhook",
      });
    });

    async function addOnWebhook(
      tokenEmail: string,
      workspaceAddOnServiceAccountEmail?: string
    ) {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "https://accounts.google.com",
          aud: "https://example.com/webhook",
          email: tokenEmail,
          email_verified: true,
        }),
      });

      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://example.com/webhook",
        workspaceAddOnServiceAccountEmail,
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer valid-google-jwt",
        },
        body: JSON.stringify(makeMessageEvent({ messageText: "Hello" })),
      });

      return adapter.handleWebhook(request);
    }

    it("should allow a Workspace Add-on token matching the configured service account", async () => {
      const response = await addOnWebhook(
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com",
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com"
      );
      expect(response.status).toBe(200);
    });

    it("should reject a Workspace Add-on token from a different project", async () => {
      // The generic `service-<number>@gcp-sa-gsuiteaddons` shape matches every
      // Workspace Add-on project, so an attacker's own add-on must not pass.
      const response = await addOnWebhook(
        "service-999@gcp-sa-gsuiteaddons.iam.gserviceaccount.com",
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com"
      );
      expect(response.status).toBe(401);
    });

    it("should reject a Workspace Add-on token when no service account is configured", async () => {
      const response = await addOnWebhook(
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com"
      );
      expect(response.status).toBe(401);
    });

    it("should still allow the Chat system service account without add-on config", async () => {
      const response = await addOnWebhook("chat@system.gserviceaccount.com");
      expect(response.status).toBe(200);
    });

    it.each([
      [
        "a suffixed lookalike domain",
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com.evil.test",
      ],
      [
        "a prefixed lookalike domain",
        "service-111@evil.test/gcp-sa-gsuiteaddons.iam.gserviceaccount.com",
      ],
      [
        "an uppercase variant",
        "SERVICE-111@GCP-SA-GSUITEADDONS.IAM.GSERVICEACCOUNT.COM",
      ],
      [
        "trailing whitespace",
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com ",
      ],
    ])("should reject %s of the configured add-on identity", async (_, email) => {
      const response = await addOnWebhook(
        email,
        "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com"
      );
      expect(response.status).toBe(401);
    });

    it("should reject the configured add-on identity when email_verified is false", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "https://accounts.google.com",
          aud: "https://example.com/webhook",
          email: "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com",
          email_verified: false,
        }),
      });
      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://example.com/webhook",
        workspaceAddOnServiceAccountEmail:
          "service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com",
      });
      const response = await adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-google-jwt",
          },
          body: JSON.stringify(makeMessageEvent({ messageText: "Hello" })),
        })
      );
      expect(response.status).toBe(401);
    });

    it("should reject endpointUrl direct webhook when token email is not Google Chat", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "https://accounts.google.com",
          aud: "https://example.com/webhook",
          email: "attacker@example.com",
          email_verified: true,
        }),
      });

      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://example.com/webhook",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer attacker-google-id-token",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("should reject endpointUrl direct webhook when token email is not verified", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "https://accounts.google.com",
          aud: "https://example.com/webhook",
          email: "chat@system.gserviceaccount.com",
          email_verified: false,
        }),
      });

      const { adapter } = await createInitializedAdapter({
        endpointUrl: "https://example.com/webhook",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer unverified-email-token",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("should not use a request-inferred endpoint URL as a verification audience", async () => {
      // Defense in depth: even if a malicious caller poisons the inferred URL
      // by sending the first request with a spoofed Host, that value must not
      // be accepted as a JWT audience.
      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
      });
      // Simulate a prior request that populated `inferredEndpointUrl`.
      (adapter as any).inferredEndpointUrl = "https://attacker.example/webhook";

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://attacker.example/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer attacker-token",
        },
        body: JSON.stringify(event),
      });

      await adapter.handleWebhook(request);

      // Only the project-number verifier runs; the inferred URL must never
      // be used as an OIDC audience.
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
      expect(verifySignedJwtSpy).toHaveBeenCalledWith(
        "attacker-token",
        { "test-kid": "test-cert" },
        "123456789",
        ["chat@system.gserviceaccount.com"]
      );
    });

    it("should accept an endpoint-URL token when both googleChatProjectNumber and endpointUrl are configured", async () => {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "https://accounts.google.com",
          aud: "https://example.com/webhook",
          email: "chat@system.gserviceaccount.com",
          email_verified: true,
        }),
      });

      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
        endpointUrl: "https://example.com/webhook",
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
        audience: "https://example.com/webhook",
      });
      // The project-number verifier is not needed when the OIDC path passes.
      expect(verifySignedJwtSpy).not.toHaveBeenCalled();
    });

    it("should fall back to the project-number verifier when both are configured and the OIDC check fails", async () => {
      // verifyIdTokenSpy keeps its default rejection (not an OIDC token);
      // the self-signed project-number verification succeeds.
      verifySignedJwtSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "chat@system.gserviceaccount.com",
          aud: "123456789",
        }),
      });

      const { adapter } = await createInitializedAdapter({
        googleChatProjectNumber: "123456789",
        endpointUrl: "https://example.com/webhook",
      });

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer self-signed-chat-jwt",
        },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(verifySignedJwtSpy).toHaveBeenCalledWith(
        "self-signed-chat-jwt",
        { "test-kid": "test-cert" },
        "123456789",
        ["chat@system.gserviceaccount.com"]
      );
    });

    it("should not throw in constructor when only endpointUrl is configured", () => {
      // endpointUrl alone is enough for direct-webhook verification when
      // the Chat app uses "HTTP endpoint URL" authentication audience.
      const previous = process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION;
      process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "false";
      try {
        expect(() =>
          createGoogleChatAdapter({
            credentials: TEST_CREDENTIALS,
            logger: mockLogger,
            endpointUrl: "https://example.com/webhook",
          })
        ).not.toThrow();
      } finally {
        if (previous !== undefined) {
          process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = previous;
        }
      }
    });

    it("should fail-closed in constructor when no JWT verification config is provided", () => {
      const previous = process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION;
      // Any value other than "true" disables the opt-out and should make the
      // constructor refuse to start.
      process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "false";
      try {
        expect(() =>
          createGoogleChatAdapter({
            credentials: TEST_CREDENTIALS,
            logger: mockLogger,
          })
        ).toThrow(VERIFICATION_REQUIRED_PATTERN);
      } finally {
        if (previous !== undefined) {
          process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = previous;
        }
      }
    });

    it("should accept direct webhook with disableSignatureVerification opt-in (fail-open)", async () => {
      // Regression: previously the adapter accepted unverified webhooks
      // silently when no project number was configured. Now this requires
      // an explicit opt-in flag.
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        disableSignatureVerification: true,
      });
      const mockState = createMockStateAdapter();
      const mockChat = createMockChatInstance({ state: mockState });
      await adapter.initialize(mockChat);

      const event = makeMessageEvent({ messageText: "Hello" });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
    });

    it("should reject Pub/Sub-shaped requests when only googleChatProjectNumber is configured", async () => {
      // Regression: the two transports share one endpoint. With only the
      // direct-webhook verifier configured, a Pub/Sub-shaped request
      // previously fell through to "warn once" and was processed unverified.
      // The module-level GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION=true
      // would otherwise route this through the opt-out path; clear it for
      // this test.
      const previous = process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION;
      process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "false";
      try {
        const adapter = createGoogleChatAdapter({
          credentials: TEST_CREDENTIALS,
          logger: mockLogger,
          googleChatProjectNumber: "123456789",
        });
        const mockState = createMockStateAdapter();
        const mockChat = createMockChatInstance({ state: mockState });
        await adapter.initialize(mockChat);

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
        expect(verifyIdTokenSpy).not.toHaveBeenCalled();
      } finally {
        if (previous !== undefined) {
          process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = previous;
        }
      }
    });

    it("should reject direct webhook events when only pubsubAudience is configured", async () => {
      // Inverse of the previous test.
      const previous = process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION;
      process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = "false";
      try {
        const adapter = createGoogleChatAdapter({
          credentials: TEST_CREDENTIALS,
          logger: mockLogger,
          pubsubAudience: "https://example.com/webhook/pubsub",
        });
        const mockState = createMockStateAdapter();
        const mockChat = createMockChatInstance({ state: mockState });
        await adapter.initialize(mockChat);

        const event = makeMessageEvent({ messageText: "Hello" });
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(401);
        expect(verifyIdTokenSpy).not.toHaveBeenCalled();
      } finally {
        if (previous !== undefined) {
          process.env.GOOGLE_CHAT_DISABLE_SIGNATURE_VERIFICATION = previous;
        }
      }
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

    it("should accept Pub/Sub webhook with disableSignatureVerification opt-in (fail-open)", async () => {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
        disableSignatureVerification: true,
      });
      const mockState = createMockStateAdapter();
      const mockChat = createMockChatInstance({ state: mockState });
      await adapter.initialize(mockChat);

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
      expect(response.status).toBe(200);
      expect(verifyIdTokenSpy).not.toHaveBeenCalled();
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
          email_verified: true,
        }),
      });

      const { adapter } = await createInitializedAdapter({
        pubsubAudience: "https://example.com/webhook/pubsub",
        pubsubServiceAccountEmail: "pubsub@my-project.iam.gserviceaccount.com",
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

    async function pubsubWebhook(
      payload: Record<string, unknown>,
      pubsubServiceAccountEmail?: string
    ) {
      verifyIdTokenSpy.mockResolvedValue({
        getPayload: () => ({
          iss: "accounts.google.com",
          aud: "https://example.com/webhook/pubsub",
          ...payload,
        }),
      });
      const { adapter } = await createInitializedAdapter({
        pubsubAudience: "https://example.com/webhook/pubsub",
        pubsubServiceAccountEmail,
      });
      return adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-pubsub-jwt",
          },
          body: JSON.stringify(
            makePubSubPushMessage({
              message: {
                name: "spaces/ABC123/messages/msg1",
                text: "Hello",
                sender: {
                  name: "users/100",
                  displayName: "User",
                  type: "HUMAN",
                },
                createTime: new Date().toISOString(),
              },
            })
          ),
        })
      );
    }

    const PUSH_SA = "pubsub@my-project.iam.gserviceaccount.com";

    it("should reject a Pub/Sub token from a different service account", async () => {
      // The audience is the victim's public push URL, so anyone can mint a
      // Google-signed token for it from their own project. Only the email
      // claim identifies the caller.
      const response = await pubsubWebhook(
        {
          email: "attacker@evil-project.iam.gserviceaccount.com",
          email_verified: true,
        },
        PUSH_SA
      );
      expect(response.status).toBe(401);
    });

    it("should reject a Pub/Sub token when no service account is configured", async () => {
      const response = await pubsubWebhook({
        email: PUSH_SA,
        email_verified: true,
      });
      expect(response.status).toBe(401);
    });

    it("should reject a Pub/Sub token when email_verified is not true", async () => {
      const response = await pubsubWebhook(
        { email: PUSH_SA, email_verified: false },
        PUSH_SA
      );
      expect(response.status).toBe(401);
    });

    it("should reject a Pub/Sub token with no email claim", async () => {
      const response = await pubsubWebhook({ email_verified: true }, PUSH_SA);
      expect(response.status).toBe(401);
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

  describe("sender email from the user info cache", () => {
    const USER_ID = "users/777";
    const USER_KEY = `gchat:user:${USER_ID}`;
    const EMAIL = "alice@example.com";

    /** Create a second adapter over the same state, with an empty in-memory cache */
    async function createAdapterOnState(mockState: StateAdapter) {
      const adapter = createGoogleChatAdapter({
        credentials: TEST_CREDENTIALS,
        logger: mockLogger,
      });
      const mockChat = createMockChatInstance({ state: mockState });
      await adapter.initialize(mockChat);
      return { adapter, mockChat };
    }

    /** Deliver a webhook message from the user and wait for the cache write */
    async function seedFromWebhook(
      adapter: GoogleChatAdapter,
      mockState: StateAdapter & { storage: Map<string, unknown> },
      senderEmail: string | undefined = EMAIL
    ) {
      const response = await adapter.handleWebhook(
        makeWebhookRequest(
          makeMessageEvent({
            senderName: USER_ID,
            senderDisplayName: "Alice",
            senderEmail,
          })
        )
      );
      if (response.status !== 200) {
        throw new Error(`Webhook returned ${response.status}`);
      }
      await vi.waitFor(() => {
        if (!mockState.storage.has(USER_KEY)) {
          throw new Error("User info not cached yet");
        }
      });
    }

    function makePubSubMessagePush(sender: {
      displayName?: string;
      email?: string;
    }): PubSubPushMessage {
      return makePubSubPushMessage({
        message: {
          name: "spaces/ABC123/messages/pubsub1",
          sender: {
            name: USER_ID,
            type: "HUMAN",
            ...sender,
          } as GoogleChatMessage["sender"],
          text: "follow-up",
          createTime: new Date().toISOString(),
        },
      });
    }

    function makeReactionPush(): PubSubPushMessage {
      return makePubSubPushMessage(
        {
          reaction: {
            name: "spaces/ABC123/messages/msg1/reactions/react1",
            emoji: { unicode: "\u{1f44d}" },
            user: { name: USER_ID, type: "HUMAN" },
          },
        },
        "google.workspace.chat.reaction.v1.created"
      );
    }

    function stubChatApi(adapter: GoogleChatAdapter, list?: unknown[]) {
      (adapter as unknown as { chatApi: unknown }).chatApi = {
        spaces: {
          messages: {
            get: vi.fn().mockResolvedValue({
              data: { thread: { name: "spaces/ABC123/threads/T1" } },
            }),
            list: vi.fn().mockResolvedValue({ data: { messages: list ?? [] } }),
          },
        },
      };
    }

    const LISTED_MESSAGE = {
      name: "spaces/ABC123/messages/listed1",
      text: "Listed",
      createTime: "2024-01-01T00:00:00Z",
      sender: { name: USER_ID, displayName: "Alice", type: "HUMAN" },
      thread: { name: "spaces/ABC123/threads/T1" },
    };

    async function fetchListedAuthor(adapter: GoogleChatAdapter) {
      stubChatApi(adapter, [LISTED_MESSAGE]);
      const threadId = adapter.encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/T1",
      });
      const result = await adapter.fetchMessages(threadId, { limit: 10 });
      const [message, ...rest] = result.messages;
      if (!message || rest.length > 0 || message.author.userId !== USER_ID) {
        throw new Error("Expected exactly one listed message from the user");
      }
      return message.author;
    }

    it("should set the email on a webhook message handed to processMessage", async () => {
      const { adapter, mockChat, mockState } = await createInitializedAdapter();

      await seedFromWebhook(adapter, mockState);

      const message = await lastDispatchedMessage(mockChat);
      expect(message.author.userId).toBe(USER_ID);
      expect(message.author.email).toBe(EMAIL);
    });

    it.each([
      ["without a display name", {}],
      ["with a display name", { displayName: "Alice" }],
    ])("should set the email on a Pub/Sub message %s for a user seen on a webhook", async (_case, sender) => {
      const { adapter, mockChat, mockState } = await createInitializedAdapter();
      await seedFromWebhook(adapter, mockState);

      const response = await adapter.handleWebhook(
        makeWebhookRequest(makePubSubMessagePush(sender))
      );

      expect(response.status).toBe(200);
      const message = await lastDispatchedMessage(mockChat);
      expect(message.id).toBe("spaces/ABC123/messages/pubsub1");
      expect(message.author.userId).toBe(USER_ID);
      expect(message.author.fullName).toBe("Alice");
      expect(message.author.email).toBe(EMAIL);
    });

    it("should set the email on a Pub/Sub message handled by another instance sharing the state", async () => {
      const first = await createInitializedAdapter();
      await seedFromWebhook(first.adapter, first.mockState);
      const second = await createAdapterOnState(first.mockState);

      await second.adapter.handleWebhook(
        makeWebhookRequest(makePubSubMessagePush({}))
      );

      const message = await lastDispatchedMessage(second.mockChat);
      expect(message.author.fullName).toBe("Alice");
      expect(message.author.email).toBe(EMAIL);
    });

    it("should leave the Pub/Sub author email undefined for a user never seen on a webhook", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();

      await adapter.handleWebhook(
        makeWebhookRequest(makePubSubMessagePush({ displayName: "Alice" }))
      );

      const message = await lastDispatchedMessage(mockChat);
      expect(message.author.userId).toBe(USER_ID);
      expect(message.author.email).toBeUndefined();
    });

    it("should prefer an email carried by the Pub/Sub payload over the cached one", async () => {
      const { adapter, mockChat, mockState } = await createInitializedAdapter();
      await seedFromWebhook(adapter, mockState);

      await adapter.handleWebhook(
        makeWebhookRequest(
          makePubSubMessagePush({ email: "payload@example.com" })
        )
      );

      const message = await lastDispatchedMessage(mockChat);
      expect(message.author.email).toBe("payload@example.com");
    });

    it("should keep the stored entry after a Pub/Sub message that carries only a display name", async () => {
      const { adapter, mockChat, mockState } = await createInitializedAdapter();
      await seedFromWebhook(adapter, mockState);
      const setCallsBefore = vi.mocked(mockState.set).mock.calls.length;
      const createCallsBefore = vi.mocked(mockState.setIfNotExists).mock.calls
        .length;

      await adapter.handleWebhook(
        makeWebhookRequest(makePubSubMessagePush({ displayName: "Alice B" }))
      );
      const message = await lastDispatchedMessage(mockChat);
      expect(message.author.fullName).toBe("Alice B");
      await vi.waitFor(() => {
        expect(
          vi.mocked(mockState.setIfNotExists).mock.calls.length
        ).toBeGreaterThan(createCallsBefore);
      });

      expect(vi.mocked(mockState.set).mock.calls.length).toBe(setCallsBefore);
      expect(mockState.storage.get(USER_KEY)).toEqual({
        avatarUrl: undefined,
        displayName: "Alice",
        email: EMAIL,
        isBot: false,
      });
      const user = await adapter.getUser(USER_ID);
      expect(user?.fullName).toBe("Alice B");
      expect(user?.email).toBe(EMAIL);
      const cold = await createAdapterOnState(mockState);
      const coldUser = await cold.adapter.getUser(USER_ID);
      expect(coldUser?.fullName).toBe("Alice");
      expect(coldUser?.email).toBe(EMAIL);
    });

    it("should keep the cached email after a later webhook message without one", async () => {
      const { adapter, mockState } = await createInitializedAdapter();
      await seedFromWebhook(adapter, mockState);
      const setCallsBefore = vi.mocked(mockState.set).mock.calls.length;

      adapter.parseMessage(
        makeMessageEvent({ senderName: USER_ID, senderDisplayName: "Alice" })
      );
      await vi.waitFor(() => {
        expect(vi.mocked(mockState.set).mock.calls.length).toBeGreaterThan(
          setCallsBefore
        );
      });

      expect((await adapter.getUser(USER_ID))?.email).toBe(EMAIL);
    });

    it("should set the email on fetchMessages authors for a user seen on a webhook", async () => {
      const first = await createInitializedAdapter();
      await seedFromWebhook(first.adapter, first.mockState);

      expect((await fetchListedAuthor(first.adapter)).email).toBe(EMAIL);

      const second = await createAdapterOnState(first.mockState);
      expect((await fetchListedAuthor(second.adapter)).email).toBe(EMAIL);
    });

    it("should leave fetchMessages author email undefined for a user never seen on a webhook", async () => {
      const { adapter } = await createInitializedAdapter();

      const author = await fetchListedAuthor(adapter);

      expect(author.fullName).toBe("Alice");
      expect(author.email).toBeUndefined();
    });

    it("should still return fetchMessages results when the state read fails", async () => {
      const first = await createInitializedAdapter();
      await seedFromWebhook(first.adapter, first.mockState);
      const second = await createAdapterOnState(first.mockState);
      vi.mocked(first.mockState.get).mockRejectedValue(
        new Error("State error")
      );

      const author = await fetchListedAuthor(second.adapter);

      expect(author.fullName).toBe("Alice");
      expect(author.email).toBeUndefined();
    });

    it("should still dispatch a Pub/Sub message when the state read fails", async () => {
      const first = await createInitializedAdapter();
      await seedFromWebhook(first.adapter, first.mockState);
      const second = await createAdapterOnState(first.mockState);
      vi.mocked(first.mockState.get).mockRejectedValue(
        new Error("State error")
      );

      const response = await second.adapter.handleWebhook(
        makeWebhookRequest(makePubSubMessagePush({}))
      );

      expect(response.status).toBe(200);
      const message = await lastDispatchedMessage(second.mockChat);
      expect(message.id).toBe("spaces/ABC123/messages/pubsub1");
      expect(message.author.fullName).toBe("User 777");
      expect(message.author.email).toBeUndefined();
    });

    it("should keep the stored email when a fetchMessages lookup fails and its cache write succeeds", async () => {
      const first = await createInitializedAdapter();
      await seedFromWebhook(first.adapter, first.mockState);
      const second = await createAdapterOnState(first.mockState);
      vi.mocked(first.mockState.get).mockRejectedValueOnce(
        new Error("State error")
      );

      expect((await fetchListedAuthor(second.adapter)).email).toBeUndefined();

      await vi.waitFor(async () => {
        expect((await second.adapter.getUser(USER_ID))?.fullName).toBe("Alice");
      });
      expect(first.mockState.storage.get(USER_KEY)).toMatchObject({
        email: EMAIL,
      });
      const third = await createAdapterOnState(first.mockState);
      expect((await third.adapter.getUser(USER_ID))?.email).toBe(EMAIL);
    });

    it("should pick up an email cached by another instance after this one cached the name", async () => {
      const warm = await createInitializedAdapter();
      expect((await fetchListedAuthor(warm.adapter)).email).toBeUndefined();
      await vi.waitFor(() => {
        expect(warm.mockState.storage.has(USER_KEY)).toBe(true);
      });
      const other = await createAdapterOnState(warm.mockState);
      await other.adapter.handleWebhook(
        makeWebhookRequest(
          makeMessageEvent({
            senderName: USER_ID,
            senderDisplayName: "Alice",
            senderEmail: EMAIL,
          })
        )
      );
      await vi.waitFor(() => {
        expect(warm.mockState.storage.get(USER_KEY)).toMatchObject({
          email: EMAIL,
        });
      });

      await warm.adapter.handleWebhook(
        makeWebhookRequest(makePubSubMessagePush({}))
      );
      const message = await lastDispatchedMessage(warm.mockChat);
      expect(message.id).toBe("spaces/ABC123/messages/pubsub1");
      expect(message.author.email).toBe(EMAIL);

      const createCallsBefore = vi.mocked(warm.mockState.setIfNotExists).mock
        .calls.length;
      expect((await fetchListedAuthor(warm.adapter)).email).toBe(EMAIL);
      await vi.waitFor(() => {
        expect(
          vi.mocked(warm.mockState.setIfNotExists).mock.calls.length
        ).toBeGreaterThan(createCallsBefore);
      });
      expect(warm.mockState.storage.get(USER_KEY)).toMatchObject({
        email: EMAIL,
      });
      const cold = await createAdapterOnState(warm.mockState);
      expect((await cold.adapter.getUser(USER_ID))?.email).toBe(EMAIL);
    });

    it("should set the email on a reaction user seen on a webhook", async () => {
      const first = await createInitializedAdapter();
      await seedFromWebhook(first.adapter, first.mockState);
      const second = await createAdapterOnState(first.mockState);
      stubChatApi(second.adapter);

      const response = await second.adapter.handleWebhook(
        makeWebhookRequest(makeReactionPush())
      );

      expect(response.status).toBe(200);
      const processReaction = vi.mocked(second.mockChat.processReaction);
      await vi.waitFor(() => {
        expect(processReaction).toHaveBeenCalledTimes(1);
      });
      const event = processReaction.mock.calls[0][0];
      expect(event.user.userId).toBe(USER_ID);
      expect(event.user.email).toBe(EMAIL);
      expect(event.messageId).toBe("spaces/ABC123/messages/msg1");
    });

    it("should leave the reaction user email undefined for a user never seen on a webhook", async () => {
      const { adapter, mockChat } = await createInitializedAdapter();
      stubChatApi(adapter);

      await adapter.handleWebhook(makeWebhookRequest(makeReactionPush()));

      const processReaction = vi.mocked(mockChat.processReaction);
      await vi.waitFor(() => {
        expect(processReaction).toHaveBeenCalledTimes(1);
      });
      const event = processReaction.mock.calls[0][0];
      expect(event.user.userId).toBe(USER_ID);
      expect(event.user.email).toBeUndefined();
    });

    it("should still process a reaction when the state read fails", async () => {
      const { adapter, mockChat, mockState } = await createInitializedAdapter();
      stubChatApi(adapter);
      vi.mocked(mockState.get).mockRejectedValue(new Error("State error"));

      await adapter.handleWebhook(makeWebhookRequest(makeReactionPush()));

      const processReaction = vi.mocked(mockChat.processReaction);
      await vi.waitFor(() => {
        expect(processReaction).toHaveBeenCalledTimes(1);
      });
      expect(processReaction.mock.calls[0][0].user.email).toBeUndefined();
    });

    it("should not cache an empty sender email", async () => {
      const { adapter, mockState } = await createInitializedAdapter();

      await seedFromWebhook(adapter, mockState, "");

      expect(mockState.storage.get(USER_KEY)).toEqual({
        avatarUrl: undefined,
        displayName: "Alice",
        email: undefined,
        isBot: false,
      });
      const user = await adapter.getUser(USER_ID);
      expect(user?.fullName).toBe("Alice");
      expect(user?.email).toBeUndefined();
    });

    it("should return an undefined email from getUser for an entry cached with an empty email", async () => {
      const { adapter, mockState } = await createInitializedAdapter();
      mockState.storage.set(USER_KEY, { displayName: "Alice", email: "" });

      const user = await adapter.getUser(USER_ID);

      expect(user?.fullName).toBe("Alice");
      expect(user?.email).toBeUndefined();
    });
  });

  describe("getUser", () => {
    it("should return cached user info", async () => {
      const { adapter, mockState } = await createInitializedAdapter();

      mockState.storage.set("gchat:user:users/123456", {
        avatarUrl: "https://lh3.googleusercontent.com/a/alice.jpg",
        displayName: "Alice Smith",
        email: "alice@example.com",
        isBot: false,
      });

      const user = await adapter.getUser("users/123456");
      expect(user).not.toBeNull();
      expect(user?.fullName).toBe("Alice Smith");
      expect(user?.userName).toBe("Alice Smith");
      expect(user?.email).toBe("alice@example.com");
      expect(user?.avatarUrl).toBe(
        "https://lh3.googleusercontent.com/a/alice.jpg"
      );
      expect(user?.isBot).toBe(false);
    });

    it("should return null when user not in cache", async () => {
      const { adapter } = await createInitializedAdapter();

      const user = await adapter.getUser("users/unknown");
      expect(user).toBeNull();
    });

    it("should return null when state throws an error", async () => {
      const { adapter, mockState } = await createInitializedAdapter();

      mockState.get = vi.fn().mockRejectedValue(new Error("State error"));

      const user = await adapter.getUser("users/error");
      expect(user).toBeNull();
    });

    it("should return undefined email when user has no email", async () => {
      const { adapter, mockState } = await createInitializedAdapter();

      mockState.storage.set("gchat:user:users/noemail", {
        displayName: "No Email User",
        isBot: false,
      });

      const user = await adapter.getUser("users/noemail");
      expect(user).not.toBeNull();
      expect(user?.fullName).toBe("No Email User");
      expect(user?.email).toBeUndefined();
    });

    it("should return isBot true for cached bot users", async () => {
      const { adapter, mockState } = await createInitializedAdapter();

      mockState.storage.set("gchat:user:users/bot123", {
        displayName: "Bot User",
        isBot: true,
      });

      const user = await adapter.getUser("users/bot123");
      expect(user).not.toBeNull();
      expect(user?.isBot).toBe(true);
    });

    it("should return undefined avatarUrl when not cached", async () => {
      const { adapter, mockState } = await createInitializedAdapter();

      mockState.storage.set("gchat:user:users/avatar-test", {
        displayName: "Avatar Test",
        email: "test@example.com",
        isBot: false,
      });

      const user = await adapter.getUser("users/avatar-test");
      expect(user).not.toBeNull();
      expect(user?.avatarUrl).toBeUndefined();
    });
  });
});
