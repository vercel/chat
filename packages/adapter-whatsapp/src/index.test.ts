import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { NetworkError } from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
  threadIdContract,
} from "@chat-adapter/tests";
import type { CardElement } from "chat";
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
  createWhatsAppAdapter,
  getWhatsAppMediaType,
  splitMessage,
  WhatsAppAdapter,
  WhatsAppApiError,
  type WhatsAppThreadId,
} from "./index";
import type {
  WhatsAppContact,
  WhatsAppInboundMessage,
  WhatsAppUserIdUpdate,
  WhatsAppWebhookPayload,
} from "./types";

function mediaResponse(
  body: string,
  status = 200,
  headers: IncomingMessage["headers"] = {}
): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    headers,
    statusCode: status,
    statusMessage: "OK",
  }) as IncomingMessage;
}

const NOT_SUPPORTED_PATTERN = /not support/i;
const ACCESS_TOKEN_PATTERN = /accessToken/i;
const APP_SECRET_PATTERN = /appSecret/i;
const WHATSAPP_IMAGE_SIZE_LIMIT_PATTERN = /exceeds WhatsApp image limit/;
const NO_MESSAGE_ID_PATTERN = /did not return a message ID/i;

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
    logger: createMockLogger(),
  });
}

// `encodeThreadId`/`decodeThreadId` are pure, so a single adapter instance (no
// init, no network) is enough to exercise the shared thread-id codec contract.
const threadIdAdapter = createTestAdapter();

// Encode/decode/round-trip coverage lives in the shared `threadIdContract`.
// WhatsApp threads are always 1:1 DMs, so `isDM` has no non-DM case to feed the
// contract's optional check — that edge stays in the local `isDM` suite below.
threadIdContract<WhatsAppThreadId>({
  name: "whatsapp",
  encode: (decoded) => threadIdAdapter.encodeThreadId(decoded),
  decode: (id) => threadIdAdapter.decodeThreadId(id),
  cases: [
    {
      decoded: { phoneNumberId: "123456789", userWaId: "15551234567" },
      encoded: "whatsapp:123456789:15551234567",
    },
    {
      decoded: { phoneNumberId: "987654321", userWaId: "44771234567" },
      encoded: "whatsapp:987654321:44771234567",
    },
    {
      // international numbers must survive the round-trip untouched.
      decoded: { phoneNumberId: "999888777", userWaId: "919876543210" },
      encoded: "whatsapp:999888777:919876543210",
    },
  ],
});

