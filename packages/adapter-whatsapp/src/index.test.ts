import { describe, expect, it } from "vitest";
import { WhatsAppAdapter } from "./index";

/**
 * Create a minimal WhatsAppAdapter for testing thread ID methods.
 * Credentials are dummy values — they won't be used for encoding/decoding.
 */
function createTestAdapter(): WhatsAppAdapter {
  return new WhatsAppAdapter({
    accessToken: "test-token",
    appSecret: "test-secret",
    phoneNumberId: "123456789",
    verifyToken: "test-verify-token",
    userName: "test-bot",
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
}

describe("encodeThreadId", () => {
  it("should encode a thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      phoneNumberId: "123456789",
      userWaId: "15551234567",
    });
    expect(result).toBe("whatsapp:123456789:15551234567");
  });

  it("should encode with different phone numbers", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      phoneNumberId: "987654321",
      userWaId: "44771234567",
    });
    expect(result).toBe("whatsapp:987654321:44771234567");
  });
});

describe("decodeThreadId", () => {
  it("should decode a valid thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("whatsapp:123456789:15551234567");
    expect(result).toEqual({
      phoneNumberId: "123456789",
      userWaId: "15551234567",
    });
  });

  it("should throw on invalid prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("slack:C123:ts123")).toThrow(
      "Invalid WhatsApp thread ID"
    );
  });

  it("should throw on empty after prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("whatsapp:")).toThrow(
      "Invalid WhatsApp thread ID format"
    );
  });

  it("should throw on missing userWaId", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("whatsapp:123456789:")).toThrow(
      "Invalid WhatsApp thread ID format"
    );
  });

  it("should throw on completely wrong format", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("nonsense")).toThrow(
      "Invalid WhatsApp thread ID"
    );
  });
});

describe("encodeThreadId / decodeThreadId roundtrip", () => {
  it("should round-trip a thread ID", () => {
    const adapter = createTestAdapter();
    const original = {
      phoneNumberId: "123456789",
      userWaId: "15551234567",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("should round-trip with international numbers", () => {
    const adapter = createTestAdapter();
    const original = {
      phoneNumberId: "999888777",
      userWaId: "919876543210",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("channelIdFromThreadId", () => {
  it("should extract channel ID (phone number ID)", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId(
      "whatsapp:123456789:15551234567"
    );
    expect(result).toBe("whatsapp:123456789");
  });
});

describe("isDM", () => {
  it("should always return true", () => {
    const adapter = createTestAdapter();
    expect(adapter.isDM("whatsapp:123456789:15551234567")).toBe(true);
  });
});

describe("renderFormatted", () => {
  it("should render markdown from AST", () => {
    const adapter = createTestAdapter();
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: "Hello world" }],
        },
      ],
    };
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("Hello world");
  });
});

describe("parseMessage", () => {
  it("should parse a raw WhatsApp text message", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.ABC123",
        from: "15551234567",
        timestamp: "1700000000",
        type: "text" as const,
        text: { body: "Hello from WhatsApp!" },
      },
      phoneNumberId: "123456789",
      contact: {
        profile: { name: "Alice" },
        wa_id: "15551234567",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("wamid.ABC123");
    expect(message.text).toBe("Hello from WhatsApp!");
    expect(message.author.userId).toBe("15551234567");
    expect(message.author.userName).toBe("Alice");
  });

  it("should parse a message without contact info", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.DEF456",
        from: "15559876543",
        timestamp: "1700000100",
        type: "text" as const,
        text: { body: "No contact info" },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.author.userName).toBe("15559876543");
  });

  it("should parse an image message with caption", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.IMG001",
        from: "15551234567",
        timestamp: "1700000200",
        type: "image" as const,
        image: {
          id: "media-123",
          mime_type: "image/jpeg",
          sha256: "abc",
          caption: "Check this out",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("Check this out");
  });

  it("should parse an image message without caption", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.IMG002",
        from: "15551234567",
        timestamp: "1700000300",
        type: "image" as const,
        image: {
          id: "media-456",
          mime_type: "image/png",
          sha256: "def",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Image]");
  });

  it("should set correct dateSent from unix timestamp", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.TIME001",
        from: "15551234567",
        timestamp: "1700000000",
        type: "text" as const,
        text: { body: "test" },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.metadata.dateSent.getTime()).toBe(1700000000000);
  });
});

describe("handleWebhook - verification challenge", () => {
  it("should respond to valid verification challenge", async () => {
    const adapter = createTestAdapter();
    const url =
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=1234567890";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("1234567890");
  });

  it("should reject invalid verify token", async () => {
    const adapter = createTestAdapter();
    const url =
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=1234567890";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(403);
  });

  it("should reject wrong mode", async () => {
    const adapter = createTestAdapter();
    const url =
      "https://example.com/webhook?hub.mode=unsubscribe&hub.verify_token=test-verify-token&hub.challenge=1234567890";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(403);
  });
});
