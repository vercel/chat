import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { NotImplementedError } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTwilioAdapter, TwilioAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

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
  } as unknown as ChatInstance;
}

const mockRemove = vi.fn().mockResolvedValue(true);

vi.mock("twilio", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    sid: "SM1234567890",
    accountSid: "AC_TEST",
    from: "+15551234567",
    to: "+15559876543",
    body: "hello",
  });

  const mockList = vi.fn().mockResolvedValue([]);
  const mockFetch = vi.fn().mockResolvedValue({
    sid: "SM1234567890",
    accountSid: "AC_TEST",
    from: "+15559876543",
    to: "+15551234567",
    body: "hello",
    numMedia: "0",
    dateSent: new Date("2025-01-15T10:00:00Z"),
    dateCreated: new Date("2025-01-15T09:59:00Z"),
  });

  const mockClient = {
    messages: Object.assign(
      (_sid: string) => ({ fetch: mockFetch, remove: mockRemove }),
      {
        create: mockCreate,
        list: mockList,
      }
    ),
  };

  const twilioFn = vi.fn().mockReturnValue(mockClient);

  return {
    default: Object.assign(twilioFn, {
      validateRequest: vi.fn().mockReturnValue(true),
    }),
  };
});

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      Reflect.deleteProperty(process.env, key);
    }
  }
  vi.clearAllMocks();
});

function makeAdapter(overrides?: Record<string, string>): TwilioAdapter {
  return new TwilioAdapter({
    accountSid: overrides?.accountSid ?? "AC_TEST",
    authToken: overrides?.authToken ?? "test_auth_token",
    phoneNumber: overrides?.phoneNumber ?? "+15551234567",
    logger: mockLogger,
  });
}

describe("createTwilioAdapter", () => {
  it("creates adapter with explicit config", () => {
    const adapter = createTwilioAdapter({
      accountSid: "AC_TEST",
      authToken: "test_auth_token",
      phoneNumber: "+15551234567",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(TwilioAdapter);
    expect(adapter.name).toBe("twilio");
  });

  it("reads credentials from environment variables", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_ENV";
    process.env.TWILIO_AUTH_TOKEN = "env_token";
    process.env.TWILIO_PHONE_NUMBER = "+15550001111";
    const adapter = createTwilioAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(TwilioAdapter);
  });

  it("throws when accountSid is missing", () => {
    Reflect.deleteProperty(process.env, "TWILIO_ACCOUNT_SID");
    expect(
      () =>
        new TwilioAdapter({
          authToken: "token",
          phoneNumber: "+15551234567",
          logger: mockLogger,
        })
    ).toThrow(ValidationError);
  });

  it("throws when authToken is missing", () => {
    Reflect.deleteProperty(process.env, "TWILIO_AUTH_TOKEN");
    expect(
      () =>
        new TwilioAdapter({
          accountSid: "AC_TEST",
          phoneNumber: "+15551234567",
          logger: mockLogger,
        })
    ).toThrow(ValidationError);
  });

  it("throws when phoneNumber is missing", () => {
    Reflect.deleteProperty(process.env, "TWILIO_PHONE_NUMBER");
    expect(
      () =>
        new TwilioAdapter({
          accountSid: "AC_TEST",
          authToken: "token",
          logger: mockLogger,
        })
    ).toThrow(ValidationError);
  });
});

describe("encodeThreadId / decodeThreadId", () => {
  it("roundtrips correctly", () => {
    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId({
      twilioNumber: "+15551234567",
      recipientNumber: "+15559876543",
    });
    expect(threadId).toBe("twilio:+15551234567:+15559876543");

    const decoded = adapter.decodeThreadId(threadId);
    expect(decoded).toEqual({
      twilioNumber: "+15551234567",
      recipientNumber: "+15559876543",
    });
  });

  it("throws on invalid thread ID", () => {
    const adapter = makeAdapter();
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:C123:T456")).toThrow(
      ValidationError
    );
    expect(() => adapter.decodeThreadId("twilio:")).toThrow(ValidationError);
  });
});