describe("decodeThreadId", () => {
  // Valid decode + round-trip coverage lives in the shared `threadIdContract`
  // above; only the malformed-id and invalid-prefix errors it does not cover
  // are kept here.
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

describe("channelIdFromThreadId", () => {
  it("should return the full thread ID (channel === thread on WhatsApp)", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId(
      "whatsapp:123456789:15551234567"
    );
    expect(result).toBe("whatsapp:123456789:15551234567");
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

  it("preserves canonical identity when reparsing raw messages", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage({
      message: {
        id: "wamid.BSUID",
        from_user_id: "US.13491208655302741918",
        timestamp: "1700000000",
        type: "text",
        text: { body: "Hello" },
      },
      phoneNumberId: "123456789",
      userId: "15551234567",
    });

    expect(message.threadId).toBe("whatsapp:123456789:15551234567");
    expect(message.author.userId).toBe("15551234567");
  });

  it("parses BSUID-only raw messages without stored identity", () => {
    const adapter = createTestAdapter();
    const message = adapter.parseMessage({
      message: {
        id: "wamid.BSUID",
        from_user_id: "US.13491208655302741918",
        timestamp: "1700000000",
        type: "text",
        text: { body: "Hello" },
      },
      phoneNumberId: "123456789",
    });

    expect(message.threadId).toBe("whatsapp:123456789:US.13491208655302741918");
    expect(message.author.userId).toBe("US.13491208655302741918");
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

describe("downloadMedia", () => {
  it.each([
    "https://attacker.example/media",
    "http://lookaside.fbsbx.com/whatsapp/media",
    "https://evilfbsbx.com/whatsapp/media",
    "https://lookaside.fbsbx.com.attacker.example/whatsapp/media",
    "https://lookaside.fbsbx.com:8443/whatsapp/media",
  ])("rejects untrusted media URL %s", async (url) => {
    const adapter = createTestAdapter();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response("leaked", { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      await expect(adapter.downloadMedia("media-123")).rejects.toBeInstanceOf(
        NetworkError
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    "https://lookaside.fbsbx.com/whatsapp/media",
    "https://scontent.xx.fbcdn.net/whatsapp/media",
  ])("downloads media from trusted Meta URL %s", async (url) => {
    const adapter = createTestAdapter();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const transport = vi.fn(async () => mediaResponse("media"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const data = await adapter.downloadMedia("media-123", transport);

      expect(data.toString()).toBe("media");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledWith(
        new URL(url),
        expect.any(AbortSignal),
        expect.objectContaining({ authorization: "Bearer test-token" })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    "https://sub.graph.example/media/file",
    "https://graph.example:8443/media/file",
  ])("refuses to send the token to off-policy redirect %s", async (location) => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      apiUrl: "https://graph.example",
      appSecret: "test-secret",
      phoneNumberId: "123456789",
      verifyToken: "test-verify-token",
      userName: "test-bot",
      logger: createMockLogger(),
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: "https://graph.example/media/file" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = vi.fn(async () => mediaResponse("", 302, { location }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      await expect(
        adapter.downloadMedia("media-123", transport)
      ).rejects.toThrow(
        "Refusing to send the access token to an untrusted media URL"
      );
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("downloads media from the configured Graph origin", async () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      apiUrl: "https://graph.example",
      appSecret: "test-secret",
      phoneNumberId: "123456789",
      verifyToken: "test-verify-token",
      userName: "test-bot",
      logger: createMockLogger(),
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: "https://graph.example/media/file" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = vi.fn(async () => mediaResponse("media"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      await adapter.downloadMedia("media-123", transport);

      expect(transport).toHaveBeenCalledWith(
        new URL("https://graph.example/media/file"),
        expect.any(AbortSignal),
        expect.objectContaining({ authorization: "Bearer test-token" })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("parseMessage - isMention and threadId", () => {
  it("should not set isMention for DMs (handled by Chat SDK)", () => {
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
    expect(message.isMention).toBeUndefined();
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

describe("splitMessage", () => {
  it("should return a single chunk for short messages", () => {
    const result = splitMessage("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("should return a single chunk for exactly 4096 chars", () => {
    const text = "a".repeat(4096);
    const result = splitMessage(text);
    expect(result).toEqual([text]);
  });

  it("should split on paragraph boundaries when possible", () => {
    const paragraph1 = "a".repeat(3000);
    const paragraph2 = "b".repeat(3000);
    const text = `${paragraph1}\n\n${paragraph2}`;
    const result = splitMessage(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(paragraph1);
    expect(result[1]).toBe(paragraph2);
  });

  it("should split on line boundaries when no paragraph break", () => {
    const line1 = "a".repeat(3000);
    const line2 = "b".repeat(3000);
    const text = `${line1}\n${line2}`;
    const result = splitMessage(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(line1);
    expect(result[1]).toBe(line2);
  });

  it("should hard-break when no line boundaries exist", () => {
    const text = "a".repeat(5000);
    const result = splitMessage(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(4096));
    expect(result[1]).toBe("a".repeat(904));
  });

  it("should handle three chunks", () => {
    const p1 = "a".repeat(4000);
    const p2 = "b".repeat(4000);
    const p3 = "c".repeat(4000);
    const text = `${p1}\n\n${p2}\n\n${p3}`;
    const result = splitMessage(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(p1);
    expect(result[1]).toBe(p2);
    expect(result[2]).toBe(p3);
  });

  it("should not split on a break that is too early in the chunk", () => {
    // A paragraph break at position 1000 (< 2048 = limit/2) should be skipped
    const earlyPart = "a".repeat(1000);
    const rest = "b".repeat(4500);
    const text = `${earlyPart}\n\n${rest}`;
    const result = splitMessage(text);
    // Should fall through to line break, then hard break
    expect(result).toHaveLength(2);
    expect(result[0].length).toBe(4096);
    expect(result[1].length).toBe(text.length - 4096);
  });

  it("should preserve all content across chunks", () => {
    const text = "x".repeat(10000);
    const result = splitMessage(text);
    expect(result.join("")).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Helpers shared across the new suites
// ---------------------------------------------------------------------------

function makeSignature(body: string, secret = "test-secret"): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function webhook(payload: WhatsAppWebhookPayload): Request {
  const body = JSON.stringify(payload);
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "x-hub-signature-256": makeSignature(body),
      "content-type": "application/json",
    },
    body,
  });
}

function inbound(
  overrides: Partial<WhatsAppInboundMessage>
): WhatsAppInboundMessage {
  return {
    id: "wamid.inbound",
    timestamp: "1700000000",
    type: "text",
    text: { body: "Hello" },
    ...overrides,
  };
}

function notification(
  messages: WhatsAppInboundMessage[],
  contacts?: WhatsAppContact[]
): WhatsAppWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: "123456789",
              },
              ...(contacts ? { contacts } : {}),
              messages,
            },
          },
        ],
      },
    ],
  };
}

function userIdUpdateNotification(
  updates: WhatsAppUserIdUpdate[]
): WhatsAppWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "user_id_update",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: "123456789",
              },
              user_id_update: updates,
            },
          },
        ],
      },
    ],
  };
}

function makeWebhookPayload(overrides?: {
  field?: string;
  hasMessages?: boolean;
}) {
  const field = overrides?.field ?? "messages";
  const hasMessages = overrides?.hasMessages ?? true;
  return {
    entry: [
      {
        changes: [
          {
            field,
            value: {
              metadata: { phone_number_id: "123456789" },
              contacts: [{ profile: { name: "User" }, wa_id: "15551234567" }],
              ...(hasMessages
                ? {
                    messages: [
                      {
                        id: "wamid.xxx",
                        from: "15551234567",
                        timestamp: "1700000000",
                        type: "text",
                        text: { body: "Hello" },
                      },
                    ],
                  }
                : {}),
            },
          },
        ],
      },
    ],
  };
}

const mockChat = createMockChatInstance();

// ---------------------------------------------------------------------------
// handleWebhook - POST with signature verification
// ---------------------------------------------------------------------------

describe("handleWebhook - POST signature verification", () => {
  it("valid signature processes message and returns 200", async () => {
    const adapter = createTestAdapter();
    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("invalid signature returns 401", async () => {
    const adapter = createTestAdapter();
    const body = JSON.stringify(makeWebhookPayload());
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "sha256=badsignature",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("missing signature returns 401", async () => {
    const adapter = createTestAdapter();
    const body = JSON.stringify(makeWebhookPayload());
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("invalid JSON returns 400", async () => {
    const adapter = createTestAdapter();
    const body = "not-json";
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("status update without messages array returns 200 without processing", async () => {
    const adapter = createTestAdapter();
    const payload = makeWebhookPayload({ hasMessages: false });
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// handleWebhook - POST message processing (initialized adapter)
// ---------------------------------------------------------------------------

describe("handleWebhook - POST message processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text message calls chat.processMessage with correct thread and message", async () => {
    const adapter = createTestAdapter();
    await adapter.initialize(mockChat);

    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = mockChat.processMessage.mock.calls[0];
    expect(threadId).toBe("whatsapp:123456789:15551234567");
    expect(message.text).toBe("Hello");
  });

  it("non-messages field change is skipped", async () => {
    const adapter = createTestAdapter();
    await adapter.initialize(mockChat);

    const payload = makeWebhookPayload({
      field: "statuses",
      hasMessages: false,
    });
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat).not.toHaveDispatched("processMessage");
  });
});

describe("handleWebhook - business-scoped user IDs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      name: "phone and BSUID",
      contact: {
        profile: { name: "User" },
        wa_id: "15551234567",
        user_id: "US.13491208655302741918",
      },
      message: {
        from: "15551234567",
        from_user_id: "US.13491208655302741918",
      },
      userId: "15551234567",
    },
    {
      name: "username without phone",
      contact: {
        profile: { name: "User", username: "exampleuser" },
        user_id: "US.13491208655302741918",
      },
      message: { from_user_id: "US.13491208655302741918" },
      userId: "US.13491208655302741918",
    },
    {
      name: "username with phone",
      contact: {
        profile: { name: "User", username: "exampleuser" },
        wa_id: "15551234567",
        user_id: "US.13491208655302741918",
      },
      message: {
        from: "15551234567",
        from_user_id: "US.13491208655302741918",
      },
      userId: "15551234567",
    },
    {
      name: "parent BSUID",
      contact: {
        profile: { name: "User", username: "exampleuser" },
        wa_id: "15551234567",
        user_id: "US.13491208655302741918",
        parent_user_id: "US.ENT.11815799212886844830",
      },
      message: {
        from: "15551234567",
        from_user_id: "US.13491208655302741918",
        from_parent_user_id: "US.ENT.11815799212886844830",
      },
      userId: "15551234567",
    },
  ])("handles $name webhooks", async ({ contact, message, userId }) => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      webhook(notification([inbound(message)], [contact]))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, parsed] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(threadId).toBe(`whatsapp:123456789:${userId}`);
    expect(typeof parsed).not.toBe("function");
    if (typeof parsed !== "function") {
      expect(parsed.author.userId).toBe(userId);
      expect(parsed.raw).toMatchObject({ contact, userId });
    }
  });

  it("sends both known identifiers from a preserved phone thread", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.reply" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await adapter.handleWebhook(
      webhook(
        notification(
          [
            inbound({
              from: "15551234567",
              from_user_id: "US.13491208655302741918",
            }),
          ],
          [
            {
              profile: { name: "User" },
              wa_id: "15551234567",
              user_id: "US.13491208655302741918",
            },
          ]
        )
      )
    );
    await adapter.postMessage("whatsapp:123456789:15551234567", {
      markdown: "Reply",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.to).toBe("15551234567");
    expect(body.recipient).toBe("US.13491208655302741918");
    fetchSpy.mockRestore();
  });

  it("preserves identity across BSUID rotation system messages", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      webhook(
        notification(
          [inbound({ from: "15551234567", from_user_id: "US.OLD" })],
          [
            {
              profile: { name: "User" },
              wa_id: "15551234567",
              user_id: "US.OLD",
            },
          ]
        )
      )
    );
    // Meta's system payload carries only the NEW identifiers; the old
    // number rides in the message-level `from`.
    await adapter.handleWebhook(
      webhook(
        notification([
          {
            from: "15551234567",
            id: "wamid.system",
            timestamp: "1700000001",
            type: "system",
            system: {
              body: "User A changed from 15551234567 to 15557654321",
              wa_id: "15557654321",
              user_id: "US.NEW",
              type: "user_changed_number",
            },
          },
        ])
      )
    );
    await adapter.handleWebhook(
      webhook(
        notification(
          [inbound({ from_user_id: "US.NEW" })],
          [
            {
              profile: { name: "User", username: "exampleuser" },
              user_id: "US.NEW",
            },
          ]
        )
      )
    );

    expect(chat.processMessage).toHaveBeenCalledTimes(2);
    const [, threadId, parsed] = vi.mocked(chat.processMessage).mock.calls[1];
    expect(threadId).toBe("whatsapp:123456789:15551234567");
    expect(typeof parsed).not.toBe("function");
    if (typeof parsed !== "function") {
      expect(parsed.author.userId).toBe("15551234567");
    }

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.reply" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await adapter.postMessage("whatsapp:123456789:15551234567", {
      markdown: "Reply",
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.to).toBe("15557654321");
    expect(body.recipient).toBe("US.NEW");
    fetchSpy.mockRestore();
  });

  it("preserves identity across number change system messages", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      webhook(
        notification([inbound({ from: "15551234567", from_user_id: "US.OLD" })])
      )
    );
    await adapter.handleWebhook(
      webhook(
        notification([
          {
            from: "15551234567",
            id: "wamid.system",
            timestamp: "1700000001",
            type: "system",
            system: {
              body: "User changed from 15551234567 to 15557654321",
              type: "user_changed_number",
              user_id: "US.NEW",
              wa_id: "15557654321",
            },
          },
        ])
      )
    );
    await adapter.handleWebhook(
      webhook(
        notification([inbound({ from: "15557654321", from_user_id: "US.NEW" })])
      )
    );

    expect(chat.processMessage).toHaveBeenCalledTimes(2);
    const [, threadId] = vi.mocked(chat.processMessage).mock.calls[1];
    expect(threadId).toBe("whatsapp:123456789:15551234567");
  });

  it("clears a stale phone route after a user_id_update rotation", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      webhook(
        notification(
          [inbound({ from: "15551234567", from_user_id: "US.OLD" })],
          [
            {
              profile: { name: "User" },
              wa_id: "15551234567",
              user_id: "US.OLD",
            },
          ]
        )
      )
    );
    // No wa_id on the update: the user no longer shares a phone number,
    // so the stored phone route must be dropped.
    await adapter.handleWebhook(
      webhook(
        userIdUpdateNotification([
          {
            detail: "User id for User has been updated.",
            timestamp: "1700000001",
            user_id: { previous: "US.OLD", current: "US.NEW" },
          },
        ])
      )
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.reply" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await adapter.postMessage("whatsapp:123456789:15551234567", {
      markdown: "Reply",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.recipient).toBe("US.NEW");
    expect(body).not.toHaveProperty("to");
    fetchSpy.mockRestore();
  });

  it("preserves a BSUID-keyed thread across a user_id_update rotation", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    // Username-only user: no phone anywhere, thread keyed by the BSUID.
    await adapter.handleWebhook(
      webhook(
        notification(
          [inbound({ from_user_id: "US.OLD" })],
          [
            {
              profile: { name: "User", username: "exampleuser" },
              user_id: "US.OLD",
            },
          ]
        )
      )
    );
    await adapter.handleWebhook(
      webhook(
        userIdUpdateNotification([
          {
            detail: "User id for User has been updated.",
            timestamp: "1700000001",
            user_id: { previous: "US.OLD", current: "US.NEW" },
          },
        ])
      )
    );
    await adapter.handleWebhook(
      webhook(
        notification(
          [inbound({ from_user_id: "US.NEW" })],
          [
            {
              profile: { name: "User", username: "exampleuser" },
              user_id: "US.NEW",
            },
          ]
        )
      )
    );

    expect(chat.processMessage).toHaveBeenCalledTimes(2);
    const [, threadId] = vi.mocked(chat.processMessage).mock.calls[1];
    expect(threadId).toBe("whatsapp:123456789:US.OLD");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.reply" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await adapter.postMessage("whatsapp:123456789:US.OLD", {
      markdown: "Reply",
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.recipient).toBe("US.NEW");
    expect(body).not.toHaveProperty("to");
    fetchSpy.mockRestore();
  });

  it("keeps the pre-change thread when a number change arrives without prior state", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    // System message first — e.g. a fresh deploy over an existing
    // conversation. The old number in `from` must stay canonical.
    await adapter.handleWebhook(
      webhook(
        notification([
          {
            from: "15551234567",
            id: "wamid.system",
            timestamp: "1700000001",
            type: "system",
            system: {
              body: "User A changed from 15551234567 to 15557654321",
              wa_id: "15557654321",
              user_id: "US.NEW",
              type: "user_changed_number",
            },
          },
        ])
      )
    );
    await adapter.handleWebhook(
      webhook(
        notification([inbound({ from: "15557654321", from_user_id: "US.NEW" })])
      )
    );

    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const [, threadId] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(threadId).toBe("whatsapp:123456789:15551234567");
  });

  it("skips redundant identity writes for repeat messages", async () => {
    const adapter = createTestAdapter();
    const state = createMockState();
    const chat = createMockChatInstance({ state });
    await adapter.initialize(chat);
    const setSpy = vi.spyOn(state, "set");

    const contact = {
      profile: { name: "User" },
      wa_id: "15551234567",
      user_id: "US.13491208655302741918",
    };
    const message = {
      from: "15551234567",
      from_user_id: "US.13491208655302741918",
    };

    await adapter.handleWebhook(
      webhook(notification([inbound(message)], [contact]))
    );
    expect(setSpy).toHaveBeenCalled();

    setSpy.mockClear();
    await adapter.handleWebhook(
      webhook(notification([inbound({ ...message, id: "wamid.2" })], [contact]))
    );
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("falls back to the user ID when the profile name is empty", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      webhook(
        notification(
          [inbound({ from: "15551234567" })],
          [{ profile: { name: "" }, wa_id: "15551234567" }]
        )
      )
    );

    const [, , parsed] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(typeof parsed).not.toBe("function");
    if (typeof parsed !== "function") {
      expect(parsed.author.userName).toBe("15551234567");
      expect(parsed.author.fullName).toBe("15551234567");
    }
  });

  it("ignores messages without a phone number or BSUID", async () => {
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      webhook(notification([inbound({})]))
    );

    expect(response.status).toBe(200);
    expect(chat).not.toHaveDispatched("processMessage");
  });
});

// ---------------------------------------------------------------------------
// postMessage
// ---------------------------------------------------------------------------

describe("postMessage", () => {
  let fetchSpy: MockInstance;

  const makeGraphApiResponse = () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.sent123" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(makeGraphApiResponse()));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("plain text calls Graph API with correct payload", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.postMessage("whatsapp:123456789:15551234567", {
      markdown: "Hello there",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/123456789/messages");
    const sent = JSON.parse(init?.body as string);
    expect(sent.type).toBe("text");
    expect(sent.to).toBe("15551234567");
    expect(result.id).toBe("wamid.sent123");
  });

  it.each([
    "US.13491208655302741918",
    "US.ENT.11815799212886844830",
  ])("sends %s threads through recipient without to", async (userId) => {
    const adapter = createTestAdapter();
    await adapter.postMessage(`whatsapp:123456789:${userId}`, {
      markdown: "Hello there",
    });

    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.recipient).toBe(userId);
    expect(sent).not.toHaveProperty("to");
  });

  it("long message splits and sends multiple requests", async () => {
    const adapter = createTestAdapter();
    const longText = "a".repeat(5000);
    await adapter.postMessage("whatsapp:123456789:15551234567", {
      markdown: longText,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("sends interactive messages to BSUID recipients", async () => {
    const adapter = createTestAdapter();
    await adapter.postMessage("whatsapp:123456789:US.13491208655302741918", {
      card: {
        type: "card",
        title: "Choose",
        children: [
          {
            type: "actions",
            children: [{ type: "button", id: "yes", label: "Yes" }],
          },
        ],
      },
    });

    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.type).toBe("interactive");
    expect(sent.recipient).toBe("US.13491208655302741918");
    expect(sent).not.toHaveProperty("to");
  });
});

describe("API errors", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const operations = [
    {
      name: "message sends",
      run: (adapter: WhatsAppAdapter) =>
        adapter.postMessage("whatsapp:123456789:15551234567", "hello"),
    },
    {
      name: "media uploads",
      run: (adapter: WhatsAppAdapter) =>
        adapter.postMessage("whatsapp:123456789:15551234567", {
          files: [
            {
              data: Buffer.from("report"),
              filename: "report.txt",
              mimeType: "text/plain",
            },
          ],
        }),
    },
    {
      name: "media metadata requests",
      run: (adapter: WhatsAppAdapter) => adapter.downloadMedia("media123"),
    },
  ];

  it.each(operations)("preserves Meta error fields for $name", async ({
    run,
  }) => {
    const raw = {
      error: {
        message: "(#130429) Rate limit hit",
        type: "OAuthException",
        code: 130429,
        error_data: {
          messaging_product: "whatsapp",
          details: "Cloud API message throughput has been reached.",
        },
        fbtrace_id: "trace123",
      },
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 400 })
    );

    const result = run(createTestAdapter());
    await expect(result).rejects.toBeInstanceOf(WhatsAppApiError);
    await expect(result).rejects.toMatchObject({
      name: "WhatsAppApiError",
      adapter: "whatsapp",
      code: "RATE_LIMITED",
      errorCode: 130_429,
      status: 400,
      providerMessage: raw.error.message,
      type: "OAuthException",
      details: raw.error.error_data.details,
      traceId: "trace123",
      raw,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it.each(operations)("wraps transport failures for $name", async ({ run }) => {
    const cause = new TypeError("fetch failed");
    fetchSpy.mockRejectedValue(cause);

    const result = run(createTestAdapter());
    await expect(result).rejects.toBeInstanceOf(NetworkError);
    await expect(result).rejects.toMatchObject({
      adapter: "whatsapp",
      code: "NETWORK_ERROR",
      originalError: cause,
    });
  });

  it.each(operations)("wraps non-JSON success bodies for $name", async ({
    run,
  }) => {
    fetchSpy.mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 200 })
    );

    const result = run(createTestAdapter());
    await expect(result).rejects.toBeInstanceOf(NetworkError);
    await expect(result).rejects.toThrow("response was not valid JSON");
  });
});

describe("reply", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [{ id: "wamid.sent123" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("adds contextual reply data to text messages", async () => {
    const adapter = createTestAdapter();

    await adapter.reply("whatsapp:123456789:15551234567", "wamid.original", {
      markdown: "Hello there",
    });

    const [, init] = fetchSpy.mock.calls[0];
    const sent = JSON.parse(init?.body as string);
    expect(sent.context).toEqual({ message_id: "wamid.original" });
  });

  it("adds contextual reply data only to the first split message", async () => {
    const adapter = createTestAdapter();

    await adapter.reply("whatsapp:123456789:15551234567", "wamid.original", {
      markdown: "a".repeat(5000),
    });

    const first = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    const second = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(first.context).toEqual({ message_id: "wamid.original" });
    expect(second).not.toHaveProperty("context");
  });

  it("adds contextual reply data to interactive cards", async () => {
    const adapter = createTestAdapter();

    await adapter.reply("whatsapp:123456789:15551234567", "wamid.original", {
      card: {
        type: "card",
        title: "Approve?",
        children: [
          {
            type: "actions",
            children: [{ type: "button", id: "yes", label: "Yes" }],
          },
        ],
      },
    });

    const [, init] = fetchSpy.mock.calls[0];
    const sent = JSON.parse(init?.body as string);
    expect(sent.type).toBe("interactive");
    expect(sent.context).toEqual({ message_id: "wamid.original" });
  });
});

// ---------------------------------------------------------------------------
// postMessage - file uploads
// ---------------------------------------------------------------------------

describe("postMessage - file uploads", () => {
  const THREAD_ID = "whatsapp:123456789:15551234567";

  let fetchSpy: MockInstance;
  let messageCounter: number;

  function createMediaFetchMock() {
    let mediaCounter = 0;
    messageCounter = 0;

    return (url: string | URL | Request) => {
      const urlStr = String(url);

      if (urlStr.includes("/media")) {
        mediaCounter += 1;

        return Promise.resolve(
          new Response(JSON.stringify({ id: `media-${mediaCounter}` }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      messageCounter += 1;

      return Promise.resolve(
        new Response(
          JSON.stringify({ messages: [{ id: `wamid.msg${messageCounter}` }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    };
  }

  function getMessageCalls(): [unknown, RequestInit | undefined][] {
    return fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/messages")
    ) as [unknown, RequestInit | undefined][];
  }

  function getMediaCalls(): [unknown, RequestInit | undefined][] {
    return fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/media")
    ) as [unknown, RequestInit | undefined][];
  }

  function parseMessageBody(index: number): Record<string, unknown> {
    const [, init] = getMessageCalls()[index] ?? [];
    return JSON.parse(init?.body as string) as Record<string, unknown>;
  }

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(createMediaFetchMock() as never);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("single PDF with markdown caption uploads then sends document", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.postMessage(THREAD_ID, {
      markdown: "Here is the report",
      files: [
        {
          data: Buffer.from("pdf-content"),
          filename: "report.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    expect(getMediaCalls()).toHaveLength(1);
    expect(getMessageCalls()).toHaveLength(1);

    const sent = parseMessageBody(0);
    expect(sent.type).toBe("document");
    expect((sent.document as { id: string }).id).toBe("media-1");
    expect((sent.document as { caption: string }).caption).toBe(
      "Here is the report"
    );
    expect((sent.document as { filename: string }).filename).toBe("report.pdf");
    expect(result.id).toBe("wamid.msg1");
  });

  it("single JPEG maps to image message type", async () => {
    const adapter = createTestAdapter();
    await adapter.postMessage(THREAD_ID, {
      markdown: "Photo",
      files: [
        {
          data: Buffer.from("jpeg"),
          filename: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    const sent = parseMessageBody(0);
    expect(sent.type).toBe("image");
    expect((sent.image as { id: string }).id).toBe("media-1");
  });

  it("sends media to BSUID recipients", async () => {
    const adapter = createTestAdapter();
    await adapter.postMessage("whatsapp:123456789:US.13491208655302741918", {
      files: [
        {
          data: Buffer.from("jpeg"),
          filename: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    const sent = parseMessageBody(0);
    expect(sent.recipient).toBe("US.13491208655302741918");
    expect(sent).not.toHaveProperty("to");
  });

  it("audio with text sends leading text message without audio caption", async () => {
    const adapter = createTestAdapter();
    await adapter.postMessage(THREAD_ID, {
      markdown: "Listen to this",
      files: [
        {
          data: Buffer.from("audio"),
          filename: "clip.mp3",
          mimeType: "audio/mpeg",
        },
      ],
    });

    expect(getMessageCalls()).toHaveLength(2);

    const textMessage = parseMessageBody(0);
    const audioMessage = parseMessageBody(1);

    expect(textMessage.type).toBe("text");
    expect((textMessage.text as { body: string }).body).toBe("Listen to this");
    expect(audioMessage.type).toBe("audio");
    expect(
      (audioMessage.audio as { caption?: string }).caption
    ).toBeUndefined();
  });

  it("long text with image sends text first then image without caption", async () => {
    const adapter = createTestAdapter();
    const longText = "a".repeat(1025);

    await adapter.postMessage(THREAD_ID, {
      markdown: longText,
      files: [
        {
          data: Buffer.from("jpeg"),
          filename: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(getMessageCalls()).toHaveLength(2);

    const textMessage = parseMessageBody(0);
    const imageMessage = parseMessageBody(1);

    expect(textMessage.type).toBe("text");
    expect(imageMessage.type).toBe("image");
    expect(
      (imageMessage.image as { caption?: string }).caption
    ).toBeUndefined();
  });

  it("multiple files send sequentially with caption only on first", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.postMessage(THREAD_ID, {
      markdown: "Two files",
      files: [
        {
          data: Buffer.from("a"),
          filename: "first.pdf",
          mimeType: "application/pdf",
        },
        {
          data: Buffer.from("b"),
          filename: "second.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    expect(getMediaCalls()).toHaveLength(2);
    expect(getMessageCalls()).toHaveLength(2);

    const first = parseMessageBody(0);
    const second = parseMessageBody(1);

    expect((first.document as { caption: string }).caption).toBe("Two files");
    expect((second.document as { caption?: string }).caption).toBeUndefined();
    expect(result.id).toBe("wamid.msg2");
  });

  it("adds reply context only to the first media message", async () => {
    const adapter = createTestAdapter();

    await adapter.reply(THREAD_ID, "wamid.original", {
      markdown: "Two files",
      files: [
        {
          data: Buffer.from("a"),
          filename: "first.pdf",
          mimeType: "application/pdf",
        },
        {
          data: Buffer.from("b"),
          filename: "second.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    const first = parseMessageBody(0);
    const second = parseMessageBody(1);
    expect(first.context).toEqual({ message_id: "wamid.original" });
    expect(second).not.toHaveProperty("context");
  });

  it("attachment with HTTPS url uses link passthrough without upload", async () => {
    const adapter = createTestAdapter();

    await adapter.postMessage(THREAD_ID, {
      markdown: "Remote doc",
      attachments: [
        {
          type: "file",
          url: "https://example.com/report.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    expect(getMediaCalls()).toHaveLength(0);
    expect(getMessageCalls()).toHaveLength(1);

    const sent = parseMessageBody(0);
    expect((sent.document as { link: string }).link).toBe(
      "https://example.com/report.pdf"
    );
    expect((sent.document as { id?: string }).id).toBeUndefined();
  });

  it("attachment with fetchData uploads binary", async () => {
    const adapter = createTestAdapter();
    const fetchData = vi.fn().mockResolvedValue(Buffer.from("png-bytes"));

    await adapter.postMessage(THREAD_ID, {
      markdown: "",
      attachments: [
        {
          type: "image",
          mimeType: "image/png",
          fetchData,
        },
      ],
    });

    expect(fetchData).toHaveBeenCalledOnce();
    expect(getMediaCalls()).toHaveLength(1);

    const sent = parseMessageBody(0);
    expect(sent.type).toBe("image");
    expect((sent.image as { id: string }).id).toBe("media-1");
  });

  it("card with files sends media then interactive message", async () => {
    const adapter = createTestAdapter();
    const card: CardElement = {
      type: "card",
      title: "Approve?",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "yes", label: "Yes" },
            { type: "button", id: "no", label: "No" },
          ],
        },
      ],
    };

    await adapter.postMessage(THREAD_ID, {
      card,
      files: [
        {
          data: Buffer.from("png"),
          filename: "proof.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(getMediaCalls()).toHaveLength(1);
    expect(getMessageCalls()).toHaveLength(2);

    const mediaMessage = parseMessageBody(0);
    const interactiveMessage = parseMessageBody(1);

    expect(mediaMessage.type).toBe("image");
    expect(
      (mediaMessage.image as { caption?: string }).caption
    ).toBeUndefined();
    expect(interactiveMessage.type).toBe("interactive");

    const interactive = interactiveMessage.interactive as {
      header?: { text: string };
      body: { text: string };
      action: { buttons: Array<{ reply: { title: string } }> };
    };
    expect(interactive.header?.text).toBe("Approve?");
    expect(interactive.action.buttons).toHaveLength(2);
  });

  it("interactive card + file does not duplicate title across caption and header", async () => {
    const adapter = createTestAdapter();
    const title = "Demo image card";

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title,
        children: [
          {
            type: "actions",
            children: [{ type: "button", id: "ok", label: "OK" }],
          },
        ],
      },
      files: [
        {
          data: Buffer.from("png"),
          filename: "demo.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(getMessageCalls()).toHaveLength(2);

    const mediaMessage = parseMessageBody(0);
    const interactiveMessage = parseMessageBody(1);
    const caption = (mediaMessage.image as { caption?: string }).caption;
    const header = (
      interactiveMessage.interactive as { header?: { text: string } }
    ).header?.text;

    expect(caption).toBeUndefined();
    expect(header).toBe(title);

    const serialized = JSON.stringify([mediaMessage, interactiveMessage]);
    expect(serialized.split(title).length - 1).toBe(1);
  });

  it("interactive card + file does not duplicate CardText/Fields in caption", async () => {
    const adapter = createTestAdapter();
    const bodyLine = "Your order has shipped";
    const fieldLabel = "Tracking code";
    const fieldValue = "SHIP-UNIQUE-VALUE";

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title: "Shipment",
        subtitle: "Status update",
        children: [
          { type: "text", content: bodyLine },
          {
            type: "fields",
            children: [{ type: "field", label: fieldLabel, value: fieldValue }],
          },
          {
            type: "actions",
            children: [
              { type: "button", id: "track", label: "Track" },
              { type: "button", id: "help", label: "Help" },
            ],
          },
        ],
      },
      files: [
        {
          data: Buffer.from("png"),
          filename: "box.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(getMessageCalls()).toHaveLength(2);

    const mediaMessage = parseMessageBody(0);
    const interactiveMessage = parseMessageBody(1);
    const caption = (mediaMessage.image as { caption?: string }).caption;
    const interactive = interactiveMessage.interactive as {
      header?: { text: string };
      body: { text: string };
    };

    expect(caption).toBeUndefined();
    expect(interactive.header?.text).toBe("Shipment");
    expect(interactive.body.text).toContain("Status update");
    expect(interactive.body.text).toContain(bodyLine);
    expect(interactive.body.text).toContain(`${fieldLabel}: ${fieldValue}`);
  });

  it("interactive card + multiple files leaves all media uncaptioned", async () => {
    const adapter = createTestAdapter();

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title: "Review docs",
        children: [
          {
            type: "actions",
            children: [
              { type: "button", id: "approve", label: "Approve" },
              { type: "button", id: "reject", label: "Reject" },
            ],
          },
        ],
      },
      files: [
        {
          data: Buffer.from("a"),
          filename: "a.pdf",
          mimeType: "application/pdf",
        },
        {
          data: Buffer.from("b"),
          filename: "b.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    expect(getMediaCalls()).toHaveLength(2);
    expect(getMessageCalls()).toHaveLength(3);

    const first = parseMessageBody(0);
    const second = parseMessageBody(1);
    const interactiveMessage = parseMessageBody(2);

    expect(first.type).toBe("document");
    expect(second.type).toBe("document");
    expect((first.document as { caption?: string }).caption).toBeUndefined();
    expect((second.document as { caption?: string }).caption).toBeUndefined();
    expect(interactiveMessage.type).toBe("interactive");
    expect(
      (interactiveMessage.interactive as { header?: { text: string } }).header
        ?.text
    ).toBe("Review docs");
  });

  it("interactive card + audio sends audio then interactive with no leading text", async () => {
    const adapter = createTestAdapter();

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title: "Voice note",
        children: [
          {
            type: "actions",
            children: [{ type: "button", id: "ack", label: "Got it" }],
          },
        ],
      },
      files: [
        {
          data: Buffer.from("audio"),
          filename: "note.mp3",
          mimeType: "audio/mpeg",
        },
      ],
    });

    // Audio cannot take a caption; interactive path also skips card fallback
    // text, so there must be no leading text message with the title.
    expect(getMessageCalls()).toHaveLength(2);

    const audioMessage = parseMessageBody(0);
    const interactiveMessage = parseMessageBody(1);

    expect(audioMessage.type).toBe("audio");
    expect(
      (audioMessage.audio as { caption?: string }).caption
    ).toBeUndefined();
    expect(interactiveMessage.type).toBe("interactive");
    expect(
      (interactiveMessage.interactive as { header?: { text: string } }).header
        ?.text
    ).toBe("Voice note");

    for (const message of [audioMessage, interactiveMessage]) {
      if (message.type === "text") {
        throw new Error("unexpected leading text message for interactive card");
      }
    }
  });

  it("interactive card + HTTPS attachment does not caption with card title", async () => {
    const adapter = createTestAdapter();

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title: "Remote image card",
        children: [
          {
            type: "actions",
            children: [{ type: "button", id: "open", label: "Open" }],
          },
        ],
      },
      attachments: [
        {
          type: "image",
          url: "https://example.com/photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(getMediaCalls()).toHaveLength(0);
    expect(getMessageCalls()).toHaveLength(2);

    const mediaMessage = parseMessageBody(0);
    const interactiveMessage = parseMessageBody(1);

    expect(mediaMessage.type).toBe("image");
    expect(
      (mediaMessage.image as { caption?: string }).caption
    ).toBeUndefined();
    expect((mediaMessage.image as { link: string }).link).toBe(
      "https://example.com/photo.jpg"
    );
    expect(
      (interactiveMessage.interactive as { header?: { text: string } }).header
        ?.text
    ).toBe("Remote image card");
  });

  it("card with single link button and file sends one captioned media message", async () => {
    const adapter = createTestAdapter();
    const card: CardElement = {
      type: "card",
      title: "Order update",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              url: "https://example.com/track",
              label: "Track",
            },
          ],
        },
      ],
    };

    await adapter.postMessage(THREAD_ID, {
      card,
      files: [
        {
          data: Buffer.from("png"),
          filename: "receipt.png",
          mimeType: "image/png",
        },
      ],
    });

    // Media posts keep the pre-existing single captioned send; the
    // caption carries the link URL instead of a second cta_url message.
    expect(getMediaCalls()).toHaveLength(1);
    expect(getMessageCalls()).toHaveLength(1);

    const mediaMessage = parseMessageBody(0);

    expect(mediaMessage.type).toBe("image");
    const caption = (mediaMessage.image as { caption?: string }).caption;
    expect(caption).toContain("Order update");
    expect(caption).toContain("Track: https://example.com/track");
  });

  it("text-fallback card + file puts title and body only in the caption once", async () => {
    const adapter = createTestAdapter();
    const title = "Receipt details";
    const bodyLine = "Thanks for your purchase";

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title,
        children: [
          { type: "text", content: bodyLine },
          {
            type: "actions",
            children: [
              {
                type: "link-button",
                url: "https://example.com/receipt",
                label: "View",
              },
              {
                type: "link-button",
                url: "https://example.com/help",
                label: "Help",
              },
            ],
          },
        ],
      },
      files: [
        {
          data: Buffer.from("png"),
          filename: "receipt.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(getMessageCalls()).toHaveLength(1);

    const mediaMessage = parseMessageBody(0);
    const caption = (mediaMessage.image as { caption: string }).caption;

    expect(caption).toContain(title);
    expect(caption).toContain(bodyLine);
    expect(caption.split(title).length - 1).toBe(1);
    expect(caption.split(bodyLine).length - 1).toBe(1);
    expect(caption).toContain("View: https://example.com/receipt");
    expect(caption).toContain("Help: https://example.com/help");
  });

  it("single link-button card posts CTA URL interactive payload", async () => {
    const adapter = createTestAdapter();

    await adapter.postMessage(THREAD_ID, {
      card: {
        type: "card",
        title: "See dates",
        children: [
          {
            type: "text",
            content: "Tap the button below to see available dates.",
          },
          {
            type: "actions",
            children: [
              {
                type: "link-button",
                url: "https://example.com/dates",
                label: "See Dates",
              },
            ],
          },
        ],
      },
    });

    expect(getMessageCalls()).toHaveLength(1);
    const message = parseMessageBody(0);
    expect(message.type).toBe("interactive");

    const interactive = message.interactive as {
      type: string;
      header?: { type: string; text: string };
      body: { text: string };
      action: {
        name: string;
        parameters: { display_text: string; url: string };
      };
    };

    expect(interactive.type).toBe("cta_url");
    expect(interactive.header).toEqual({ type: "text", text: "See dates" });
    expect(interactive.body.text).toContain(
      "Tap the button below to see available dates."
    );
    expect(interactive.action).toEqual({
      name: "cta_url",
      parameters: {
        display_text: "See Dates",
        url: "https://example.com/dates",
      },
    });
  });

  it("oversize image throws ValidationError before upload", async () => {
    const adapter = createTestAdapter();
    const oversized = Buffer.alloc(6 * 1024 * 1024);

    await expect(
      adapter.postMessage(THREAD_ID, {
        markdown: "",
        files: [
          {
            data: oversized,
            filename: "huge.png",
            mimeType: "image/png",
          },
        ],
      })
    ).rejects.toThrow(WHATSAPP_IMAGE_SIZE_LIMIT_PATTERN);

    expect(getMediaCalls()).toHaveLength(0);
    expect(getMessageCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sendTemplate
// ---------------------------------------------------------------------------

describe("sendTemplate", () => {
  let fetchSpy: MockInstance;

  const makeGraphApiResponse = () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.template123" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(makeGraphApiResponse()));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends a template with name and language", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.sendTemplate(
      "whatsapp:123456789:15551234567",
      {
        name: "appointment_reminder",
        language: "en",
      }
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/123456789/messages");
    const sent = JSON.parse(init?.body as string);
    expect(sent.type).toBe("template");
    expect(sent.to).toBe("15551234567");
    expect(sent.template).toEqual({
      name: "appointment_reminder",
      language: { code: "en" },
    });
    expect(result.id).toBe("wamid.template123");
  });

  it("includes components when provided", async () => {
    const adapter = createTestAdapter();
    await adapter.sendTemplate("whatsapp:123456789:15551234567", {
      name: "order_shipped",
      language: "en_US",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ada" },
            { type: "text", text: "#12345" },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: 0,
          parameters: [{ type: "text", text: "12345" }],
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.template.name).toBe("order_shipped");
    expect(sent.template.language).toEqual({ code: "en_US" });
    expect(sent.template.components).toHaveLength(2);
    expect(sent.template.components[0].parameters[0].text).toBe("Ada");
  });

  it("sends templates to BSUID recipients", async () => {
    const adapter = createTestAdapter();
    await adapter.sendTemplate("whatsapp:123456789:US.13491208655302741918", {
      name: "order_shipped",
      language: "en_US",
    });

    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.recipient).toBe("US.13491208655302741918");
    expect(sent).not.toHaveProperty("to");
  });

  it("converts emoji placeholders in text parameters", async () => {
    const adapter = createTestAdapter();
    await adapter.sendTemplate("whatsapp:123456789:15551234567", {
      name: "order_shipped",
      language: "en_US",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: "Shipped! {{emoji:thumbs_up}}" }],
        },
      ],
    });

    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.template.components[0].parameters[0].text).toBe("Shipped! 👍");
  });

  it("does not emoji-convert quick reply payloads", async () => {
    const adapter = createTestAdapter();
    await adapter.sendTemplate("whatsapp:123456789:15551234567", {
      name: "order_shipped",
      language: "en_US",
      components: [
        {
          type: "button",
          sub_type: "quick_reply",
          index: 0,
          parameters: [{ type: "payload", payload: "{{emoji:thumbs_up}}:1" }],
        },
      ],
    });

    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.template.components[0].parameters[0].payload).toBe(
      "{{emoji:thumbs_up}}:1"
    );
  });

  it("omits components when the array is empty", async () => {
    const adapter = createTestAdapter();
    await adapter.sendTemplate("whatsapp:123456789:15551234567", {
      name: "hello_world",
      language: "en_US",
      components: [],
    });

    const sent = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sent.template).not.toHaveProperty("components");
  });

  it("throws when the API returns no message ID", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const adapter = createTestAdapter();
    await expect(
      adapter.sendTemplate("whatsapp:123456789:15551234567", {
        name: "hello_world",
        language: "en_US",
      })
    ).rejects.toThrow(NO_MESSAGE_ID_PATTERN);
  });

  it("throws on invalid thread ID", async () => {
    const adapter = createTestAdapter();
    await expect(
      adapter.sendTemplate("slack:C123:ts123", {
        name: "hello_world",
        language: "en_US",
      })
    ).rejects.toThrow("Invalid WhatsApp thread ID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("getWhatsAppMediaType", () => {
  it.each([
    ["image/png", "image"],
    ["image/jpeg", "image"],
    ["image/gif", "document"],
    ["video/mp4", "video"],
    ["video/3gpp", "video"],
    ["audio/mpeg", "audio"],
    ["application/pdf", "document"],
  ] as const)("maps %s to %s", (mimeType, expected) => {
    expect(getWhatsAppMediaType(mimeType)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// editMessage
// ---------------------------------------------------------------------------

describe("editMessage", () => {
  it("throws 'not supported' error", async () => {
    const adapter = createTestAdapter();
    await expect(
      adapter.editMessage("whatsapp:123456789:15551234567", "wamid.xxx", {
        text: "Updated",
      })
    ).rejects.toThrow(NOT_SUPPORTED_PATTERN);
  });
});

// ---------------------------------------------------------------------------
// deleteMessage
// ---------------------------------------------------------------------------

describe("deleteMessage", () => {
  it("throws 'not supported' error", async () => {
    const adapter = createTestAdapter();
    await expect(
      adapter.deleteMessage("whatsapp:123456789:15551234567", "wamid.xxx")
    ).rejects.toThrow(NOT_SUPPORTED_PATTERN);
  });
});

// ---------------------------------------------------------------------------
// addReaction / removeReaction
// ---------------------------------------------------------------------------

describe("addReaction / removeReaction", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("addReaction sends reaction with the given emoji", async () => {
    const adapter = createTestAdapter();
    await adapter.addReaction(
      "whatsapp:123456789:15551234567",
      "wamid.msg1",
      "👍"
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.type).toBe("reaction");
    expect(body.reaction.message_id).toBe("wamid.msg1");
    expect(body.reaction.emoji).toBeTruthy();
  });

  it("removeReaction sends reaction with empty emoji", async () => {
    const adapter = createTestAdapter();
    await adapter.removeReaction(
      "whatsapp:123456789:US.13491208655302741918",
      "wamid.msg1",
      "👍"
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.type).toBe("reaction");
    expect(body.reaction.emoji).toBe("");
    expect(body.recipient).toBe("US.13491208655302741918");
    expect(body).not.toHaveProperty("to");
  });
});

describe("markAsRead", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("marks an inbound message as read", async () => {
    const adapter = createTestAdapter();

    await adapter.markAsRead("whatsapp:123456789:15551234567", "wamid.inbound");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/123456789/messages");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.inbound",
    });
  });

  it("preserves the adapter-level message id signature", async () => {
    const adapter = createTestAdapter();

    await adapter.markAsRead("wamid.inbound");

    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.inbound",
    });
  });

  it("rejects an unsuccessful API response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const adapter = createTestAdapter();

    await expect(adapter.markAsRead("wamid.inbound")).rejects.toThrow(
      "WhatsApp mark as read failed"
    );
  });
});

// ---------------------------------------------------------------------------
// startTyping
// ---------------------------------------------------------------------------

describe("startTyping", () => {
  let fetchSpy: MockInstance;

  const makeGraphApiResponse = () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(makeGraphApiResponse()));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("resolves latest inbound message ID and sends typing indicator", async () => {
    const adapter = createTestAdapter();
    const threadId = "whatsapp:123456789:15551234567";

    // Mock history: 1 inbound message, 1 outbound (bot) message
    const mockState = {
      getList: vi.fn().mockResolvedValue([
        {
          _type: "chat:Message",
          id: "wamid.inbound123",
          threadId,
          text: "Hi",
          author: {
            userId: "15551234567",
            userName: "User",
            fullName: "User",
            isMe: false,
            isBot: false,
          },
          formatted: { type: "root", children: [] },
          attachments: [],
          metadata: { dateSent: new Date().toISOString(), edited: false },
        },
        {
          _type: "chat:Message",
          id: "wamid.outbound456",
          threadId,
          text: "Hello",
          author: {
            userId: "123456789",
            userName: "bot",
            fullName: "bot",
            isMe: true,
            isBot: true,
          },
          formatted: { type: "root", children: [] },
          attachments: [],
          metadata: { dateSent: new Date().toISOString(), edited: false },
        },
      ]),
    };

    await adapter.initialize({
      ...mockChat,
      getState: () => mockState,
    } as any);

    await adapter.startTyping(threadId);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/123456789/messages");
    const sent = JSON.parse(init?.body as string);
    expect(sent.status).toBe("read");
    expect(sent.message_id).toBe("wamid.inbound123");
    expect(sent.typing_indicator.type).toBe("text");
  });

  it("does nothing if no inbound message is found in history", async () => {
    const adapter = createTestAdapter();
    const threadId = "whatsapp:123456789:15551234567";

    const mockState = {
      getList: vi.fn().mockResolvedValue([]),
    };

    await adapter.initialize({
      ...mockChat,
      getState: () => mockState,
    } as any);

    await adapter.startTyping(threadId);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchMessages
// ---------------------------------------------------------------------------

describe("fetchMessages", () => {
  it("returns empty messages array", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.fetchMessages(
      "whatsapp:123456789:15551234567"
    );
    expect(result).toEqual({ messages: [] });
  });
});

// ---------------------------------------------------------------------------
// fetchThread
// ---------------------------------------------------------------------------

describe("fetchThread", () => {
  it("returns correct ThreadInfo", async () => {
    const adapter = createTestAdapter();
    const info = await adapter.fetchThread("whatsapp:123456789:15551234567");
    expect(info.id).toBe("whatsapp:123456789:15551234567");
    expect(info.channelId).toBe("whatsapp:123456789");
    expect(info.isDM).toBe(true);
    expect(info.metadata).toEqual({
      phoneNumberId: "123456789",
      userWaId: "15551234567",
    });
  });
});

// ---------------------------------------------------------------------------
// openDM
// ---------------------------------------------------------------------------

describe("openDM", () => {
  it("returns encoded thread ID for the given user", async () => {
    const adapter = createTestAdapter();
    const threadId = await adapter.openDM("15551234567");
    expect(threadId).toBe("whatsapp:123456789:15551234567");
  });
});

// ---------------------------------------------------------------------------
// stream
// ---------------------------------------------------------------------------

describe("stream", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ messages: [{ id: "wamid.streamed" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("buffers async iterable chunks and sends as a single message", async () => {
    const adapter = createTestAdapter();

    async function* chunks() {
      yield "Hello";
      yield " ";
      yield "world";
    }

    const result = await adapter.stream(
      "whatsapp:123456789:15551234567",
      chunks()
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.text.body).toBe("Hello world");
    expect(result.id).toBe("wamid.streamed");
  });
});

// ---------------------------------------------------------------------------
// createWhatsAppAdapter factory
// ---------------------------------------------------------------------------

describe("createWhatsAppAdapter", () => {
  const requiredEnvVars = {
    WHATSAPP_ACCESS_TOKEN: "env-token",
    WHATSAPP_APP_SECRET: "env-secret",
    WHATSAPP_PHONE_NUMBER_ID: "env-phone-id",
    WHATSAPP_VERIFY_TOKEN: "env-verify",
  };

  it("throws when accessToken is missing", () => {
    expect(() =>
      createWhatsAppAdapter({
        appSecret: "secret",
        phoneNumberId: "123",
        verifyToken: "verify",
      })
    ).toThrow(ACCESS_TOKEN_PATTERN);
  });

  it("throws when appSecret is missing", () => {
    expect(() =>
      createWhatsAppAdapter({
        accessToken: "token",
        phoneNumberId: "123",
        verifyToken: "verify",
      })
    ).toThrow(APP_SECRET_PATTERN);
  });

  it("uses environment variables as fallback", () => {
    const originalEnv = { ...process.env };
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      process.env[key] = value;
    }

    try {
      const adapter = createWhatsAppAdapter();
      expect(adapter).toBeInstanceOf(WhatsAppAdapter);
    } finally {
      for (const key of Object.keys(requiredEnvVars)) {
        if (key in originalEnv) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      }
    }
  });

  it("uses apiUrl config to override base URL", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      appSecret: "test-secret",
      phoneNumberId: "123456789",
      verifyToken: "test-verify-token",
      userName: "test-bot",
      apiUrl: "https://custom-graph.example.com",
      logger: createMockLogger(),
    });
    expect((adapter as unknown as { graphApiUrl: string }).graphApiUrl).toBe(
      "https://custom-graph.example.com/v25.0"
    );
  });

  it("uses WHATSAPP_API_URL env var via factory", () => {
    const originalEnv = { ...process.env };
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      process.env[key] = value;
    }
    process.env.WHATSAPP_API_URL = "https://custom-graph.example.com";

    try {
      const adapter = createWhatsAppAdapter();
      expect((adapter as unknown as { graphApiUrl: string }).graphApiUrl).toBe(
        "https://custom-graph.example.com/v25.0"
      );
    } finally {
      for (const key of [...Object.keys(requiredEnvVars), "WHATSAPP_API_URL"]) {
        if (key in originalEnv) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      }
    }
  });

  it("uses apiUrl with custom apiVersion", () => {
    const adapter = new WhatsAppAdapter({
      accessToken: "test-token",
      appSecret: "test-secret",
      phoneNumberId: "123456789",
      verifyToken: "test-verify-token",
      userName: "test-bot",
      apiUrl: "https://custom-graph.example.com",
      apiVersion: "v19.0",
      logger: createMockLogger(),
    });
    expect((adapter as unknown as { graphApiUrl: string }).graphApiUrl).toBe(
      "https://custom-graph.example.com/v19.0"
    );
  });
});

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends WhatsAppAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.verifySignature,
        ] as const;
      }

      checkMethods(message: WhatsAppInboundMessage) {
        return [
          () => this.handleInboundMessage(message, undefined, "123"),
          () => this.handleReaction(message, undefined, "123"),
          () => this.handleInteractiveReply(message, undefined, "123"),
          () => this.handleButtonResponse(message, undefined, "123"),
          () => this.buildMessage(message, undefined, "thread", "text", "123"),
        ];
      }
    }
    expect(TestSubclass.prototype.checkAccess).toBeInstanceOf(Function);
    expect(TestSubclass.prototype.checkMethods).toBeInstanceOf(Function);
  });
});
