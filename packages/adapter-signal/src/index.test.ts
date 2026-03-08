import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger, StateAdapter } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSignalAdapter,
  SignalAdapter,
  type SignalEnvelope,
  type SignalUpdate,
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

function signalOk(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signalEmpty(status = 204): Response {
  return new Response(null, { status });
}

function signalError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMockState(): StateAdapter {
  const cache = new Map<string, unknown>();

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi.fn().mockResolvedValue(null),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(false),
    get: vi.fn(async (key: string) => (cache.get(key) ?? null) as unknown),
    set: vi.fn(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      cache.delete(key);
    }),
  };
}

function createMockChat(state: StateAdapter = createMockState()): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn().mockReturnValue(state),
    getUserName: vi.fn().mockReturnValue("mybot"),
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

function queueSuccessfulHealthCheck(phoneNumber: string): void {
  mockFetch
    .mockResolvedValueOnce(signalOk({ status: "ok" }))
    .mockResolvedValueOnce(signalOk([phoneNumber]));
}

async function initializeAdapter(
  adapter: SignalAdapter,
  chat: ChatInstance,
  phoneNumber = "+10000000000"
): Promise<void> {
  queueSuccessfulHealthCheck(phoneNumber);
  await adapter.initialize(chat);
}

function buildUpdate(envelopeOverrides: Partial<SignalEnvelope>): SignalUpdate {
  return {
    account: "+10000000000",
    envelope: {
      source: "d77d6cbf-4a80-4f7e-a8ad-c53fdbf36f4d",
      sourceNumber: "+15551234567",
      sourceUuid: "d77d6cbf-4a80-4f7e-a8ad-c53fdbf36f4d",
      sourceName: "Alice",
      timestamp: 1_735_689_600_000,
      ...envelopeOverrides,
    },
  };
}

describe("createSignalAdapter", () => {
  it("throws when phone number is missing", () => {
    process.env.SIGNAL_PHONE_NUMBER = "";

    expect(() => createSignalAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );
  });

  it("uses env var config when explicit config is omitted", () => {
    process.env.SIGNAL_PHONE_NUMBER = "+19998887777";

    const adapter = createSignalAdapter({ logger: mockLogger });

    expect(adapter).toBeInstanceOf(SignalAdapter);
    expect(adapter.name).toBe("signal");
  });
});