describe("handleWebhook", () => {
  it("rejects non-form-urlencoded content type", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("rejects invalid signature", async () => {
    const twilio = await import("twilio");
    vi.mocked(twilio.default.validateRequest).mockReturnValueOnce(false);

    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const params = new URLSearchParams({
      MessageSid: "SM123",
      AccountSid: "AC_TEST",
      From: "+15559876543",
      To: "+15551234567",
      Body: "hello",
      NumMedia: "0",
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "invalid",
      },
      body: params.toString(),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("processes valid SMS and returns TwiML", async () => {
    const adapter = makeAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const params = new URLSearchParams({
      MessageSid: "SM123",
      AccountSid: "AC_TEST",
      From: "+15559876543",
      To: "+15551234567",
      Body: "hello world",
      NumMedia: "0",
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body: params.toString(),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/xml");
    const text = await response.text();
    expect(text).toBe("<Response></Response>");

    expect(chat.processMessage).toHaveBeenCalledOnce();
  });

  it("extracts MMS media attachments", async () => {
    const adapter = makeAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const params = new URLSearchParams({
      MessageSid: "SM456",
      AccountSid: "AC_TEST",
      From: "+15559876543",
      To: "+15551234567",
      Body: "check this out",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/img1.jpg",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/media/doc.pdf",
      MediaContentType1: "application/pdf",
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body: params.toString(),
    });

    await adapter.handleWebhook(request);

    const processCall = vi.mocked(chat.processMessage).mock.calls[0];
    const message = processCall?.[2];
    expect(message?.attachments).toHaveLength(2);
    expect(message?.attachments[0]?.type).toBe("image");
    expect(message?.attachments[0]?.url).toBe(
      "https://api.twilio.com/media/img1.jpg"
    );
    expect(message?.attachments[1]?.type).toBe("file");
  });

  it("handles status callback webhooks gracefully", async () => {
    const adapter = makeAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const params = new URLSearchParams({
      MessageSid: "SM789",
      AccountSid: "AC_TEST",
      From: "+15551234567",
      To: "+15559876543",
      MessageStatus: "delivered",
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid",
      },
      body: params.toString(),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("<Response></Response>");
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});

describe("postMessage", () => {
  it("calls Twilio API to send message", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const twilio = await import("twilio");
    const client = twilio.default("AC_TEST", "token");

    const result = await adapter.postMessage(
      "twilio:+15551234567:+15559876543",
      "hello"
    );

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hello",
        from: "+15551234567",
        to: "+15559876543",
      })
    );
    expect(result.id).toContain("twilio:");
    expect(result.threadId).toBe("twilio:+15551234567:+15559876543");
  });

  it("renders card messages as fallback text", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const twilio = await import("twilio");
    const client = twilio.default("AC_TEST", "token");

    const cardMessage = {
      type: "card" as const,
      title: "Test Card",
      children: [{ type: "text" as const, content: "Card body" }],
    };

    await adapter.postMessage("twilio:+15551234567:+15559876543", cardMessage);

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Test Card"),
      })
    );
  });

  it("logs warning when message is truncated", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const longText = "x".repeat(2000);
    await adapter.postMessage("twilio:+15551234567:+15559876543", longText);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("truncated")
    );
  });
});

describe("deleteMessage", () => {
  it("calls Twilio API to remove message", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    await adapter.deleteMessage(
      "twilio:+15551234567:+15559876543",
      "twilio:SM1234567890"
    );

    expect(mockRemove).toHaveBeenCalledOnce();
  });

  it("strips twilio: prefix from message ID", async () => {
    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    await adapter.deleteMessage(
      "twilio:+15551234567:+15559876543",
      "SM1234567890"
    );

    expect(mockRemove).toHaveBeenCalledOnce();
  });
});

describe("unsupported operations", () => {
  it("editMessage throws NotImplementedError", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.editMessage("twilio:+1:+2", "msg1", "text")
    ).rejects.toThrow(NotImplementedError);
  });

  it("addReaction throws NotImplementedError", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.addReaction("twilio:+1:+2", "msg1", "thumbsup")
    ).rejects.toThrow(NotImplementedError);
  });

  it("removeReaction throws NotImplementedError", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.removeReaction("twilio:+1:+2", "msg1", "thumbsup")
    ).rejects.toThrow(NotImplementedError);
  });
});

