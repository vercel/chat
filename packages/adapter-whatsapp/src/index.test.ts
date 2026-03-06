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

  it("should throw on extra segments", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("whatsapp:123:456:extra")).toThrow(
      "Invalid WhatsApp thread ID format"
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

describe("parseMessage - media attachments", () => {
  it("should create an image attachment with fetchData", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.IMG001",
        from: "15551234567",
        timestamp: "1700000200",
        type: "image" as const,
        image: {
          id: "media-img-123",
          mime_type: "image/jpeg",
          sha256: "abc",
          caption: "A photo",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("A photo");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("image");
    expect(message.attachments[0].mimeType).toBe("image/jpeg");
    expect(typeof message.attachments[0].fetchData).toBe("function");
  });

  it("should create a document attachment with filename", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.DOC001",
        from: "15551234567",
        timestamp: "1700000300",
        type: "document" as const,
        document: {
          id: "media-doc-456",
          mime_type: "application/pdf",
          sha256: "def",
          filename: "report.pdf",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Document: report.pdf]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("file");
    expect(message.attachments[0].mimeType).toBe("application/pdf");
    expect(message.attachments[0].name).toBe("report.pdf");
  });

  it("should create an audio attachment", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.AUD001",
        from: "15551234567",
        timestamp: "1700000400",
        type: "audio" as const,
        audio: {
          id: "media-aud-789",
          mime_type: "audio/ogg",
          sha256: "ghi",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Audio message]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("audio");
    expect(message.attachments[0].mimeType).toBe("audio/ogg");
  });

  it("should create a video attachment", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.VID001",
        from: "15551234567",
        timestamp: "1700000500",
        type: "video" as const,
        video: {
          id: "media-vid-101",
          mime_type: "video/mp4",
          sha256: "jkl",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Video]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("video");
    expect(message.attachments[0].mimeType).toBe("video/mp4");
  });

  it("should create a sticker attachment as image type", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.STK001",
        from: "15551234567",
        timestamp: "1700000600",
        type: "sticker" as const,
        sticker: {
          id: "media-stk-202",
          mime_type: "image/webp",
          sha256: "mno",
          animated: false,
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Sticker]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("image");
    expect(message.attachments[0].mimeType).toBe("image/webp");
    expect(message.attachments[0].name).toBe("sticker");
  });

  it("should create a location attachment with Google Maps URL", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.LOC001",
        from: "15551234567",
        timestamp: "1700000700",
        type: "location" as const,
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          name: "San Francisco",
          address: "CA, USA",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Location: San Francisco - CA, USA]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("file");
    expect(message.attachments[0].name).toBe("San Francisco");
    expect(message.attachments[0].url).toBe(
      "https://www.google.com/maps?q=37.7749,-122.4194"
    );
  });

  it("should format location text with coordinates when no name", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.LOC002",
        from: "15551234567",
        timestamp: "1700000800",
        type: "location" as const,
        location: {
          latitude: 48.8566,
          longitude: 2.3522,
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Location: 48.8566, 2.3522]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].name).toBe("Location");
  });

  it("should create a voice message attachment as audio type", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.VOC001",
        from: "15551234567",
        timestamp: "1700000650",
        type: "voice" as const,
        voice: {
          id: "media-voc-303",
          mime_type: "audio/ogg; codecs=opus",
          sha256: "pqr",
        },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("[Voice message]");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("audio");
    expect(message.attachments[0].mimeType).toBe("audio/ogg; codecs=opus");
    expect(message.attachments[0].name).toBe("voice");
  });

  it("should have no attachments for plain text messages", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.TXT001",
        from: "15551234567",
        timestamp: "1700000000",
        type: "text" as const,
        text: { body: "Hello" },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.attachments).toHaveLength(0);
  });
});

describe("parseMessage - isMention and threadId", () => {
  it("should set isMention to true for all messages", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.MENTION001",
        from: "15551234567",
        timestamp: "1700000000",
        type: "text" as const,
        text: { body: "Hello" },
      },
      phoneNumberId: "123456789",
    };
    const message = adapter.parseMessage(raw);
    expect(message.isMention).toBe(true);
  });

  it("should encode threadId from phoneNumberId and sender", () => {
    const adapter = createTestAdapter();
    const raw = {
      message: {
        id: "wamid.THREAD001",
        from: "15559876543",
        timestamp: "1700000000",
        type: "text" as const,
        text: { body: "test" },
      },
      phoneNumberId: "987654321",
    };
    const message = adapter.parseMessage(raw);
    expect(message.threadId).toBe("whatsapp:987654321:15559876543");
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
