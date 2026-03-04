import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { NotImplementedError } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeWhatsAppCallbackData } from "./cards";
import {
  createWhatsAppAdapter,
  WhatsAppAdapter,
  type WhatsAppIncomingMessage,
} from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function whatsappOk(result: unknown = {}): Response {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function whatsappError(
  status: number,
  errorCode: number,
  message: string
): Response {
  return new Response(
    JSON.stringify({
      error: { code: errorCode, message },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

function createMockChat(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("bot"),
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

function sampleIncomingMessage(
  overrides?: Partial<WhatsAppIncomingMessage>
): WhatsAppIncomingMessage {
  return {
    id: "wamid.123",
    from: "15551234567",
    timestamp: "1735689600",
    type: "text",
    text: { body: "hello" },
    ...overrides,
  };
}

function webhookPayload(
  messages: WhatsAppIncomingMessage[],
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15559876543",
                phone_number_id: "PHONE_ID",
              },
              contacts: contacts ?? [
                {
                  profile: { name: "Test User" },
                  wa_id: "15551234567",
                },
              ],
              messages,
            },
          },
        ],
      },
    ],
  };
}

function createAdapter(
  overrides?: Partial<{
    accessToken: string;
    phoneNumberId: string;
    verifyToken: string;
    appSecret: string;
  }>
): WhatsAppAdapter {
  return new WhatsAppAdapter({
    accessToken: overrides?.accessToken ?? "test-token",
    phoneNumberId: overrides?.phoneNumberId ?? "PHONE_ID",
    verifyToken: overrides?.verifyToken ?? "my-verify-token",
    appSecret: overrides?.appSecret,
    logger: mockLogger,
  });
}

describe("createWhatsAppAdapter", () => {
  it("throws when accessToken is missing", () => {
    expect(() => createWhatsAppAdapter({})).toThrow(ValidationError);
  });

  it("throws when phoneNumberId is missing", () => {
    expect(() => createWhatsAppAdapter({ accessToken: "token" })).toThrow(
      ValidationError
    );
  });

  it("creates adapter from env vars", () => {
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;

    process.env.WHATSAPP_ACCESS_TOKEN = "env-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "env-phone";

    try {
      const adapter = createWhatsAppAdapter();
      expect(adapter).toBeInstanceOf(WhatsAppAdapter);
      expect(adapter.name).toBe("whatsapp");
    } finally {
      if (originalToken) {
        process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
      } else {
        Reflect.deleteProperty(process.env, "WHATSAPP_ACCESS_TOKEN");
      }
      if (originalPhone) {
        process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
      } else {
        Reflect.deleteProperty(process.env, "WHATSAPP_PHONE_NUMBER_ID");
      }
    }
  });
});

