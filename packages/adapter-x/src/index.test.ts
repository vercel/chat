import { createHmac } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger, Message } from "chat";
import { emoji } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createXAdapter, XAdapter, type XRawMessage } from "./index";

const CONSUMER_SECRET = "test-consumer-secret";
const ACCESS_TOKEN = "test-access-token";
const BOT_USER_ID = "999";
const WEBHOOK_URL = "https://bot.example.com/api/webhooks/x";

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
  vi.unstubAllEnvs();
});

function apiOk(result: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", ...headers },
    status: 200,
  });
}

function createMockState() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    store,
  };
}

function createMockChat(state = createMockState()): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn().mockReturnValue(state),
    getUserName: vi.fn().mockReturnValue("testbot"),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
  } as unknown as ChatInstance;
}

function createAdapter(): XAdapter {
  return new XAdapter({
    consumerSecret: CONSUMER_SECRET,
    logger: mockLogger,
    userAccessToken: ACCESS_TOKEN,
    userId: BOT_USER_ID,
    userName: "testbot",
  });
}

async function createInitializedAdapter(): Promise<{
  adapter: XAdapter;
  chat: ChatInstance;
}> {
  const adapter = createAdapter();
  const chat = createMockChat();
  await adapter.initialize(chat);
  return { adapter, chat };
}

