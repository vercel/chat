import { createHmac } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  threadIdContract,
} from "@chat-adapter/tests";
import type { ChatInstance } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstagramAdapter,
  InstagramAdapter,
  type InstagramMessagingEvent,
  type InstagramThreadId,
} from "./index";

const APP_SECRET = "test-app-secret";
const ACCOUNT_ID = "IG_ACCOUNT_123";
const ACCESS_TOKEN = "test-access-token";
const VERIFY_TOKEN = "test-verify-token";
const THREAD_ID = `instagram:${ACCOUNT_ID}:IGSID_456`;
const WINDOW_ERROR_PATTERN = /24-hour messaging window/;
const mockLogger = createMockLogger();
const mockFetch = vi.fn<typeof fetch>();

function apiResponse(
  result: unknown,
  status = 200,
  headers?: HeadersInit
): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function createAdapter(): InstagramAdapter {
  return new InstagramAdapter({
    accessToken: ACCESS_TOKEN,
    accountId: ACCOUNT_ID,
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    logger: mockLogger,
  });
}

function createChat(): ChatInstance {
  return createMockChatInstance({ logger: mockLogger, userName: "TestBot" });
}

function event(
  overrides: Partial<InstagramMessagingEvent> = {}
): InstagramMessagingEvent {
  return {
    sender: { id: "IGSID_456" },
    recipient: { id: ACCOUNT_ID },
    timestamp: 1_735_689_600_000,
    message: { mid: "mid.1", text: "hello" },
    ...overrides,
  };
}

function webhook(events: InstagramMessagingEvent[], object = "instagram") {
  return {
    object,
    entry: [
      {
        id: ACCOUNT_ID,
        time: 1_735_689_600_000,
        messaging: events,
      },
    ],
  };
}

function signedRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", APP_SECRET).update(body).digest("hex");
  return new Request("https://example.com/api/webhooks/instagram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

async function initialize(adapter: InstagramAdapter): Promise<ChatInstance> {
  const chat = createChat();
  mockFetch.mockResolvedValueOnce(
    apiResponse({ id: ACCOUNT_ID, username: "testshop" })
  );
  await adapter.initialize(chat);
  return chat;
}

function lastJsonBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls.at(-1);
  const init = call?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("InstagramAdapter", () => {
  describe("factory", () => {
    it("reads all credentials and API version from the environment", () => {
      vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", ACCESS_TOKEN);
      vi.stubEnv("INSTAGRAM_ACCOUNT_ID", ACCOUNT_ID);
      vi.stubEnv("INSTAGRAM_APP_SECRET", APP_SECRET);
      vi.stubEnv("INSTAGRAM_VERIFY_TOKEN", VERIFY_TOKEN);
      vi.stubEnv("INSTAGRAM_API_VERSION", "v25.0");

      const adapter = createInstagramAdapter({ logger: mockLogger });
      expect(adapter).toBeInstanceOf(InstagramAdapter);
      expect(adapter.name).toBe("instagram");
    });

    it.each([
      ["accessToken", { accessToken: "" }],
      ["accountId", { accountId: "" }],
      ["appSecret", { appSecret: "" }],
      ["verifyToken", { verifyToken: "" }],
    ])("requires %s", (_name, missing) => {
      expect(() =>
        createInstagramAdapter({
          accessToken: ACCESS_TOKEN,
          accountId: ACCOUNT_ID,
          appSecret: APP_SECRET,
          verifyToken: VERIFY_TOKEN,
          logger: mockLogger,
          ...missing,
        })
      ).toThrow(ValidationError);
    });
  });

  describe("thread IDs", () => {
    it("rejects malformed and cross-platform IDs", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("instagram:only-two")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("instagram::user")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("messenger:page:user")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("instagram:a:b:extra")).toThrow(
        ValidationError
      );
    });

    it("opens an account-scoped DM", async () => {
      await expect(createAdapter().openDM("IGSID_456")).resolves.toBe(
        THREAD_ID
      );
    });
  });

  describe("webhooks", () => {
    it("completes the verification challenge", async () => {
      const response = await createAdapter().handleWebhook(
        new Request(
          `https://example.com/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge`,
          { method: "GET" }
        )
      );
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("challenge");
    });

    it("rejects bad signatures and non-Instagram objects", async () => {
      const adapter = createAdapter();
      const unsigned = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(webhook([event()])),
      });
      expect((await adapter.handleWebhook(unsigned)).status).toBe(403);
      expect(
        (await adapter.handleWebhook(signedRequest(webhook([], "page")))).status
      ).toBe(404);
    });

    it("routes DMs with account-scoped thread IDs", async () => {
      const adapter = createAdapter();
      const chat = await initialize(adapter);
      const response = await adapter.handleWebhook(
        signedRequest(webhook([event()]))
      );
      expect(response.status).toBe(200);
      expect(chat.processMessage).toHaveBeenCalledWith(
        adapter,
        THREAD_ID,
        expect.objectContaining({
          text: "hello",
          isMention: true,
        }),
        undefined
      );
    });

    it("normalizes story replies and preserves raw context", async () => {
      const adapter = createAdapter();
      const chat = await initialize(adapter);
      const storyEvent = event({
        message: {
          mid: "mid.story",
          text: "Is this available?",
          reply_to: {
            story: {
              id: "story.1",
              url: "https://cdn.example.com/story.jpg",
            },
          },
        },
      });
      await adapter.handleWebhook(signedRequest(webhook([storyEvent])));
      const message = vi.mocked(chat.processMessage).mock.calls[0]?.[2];
      expect(message?.attachments).toEqual([
        expect.objectContaining({
          type: "image",
          url: "https://cdn.example.com/story.jpg",
        }),
      ]);
      expect(message?.raw).toStrictEqual(storyEvent);
    });

    it("routes quick replies and postbacks as actions", async () => {
      const adapter = createAdapter();
      const chat = await initialize(adapter);
      await adapter.handleWebhook(
        signedRequest(
          webhook([
            event({
              message: {
                mid: "mid.quick",
                text: "Yes",
                quick_reply: { payload: 'chat:{"a":"confirm","v":"yes"}' },
              },
            }),
            event({
              message: undefined,
              postback: {
                title: "Track",
                payload: 'chat:{"a":"track"}',
              },
            }),
          ])
        )
      );
      expect(chat.processAction).toHaveBeenCalledTimes(2);
      expect(chat.processAction).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ actionId: "confirm", value: "yes" }),
        undefined
      );
      expect(chat.processAction).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ actionId: "track" }),
        undefined
      );
      expect(chat.processMessage).not.toHaveBeenCalled();
    });

    it("routes reaction add and remove events", async () => {
      const adapter = createAdapter();
      const chat = await initialize(adapter);
      await adapter.handleWebhook(
        signedRequest(
          webhook([
            event({
              message: undefined,
              reaction: {
                action: "react",
                emoji: "❤️",
                mid: "mid.1",
              },
            }),
            event({
              message: undefined,
              reaction: {
                action: "unreact",
                emoji: "❤️",
                mid: "mid.1",
              },
            }),
          ])
        )
      );
      expect(chat.processReaction).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ added: true, rawEmoji: "❤️" }),
        undefined
      );
      expect(chat.processReaction).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ added: false }),
        undefined
      );
    });
  });

  describe("sending", () => {
    it("uses graph.instagram.com, bearer auth, and the account endpoint", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse({ recipient_id: "IGSID_456", message_id: "mid.sent" })
      );
      const result = await adapter.postMessage(THREAD_ID, "Hello");
      expect(result.id).toBe("mid.sent");
      const [input, init] = mockFetch.mock.calls[0] ?? [];
      expect(String(input)).toContain(
        `graph.instagram.com/v26.0/${ACCOUNT_ID}/messages`
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${ACCESS_TOKEN}`
      );
      expect(lastJsonBody()).toMatchObject({
        recipient: { id: "IGSID_456" },
        message: { text: "Hello" },
        messaging_type: "RESPONSE",
      });
    });

    it("truncates text to 1000 UTF-8 bytes without splitting emoji", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse({ recipient_id: "IGSID_456", message_id: "mid.sent" })
      );
      await adapter.postMessage(THREAD_ID, "🌎".repeat(300));
      const message = lastJsonBody().message as { text: string };
      expect(
        new TextEncoder().encode(message.text).byteLength
      ).toBeLessThanOrEqual(1000);
      expect(message.text.endsWith("...")).toBe(true);
    });

    it("renders card markdown as plain text and resolves emoji placeholders", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse({ recipient_id: "IGSID_456", message_id: "mid.card" })
      );
      await adapter.postMessage(THREAD_ID, {
        type: "card",
        title: "{{emoji:sparkles}} Test Menu",
        children: [
          { type: "text", content: "**Choose** an option" },
          {
            type: "actions",
            children: [{ type: "button", id: "hello", label: "Say Hello" }],
          },
        ],
      });
      expect(lastJsonBody()).toMatchObject({
        message: {
          text: "✨ Test Menu\nChoose an option",
          quick_replies: [
            {
              content_type: "text",
              title: "Say Hello",
              payload: 'chat:{"a":"hello"}',
            },
          ],
        },
      });
    });

    it("sends URL media and typing indicators", async () => {
      const adapter = createAdapter();
      mockFetch
        .mockResolvedValueOnce(
          apiResponse({ recipient_id: "IGSID_456", message_id: "mid.image" })
        )
        .mockResolvedValueOnce(apiResponse({ success: true }));
      await adapter.postMessage(THREAD_ID, {
        raw: "",
        attachments: [
          {
            type: "image",
            url: "https://cdn.example.com/product.jpg",
          },
        ],
      });
      const firstBody = JSON.parse(
        String(mockFetch.mock.calls[0]?.[1]?.body)
      ) as Record<string, unknown>;
      expect(firstBody).toMatchObject({
        message: {
          attachment: {
            type: "image",
            payload: { url: "https://cdn.example.com/product.jpg" },
          },
        },
      });
      await adapter.startTyping(THREAD_ID);
      expect(lastJsonBody()).toMatchObject({
        sender_action: "typing_on",
      });
    });

    it("uploads binary attachments and sends the returned media ID", async () => {
      const adapter = createAdapter();
      mockFetch
        .mockResolvedValueOnce(apiResponse({ attachment_id: "attachment.1" }))
        .mockResolvedValueOnce(
          apiResponse({ recipient_id: "IGSID_456", message_id: "mid.file" })
        );
      await adapter.postMessage(THREAD_ID, {
        raw: "",
        files: [
          {
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("pdf"),
          },
        ],
      });
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
        `${ACCOUNT_ID}/message_attachments`
      );
      expect(mockFetch.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
      expect(lastJsonBody()).toMatchObject({
        message: {
          attachment: {
            type: "file",
            payload: { attachment_id: "attachment.1" },
          },
        },
      });
    });

    it("uses the audited HUMAN_AGENT message tag explicitly", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse({ recipient_id: "IGSID_456", message_id: "mid.human" })
      );
      await adapter.sendHumanAgentMessage(THREAD_ID, "Human follow-up");
      expect(lastJsonBody()).toMatchObject({
        messaging_type: "MESSAGE_TAG",
        tag: "HUMAN_AGENT",
      });
    });
  });

  describe("Graph errors", () => {
    it("maps rate limits with retry hints", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse({ error: { code: 613, message: "Rate limit" } }, 429, {
          "retry-after": "60",
        })
      );
      await expect(
        adapter.postMessage(THREAD_ID, "hello")
      ).rejects.toMatchObject({
        name: "AdapterRateLimitError",
        retryAfter: 60,
      });
      await expect(
        Promise.reject(new AdapterRateLimitError("instagram"))
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });

    it("maps expired messaging windows to a clear typed error", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse(
          {
            error: {
              code: 10,
              error_subcode: 2_534_022,
              message: "This message was sent outside the allowed window.",
            },
          },
          400
        )
      );
      await expect(adapter.postMessage(THREAD_ID, "hello")).rejects.toThrow(
        WINDOW_ERROR_PATTERN
      );
    });

    it("maps expired access tokens", async () => {
      const adapter = createAdapter();
      mockFetch.mockResolvedValueOnce(
        apiResponse({ error: { code: 190, message: "Expired" } }, 401)
      );
      await expect(
        adapter.postMessage(THREAD_ID, "hello")
      ).rejects.toBeInstanceOf(AuthenticationError);
    });
  });
});

const threadIdAdapter = createAdapter();

threadIdContract<InstagramThreadId>({
  name: "instagram",
  encode: (decoded) => threadIdAdapter.encodeThreadId(decoded),
  decode: (id) => threadIdAdapter.decodeThreadId(id),
  cases: [
    {
      decoded: { accountId: ACCOUNT_ID, recipientId: "IGSID_456" },
      encoded: THREAD_ID,
    },
    {
      decoded: { accountId: "IG_ACCOUNT_789", recipientId: "IGSID_999" },
      encoded: "instagram:IG_ACCOUNT_789:IGSID_999",
    },
  ],
});