describe("WhatsAppAdapter", () => {
  it("encodes and decodes thread IDs", () => {
    const adapter = createAdapter();
    const threadId = adapter.encodeThreadId({
      phoneNumberId: "PHONE_ID",
      userPhoneNumber: "15551234567",
    });

    expect(threadId).toBe("whatsapp:PHONE_ID:15551234567");

    const decoded = adapter.decodeThreadId(threadId);
    expect(decoded.phoneNumberId).toBe("PHONE_ID");
    expect(decoded.userPhoneNumber).toBe("15551234567");
  });

  it("throws on invalid thread IDs", () => {
    const adapter = createAdapter();

    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("whatsapp:only")).toThrow(
      ValidationError
    );
    expect(() => adapter.decodeThreadId("whatsapp:a:b:c")).toThrow(
      ValidationError
    );
  });

  it("handles webhook verification GET request", async () => {
    const adapter = createAdapter({ verifyToken: "my-secret" });
    await adapter.initialize(createMockChat());

    const url =
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=my-secret&hub.challenge=challenge_123";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toBe("challenge_123");
  });

  it("rejects webhook verification with wrong token", async () => {
    const adapter = createAdapter({ verifyToken: "my-secret" });
    await adapter.initialize(createMockChat());

    const url =
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge_123";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(403);
  });

  it("processes incoming text messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const payload = webhookPayload([sampleIncomingMessage()]);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, message] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string },
    ];
    expect(threadId).toBe("whatsapp:PHONE_ID:15551234567");
    expect(message.text).toBe("hello");
  });

  it("processes incoming image messages with caption", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const payload = webhookPayload([
      sampleIncomingMessage({
        type: "image",
        text: undefined,
        image: {
          id: "img_123",
          mime_type: "image/jpeg",
          caption: "A photo",
        },
      }),
    ]);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, , message] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string; attachments: Array<{ type: string }> },
    ];
    expect(message.text).toBe("A photo");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.type).toBe("image");
  });

  it("processes incoming reaction messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const payload = webhookPayload([
      sampleIncomingMessage({
        type: "reaction",
        text: undefined,
        reaction: {
          message_id: "wamid.original",
          emoji: "\ud83d\udc4d",
        },
      }),
    ]);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processReaction = chat.processReaction as ReturnType<typeof vi.fn>;
    expect(processReaction).toHaveBeenCalledTimes(1);

    const [event] = processReaction.mock.calls[0] as [
      { added: boolean; rawEmoji: string },
    ];
    expect(event.added).toBe(true);
    expect(event.rawEmoji).toBe("\ud83d\udc4d");
  });

  it("processes interactive button reply as action", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();
    await adapter.initialize(chat);

    const callbackData = encodeWhatsAppCallbackData("approve", "request-123");
    const payload = webhookPayload([
      sampleIncomingMessage({
        type: "interactive",
        text: undefined,
        interactive: {
          type: "button_reply",
          button_reply: {
            id: callbackData,
            title: "Approve",
          },
        },
      }),
    ]);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processAction = chat.processAction as ReturnType<typeof vi.fn>;
    expect(processAction).toHaveBeenCalledTimes(1);

    const [event] = processAction.mock.calls[0] as [
      { actionId: string; value?: string },
    ];
    expect(event.actionId).toBe("approve");
    expect(event.value).toBe("request-123");
  });

  it("posts text messages", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      whatsappOk({ messages: [{ id: "wamid.sent_1" }] })
    );

    const result = await adapter.postMessage("whatsapp:PHONE_ID:15551234567", {
      markdown: "hello",
    });

    expect(result.id).toBe("wamid.sent_1");
    expect(result.threadId).toBe("whatsapp:PHONE_ID:15551234567");

    const sentBody = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { to: string; type: string; text: { body: string } };

    expect(sentBody.to).toBe("15551234567");
    expect(sentBody.type).toBe("text");
    expect(sentBody.text.body).toBe("hello");
  });

  it("posts card messages as interactive buttons", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      whatsappOk({ messages: [{ id: "wamid.sent_2" }] })
    );

    await adapter.postMessage("whatsapp:PHONE_ID:15551234567", {
      type: "card",
      title: "Approval needed",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              value: "req-1",
            },
            {
              type: "button",
              id: "reject",
              label: "Reject",
              value: "req-1",
            },
          ],
        },
      ],
    });

    const sentBody = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { type: string; interactive: { type: string } };

    expect(sentBody.type).toBe("interactive");
    expect(sentBody.interactive.type).toBe("button");
  });

  it("adds and removes reactions", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    mockFetch
      .mockResolvedValueOnce(
        whatsappOk({ messages: [{ id: "wamid.reaction_1" }] })
      )
      .mockResolvedValueOnce(
        whatsappOk({ messages: [{ id: "wamid.reaction_2" }] })
      );

    await adapter.addReaction(
      "whatsapp:PHONE_ID:15551234567",
      "wamid.original",
      "\ud83d\udc4d"
    );
    await adapter.removeReaction(
      "whatsapp:PHONE_ID:15551234567",
      "wamid.original",
      "\ud83d\udc4d"
    );

    const addBody = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { type: string; reaction: { emoji: string } };
    const removeBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as { type: string; reaction: { emoji: string } };

    expect(addBody.type).toBe("reaction");
    expect(addBody.reaction.emoji).toBe("\ud83d\udc4d");
    expect(removeBody.type).toBe("reaction");
    expect(removeBody.reaction.emoji).toBe("");
  });

  it("throws NotImplementedError for editMessage", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    await expect(
      adapter.editMessage("whatsapp:PHONE_ID:15551234567", "msg1", "updated")
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("throws NotImplementedError for deleteMessage", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    await expect(
      adapter.deleteMessage("whatsapp:PHONE_ID:15551234567", "msg1")
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("startTyping is a no-op", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    // Should not throw or make any fetch calls
    await adapter.startTyping("whatsapp:PHONE_ID:15551234567");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("isDM always returns true", () => {
    const adapter = createAdapter();
    expect(adapter.isDM("whatsapp:PHONE_ID:15551234567")).toBe(true);
  });

  it("openDM constructs thread ID from phone number", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    const threadId = await adapter.openDM("15559876543");
    expect(threadId).toBe("whatsapp:PHONE_ID:15559876543");
  });

  it("paginates cached messages", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    adapter.parseMessage(sampleIncomingMessage({ id: "m1", timestamp: "1" }));
    adapter.parseMessage(sampleIncomingMessage({ id: "m2", timestamp: "2" }));
    adapter.parseMessage(sampleIncomingMessage({ id: "m3", timestamp: "3" }));

    const backward = await adapter.fetchMessages(
      "whatsapp:PHONE_ID:15551234567",
      { limit: 2, direction: "backward" }
    );

    expect(backward.messages.map((m) => m.text)).toEqual(["hello", "hello"]);
    expect(backward.messages).toHaveLength(2);
    expect(backward.nextCursor).toBe("m2");

    const forward = await adapter.fetchMessages(
      "whatsapp:PHONE_ID:15551234567",
      { limit: 2, direction: "forward" }
    );

    expect(forward.messages).toHaveLength(2);
    expect(forward.nextCursor).toBe("m2");
  });

  it("maps WhatsApp API errors to adapter-specific error types", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      whatsappError(401, 190, "Invalid OAuth access token")
    );
    await expect(
      adapter.postMessage("whatsapp:PHONE_ID:15551234567", "test")
    ).rejects.toBeInstanceOf(AuthenticationError);

    mockFetch.mockResolvedValueOnce(whatsappError(429, 80007, "Rate limited"));
    await expect(
      adapter.postMessage("whatsapp:PHONE_ID:15551234567", "test")
    ).rejects.toBeInstanceOf(AdapterRateLimitError);

    mockFetch.mockResolvedValueOnce(
      whatsappError(403, 10, "Permission denied")
    );
    await expect(
      adapter.postMessage("whatsapp:PHONE_ID:15551234567", "test")
    ).rejects.toBeInstanceOf(PermissionError);

    mockFetch.mockResolvedValueOnce(whatsappError(400, 400, "Bad request"));
    await expect(
      adapter.postMessage("whatsapp:PHONE_ID:15551234567", "test")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NetworkError when API returns non-JSON response", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    mockFetch.mockResolvedValueOnce(
      new Response("<html>oops</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      })
    );

    await expect(
      adapter.postMessage("whatsapp:PHONE_ID:15551234567", "test")
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("fetches thread metadata", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createMockChat());

    const thread = await adapter.fetchThread("whatsapp:PHONE_ID:15551234567");
    expect(thread.channelId).toBe("PHONE_ID");
    expect(thread.channelName).toBe("15551234567");
    expect(thread.isDM).toBe(true);
  });

  it("rejects webhook with missing signature when appSecret is set", async () => {
    const adapter = createAdapter({ appSecret: "test-secret" });
    await adapter.initialize(createMockChat());

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookPayload([sampleIncomingMessage()])),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });
});