describe("fetchMessages", () => {
  it("fetches messages from both directions", async () => {
    const twilio = await import("twilio");
    const client = twilio.default("AC_TEST", "token");

    const now = new Date("2025-01-15T10:00:00Z");
    const earlier = new Date("2025-01-15T09:00:00Z");

    vi.mocked(client.messages.list)
      .mockResolvedValueOnce([
        {
          sid: "SM_IN",
          accountSid: "AC_TEST",
          from: "+15559876543",
          to: "+15551234567",
          body: "inbound",
          numMedia: "0",
          dateSent: now,
          dateCreated: now,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          sid: "SM_OUT",
          accountSid: "AC_TEST",
          from: "+15551234567",
          to: "+15559876543",
          body: "outbound",
          numMedia: "0",
          dateSent: earlier,
          dateCreated: earlier,
        },
      ] as never);

    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const result = await adapter.fetchMessages(
      "twilio:+15551234567:+15559876543"
    );

    expect(client.messages.list).toHaveBeenCalledTimes(2);
    expect(result.messages).toHaveLength(2);
    // Sorted by dateCreated: outbound (earlier) before inbound (now)
    expect(result.messages[0]?.id).toBe("twilio:SM_OUT");
    expect(result.messages[1]?.id).toBe("twilio:SM_IN");
  });

  it("uses real timestamps from API", async () => {
    const twilio = await import("twilio");
    const client = twilio.default("AC_TEST", "token");
    const sentDate = new Date("2025-01-15T10:00:00Z");

    vi.mocked(client.messages.list)
      .mockResolvedValueOnce([
        {
          sid: "SM_TS",
          accountSid: "AC_TEST",
          from: "+15559876543",
          to: "+15551234567",
          body: "test",
          numMedia: "0",
          dateSent: sentDate,
          dateCreated: sentDate,
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const adapter = makeAdapter();
    await adapter.initialize(createMockChat());

    const result = await adapter.fetchMessages(
      "twilio:+15551234567:+15559876543"
    );

    expect(result.messages[0]?.metadata.dateSent).toEqual(sentDate);
  });
});

describe("isDM", () => {
  it("always returns true", () => {
    const adapter = makeAdapter();
    expect(adapter.isDM("twilio:+15551234567:+15559876543")).toBe(true);
  });
});

describe("startTyping", () => {
  it("is a no-op", async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.startTyping("twilio:+15551234567:+15559876543")
    ).resolves.toBeUndefined();
  });
});

describe("openDM", () => {
  it("returns encoded thread ID using configured phone number", async () => {
    const adapter = makeAdapter();
    const threadId = await adapter.openDM("+15559876543");
    expect(threadId).toBe("twilio:+15551234567:+15559876543");
  });
});

describe("fetchThread", () => {
  it("returns thread info with isDM true", async () => {
    const adapter = makeAdapter();
    const info = await adapter.fetchThread("twilio:+15551234567:+15559876543");
    expect(info.isDM).toBe(true);
    expect(info.id).toBe("twilio:+15551234567:+15559876543");
  });
});

describe("channelIdFromThreadId", () => {
  it("returns both phone numbers", () => {
    const adapter = makeAdapter();
    const channelId = adapter.channelIdFromThreadId(
      "twilio:+15551234567:+15559876543"
    );
    expect(channelId).toBe("+15551234567:+15559876543");
  });

  it("throws on invalid thread ID", () => {
    const adapter = makeAdapter();
    expect(() => adapter.channelIdFromThreadId("invalid")).toThrow(
      ValidationError
    );
  });
});

describe("parseMessage", () => {
  it("parses basic SMS payload", () => {
    const adapter = makeAdapter();
    const message = adapter.parseMessage({
      MessageSid: "SM999",
      AccountSid: "AC_TEST",
      From: "+15559876543",
      To: "+15551234567",
      Body: "test message",
      NumMedia: "0",
    });

    expect(message.id).toBe("twilio:SM999");
    expect(message.text).toBe("test message");
    expect(message.author.userId).toBe("+15559876543");
    expect(message.attachments).toHaveLength(0);
  });

  it("parses MMS with media", () => {
    const adapter = makeAdapter();
    const message = adapter.parseMessage({
      MessageSid: "SM888",
      AccountSid: "AC_TEST",
      From: "+15559876543",
      To: "+15551234567",
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/photo.jpg",
      MediaContentType0: "image/jpeg",
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.type).toBe("image");
    expect(message.attachments[0]?.url).toBe(
      "https://api.twilio.com/media/photo.jpg"
    );
  });
});