describe("SignalAdapter", () => {
  it("encodes and decodes thread IDs", () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    expect(adapter.encodeThreadId({ chatId: "+15551234567" })).toBe(
      "signal:+15551234567"
    );
    expect(adapter.encodeThreadId({ chatId: "group.c29tZS1ncm91cA==" })).toBe(
      "signal:group.c29tZS1ncm91cA=="
    );

    expect(adapter.decodeThreadId("signal:+15551234567")).toEqual({
      chatId: "+15551234567",
    });
  });

  it("fails initialization when Signal service health check fails", async () => {
    mockFetch.mockResolvedValueOnce(signalError(503, "Service unavailable"));

    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await expect(adapter.initialize(createMockChat())).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it("fails initialization when configured account is not linked", async () => {
    mockFetch
      .mockResolvedValueOnce(signalOk({ status: "ok" }))
      .mockResolvedValueOnce(signalOk(["+19998887777"]));

    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await expect(adapter.initialize(createMockChat())).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("rejects webhook requests with an invalid secret", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      webhookSecret: "expected",
      logger: mockLogger,
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signal-webhook-secret": "wrong",
      },
      body: JSON.stringify(buildUpdate({})),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("processes incoming data messages and marks mentions", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_100,
            message: "Hello there",
            mentions: [
              {
                author: "+10000000000",
                start: 0,
                length: 5,
              },
            ],
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string; isMention?: boolean },
    ];

    expect(threadId).toBe("signal:+15551234567");
    expect(parsedMessage.text).toBe("Hello there");
    expect(parsedMessage.isMention).toBe(true);
  });

  it("normalizes incoming group IDs without base64 guessing heuristics", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_150,
            message: "Group hello",
            groupInfo: {
              groupId: "test",
              type: "DELIVER",
            },
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId] = processMessage.mock.calls[0] as [unknown, string];
    expect(threadId).toBe("signal:group.dGVzdA==");
  });

  it("processes incoming edit messages through processMessage", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildUpdate({
          editMessage: {
            targetSentTimestamp: 1_735_689_600_100,
            dataMessage: {
              timestamp: 1_735_689_600_300,
              message: "Edited text",
            },
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string; metadata: { edited: boolean } },
    ];

    expect(parsedMessage.text).toBe("Edited text");
    expect(parsedMessage.metadata.edited).toBe(true);
  });

  it("keeps edit message IDs stable when identifier aliases change", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const originalMessageRequest = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildUpdate({
          source: "uuid-user-1",
          sourceNumber: null,
          sourceUuid: "uuid-user-1",
          dataMessage: {
            timestamp: 1_735_689_600_500,
            message: "Original",
          },
        })
      ),
    });

    await adapter.handleWebhook(originalMessageRequest);

    const editRequest = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildUpdate({
          source: "uuid-user-1",
          sourceNumber: "+15550001111",
          sourceUuid: "uuid-user-1",
          editMessage: {
            targetSentTimestamp: 1_735_689_600_500,
            dataMessage: {
              timestamp: 1_735_689_600_700,
              message: "Edited",
            },
          },
        })
      ),
    });

    await adapter.handleWebhook(editRequest);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(2);

    const [, , originalMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { id: string },
    ];

    const [, , editedMessage] = processMessage.mock.calls[1] as [
      unknown,
      string,
      { id: string; metadata: { edited: boolean } },
    ];

    expect(editedMessage.id).toBe(originalMessage.id);
    expect(editedMessage.metadata.edited).toBe(true);
  });

  it("processes JSON-RPC receive wrapper payloads and emits reactions", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "receive",
        params: buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_200,
            reaction: {
              emoji: "🔥",
              targetAuthor: "+19995551212",
              targetSentTimestamp: 42,
              isRemove: false,
            },
          },
        }),
      }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processReaction = chat.processReaction as ReturnType<typeof vi.fn>;
    expect(processReaction).toHaveBeenCalledTimes(1);

    const [event] = processReaction.mock.calls[0] as [
      { messageId: string; rawEmoji: string; added: boolean },
    ];

    expect(event.messageId).toBe("+19995551212|42");
    expect(event.rawEmoji).toBe("🔥");
    expect(event.added).toBe(true);
  });

  it("processes sync sent messages from linked devices through processMessage", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildUpdate({
          source: "bot-uuid",
          sourceNumber: "+10000000000",
          sourceUuid: "bot-uuid",
          sourceName: "Bot",
          sourceDevice: 2,
          syncMessage: {
            sentMessage: {
              timestamp: 1_735_689_600_800,
              destination: "+15551234567",
              message: "sent from linked device",
            },
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string; author: { isMe: boolean } },
    ];

    expect(threadId).toBe("signal:+15551234567");
    expect(parsedMessage.text).toBe("sent from linked device");
    expect(parsedMessage.author.isMe).toBe(false);
  });

  it("polls /v1/receive and dispatches incoming updates", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(
      signalOk([
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_400,
            message: "polled update",
          },
        }),
      ])
    );

    const processed = await adapter.pollOnce();

    expect(processed).toBe(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "/v1/receive/%2B10000000000"
    );

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);
  });

  it("posts, edits, deletes, reacts, and sends typing indicators", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch
      .mockResolvedValueOnce(signalOk({ timestamp: "1001" }, 201))
      .mockResolvedValueOnce(signalOk({ timestamp: "1002" }, 201))
      .mockResolvedValueOnce(signalOk({ timestamp: "1001" }, 201))
      .mockResolvedValueOnce(signalEmpty(204))
      .mockResolvedValueOnce(signalEmpty(204))
      .mockResolvedValueOnce(signalEmpty(204));

    const posted = await adapter.postMessage("signal:+15551234567", "hello");
    expect(posted.id).toBe("+10000000000|1001");

    await adapter.editMessage("signal:+15551234567", posted.id, "updated");
    await adapter.deleteMessage("signal:+15551234567", posted.id);
    await adapter.addReaction("signal:+15551234567", posted.id, "thumbs_up");
    await adapter.removeReaction("signal:+15551234567", posted.id, "thumbs_up");
    await adapter.startTyping("signal:+15551234567");

    const postUrl = String(mockFetch.mock.calls[0]?.[0]);
    const editUrl = String(mockFetch.mock.calls[1]?.[0]);
    const deleteUrl = String(mockFetch.mock.calls[2]?.[0]);
    const addReactionUrl = String(mockFetch.mock.calls[3]?.[0]);
    const removeReactionUrl = String(mockFetch.mock.calls[4]?.[0]);
    const typingUrl = String(mockFetch.mock.calls[5]?.[0]);

    expect(postUrl).toContain("/v2/send");
    expect(editUrl).toContain("/v2/send");
    expect(deleteUrl).toContain("/v1/remote-delete/%2B10000000000");
    expect(addReactionUrl).toContain("/v1/reactions/%2B10000000000");
    expect(removeReactionUrl).toContain("/v1/reactions/%2B10000000000");
    expect(typingUrl).toContain("/v1/typing-indicator/%2B10000000000");

    const postBody = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as {
      message: string;
      number: string;
      recipients: string[];
    };

    const editBody = JSON.parse(
      String((mockFetch.mock.calls[1]?.[1] as RequestInit).body)
    ) as {
      edit_timestamp: number;
      message: string;
    };

    const reactionBody = JSON.parse(
      String((mockFetch.mock.calls[3]?.[1] as RequestInit).body)
    ) as {
      reaction: string;
      target_author: string;
      timestamp: number;
    };

    expect(postBody.number).toBe("+10000000000");
    expect(postBody.recipients).toEqual(["+15551234567"]);
    expect(postBody.message).toBe("hello");

    expect(editBody.edit_timestamp).toBe(1001);
    expect(editBody.message).toBe("updated");

    expect(reactionBody.target_author).toBe("+10000000000");
    expect(reactionBody.timestamp).toBe(1001);
    expect(reactionBody.reaction).toBe("👍");
  });

  it("paginates cached messages", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    adapter.parseMessage(
      buildUpdate({
        dataMessage: {
          timestamp: 1,
          message: "m1",
        },
      })
    );

    adapter.parseMessage(
      buildUpdate({
        dataMessage: {
          timestamp: 2,
          message: "m2",
        },
      })
    );

    adapter.parseMessage(
      buildUpdate({
        dataMessage: {
          timestamp: 3,
          message: "m3",
        },
      })
    );

    const backward = await adapter.fetchMessages("signal:+15551234567", {
      limit: 2,
      direction: "backward",
    });

    const forward = await adapter.fetchMessages("signal:+15551234567", {
      limit: 2,
      direction: "forward",
    });

    expect(backward.messages.map((message) => message.text)).toEqual([
      "m2",
      "m3",
    ]);
    expect(forward.messages.map((message) => message.text)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("keeps message history in-memory per adapter instance", async () => {
    const adapterA = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapterA, createMockChat());

    adapterA.parseMessage(
      buildUpdate({
        dataMessage: {
          timestamp: 1,
          message: "m1",
        },
      })
    );

    const adapterB = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapterB, createMockChat());

    const restored = await adapterB.fetchMessages("signal:+15551234567", {
      direction: "forward",
      limit: 10,
    });

    expect(restored.messages).toEqual([]);
  });

  it("fetches group channel metadata", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(
      signalOk({
        id: "group.c29tZS1ncm91cA==",
        name: "General",
        members: ["+1", "+2", "+3"],
      })
    );

    const info = await adapter.fetchChannelInfo("group.c29tZS1ncm91cA==");

    expect(info.id).toBe("group.c29tZS1ncm91cA==");
    expect(info.name).toBe("General");
    expect(info.memberCount).toBe(3);
    expect(info.isDM).toBe(false);
  });

  it("maps HTTP errors to adapter-specific error types", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    mockFetch.mockResolvedValueOnce(signalError(401, "Unauthorized"));
    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(AuthenticationError);

    mockFetch.mockResolvedValueOnce(signalError(429, "Rate limited"));
    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(AdapterRateLimitError);

    mockFetch.mockResolvedValueOnce(signalError(403, "Forbidden"));
    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(PermissionError);

    mockFetch.mockResolvedValueOnce(signalError(404, "Not found"));
    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    mockFetch.mockResolvedValueOnce(signalError(400, "Bad request"));
    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(ValidationError);

    mockFetch.mockResolvedValueOnce(signalError(500, "Internal server error"));
    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("handles incoming messages with attachments", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_500,
            message: "Check this out",
            attachments: [
              {
                id: "att-1",
                contentType: "image/png",
                filename: "photo.png",
                size: 1024,
                width: 800,
                height: 600,
              },
              {
                id: "att-2",
                contentType: "application/pdf",
                filename: "doc.pdf",
                size: 2048,
              },
            ],
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { attachments: Array<{ type: string; name?: string; size?: number }> },
    ];

    expect(parsedMessage.attachments).toHaveLength(2);
    expect(parsedMessage.attachments[0].type).toBe("image");
    expect(parsedMessage.attachments[0].name).toBe("photo.png");
    expect(parsedMessage.attachments[1].type).toBe("file");
    expect(parsedMessage.attachments[1].name).toBe("doc.pdf");
  });

  it("downloads attachment data via signalFetch", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_600,
            message: "",
            attachments: [{ id: "att-download", contentType: "image/jpeg" }],
          },
        })
      ),
    });

    await adapter.handleWebhook(request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { attachments: Array<{ fetchData: () => Promise<Buffer> }> },
    ];

    mockFetch.mockClear();
    const binaryData = Buffer.from("fake-image-data");
    mockFetch.mockResolvedValueOnce(new Response(binaryData, { status: 200 }));

    const data = await parsedMessage.attachments[0].fetchData();
    expect(data).toBeInstanceOf(Buffer);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "/v1/attachments/att-download"
    );
  });

  it("maps audio and video attachment types", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_700,
            message: "",
            attachments: [
              { id: "v1", contentType: "video/mp4" },
              { id: "a1", contentType: "audio/ogg" },
            ],
          },
        })
      ),
    });

    await adapter.handleWebhook(request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { attachments: Array<{ type: string }> },
    ];

    expect(parsedMessage.attachments[0].type).toBe("video");
    expect(parsedMessage.attachments[1].type).toBe("audio");
  });

  it("ignores webhook payloads when chat is not initialized", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_100,
            message: "Hello",
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid JSON webhooks", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("handles webhook payloads with no updates gracefully", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unexpected: "payload" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).not.toHaveBeenCalled();
  });

  it("handles array payloads with multiple updates", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_100,
            message: "first",
          },
        }),
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_200,
            message: "second",
          },
        }),
      ]),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(2);
  });

  it("processes remote delete messages", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    // First send a message to cache it
    adapter.parseMessage(
      buildUpdate({
        dataMessage: {
          timestamp: 1_735_689_600_100,
          message: "to-be-deleted",
        },
      })
    );

    // Then send remote delete
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_200,
            remoteDelete: {
              timestamp: 1_735_689_600_100,
            },
          },
        })
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const fetched = await adapter.fetchMessages("signal:+15551234567", {
      limit: 10,
      direction: "forward",
    });

    expect(
      fetched.messages.find((m) => m.text === "to-be-deleted")
    ).toBeUndefined();
  });

  it("detects bot mention via text pattern when not in mentions array", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
      userName: "mybot",
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          dataMessage: {
            timestamp: 1_735_689_600_100,
            message: "Hey @mybot can you help?",
          },
        })
      ),
    });

    await adapter.handleWebhook(request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { isMention: boolean },
    ];

    expect(parsedMessage.isMention).toBe(true);
  });

  it("identifies DMs vs group chats", () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    expect(adapter.isDM("signal:+15551234567")).toBe(true);
    expect(adapter.isDM("signal:group.dGVzdA==")).toBe(false);
  });

  it("opens DMs for user identifiers", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const threadId = await adapter.openDM("+15551234567");
    expect(threadId).toBe("signal:+15551234567");
  });

  it("rejects openDM for group identifiers", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await expect(adapter.openDM("group.dGVzdA==")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("fetches DM channel info without API call", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const info = await adapter.fetchChannelInfo("+15551234567");
    expect(info.isDM).toBe(true);
    expect(info.name).toBe("+15551234567");
  });

  it("extracts channelId from threadId", () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    expect(adapter.channelIdFromThreadId("signal:+15551234567")).toBe(
      "+15551234567"
    );
  });

  it("fetches thread info for DMs", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const threadInfo = await adapter.fetchThread("signal:+15551234567");
    expect(threadInfo.isDM).toBe(true);
    expect(threadInfo.channelId).toBe("+15551234567");
  });

  it("posts messages to groups", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(signalOk({ timestamp: "2001" }, 201));

    const posted = await adapter.postChannelMessage(
      "group.dGVzdA==",
      "hello group"
    );

    expect(posted.threadId).toBe("signal:group.dGVzdA==");
  });

  it("rejects empty messages", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    await expect(
      adapter.postMessage("signal:+15551234567", "   ")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("truncates messages exceeding the limit", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(signalOk({ timestamp: "3001" }, 201));

    const longText = "x".repeat(5000);
    await adapter.postMessage("signal:+15551234567", longText);

    const body = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { message: string };

    expect(body.message.length).toBeLessThanOrEqual(4096);
    expect(body.message.endsWith("...")).toBe(true);
  });

  it("uses styled text mode for markdown messages", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(signalOk({ timestamp: "4001" }, 201));

    await adapter.postMessage("signal:+15551234567", {
      markdown: "**bold text**",
    });

    const body = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { text_mode?: string };

    expect(body.text_mode).toBe("styled");
  });

  it("does not set text mode for plain string messages", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(signalOk({ timestamp: "5001" }, 201));

    await adapter.postMessage("signal:+15551234567", "plain text");

    const body = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { text_mode?: string };

    expect(body.text_mode).toBeUndefined();
  });

  it("uses configured text mode override", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      textMode: "normal",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(signalOk({ timestamp: "6001" }, 201));

    await adapter.postMessage("signal:+15551234567", {
      markdown: "**bold**",
    });

    const body = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit).body)
    ) as { text_mode?: string };

    expect(body.text_mode).toBe("normal");
  });

  it("fetches a single message by ID", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    const parsed = adapter.parseMessage(
      buildUpdate({
        dataMessage: {
          timestamp: 42,
          message: "find-me",
        },
      })
    );

    const found = await adapter.fetchMessage("signal:+15551234567", parsed.id);
    expect(found?.text).toBe("find-me");
  });

  it("returns null for non-existent message", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await initializeAdapter(adapter, createMockChat());

    const found = await adapter.fetchMessage("signal:+15551234567", "+1|99999");
    expect(found).toBeNull();
  });

  it("validates SIGNAL_TEXT_MODE env var", () => {
    process.env.SIGNAL_PHONE_NUMBER = "+10000000000";
    process.env.SIGNAL_TEXT_MODE = "invalid";

    expect(() => createSignalAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );

    process.env.SIGNAL_TEXT_MODE = "";
  });

  it("accepts valid SIGNAL_TEXT_MODE env var values", () => {
    process.env.SIGNAL_PHONE_NUMBER = "+10000000000";
    process.env.SIGNAL_TEXT_MODE = "styled";

    const adapter = createSignalAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(SignalAdapter);

    process.env.SIGNAL_TEXT_MODE = "";
  });

  it("handles network errors during fetch", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(
      adapter.startTyping("signal:+15551234567")
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("identity aliases stabilize message IDs across UUID-to-phone transitions", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    // First message with UUID only
    const msg1Request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          source: "uuid-user-1",
          sourceNumber: null,
          sourceUuid: "uuid-user-1",
          dataMessage: {
            timestamp: 1_000_000,
            message: "first",
          },
        })
      ),
    });

    await adapter.handleWebhook(msg1Request);

    // Second message reveals phone number
    const msg2Request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildUpdate({
          source: "uuid-user-1",
          sourceNumber: "+15559999999",
          sourceUuid: "uuid-user-1",
          dataMessage: {
            timestamp: 2_000_000,
            message: "second",
          },
        })
      ),
    });

    await adapter.handleWebhook(msg2Request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, _threadId1] = processMessage.mock.calls[0] as [unknown, string];
    const [, threadId2] = processMessage.mock.calls[1] as [unknown, string];

    // Both messages should route to the same thread once the phone number is known
    expect(threadId2).toBe("signal:+15559999999");
  });

  it("handles stopPolling when polling is not active", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    await expect(adapter.stopPolling()).resolves.toBeUndefined();
  });

  it("ignores duplicate startPolling calls", async () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const chat = createMockChat();
    await initializeAdapter(adapter, chat);

    mockFetch.mockClear();
    // Make the first poll hang
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(signalOk([])), 50))
    );

    adapter.startPolling({ intervalMs: 10_000 });
    adapter.startPolling({ intervalMs: 10_000 });

    // Let the first poll complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    await adapter.stopPolling();
  });

  it("renderFormatted converts AST to string", () => {
    const adapter = createSignalAdapter({
      phoneNumber: "+10000000000",
      logger: mockLogger,
    });

    const result = adapter.renderFormatted({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "hello world" }],
        },
      ],
    });

    expect(result).toContain("hello world");
  });
});