function signBody(body: string): string {
  const hash = createHmac("sha256", CONSUMER_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return `sha256=${hash}`;
}

function webhookRequest(payload: unknown, signature?: string): Request {
  const body = JSON.stringify(payload);
  return new Request(WEBHOOK_URL, {
    body,
    headers: {
      "content-type": "application/json",
      "x-twitter-webhooks-signature": signature ?? signBody(body),
    },
    method: "POST",
  });
}

// Mirrors the real post.mention.create shape: author is referenced by
// author_id on the payload and hydrated in data.includes.users[].
function mentionEnvelope(overrides?: Record<string, unknown>) {
  return {
    data: {
      event_type: "post.mention.create",
      filter: { user_id: BOT_USER_ID },
      includes: {
        users: [
          { id: "111", name: "Ada Lovelace", username: "ada" },
          { id: BOT_USER_ID, name: "Test Bot", username: "testbot" },
        ],
      },
      payload: {
        author_id: "111",
        conversation_id: "500",
        created_at: "2026-07-01T12:00:00.000Z",
        id: "501",
        text: "@testbot hello there",
        ...overrides,
      },
    },
  };
}

// Mirrors the real dm.received shape: legacy Account Activity format with a
// direct_message_events array and a users map keyed by id (each under .data).
function dmEnvelope(options?: {
  eventType?: "dm.received" | "dm.sent";
  id?: string;
  recipientId?: string;
  senderId?: string;
  text?: string;
}) {
  const senderId = options?.senderId ?? "111";
  const recipientId = options?.recipientId ?? BOT_USER_ID;
  return {
    data: {
      event_type: options?.eventType ?? "dm.received",
      filter: { user_id: BOT_USER_ID },
      payload: {
        direct_message_events: [
          {
            created_timestamp: "1735689600000",
            id: options?.id ?? "9001",
            message_create: {
              message_data: { text: options?.text ?? "hi bot" },
              sender_id: senderId,
              target: { recipient_id: recipientId },
            },
            type: "message_create",
          },
        ],
        users: {
          "111": { data: { id: "111", name: "Ada Lovelace", username: "ada" } },
          [BOT_USER_ID]: {
            data: { id: BOT_USER_ID, name: "Test Bot", username: "testbot" },
          },
        },
      },
    },
  };
}

function lastProcessedMessage(chat: ChatInstance): Message<XRawMessage> {
  const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
  const call = processMessage.mock.calls.at(-1);
  if (!call) {
    throw new Error("processMessage was not called");
  }
  return call[2] as Message<XRawMessage>;
}

describe("XAdapter", () => {
  describe("factory function", () => {
    it("throws when consumer secret is missing", () => {
      vi.stubEnv("X_CONSUMER_SECRET", "");
      vi.stubEnv("X_USER_ACCESS_TOKEN", "token");
      expect(() => createXAdapter({ logger: mockLogger })).toThrow(
        ValidationError
      );
    });

    it("throws when no access token or refresh credentials are provided", () => {
      vi.stubEnv("X_CONSUMER_SECRET", "secret");
      vi.stubEnv("X_USER_ACCESS_TOKEN", "");
      expect(() => createXAdapter({ logger: mockLogger })).toThrow(
        ValidationError
      );
    });

    it("accepts managed refresh credentials without a static token", () => {
      vi.stubEnv("X_CONSUMER_SECRET", "secret");
      vi.stubEnv("X_USER_ACCESS_TOKEN", "");
      vi.stubEnv("X_CLIENT_ID", "client-1");
      vi.stubEnv("X_REFRESH_TOKEN", "refresh-1");
      expect(() => createXAdapter({ logger: mockLogger })).not.toThrow();
    });

    it("auto-detects credentials from the environment", () => {
      vi.stubEnv("X_CONSUMER_SECRET", "secret");
      vi.stubEnv("X_USER_ACCESS_TOKEN", "token");
      vi.stubEnv("X_USER_ID", "42");
      vi.stubEnv("X_USERNAME", "envbot");
      const adapter = createXAdapter({ logger: mockLogger });
      expect(adapter.name).toBe("x");
      expect(adapter.botUserId).toBe("42");
      expect(adapter.userName).toBe("envbot");
    });

    it("prefers config over environment", () => {
      vi.stubEnv("X_CONSUMER_SECRET", "env-secret");
      vi.stubEnv("X_USER_ACCESS_TOKEN", "env-token");
      vi.stubEnv("X_USERNAME", "envbot");
      const adapter = createXAdapter({
        logger: mockLogger,
        userName: "configbot",
      });
      expect(adapter.userName).toBe("configbot");
    });
  });

  describe("initialize", () => {
    it("fetches identity when userId is not configured", async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ data: { id: "77", username: "fetchedbot" } })
      );
      const adapter = new XAdapter({
        consumerSecret: CONSUMER_SECRET,
        logger: mockLogger,
        userAccessToken: ACCESS_TOKEN,
      });
      await adapter.initialize(createMockChat());
      expect(adapter.botUserId).toBe("77");
      expect(adapter.userName).toBe("fetchedbot");
    });

    it("skips the identity fetch when userId and userName are configured", async () => {
      await createInitializedAdapter();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws when the bot id cannot be resolved (no userId and /me fails)", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ title: "Unauthorized" }] }), {
          status: 401,
        })
      );
      const adapter = new XAdapter({
        consumerSecret: CONSUMER_SECRET,
        logger: mockLogger,
        userAccessToken: ACCESS_TOKEN,
      });
      await expect(adapter.initialize(createMockChat())).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("CRC challenge", () => {
    it("answers with the HMAC of crc_token", async () => {
      const adapter = createAdapter();
      const response = await adapter.handleWebhook(
        new Request(`${WEBHOOK_URL}?crc_token=challenge-me`, { method: "GET" })
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { response_token: string };
      const expected = createHmac("sha256", CONSUMER_SECRET)
        .update("challenge-me", "utf8")
        .digest("base64");
      expect(body.response_token).toBe(`sha256=${expected}`);
    });

    it("rejects a GET without crc_token", async () => {
      const adapter = createAdapter();
      const response = await adapter.handleWebhook(
        new Request(WEBHOOK_URL, { method: "GET" })
      );
      expect(response.status).toBe(400);
    });
  });

  describe("signature verification", () => {
    it("rejects a missing signature", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      const response = await adapter.handleWebhook(
        new Request(WEBHOOK_URL, {
          body: JSON.stringify(mentionEnvelope()),
          method: "POST",
        })
      );
      expect(response.status).toBe(401);
      expect(chat.processMessage).not.toHaveBeenCalled();
    });

    it("rejects an invalid signature", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      const response = await adapter.handleWebhook(
        webhookRequest(mentionEnvelope(), "sha256=bm90LXRoZS1zaWduYXR1cmU=")
      );
      expect(response.status).toBe(401);
      expect(chat.processMessage).not.toHaveBeenCalled();
    });

    it("accepts a valid signature", async () => {
      const { adapter } = await createInitializedAdapter();
      const response = await adapter.handleWebhook(
        webhookRequest(mentionEnvelope())
      );
      expect(response.status).toBe(200);
    });
  });

  describe("mention routing", () => {
    it("routes post.mention.create to processMessage", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      await adapter.handleWebhook(webhookRequest(mentionEnvelope()));

      expect(chat.processMessage).toHaveBeenCalledTimes(1);
      const message = lastProcessedMessage(chat);
      expect(message.threadId).toBe("x:post:500");
      expect(message.id).toBe("501");
      expect(message.text).toBe("@testbot hello there");
      expect(message.isMention).toBe(true);
      expect(message.author.userId).toBe("111");
      expect(message.author.isMe).toBe(false);
    });

    it("resolves the author handle from includes.users, not the payload", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      await adapter.handleWebhook(webhookRequest(mentionEnvelope()));

      const message = lastProcessedMessage(chat);
      // The real payload carries only author_id; the handle lives in
      // data.includes.users. Regression guard for the includes-resolution bug.
      expect(message.author.userName).toBe("ada");
      expect(message.author.fullName).toBe("Ada Lovelace");
    });

    it("falls back to the post id when conversation_id is missing", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      await adapter.handleWebhook(
        webhookRequest(mentionEnvelope({ conversation_id: undefined }))
      );
      expect(lastProcessedMessage(chat).threadId).toBe("x:post:501");
    });

    it("unwraps payloads nested under a post key", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      const envelope = {
        data: {
          event_type: "post.mention.create",
          payload: {
            author: { id: "111", name: "Ada", username: "ada" },
            post: {
              author_id: "111",
              conversation_id: "500",
              id: "501",
              text: "@testbot hi",
            },
          },
        },
      };
      await adapter.handleWebhook(webhookRequest(envelope));
      const message = lastProcessedMessage(chat);
      expect(message.author.userName).toBe("ada");
      expect(message.author.fullName).toBe("Ada");
    });
  });

  describe("DM routing", () => {
    it("routes dm.received to a participant-keyed dm thread", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      await adapter.handleWebhook(webhookRequest(dmEnvelope()));

      const message = lastProcessedMessage(chat);
      // No conversation id on the wire: threaded by the other participant.
      expect(message.threadId).toBe("x:dm:111");
      expect(message.text).toBe("hi bot");
      expect(message.author.userName).toBe("ada");
      expect(message.author.isMe).toBe(false);
      expect(adapter.isDM(message.threadId)).toBe(true);
    });

    it("parses the legacy direct_message_events shape", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      await adapter.handleWebhook(
        webhookRequest(dmEnvelope({ id: "9100", text: "nested legacy shape" }))
      );
      const message = lastProcessedMessage(chat);
      expect(message.id).toBe("9100");
      expect(message.text).toBe("nested legacy shape");
    });

    it("marks adapter-sent DM echoes as isMe", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        apiOk({ data: { dm_conversation_id: "111-999", dm_event_id: "9002" } })
      );
      await adapter.postMessage("x:dm:111", "hello!");

      // dm.sent echo of the message we just sent (same event id we tracked)
      await adapter.handleWebhook(
        webhookRequest(
          dmEnvelope({
            eventType: "dm.sent",
            id: "9002",
            recipientId: "111",
            senderId: BOT_USER_ID,
            text: "hello!",
          })
        )
      );
      const message = lastProcessedMessage(chat);
      expect(message.author.isMe).toBe(true);
    });

    it("marks bot-sent DMs as isMe even when untracked (stateless)", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      // A dm.sent echo arriving on a fresh instance (id never tracked here):
      // still self because the sender is the bot, so no reply loop.
      await adapter.handleWebhook(
        webhookRequest(
          dmEnvelope({
            eventType: "dm.sent",
            id: "9500",
            recipientId: "111",
            senderId: BOT_USER_ID,
            text: "cold-start echo",
          })
        )
      );
      expect(lastProcessedMessage(chat).author.isMe).toBe(true);
    });

    it("routes every message_create in a batched DM delivery", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      const envelope = {
        data: {
          event_type: "dm.received",
          filter: { user_id: BOT_USER_ID },
          payload: {
            direct_message_events: [
              {
                created_timestamp: "1735689600000",
                id: "9101",
                message_create: {
                  message_data: { text: "first of batch" },
                  sender_id: "111",
                  target: { recipient_id: BOT_USER_ID },
                },
                type: "message_create",
              },
              {
                created_timestamp: "1735689600001",
                id: "9102",
                message_create: {
                  message_data: { text: "second of batch" },
                  sender_id: "111",
                  target: { recipient_id: BOT_USER_ID },
                },
                type: "message_create",
              },
            ],
            users: {
              "111": {
                data: { id: "111", name: "Ada Lovelace", username: "ada" },
              },
            },
          },
        },
      };
      await adapter.handleWebhook(webhookRequest(envelope));
      const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
      expect(processMessage).toHaveBeenCalledTimes(2);
      expect(
        processMessage.mock.calls.map(
          (c) => (c[2] as Message<XRawMessage>).text
        )
      ).toEqual(["first of batch", "second of batch"]);
    });

    it("ignores unknown event types", async () => {
      const { adapter, chat } = await createInitializedAdapter();
      const response = await adapter.handleWebhook(
        webhookRequest({
          data: { event_type: "profile.update.bio", payload: {} },
        })
      );
      expect(response.status).toBe(200);
      expect(chat.processMessage).not.toHaveBeenCalled();
    });
  });

  describe("postMessage", () => {
    it("replies to the conversation root when nothing was received", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      const result = await adapter.postMessage("x:post:500", "a reply");

      expect(result.id).toBe("600");
      expect(result.threadId).toBe("x:post:500");
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api.x.com/2/tweets");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        reply: { in_reply_to_tweet_id: "500" },
        text: "a reply",
      });
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      });
    });

    it("replies to the latest inbound mention in the thread", async () => {
      const { adapter } = await createInitializedAdapter();
      await adapter.handleWebhook(webhookRequest(mentionEnvelope()));
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "a reply");

      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body.reply.in_reply_to_tweet_id).toBe("501");
    });

    it("chains consecutive replies under the previous one", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "601" } }));

      await adapter.postMessage("x:post:500", "first");
      await adapter.postMessage("x:post:500", "second");

      const secondBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
      expect(secondBody.reply.in_reply_to_tweet_id).toBe("600");
    });

    it("sends DMs through the by-participant endpoint", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        apiOk({ data: { dm_conversation_id: "111-999", dm_event_id: "9002" } })
      );

      const result = await adapter.postMessage("x:dm:111", "hello!");

      expect(result.id).toBe("9002");
      expect(result.threadId).toBe("x:dm:111");
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe(
        "https://api.x.com/2/dm_conversations/with/111/messages"
      );
      expect(JSON.parse(String(init?.body))).toEqual({ text: "hello!" });
    });

    describe("media attachments", () => {
      const image = () => ({
        data: Buffer.from("PNGDATA"),
        filename: "card.png",
        mimeType: "image/png",
      });

      function queueMediaUpload(): void {
        mockFetch
          .mockResolvedValueOnce(apiOk({ data: { id: "MEDIA1" } })) // INIT
          .mockResolvedValueOnce(apiOk({})) // APPEND
          .mockResolvedValueOnce(apiOk({ data: { id: "MEDIA1" } })); // FINALIZE
      }

      it("uploads an image and attaches the media_id to the reply", async () => {
        const { adapter } = await createInitializedAdapter();
        queueMediaUpload();
        mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

        await adapter.postMessage("x:post:500", {
          files: [image()],
          markdown: "here you go",
        });

        // initialize (JSON body)
        expect(String(mockFetch.mock.calls[0][0])).toBe(
          "https://api.x.com/2/media/upload/initialize"
        );
        expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body))).toEqual({
          media_category: "tweet_image",
          media_type: "image/png",
          total_bytes: 7,
        });
        expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        });

        // append (multipart to /{id}/append)
        expect(String(mockFetch.mock.calls[1][0])).toBe(
          "https://api.x.com/2/media/upload/MEDIA1/append"
        );
        const append = mockFetch.mock.calls[1][1]?.body as FormData;
        expect(append.get("segment_index")).toBe("0");
        expect(append.get("media")).toBeInstanceOf(Blob);

        // finalize
        expect(String(mockFetch.mock.calls[2][0])).toBe(
          "https://api.x.com/2/media/upload/MEDIA1/finalize"
        );

        const tweetBody = JSON.parse(String(mockFetch.mock.calls[3][1]?.body));
        expect(tweetBody).toEqual({
          media: { media_ids: ["MEDIA1"] },
          reply: { in_reply_to_tweet_id: "500" },
          text: "here you go",
        });
      });

      it("allows a media-only reply with no text", async () => {
        const { adapter } = await createInitializedAdapter();
        queueMediaUpload();
        mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

        await adapter.postMessage("x:post:500", {
          files: [image()],
          markdown: "",
        });

        const tweetBody = JSON.parse(String(mockFetch.mock.calls[3][1]?.body));
        expect(tweetBody.media).toEqual({ media_ids: ["MEDIA1"] });
        expect(tweetBody.text).toBeUndefined();
      });

      it("infers the media type from the filename when mimeType is absent", async () => {
        const { adapter } = await createInitializedAdapter();
        queueMediaUpload();
        mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

        await adapter.postMessage("x:post:500", {
          files: [{ data: Buffer.from("x"), filename: "draw.png" }],
          markdown: "",
        });

        const initBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
        expect(initBody.media_type).toBe("image/png");
        expect(initBody.media_category).toBe("tweet_image");
      });

      it("attaches uploaded media to a DM", async () => {
        const { adapter } = await createInitializedAdapter();
        queueMediaUpload();
        mockFetch.mockResolvedValueOnce(
          apiOk({
            data: { dm_conversation_id: "111-999", dm_event_id: "9002" },
          })
        );

        await adapter.postMessage("x:dm:111", {
          files: [image()],
          markdown: "pic",
        });

        // DM media must register as dm_image; X rejects a tweet_image media_id
        // attached to a DM event.
        const initBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
        expect(initBody.media_category).toBe("dm_image");

        const dmBody = JSON.parse(String(mockFetch.mock.calls[3][1]?.body));
        expect(dmBody).toEqual({
          attachments: [{ media_id: "MEDIA1" }],
          text: "pic",
        });
      });

      it("rejects more than four media attachments", async () => {
        const { adapter } = await createInitializedAdapter();
        await expect(
          adapter.postMessage("x:post:500", {
            files: Array.from({ length: 5 }, image),
            markdown: "",
          })
        ).rejects.toThrow("at most 4 media");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("rejects an unsupported media type", async () => {
        const { adapter } = await createInitializedAdapter();
        await expect(
          adapter.postMessage("x:post:500", {
            files: [
              {
                data: Buffer.from("x"),
                filename: "note.txt",
                mimeType: "text/plain",
              },
            ],
            markdown: "",
          })
        ).rejects.toThrow("supports image uploads");
      });
    });

    it("flattens markdown before posting", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", { markdown: "**bold** move" });

      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body.text).toBe("bold move");
    });

    it("renders cards as plain text", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", {
        card: {
          children: [{ content: "Body", type: "text" }],
          title: "Title",
          type: "card",
        },
      });

      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body.text).toBe("Title\nBody");
    });

    it("converts emoji placeholders to unicode", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "nice {{emoji:thumbs_up}}");

      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body.text).toBe("nice 👍");
    });

    it("rejects empty messages", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(adapter.postMessage("x:post:500", "  ")).rejects.toThrow(
        ValidationError
      );
    });

    it("resolves the access token from a provider function", async () => {
      const provider = vi.fn().mockResolvedValue("fresh-token");
      const adapter = new XAdapter({
        consumerSecret: CONSUMER_SECRET,
        logger: mockLogger,
        userAccessToken: provider,
        userId: BOT_USER_ID,
        userName: "testbot",
      });
      await adapter.initialize(createMockChat());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "hi");

      expect(provider).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: "Bearer fresh-token",
      });
    });
  });

  describe("postChannelMessage", () => {
    it("creates a top-level post on the x:public channel", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "700" } }));

      const result = await adapter.postChannelMessage(
        "x:public",
        "announcement"
      );

      expect(result.threadId).toBe("x:post:700");
      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body).toEqual({ text: "announcement" });
    });

    it("rejects other channels", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(
        adapter.postChannelMessage("x:dm:111", "nope")
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("editMessage", () => {
    it("edits a post via edit_options", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "601" } }));

      const result = await adapter.editMessage("x:post:500", "600", "fixed");

      expect(result.id).toBe("601");
      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body).toEqual({
        edit_options: { previous_post_id: "600" },
        text: "fixed",
      });
    });

    it("rejects DM edits", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(
        adapter.editMessage("x:dm:111", "9002", "fixed")
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("deleteMessage", () => {
    it("deletes posts", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { deleted: true } }));
      await adapter.deleteMessage("x:post:500", "600");
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api.x.com/2/tweets/600");
      expect(init?.method).toBe("DELETE");
    });

    it("deletes DM events", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { deleted: true } }));
      await adapter.deleteMessage("x:dm:111", "9002");
      expect(String(mockFetch.mock.calls[0][0])).toBe(
        "https://api.x.com/2/dm_events/9002"
      );
    });
  });

  describe("reactions", () => {
    it("likes a post with emoji.heart", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { liked: true } }));

      await adapter.addReaction("x:post:500", "501", emoji.heart);

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe(
        `https://api.x.com/2/users/${BOT_USER_ID}/likes`
      );
      expect(JSON.parse(String(init?.body))).toEqual({ tweet_id: "501" });
    });

    it('accepts the string "like"', async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { liked: true } }));
      await adapter.addReaction("x:post:500", "501", "like");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("removes a like", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { liked: false } }));
      await adapter.removeReaction("x:post:500", "501", emoji.heart);
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe(
        `https://api.x.com/2/users/${BOT_USER_ID}/likes/501`
      );
      expect(init?.method).toBe("DELETE");
    });

    it("rejects non-like emoji", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(
        adapter.addReaction("x:post:500", "501", emoji.thumbs_up)
      ).rejects.toThrow(ValidationError);
    });

    it("rejects reactions on DMs", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(
        adapter.addReaction("x:dm:111", "9002", emoji.heart)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("stream", () => {
    it("buffers all chunks and posts once", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      async function* chunks() {
        yield "Hello ";
        yield { text: "streaming ", type: "markdown_text" as const };
        yield "world";
      }

      const result = await adapter.stream("x:post:500", chunks());

      expect(result?.id).toBe("600");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body.text).toBe("Hello streaming world");
    });
  });

  describe("thread IDs", () => {
    it("round-trips post and dm thread IDs", () => {
      const adapter = createAdapter();
      expect(
        adapter.encodeThreadId({ conversationId: "500", kind: "post" })
      ).toBe("x:post:500");
      expect(adapter.decodeThreadId("x:dm:111")).toEqual({
        conversationId: "111",
        kind: "dm",
      });
    });

    it("derives channel IDs from thread IDs", () => {
      const adapter = createAdapter();
      expect(adapter.channelIdFromThreadId("x:post:500")).toBe("x:public");
      // A DM has no broader channel, so the thread is its own channel.
      expect(adapter.channelIdFromThreadId("x:dm:111")).toBe("x:dm:111");
    });

    it("rejects malformed thread IDs", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("slack:C123:456")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("x:group:1")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("x:post:")).toThrow(ValidationError);
    });

    it("opens DMs as participant-keyed dm threads", async () => {
      const { adapter } = await createInitializedAdapter();
      const threadId = await adapter.openDM("111");
      expect(threadId).toBe("x:dm:111");
      expect(adapter.isDM(threadId)).toBe(true);
    });

    it("keeps a DM send on the same participant thread it was posted to", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        apiOk({ data: { dm_conversation_id: "111-999", dm_event_id: "9100" } })
      );

      const result = await adapter.postMessage("x:dm:111", "hello!");

      expect(result.id).toBe("9100");
      // Thread stays participant-keyed so inbound echoes land on it too.
      expect(result.threadId).toBe("x:dm:111");
      expect(String(mockFetch.mock.calls[0][0])).toBe(
        "https://api.x.com/2/dm_conversations/with/111/messages"
      );
    });

    it("deletes DM messages as DM events", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: { deleted: true } }));

      await adapter.deleteMessage("x:dm:111", "9100");

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api.x.com/2/dm_events/9100");
      expect(init?.method).toBe("DELETE");
    });

    it("fetches DM messages through the by-participant endpoint", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: [], meta: {} }));
      await adapter.fetchMessages("x:dm:111");
      expect(String(mockFetch.mock.calls[0][0])).toContain(
        "/2/dm_conversations/with/111/dm_events"
      );
    });
  });

  describe("fetchMessages", () => {
    it("fetches DM events from the API", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        apiOk({
          data: [
            {
              created_at: "2026-07-01T12:01:00.000Z",
              id: "9002",
              sender_id: BOT_USER_ID,
              text: "second",
            },
            {
              created_at: "2026-07-01T12:00:00.000Z",
              id: "9001",
              sender_id: "111",
              text: "first",
            },
          ],
          meta: { next_token: "cursor-1", result_count: 2 },
        })
      );

      const result = await adapter.fetchMessages("x:dm:111", { limit: 2 });

      expect(result.messages.map((message) => message.text)).toEqual([
        "first",
        "second",
      ]);
      expect(result.nextCursor).toBe("cursor-1");
      const url = String(mockFetch.mock.calls[0][0]);
      expect(url).toContain("/2/dm_conversations/with/111/dm_events");
      expect(url).toContain("max_results=2");
    });

    it("passes the cursor as pagination_token", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(apiOk({ data: [], meta: {} }));
      await adapter.fetchMessages("x:dm:111", { cursor: "cursor-1" });
      expect(String(mockFetch.mock.calls[0][0])).toContain(
        "pagination_token=cursor-1"
      );
    });

    it("serves post threads from the inbound cache", async () => {
      const { adapter } = await createInitializedAdapter();
      await adapter.handleWebhook(webhookRequest(mentionEnvelope()));

      const result = await adapter.fetchMessages("x:post:500");

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe("501");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("fetchThread", () => {
    it("returns thread info for both kinds", async () => {
      const adapter = createAdapter();
      expect(await adapter.fetchThread("x:post:500")).toMatchObject({
        channelId: "x:public",
        id: "x:post:500",
        isDM: false,
      });
      expect(await adapter.fetchThread("x:dm:111")).toMatchObject({
        channelId: "x:dm:111",
        isDM: true,
      });
    });
  });

  describe("getUser", () => {
    it("maps user fields", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        apiOk({
          data: {
            id: "111",
            name: "Ada Lovelace",
            profile_image_url: "https://example.com/a.png",
            username: "ada",
          },
        })
      );

      const user = await adapter.getUser("111");

      expect(user).toEqual({
        avatarUrl: "https://example.com/a.png",
        fullName: "Ada Lovelace",
        isBot: false,
        userId: "111",
        userName: "ada",
      });
    });

    it("returns null for unknown users", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ title: "Not Found" }] }), {
          status: 404,
        })
      );
      expect(await adapter.getUser("0")).toBeNull();
    });
  });

  describe("error mapping", () => {
    it("maps 429 to AdapterRateLimitError with retryAfter", async () => {
      const { adapter } = await createInitializedAdapter();
      const reset = Math.floor(Date.now() / 1000) + 120;
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ title: "Too Many" }] }), {
          headers: { "x-rate-limit-reset": String(reset) },
          status: 429,
        })
      );

      const error = await adapter
        .postMessage("x:post:500", "hi")
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AdapterRateLimitError);
      const retryAfter = (error as AdapterRateLimitError).retryAfter ?? 0;
      expect(retryAfter).toBeGreaterThan(100);
      expect(retryAfter).toBeLessThanOrEqual(120);
    });

    it("maps 401 to AuthenticationError", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ title: "Unauthorized" }] }), {
          status: 401,
        })
      );
      await expect(adapter.postMessage("x:post:500", "hi")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("throws when the response has errors and no data", async () => {
      const { adapter } = await createInitializedAdapter();
      mockFetch.mockResolvedValueOnce(
        apiOk({ errors: [{ detail: "You cannot reply to this post." }] })
      );
      await expect(adapter.postMessage("x:post:500", "hi")).rejects.toThrow(
        "You cannot reply to this post."
      );
    });
  });

  describe("parseMessage", () => {
    it("rebuilds a post message from raw", () => {
      const adapter = createAdapter();
      const message = adapter.parseMessage({
        kind: "post",
        post: {
          author_id: "111",
          conversation_id: "500",
          created_at: "2026-07-01T12:00:00.000Z",
          id: "501",
          text: "hello",
        },
      });
      expect(message.threadId).toBe("x:post:500");
      expect(message.text).toBe("hello");
    });

    it("rebuilds a dm message from raw, threaded by participant", () => {
      const adapter = createAdapter();
      const message = adapter.parseMessage({
        dmEvent: {
          id: "9001",
          recipient_id: BOT_USER_ID,
          sender_id: "111",
          text: "hi",
        },
        kind: "dm",
      });
      expect(message.threadId).toBe("x:dm:111");
    });
  });

  describe("startTyping", () => {
    it("is a no-op", async () => {
      const { adapter } = await createInitializedAdapter();
      await expect(adapter.startTyping("x:post:500")).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("managed OAuth refresh", () => {
    function refreshOk(overrides?: Record<string, unknown>): Response {
      return apiOk({
        access_token: "fresh-access",
        expires_in: 7200,
        refresh_token: "rotated-refresh",
        token_type: "bearer",
        ...overrides,
      });
    }

    async function createManagedAdapter(clientSecret?: string) {
      const state = createMockState();
      const adapter = new XAdapter({
        clientId: "client-1",
        clientSecret,
        consumerSecret: CONSUMER_SECRET,
        logger: mockLogger,
        refreshToken: "initial-refresh",
        userId: BOT_USER_ID,
        userName: "testbot",
      });
      await adapter.initialize(createMockChat(state));
      return { adapter, state };
    }

    it("refreshes before the first API call and sends the new token", async () => {
      const { adapter } = await createManagedAdapter();
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "hi");

      const [refreshUrl, refreshInit] = mockFetch.mock.calls[0];
      expect(String(refreshUrl)).toBe("https://api.x.com/2/oauth2/token");
      const params = new URLSearchParams(String(refreshInit?.body));
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("initial-refresh");
      expect(params.get("client_id")).toBe("client-1");

      expect(mockFetch.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
      });
    });

    it("reuses the token until it nears expiry", async () => {
      const { adapter } = await createManagedAdapter();
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "601" } }));

      await adapter.postMessage("x:post:500", "one");
      await adapter.postMessage("x:post:500", "two");

      const refreshCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes("/2/oauth2/token")
      );
      expect(refreshCalls).toHaveLength(1);
    });

    it("persists the rotated refresh token in state", async () => {
      const { adapter, state } = await createManagedAdapter();
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "hi");

      const stored = state.store.get("x:oauth:client-1") as {
        accessToken: string;
        refreshToken: string;
      };
      expect(stored.refreshToken).toBe("rotated-refresh");
      expect(stored.accessToken).toBe("fresh-access");
    });

    it("resumes from the stored rotated token after a restart", async () => {
      const state = createMockState();
      state.store.set("x:oauth:client-1", {
        accessToken: "stale-access",
        expiresAt: 0,
        refreshToken: "rotated-refresh",
      });
      const adapter = new XAdapter({
        clientId: "client-1",
        consumerSecret: CONSUMER_SECRET,
        logger: mockLogger,
        refreshToken: "initial-refresh",
        userId: BOT_USER_ID,
        userName: "testbot",
      });
      await adapter.initialize(createMockChat(state));
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "hi");

      const params = new URLSearchParams(
        String(mockFetch.mock.calls[0][1]?.body)
      );
      expect(params.get("refresh_token")).toBe("rotated-refresh");
    });

    it("uses basic auth for confidential clients", async () => {
      const { adapter } = await createManagedAdapter("client-secret");
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "hi");

      const [, refreshInit] = mockFetch.mock.calls[0];
      const basic = Buffer.from("client-1:client-secret").toString("base64");
      expect(refreshInit?.headers).toMatchObject({
        Authorization: `Basic ${basic}`,
      });
      const params = new URLSearchParams(String(refreshInit?.body));
      expect(params.get("client_id")).toBeNull();
    });

    it("throws AuthenticationError when the refresh is rejected", async () => {
      const { adapter } = await createManagedAdapter();
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_request" }), {
          status: 400,
        })
      );

      await expect(adapter.postMessage("x:post:500", "hi")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("shares one refresh across concurrent API calls", async () => {
      const { adapter } = await createManagedAdapter();
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "601" } }));

      await Promise.all([
        adapter.postMessage("x:post:500", "one"),
        adapter.postMessage("x:post:501", "two"),
      ]);

      const refreshCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes("/2/oauth2/token")
      );
      expect(refreshCalls).toHaveLength(1);
    });

    it("encrypts persisted tokens when an encryption key is configured", async () => {
      const key = Buffer.alloc(32, 7).toString("base64");
      const state = createMockState();
      const adapter = new XAdapter({
        clientId: "client-1",
        consumerSecret: CONSUMER_SECRET,
        encryptionKey: key,
        logger: mockLogger,
        refreshToken: "initial-refresh",
        userId: BOT_USER_ID,
        userName: "testbot",
      });
      await adapter.initialize(createMockChat(state));
      mockFetch.mockResolvedValueOnce(refreshOk());
      mockFetch.mockResolvedValueOnce(apiOk({ data: { id: "600" } }));

      await adapter.postMessage("x:post:500", "hi");

      const stored = state.store.get("x:oauth:client-1") as {
        refreshToken: unknown;
      };
      expect(typeof stored.refreshToken).not.toBe("string");
    });
  });
});
