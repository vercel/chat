import { createHmac } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
  selfMessageContract,
  threadIdContract,
} from "@chat-adapter/tests";
import type { ChatInstance } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTwitchAdapter,
  TwitchAdapter,
  type TwitchAdapterConfig,
  type TwitchChatMessageEvent,
  type TwitchThreadId,
  type TwitchWhisperEvent,
} from "./index";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const WEBHOOK_SECRET = "test-webhook-secret";
const BOT_ID = "9001";
const BOT_LOGIN = "chatsdkbot";
const BROADCASTER_ID = "1971641";
const VIEWER_ID = "4145994";
const CHAT_THREAD = `twitch:${BROADCASTER_ID}`;
const WHISPER_THREAD = `twitch:whisper:${VIEWER_ID}`;
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const USER_TOKEN_KEY = `twitch:oauth:${CLIENT_ID}:${BOT_ID}`;
const APP_TOKEN_KEY = `twitch:app-token:${CLIENT_ID}`;
const HELIX = "https://api.twitch.tv/helix";

const mockLogger = createMockLogger();
const mockFetch = vi.fn<typeof fetch>();
/** Queued Helix responses; the OAuth token endpoint is answered automatically. */
let helixResponses: Response[] = [];
let tokenRequests: URLSearchParams[] = [];

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function queue(...responses: Response[]): void {
  helixResponses.push(...responses);
}

function helixCalls(): { init: RequestInit; url: URL }[] {
  return mockFetch.mock.calls
    .filter(([input]) => String(input).startsWith(HELIX))
    .map(([input, init]) => ({
      init: init ?? {},
      url: new URL(String(input)),
    }));
}

function lastHelixCall(): {
  body: Record<string, unknown>;
  init: RequestInit;
  url: URL;
} {
  const call = helixCalls().at(-1);
  if (!call) {
    throw new Error("No Helix call was made");
  }
  return {
    body: call.init.body ? JSON.parse(String(call.init.body)) : {},
    init: call.init,
    url: call.url,
  };
}

function createAdapter(overrides: Partial<TwitchAdapterConfig> = {}) {
  return new TwitchAdapter({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    logger: mockLogger,
    userId: BOT_ID,
    userName: BOT_LOGIN,
    webhookSecret: WEBHOOK_SECRET,
    ...overrides,
  });
}

async function initialized(
  overrides: Partial<TwitchAdapterConfig> = {},
  chat: ChatInstance = createMockChatInstance({ logger: mockLogger })
): Promise<{ adapter: TwitchAdapter; chat: ChatInstance }> {
  const adapter = createAdapter(overrides);
  await adapter.initialize(chat);
  return { adapter, chat };
}

function chatEvent(
  overrides: Partial<TwitchChatMessageEvent> = {}
): TwitchChatMessageEvent {
  return {
    badges: [{ id: "1", info: "", set_id: "moderator" }],
    broadcaster_user_id: BROADCASTER_ID,
    broadcaster_user_login: "streamer",
    broadcaster_user_name: "streamer",
    channel_points_custom_reward_id: null,
    chatter_user_id: VIEWER_ID,
    chatter_user_login: "viewer32",
    chatter_user_name: "Viewer32",
    cheer: null,
    color: "#00FF7F",
    message: {
      fragments: [
        {
          cheermote: null,
          emote: null,
          mention: null,
          text: "Hi chat",
          type: "text",
        },
      ],
      text: "Hi chat",
    },
    message_id: "cc106a89-1814-919d-454c-f4f2f970aae7",
    message_type: "text",
    reply: null,
    source_badges: null,
    source_broadcaster_user_id: null,
    source_broadcaster_user_login: null,
    source_broadcaster_user_name: null,
    source_message_id: null,
    ...overrides,
  };
}

function whisperEvent(
  overrides: Partial<TwitchWhisperEvent> = {}
): TwitchWhisperEvent {
  return {
    from_user_id: VIEWER_ID,
    from_user_login: "viewer32",
    from_user_name: "Viewer32",
    to_user_id: BOT_ID,
    to_user_login: BOT_LOGIN,
    to_user_name: BOT_LOGIN,
    whisper: { text: "a secret" },
    whisper_id: "some-whisper-id",
    ...overrides,
  };
}

function subscription(type: string, status = "enabled") {
  return {
    condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
    cost: 0,
    created_at: "2023-11-06T18:11:47.492253549Z",
    id: "0b7f3361-672b-4d39-b307-dd5b576c9b27",
    status,
    transport: {
      callback: "https://example.com/api/webhooks/twitch",
      method: "webhook",
    },
    type,
    version: "1",
  };
}

function nanoTimestamp(date = new Date()): string {
  return date.toISOString().replace("Z", "123456Z");
}

function signedRequest(
  payload: unknown,
  options: {
    messageId?: string;
    messageType?: string;
    secret?: string;
    timestamp?: string;
  } = {}
): Request {
  const body = JSON.stringify(payload);
  const messageId = options.messageId ?? "e76c6bd4-55c9-4987-8304-da1588d8988b";
  const timestamp = options.timestamp ?? nanoTimestamp();
  const signature = createHmac("sha256", options.secret ?? WEBHOOK_SECRET)
    .update(messageId + timestamp + body)
    .digest("hex");
  return new Request("https://example.com/api/webhooks/twitch", {
    body,
    headers: {
      "content-type": "application/json",
      "twitch-eventsub-message-id": messageId,
      "twitch-eventsub-message-retry": "0",
      "twitch-eventsub-message-signature": `sha256=${signature}`,
      "twitch-eventsub-message-timestamp": timestamp,
      "twitch-eventsub-message-type": options.messageType ?? "notification",
      "twitch-eventsub-subscription-type": "channel.chat.message",
      "twitch-eventsub-subscription-version": "1",
    },
    method: "POST",
  });
}

function chatNotification(overrides: Partial<TwitchChatMessageEvent> = {}) {
  return signedRequest({
    event: chatEvent(overrides),
    subscription: subscription("channel.chat.message"),
  });
}

function dispatched(chat: ChatInstance) {
  const calls = vi.mocked(chat.processMessage).mock.calls;
  const call = calls.at(-1);
  if (!call) {
    throw new Error("processMessage was not called");
  }
  return { message: call[2], threadId: call[1] };
}

/** Whispers dispatch a message factory; run it like Chat SDK does. */
async function dispatchedWhisper(chat: ChatInstance) {
  const { message, threadId } = dispatched(chat);
  return {
    message: typeof message === "function" ? await message() : message,
    threadId,
  };
}

beforeEach(() => {
  helixResponses = [];
  tokenRequests = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === TOKEN_URL) {
      const params = new URLSearchParams(String(init?.body));
      tokenRequests.push(params);
      if (params.get("grant_type") === "refresh_token") {
        return json({
          access_token: `user-token-${tokenRequests.length}`,
          expires_in: 14_000,
          refresh_token: `rotated-refresh-${tokenRequests.length}`,
          scope: ["user:manage:whispers"],
          token_type: "bearer",
        });
      }
      return json({
        access_token: `app-token-${tokenRequests.length}`,
        expires_in: 5_011_271,
        token_type: "bearer",
      });
    }
    const next = helixResponses.shift();
    if (!next) {
      throw new Error(`Unexpected request: ${url}`);
    }
    return next;
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

threadIdContract<TwitchThreadId>({
  cases: [
    {
      decoded: { broadcasterUserId: BROADCASTER_ID, kind: "chat" },
      encoded: CHAT_THREAD,
    },
    {
      decoded: { kind: "whisper", userId: VIEWER_ID },
      encoded: WHISPER_THREAD,
    },
  ],
  decode: (id) => createAdapter().decodeThreadId(id),
  encode: (decoded) => createAdapter().encodeThreadId(decoded),
  isDM: {
    dmThreadId: WHISPER_THREAD,
    fn: (id) => createAdapter().isDM(id),
    nonDmThreadId: CHAT_THREAD,
  },
  name: "twitch",
});

selfMessageContract({
  makeOtherMessageRequest: () => chatNotification(),
  makeSelfMessageRequest: () =>
    chatNotification({
      chatter_user_id: BOT_ID,
      chatter_user_login: BOT_LOGIN,
      chatter_user_name: BOT_LOGIN,
    }),
  name: "twitch",
  setup: () => initialized(),
});

describe("createTwitchAdapter", () => {
  it("reads credentials from the environment", () => {
    vi.stubEnv("TWITCH_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("TWITCH_CLIENT_SECRET", CLIENT_SECRET);
    vi.stubEnv("TWITCH_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("TWITCH_BOT_USER_ID", BOT_ID);
    vi.stubEnv("TWITCH_BOT_USERNAME", BOT_LOGIN);

    const adapter = createTwitchAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(TwitchAdapter);
    expect(adapter.name).toBe("twitch");
    expect(adapter.botUserId).toBe(BOT_ID);
    expect(adapter.userName).toBe(BOT_LOGIN);
    expect(adapter.lockScope).toBe("channel");
    expect(adapter.persistThreadHistory).toBe(true);
  });

  it.each([
    ["clientId", { clientId: "" }, "TWITCH_CLIENT_ID"],
    ["clientSecret", { clientSecret: "" }, "TWITCH_CLIENT_SECRET"],
    ["webhookSecret", { webhookSecret: "" }, "TWITCH_WEBHOOK_SECRET"],
    ["bot account", { userId: "", userName: "" }, "TWITCH_BOT_USER_ID"],
  ])("requires %s", (_name, missing, pattern) => {
    expect(() =>
      createTwitchAdapter({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        logger: mockLogger,
        userId: BOT_ID,
        webhookSecret: WEBHOOK_SECRET,
        ...missing,
      })
    ).toThrow(pattern);
  });

  it("rejects webhook secrets outside Twitch's 10-100 character range", () => {
    expect(() => createAdapter({ webhookSecret: "short" })).toThrow(
      ValidationError
    );
    expect(() => createAdapter({ webhookSecret: "x".repeat(101) })).toThrow(
      ValidationError
    );
  });
});

describe("initialize", () => {
  it("skips the lookup when the bot ID and login are configured", async () => {
    await initialized();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves the bot ID from the login", async () => {
    queue(
      json({
        data: [{ display_name: "ChatSdkBot", id: BOT_ID, login: BOT_LOGIN }],
      })
    );
    const { adapter } = await initialized({ userId: undefined });

    expect(adapter.botUserId).toBe(BOT_ID);
    const call = lastHelixCall();
    expect(call.url.pathname).toBe("/helix/users");
    expect(call.url.searchParams.get("login")).toBe(BOT_LOGIN);
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer app-token-1",
      "Client-Id": CLIENT_ID,
    });
    expect(tokenRequests[0]?.get("grant_type")).toBe("client_credentials");
    expect(tokenRequests[0]?.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("resolves the login from the bot ID", async () => {
    queue(
      json({
        data: [{ display_name: "ChatSdkBot", id: BOT_ID, login: BOT_LOGIN }],
      })
    );
    const { adapter } = await initialized({ userName: undefined });

    expect(adapter.userName).toBe(BOT_LOGIN);
    expect(lastHelixCall().url.searchParams.get("id")).toBe(BOT_ID);
  });

  it("fails fast when the bot ID cannot be resolved", async () => {
    queue(json({ data: [] }));
    await expect(initialized({ userId: undefined })).rejects.toThrow(
      "Could not resolve the bot user ID"
    );
  });
});

describe("handleWebhook", () => {
  it("answers the subscription challenge with the raw challenge", async () => {
    const { adapter } = await initialized();
    const response = await adapter.handleWebhook(
      signedRequest(
        {
          challenge: "pogchamp-kappa-360noscope-vohiyo",
          subscription: subscription(
            "channel.chat.message",
            "webhook_callback_verification_pending"
          ),
        },
        { messageType: "webhook_callback_verification" }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("pogchamp-kappa-360noscope-vohiyo");
  });

  it("rejects a challenge without a challenge value", async () => {
    const { adapter } = await initialized();
    const response = await adapter.handleWebhook(
      signedRequest(
        { subscription: subscription("channel.chat.message") },
        { messageType: "webhook_callback_verification" }
      )
    );
    expect(response.status).toBe(400);
  });

  it("rejects requests with an invalid signature", async () => {
    const { adapter, chat } = await initialized();
    const response = await adapter.handleWebhook(
      signedRequest(
        {
          event: chatEvent(),
          subscription: subscription("channel.chat.message"),
        },
        { secret: "wrong-webhook-secret" }
      )
    );
    expect(response.status).toBe(403);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("rejects requests with missing signature headers", async () => {
    const { adapter } = await initialized();
    const response = await adapter.handleWebhook(
      new Request("https://example.com/api/webhooks/twitch", {
        body: "{}",
        method: "POST",
      })
    );
    expect(response.status).toBe(403);
  });

  it("rejects notifications older than 10 minutes", async () => {
    const { adapter, chat } = await initialized();
    const response = await adapter.handleWebhook(
      signedRequest(
        {
          event: chatEvent(),
          subscription: subscription("channel.chat.message"),
        },
        { timestamp: nanoTimestamp(new Date(Date.now() - 11 * 60 * 1000)) }
      )
    );
    expect(response.status).toBe(403);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("rejects non-POST requests", async () => {
    const { adapter } = await initialized();
    const response = await adapter.handleWebhook(
      new Request("https://example.com/api/webhooks/twitch")
    );
    expect(response.status).toBe(405);
  });

  it("returns 400 for a signed body that is not JSON", async () => {
    const { adapter } = await initialized();
    const timestamp = nanoTimestamp();
    const body = "not json";
    const signature = createHmac("sha256", WEBHOOK_SECRET)
      .update(`msg-1${timestamp}${body}`)
      .digest("hex");
    const response = await adapter.handleWebhook(
      new Request("https://example.com/api/webhooks/twitch", {
        body,
        headers: {
          "twitch-eventsub-message-id": "msg-1",
          "twitch-eventsub-message-signature": `sha256=${signature}`,
          "twitch-eventsub-message-timestamp": timestamp,
          "twitch-eventsub-message-type": "notification",
        },
        method: "POST",
      })
    );
    expect(response.status).toBe(400);
  });

  it("acknowledges revocations", async () => {
    const { adapter, chat } = await initialized();
    const response = await adapter.handleWebhook(
      signedRequest(
        {
          subscription: subscription(
            "channel.chat.message",
            "authorization_revoked"
          ),
        },
        { messageType: "revocation" }
      )
    );
    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Twitch revoked an EventSub subscription",
      expect.objectContaining({ status: "authorization_revoked" })
    );
  });

  it("routes channel chat messages to the broadcaster's chat thread", async () => {
    const { adapter, chat } = await initialized();
    const response = await adapter.handleWebhook(chatNotification());

    expect(response.status).toBe(200);
    const { message, threadId } = dispatched(chat);
    expect(threadId).toBe(CHAT_THREAD);
    expect(message.id).toBe("cc106a89-1814-919d-454c-f4f2f970aae7");
    expect(message.text).toBe("Hi chat");
    expect(message.author).toEqual({
      fullName: "Viewer32",
      isBot: false,
      isMe: false,
      userId: VIEWER_ID,
      userName: "viewer32",
    });
    expect(message.isMention).toBeUndefined();
    expect(adapter.isDM(threadId)).toBe(false);
  });

  it("uses the EventSub timestamp as the message date", async () => {
    const { adapter, chat } = await initialized();
    const sentAt = new Date(Date.now() - 5000);
    await adapter.handleWebhook(
      signedRequest(
        {
          event: chatEvent(),
          subscription: subscription("channel.chat.message"),
        },
        { timestamp: nanoTimestamp(sentAt) }
      )
    );
    expect(dispatched(chat).message.metadata.dateSent.getTime()).toBe(
      sentAt.getTime()
    );
  });

  it("flags structured @mentions of the bot", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      chatNotification({
        message: {
          fragments: [
            {
              mention: {
                user_id: BOT_ID,
                user_login: BOT_LOGIN,
                user_name: BOT_LOGIN,
              },
              text: `@${BOT_LOGIN}`,
              type: "mention",
            },
            { text: " what's the song?", type: "text" },
          ],
          text: `@${BOT_LOGIN} what's the song?`,
        },
      })
    );
    expect(dispatched(chat).message.isMention).toBe(true);
  });

  it("treats replies to the bot's messages as mentions", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      chatNotification({
        reply: {
          parent_message_body: "Hello!",
          parent_message_id: "parent-1",
          parent_user_id: BOT_ID,
          parent_user_login: BOT_LOGIN,
          parent_user_name: BOT_LOGIN,
          thread_message_id: "parent-1",
          thread_user_id: BOT_ID,
          thread_user_login: BOT_LOGIN,
          thread_user_name: BOT_LOGIN,
        },
      })
    );
    expect(dispatched(chat).message.isMention).toBe(true);
  });

  it("exposes the replied-to message as replyTo", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      chatNotification({
        message: { fragments: [], text: `@${BOT_LOGIN} how come?` },
        reply: {
          parent_message_body: "Celeste is a great pick",
          parent_message_id: "parent-1",
          parent_user_id: BOT_ID,
          parent_user_login: BOT_LOGIN,
          parent_user_name: BOT_LOGIN,
          thread_message_id: "parent-1",
          thread_user_id: BOT_ID,
          thread_user_login: BOT_LOGIN,
          thread_user_name: BOT_LOGIN,
        },
      })
    );
    const { replyTo } = dispatched(chat).message;
    expect(replyTo?.id).toBe("parent-1");
    expect(replyTo?.text).toBe("Celeste is a great pick");
    expect(replyTo?.author.isMe).toBe(true);
    expect(replyTo?.author.userName).toBe(BOT_LOGIN);
    expect(replyTo?.raw).toMatchObject({
      event: {
        chatter_user_id: BOT_ID,
        message: { text: "Celeste is a great pick" },
        message_id: "parent-1",
        reply: null,
      },
      kind: "chat",
    });
    expect(replyTo?.metadata.dateSent.getTime()).toBeLessThan(
      dispatched(chat).message.metadata.dateSent.getTime()
    );
  });

  it("leaves replyTo unset on messages that aren't replies", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(chatNotification());
    expect(dispatched(chat).message.replyTo).toBeUndefined();
  });

  it("does not flag mentions of other users", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      chatNotification({
        message: {
          fragments: [
            {
              mention: {
                user_id: "123",
                user_login: "someone",
                user_name: "Someone",
              },
              text: "@someone",
              type: "mention",
            },
          ],
          text: "@someone",
        },
      })
    );
    expect(dispatched(chat).message.isMention).toBeUndefined();
  });

  it("routes whispers to a whisper thread keyed by the sender", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      signedRequest({
        event: whisperEvent(),
        subscription: subscription("user.whisper.message"),
      })
    );

    const { message, threadId } = await dispatchedWhisper(chat);
    expect(threadId).toBe(WHISPER_THREAD);
    expect(message.id).toBe("some-whisper-id");
    expect(message.text).toBe("a secret");
    expect(message.author.userName).toBe("viewer32");
    expect(adapter.isDM(threadId)).toBe(true);
    expect(
      await chat.getState().get(`twitch:whispered:${BOT_ID}:${VIEWER_ID}`)
    ).toBe(true);
  });

  it("ignores shared chat copies of messages from other channels", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      chatNotification({
        message_id: "copy-in-this-channel",
        source_broadcaster_user_id: "555",
        source_message_id: "original-id",
      })
    );
    expect(chat.processMessage).not.toHaveBeenCalled();

    await adapter.handleWebhook(
      chatNotification({
        source_broadcaster_user_id: BROADCASTER_ID,
        source_message_id: "cc106a89-1814-919d-454c-f4f2f970aae7",
      })
    );
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed events and unsupported subscription types", async () => {
    const { adapter, chat } = await initialized();
    await adapter.handleWebhook(
      signedRequest({
        event: { message_id: "x" },
        subscription: subscription("channel.chat.message"),
      })
    );
    await adapter.handleWebhook(
      signedRequest({
        event: { from_user_id: "1" },
        subscription: subscription("user.whisper.message"),
      })
    );
    await adapter.handleWebhook(
      signedRequest({
        event: { message_id: "x" },
        subscription: subscription("channel.chat.message_delete"),
      })
    );
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("acknowledges notifications before initialize without dispatching", async () => {
    const adapter = createAdapter();
    const response = await adapter.handleWebhook(chatNotification());
    expect(response.status).toBe(200);
  });
});

describe("postMessage", () => {
  it("sends chat messages as the bot with the app access token", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));

    const result = await adapter.postMessage(CHAT_THREAD, "Hello chat");

    expect(result.id).toBe("sent-1");
    expect(result.threadId).toBe(CHAT_THREAD);
    const call = lastHelixCall();
    expect(call.url.pathname).toBe("/helix/chat/messages");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer app-token-1",
      "Client-Id": CLIENT_ID,
      "Content-Type": "application/json",
    });
    expect(call.body).toEqual({
      broadcaster_id: BROADCASTER_ID,
      message: "Hello chat",
      sender_id: BOT_ID,
    });
  });

  it("caches the app access token across calls", async () => {
    const { adapter } = await initialized();
    queue(
      json({ data: [{ is_sent: true, message_id: "sent-1" }] }),
      json({ data: [{ is_sent: true, message_id: "sent-2" }] })
    );
    await adapter.postMessage(CHAT_THREAD, "one");
    await adapter.postMessage(CHAT_THREAD, "two");
    expect(tokenRequests).toHaveLength(1);
  });

  it("reuses the app access token stored by another instance", async () => {
    const state = createMockState();
    const first = await initialized(
      {},
      createMockChatInstance({ logger: mockLogger, state })
    );
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await first.adapter.postMessage(CHAT_THREAD, "one");

    const second = await initialized(
      {},
      createMockChatInstance({ logger: mockLogger, state })
    );
    queue(json({ data: [{ is_sent: true, message_id: "sent-2" }] }));
    await second.adapter.postMessage(CHAT_THREAD, "two");

    expect(tokenRequests).toHaveLength(1);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer app-token-1",
    });
  });

  it("doesn't reuse a rejected app token that couldn't be deleted from state", async () => {
    const state = createMockState();
    vi.spyOn(state, "delete").mockRejectedValue(new Error("state down"));
    const { adapter } = await initialized(
      {},
      createMockChatInstance({ logger: mockLogger, state })
    );
    queue(
      json({ data: [{ is_sent: true, message_id: "sent-1" }] }),
      json({ message: "Invalid OAuth token", status: 401 }, 401),
      json({ data: [{ is_sent: true, message_id: "sent-2" }] })
    );
    await adapter.postMessage(CHAT_THREAD, "one");
    await adapter.postMessage(CHAT_THREAD, "two");

    expect(tokenRequests).toHaveLength(2);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer app-token-2",
    });
  });

  it("refreshes the app access token once after a 401", async () => {
    const { adapter, chat } = await initialized();
    queue(
      json(
        { error: "Unauthorized", message: "Invalid OAuth token", status: 401 },
        401
      ),
      json({ data: [{ is_sent: true, message_id: "sent-1" }] })
    );
    await adapter.postMessage(CHAT_THREAD, "hello");
    expect(tokenRequests).toHaveLength(2);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer app-token-2",
    });
    expect(await chat.getState().get(APP_TOKEN_KEY)).toMatchObject({
      accessToken: "app-token-2",
    });
  });

  it("flattens markdown to a single line of plain text", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.postMessage(CHAT_THREAD, {
      markdown:
        "**Top songs**\n\n- one\n- two\n\nSee [the list](https://example.com)",
    });
    expect(lastHelixCall().body.message).toBe(
      "Top songs • one • two See the list (https://example.com)"
    );
  });

  it("renders cards as plain text", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.postMessage(CHAT_THREAD, {
      card: {
        children: [
          { content: "Vote now", type: "text" },
          {
            children: [
              {
                label: "Open",
                type: "link-button",
                url: "https://example.com",
              },
            ],
            type: "actions",
          },
        ],
        title: "Poll",
        type: "card",
      },
    });
    expect(lastHelixCall().body.message).toBe(
      "Poll · Vote now · Open: https://example.com"
    );
  });

  it("converts emoji placeholders to unicode", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.postMessage(CHAT_THREAD, "GG {{emoji:fire}}");
    expect(lastHelixCall().body.message).toBe("GG 🔥");
  });

  it("truncates chat messages to 500 characters", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.postMessage(CHAT_THREAD, "a".repeat(600));
    const message = String(lastHelixCall().body.message);
    expect(Array.from(message)).toHaveLength(500);
    expect(message.endsWith("…")).toBe(true);
  });

  it("truncates at the last word boundary", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    const words = Array.from({ length: 100 }, (_, i) => `word${i + 1}`);
    await adapter.postMessage(CHAT_THREAD, words.join(" "));
    const message = String(lastHelixCall().body.message);
    expect(Array.from(message).length).toBeLessThanOrEqual(500);
    expect(message.endsWith(" word72…")).toBe(true);
  });

  it("throws when Twitch drops the message", async () => {
    const { adapter } = await initialized();
    queue(
      json({
        data: [
          {
            drop_reason: {
              code: "msg_duplicate",
              message: "Message is a duplicate",
            },
            is_sent: false,
            message_id: "",
          },
        ],
      })
    );
    await expect(adapter.postMessage(CHAT_THREAD, "hi")).rejects.toThrow(
      "Twitch dropped the chat message: Message is a duplicate (msg_duplicate)"
    );
  });

  it("skips the blank placeholder Chat SDK posts for empty output", async () => {
    const { adapter } = await initialized();
    const result = await adapter.postMessage(CHAT_THREAD, { markdown: " " });
    expect(result.id).toBeTruthy();
    expect(result.threadId).toBe(CHAT_THREAD);
    expect(helixCalls()).toHaveLength(0);
  });

  it("rejects messages that render empty, and attachments", async () => {
    const { adapter } = await initialized();
    await expect(
      adapter.postMessage(CHAT_THREAD, { markdown: "---" })
    ).rejects.toThrow(ValidationError);
    await expect(
      adapter.postMessage(CHAT_THREAD, {
        files: [{ data: Buffer.from("x"), filename: "x.png" }],
        markdown: "pic",
      })
    ).rejects.toThrow("file uploads");
  });

  it("posts to a chat room by channel ID", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.postChannelMessage(CHAT_THREAD, "Stream starting!");
    expect(lastHelixCall().body.broadcaster_id).toBe(BROADCASTER_ID);
  });

  it("returns no messages so Chat SDK reads its persisted history", async () => {
    const { adapter } = await initialized();
    await adapter.handleWebhook(chatNotification());
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.postMessage(CHAT_THREAD, "reply");

    expect(await adapter.fetchMessages(CHAT_THREAD)).toEqual({ messages: [] });
    await expect(adapter.fetchMessages("slack:C1:1")).rejects.toThrow(
      ValidationError
    );
  });
});

describe("reply", () => {
  it("sets reply_parent_message_id on chat replies", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    await adapter.reply(CHAT_THREAD, "parent-1", "On it!");
    expect(lastHelixCall().body).toMatchObject({
      message: "On it!",
      reply_parent_message_id: "parent-1",
    });
  });
});

describe("whispers", () => {
  it("requires a user access token", async () => {
    const { adapter } = await initialized();
    await expect(adapter.postMessage(WHISPER_THREAD, "hi")).rejects.toThrow(
      "user:manage:whispers"
    );
  });

  it("sends whispers with the user access token", async () => {
    const { adapter } = await initialized({ userAccessToken: "user-token" });
    queue(new Response(null, { status: 204 }));

    const result = await adapter.postMessage(WHISPER_THREAD, "psst");

    expect(result.threadId).toBe(WHISPER_THREAD);
    expect(result.id).toBeTruthy();
    const call = lastHelixCall();
    expect(call.url.pathname).toBe("/helix/whispers");
    expect(call.url.searchParams.get("from_user_id")).toBe(BOT_ID);
    expect(call.url.searchParams.get("to_user_id")).toBe(VIEWER_ID);
    expect(call.body).toEqual({ message: "psst" });
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer user-token",
    });
  });

  it("accepts a token provider function", async () => {
    const provider = vi.fn(async () => "provided-token");
    const { adapter } = await initialized({ userAccessToken: provider });
    queue(new Response(null, { status: 204 }));
    await adapter.postMessage(WHISPER_THREAD, "psst");
    expect(provider).toHaveBeenCalled();
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer provided-token",
    });
  });

  it("refreshes and persists a managed user token", async () => {
    const state = createMockState();
    const chat = createMockChatInstance({ logger: mockLogger, state });
    const { adapter } = await initialized(
      { refreshToken: "initial-refresh" },
      chat
    );
    queue(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 })
    );

    await adapter.postMessage(WHISPER_THREAD, "one");
    await adapter.postMessage(WHISPER_THREAD, "two");

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token");
    expect(tokenRequests[0]?.get("refresh_token")).toBe("initial-refresh");
    expect(tokenRequests[0]?.get("client_id")).toBe(CLIENT_ID);
    expect(tokenRequests[0]?.get("client_secret")).toBe(CLIENT_SECRET);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer user-token-1",
    });
    expect(await state.get(USER_TOKEN_KEY)).toMatchObject({
      accessToken: "user-token-1",
      refreshToken: "rotated-refresh-1",
    });
  });

  it("shares one state read and one refresh between concurrent whispers", async () => {
    const state = createMockState();
    const getSpy = vi.spyOn(state, "get");
    const { adapter } = await initialized(
      { refreshToken: "initial-refresh" },
      createMockChatInstance({ logger: mockLogger, state })
    );
    queue(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 })
    );

    await Promise.all([
      adapter.postMessage(WHISPER_THREAD, "one"),
      adapter.postMessage(WHISPER_THREAD, "two"),
    ]);

    expect(tokenRequests).toHaveLength(1);
    const userTokenReads = getSpy.mock.calls.filter(
      ([key]) => key === USER_TOKEN_KEY
    );
    // One load, plus one re-read before the refresh.
    expect(userTokenReads).toHaveLength(2);
  });

  it("ignores a stored token minted from a different refresh token", async () => {
    const state = createMockState();
    const chat = createMockChatInstance({ logger: mockLogger, state });
    const first = await initialized({ refreshToken: "old-refresh" }, chat);
    queue(new Response(null, { status: 204 }));
    await first.adapter.postMessage(WHISPER_THREAD, "one");

    const next = await initialized({ refreshToken: "new-refresh" }, chat);
    queue(new Response(null, { status: 204 }));
    await next.adapter.postMessage(WHISPER_THREAD, "two");

    expect(tokenRequests.map((p) => p.get("refresh_token"))).toEqual([
      "old-refresh",
      "new-refresh",
    ]);
  });

  it("keeps tokens for different bots apart", async () => {
    const state = createMockState();
    const chat = createMockChatInstance({ logger: mockLogger, state });
    const bot = await initialized({ refreshToken: "shared-refresh" }, chat);
    queue(new Response(null, { status: 204 }));
    await bot.adapter.postMessage(WHISPER_THREAD, "one");

    const other = await initialized(
      { refreshToken: "shared-refresh", userId: "777", userName: "otherbot" },
      chat
    );
    queue(new Response(null, { status: 204 }));
    await other.adapter.postMessage(WHISPER_THREAD, "two");

    expect(tokenRequests).toHaveLength(2);
    expect(await state.get(`twitch:oauth:${CLIENT_ID}:777`)).toBeTruthy();
  });

  it("uses a refresh stored by another instance before refreshing itself", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const state = createMockState();
      const chat = createMockChatInstance({ logger: mockLogger, state });
      const a = await initialized({ refreshToken: "initial-refresh" }, chat);
      const b = await initialized({ refreshToken: "initial-refresh" }, chat);
      queue(
        new Response(null, { status: 204 }),
        new Response(null, { status: 204 })
      );
      await a.adapter.postMessage(WHISPER_THREAD, "one");
      await b.adapter.postMessage(WHISPER_THREAD, "two");
      expect(tokenRequests).toHaveLength(1);

      // Both in-memory tokens expire; A refreshes and rotates first.
      vi.setSystemTime(Date.now() + 15_000_000);
      queue(
        new Response(null, { status: 204 }),
        new Response(null, { status: 204 })
      );
      await a.adapter.postMessage(WHISPER_THREAD, "three");
      await b.adapter.postMessage(WHISPER_THREAD, "four");

      expect(tokenRequests.map((p) => p.get("refresh_token"))).toEqual([
        "initial-refresh",
        "rotated-refresh-1",
      ]);
      expect(lastHelixCall().init.headers).toMatchObject({
        Authorization: "Bearer user-token-2",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the user token and retries once after a 401", async () => {
    const { adapter } = await initialized({ refreshToken: "initial-refresh" });
    queue(
      new Response(null, { status: 204 }),
      json({ message: "Invalid OAuth token", status: 401 }, 401),
      new Response(null, { status: 204 })
    );
    await adapter.postMessage(WHISPER_THREAD, "one");
    await adapter.postMessage(WHISPER_THREAD, "two");

    expect(tokenRequests).toHaveLength(2);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer user-token-2",
    });
  });

  it("uses a configured access token before refreshing it", async () => {
    const { adapter } = await initialized({
      refreshToken: "initial-refresh",
      userAccessToken: "configured-token",
    });
    queue(
      new Response(null, { status: 204 }),
      json({ message: "Invalid OAuth token", status: 401 }, 401),
      new Response(null, { status: 204 })
    );

    await adapter.postMessage(WHISPER_THREAD, "one");
    expect(tokenRequests).toHaveLength(0);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer configured-token",
    });

    await adapter.postMessage(WHISPER_THREAD, "two");
    expect(tokenRequests).toHaveLength(1);
    expect(lastHelixCall().init.headers).toMatchObject({
      Authorization: "Bearer user-token-1",
    });
  });

  it("does not retry a 401 on a static user token", async () => {
    const { adapter } = await initialized({ userAccessToken: "user-token" });
    queue(json({ message: "Invalid OAuth token", status: 401 }, 401));
    await expect(adapter.postMessage(WHISPER_THREAD, "hi")).rejects.toThrow(
      AuthenticationError
    );
    expect(helixCalls()).toHaveLength(1);
  });

  it("limits whispers to 500 characters until the user has whispered the bot", async () => {
    const { adapter, chat } = await initialized({
      userAccessToken: "user-token",
    });
    const long = "word ".repeat(400).trim();
    queue(new Response(null, { status: 204 }));
    await adapter.postMessage(WHISPER_THREAD, long);
    const first = String(lastHelixCall().body.message);
    expect(Array.from(first).length).toBeLessThanOrEqual(500);
    expect(first.endsWith("…")).toBe(true);

    await adapter.handleWebhook(
      signedRequest({
        event: whisperEvent(),
        subscription: subscription("user.whisper.message"),
      })
    );
    await dispatchedWhisper(chat);
    queue(new Response(null, { status: 204 }));
    await adapter.postMessage(WHISPER_THREAD, long);
    expect(lastHelixCall().body.message).toBe(long);
  });

  it("encrypts the persisted token when an encryption key is set", async () => {
    const state = createMockState();
    const chat = createMockChatInstance({ logger: mockLogger, state });
    const encryptionKey = Buffer.alloc(32, 7).toString("base64");
    const { adapter } = await initialized(
      { encryptionKey, refreshToken: "initial-refresh" },
      chat
    );
    queue(new Response(null, { status: 204 }));
    await adapter.postMessage(WHISPER_THREAD, "one");

    const stored = await state.get<{ refreshToken: unknown }>(USER_TOKEN_KEY);
    expect(typeof stored?.refreshToken).toBe("object");

    // A fresh adapter reads the stored token back instead of refreshing.
    const next = await initialized(
      { encryptionKey, refreshToken: "initial-refresh" },
      chat
    );
    queue(new Response(null, { status: 204 }));
    await next.adapter.postMessage(WHISPER_THREAD, "two");
    expect(tokenRequests).toHaveLength(1);
  });

  it("surfaces refresh failures as authentication errors", async () => {
    const { adapter } = await initialized({ refreshToken: "bad-refresh" });
    mockFetch.mockImplementationOnce(async () =>
      json({ message: "Invalid refresh token", status: 400 }, 400)
    );
    await expect(adapter.postMessage(WHISPER_THREAD, "hi")).rejects.toThrow(
      AuthenticationError
    );
  });

  it("opens whisper threads by user ID", async () => {
    const adapter = createAdapter();
    expect(await adapter.openDM(VIEWER_ID)).toBe(WHISPER_THREAD);
  });
});

describe("deleteMessage", () => {
  it("deletes chat messages as the bot moderator", async () => {
    const { adapter } = await initialized();
    queue(new Response(null, { status: 204 }));
    await adapter.deleteMessage(CHAT_THREAD, "msg-1");

    const call = lastHelixCall();
    expect(call.init.method).toBe("DELETE");
    expect(call.url.pathname).toBe("/helix/moderation/chat");
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      broadcaster_id: BROADCASTER_ID,
      message_id: "msg-1",
      moderator_id: BOT_ID,
    });
  });

  it("rejects an empty message ID instead of clearing the chat", async () => {
    const { adapter } = await initialized();
    await expect(adapter.deleteMessage(CHAT_THREAD, "")).rejects.toThrow(
      ValidationError
    );
    expect(helixCalls()).toHaveLength(0);
  });

  it("rejects deleting whispers", async () => {
    const { adapter } = await initialized();
    await expect(adapter.deleteMessage(WHISPER_THREAD, "w-1")).rejects.toThrow(
      ValidationError
    );
  });

  it("maps 403 responses to PermissionError", async () => {
    const { adapter } = await initialized();
    queue(
      json(
        {
          error: "Forbidden",
          message:
            "The user in moderator_id is not one of the broadcaster's moderators.",
          status: 403,
        },
        403
      )
    );
    await expect(adapter.deleteMessage(CHAT_THREAD, "msg-1")).rejects.toThrow(
      PermissionError
    );
  });
});

describe("unsupported operations", () => {
  it("rejects edits and reactions", async () => {
    const { adapter } = await initialized();
    await expect(adapter.editMessage(CHAT_THREAD, "m", "x")).rejects.toThrow(
      ValidationError
    );
    await expect(
      adapter.addReaction(CHAT_THREAD, "m", "heart")
    ).rejects.toThrow(ValidationError);
    await expect(
      adapter.removeReaction(CHAT_THREAD, "m", "heart")
    ).rejects.toThrow(ValidationError);
  });

  it("treats typing as a no-op", async () => {
    const { adapter } = await initialized();
    await expect(adapter.startTyping(CHAT_THREAD)).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("stream", () => {
  it("buffers the stream and posts once", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [{ is_sent: true, message_id: "sent-1" }] }));
    async function* chunks() {
      yield "Hello ";
      yield { text: "**chat**", type: "markdown_text" as const };
      yield {
        id: "t",
        status: "complete" as const,
        title: "x",
        type: "task_update" as const,
      };
    }
    const result = await adapter.stream(CHAT_THREAD, chunks());
    expect(result.id).toBe("sent-1");
    expect(helixCalls()).toHaveLength(1);
    expect(lastHelixCall().body.message).toBe("Hello chat");
  });

  it("posts nothing when the stream has no text", async () => {
    const { adapter } = await initialized();
    async function* chunks() {
      yield {
        id: "t",
        status: "complete" as const,
        title: "x",
        type: "task_update" as const,
      };
    }
    const result = await adapter.stream(CHAT_THREAD, chunks());
    expect(result.id).toBeTruthy();
    expect(helixCalls()).toHaveLength(0);
  });
});

describe("errors", () => {
  it("maps 429 responses to AdapterRateLimitError with the reset delay", async () => {
    const { adapter } = await initialized();
    const reset = Math.floor(Date.now() / 1000) + 30;
    queue(
      json({ error: "Too Many Requests", status: 429 }, 429, {
        "ratelimit-reset": String(reset),
      })
    );
    const error = await adapter.postMessage(CHAT_THREAD, "hi").catch((e) => e);
    expect(error).toBeInstanceOf(AdapterRateLimitError);
    expect(error.retryAfter).toBeGreaterThan(25);
  });

  it("maps 422 responses to ValidationError with Twitch's message", async () => {
    const { adapter } = await initialized();
    queue(
      json(
        {
          error: "Unprocessable Entity",
          message: "The message is too large.",
          status: 422,
        },
        422
      )
    );
    await expect(adapter.postMessage(CHAT_THREAD, "hi")).rejects.toThrow(
      "The message is too large."
    );
  });

  it("surfaces app token failures as authentication errors", async () => {
    const { adapter } = await initialized();
    mockFetch.mockImplementationOnce(async () =>
      json({ message: "invalid client secret", status: 403 }, 403)
    );
    await expect(adapter.postMessage(CHAT_THREAD, "hi")).rejects.toThrow(
      AuthenticationError
    );
  });
});

describe("getUser", () => {
  it("returns user info from Get Users", async () => {
    const { adapter } = await initialized();
    queue(
      json({
        data: [
          {
            broadcaster_type: "partner",
            display_name: "TwitchDev",
            id: "141981764",
            login: "twitchdev",
            profile_image_url: "https://static-cdn.jtvnw.net/avatar.png",
            type: "",
          },
        ],
      })
    );
    expect(await adapter.getUser("141981764")).toEqual({
      avatarUrl: "https://static-cdn.jtvnw.net/avatar.png",
      fullName: "TwitchDev",
      isBot: false,
      userId: "141981764",
      userName: "twitchdev",
    });
  });

  it("returns null for unknown users", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [] }));
    expect(await adapter.getUser("0")).toBeNull();
  });
});

describe("EventSub subscriptions", () => {
  it("subscribes to a broadcaster's chat as the bot", async () => {
    const { adapter } = await initialized();
    queue(
      json(
        {
          data: [
            subscription(
              "channel.chat.message",
              "webhook_callback_verification_pending"
            ),
          ],
          max_total_cost: 10_000,
          total: 1,
          total_cost: 0,
        },
        202
      )
    );

    const result = await adapter.subscribeToChat(
      BROADCASTER_ID,
      "https://example.com/api/webhooks/twitch"
    );

    expect(result.status).toBe("webhook_callback_verification_pending");
    const call = lastHelixCall();
    expect(call.url.pathname).toBe("/helix/eventsub/subscriptions");
    expect(call.body).toEqual({
      condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
      transport: {
        callback: "https://example.com/api/webhooks/twitch",
        method: "webhook",
        secret: WEBHOOK_SECRET,
      },
      type: "channel.chat.message",
      version: "1",
    });
  });

  it("subscribes to whispers sent to the bot", async () => {
    const { adapter } = await initialized();
    queue(json({ data: [subscription("user.whisper.message")] }, 202));
    await adapter.subscribeToWhispers(
      "https://example.com/api/webhooks/twitch"
    );
    expect(lastHelixCall().body).toMatchObject({
      condition: { user_id: BOT_ID },
      type: "user.whisper.message",
    });
  });
});

describe("thread helpers", () => {
  it("rejects malformed thread IDs", () => {
    const adapter = createAdapter();
    for (const id of [
      "slack:C1",
      "twitch:",
      "twitch:whisper",
      "twitch:a:b",
      "twitch:whisper:",
    ]) {
      expect(() => adapter.decodeThreadId(id)).toThrow(ValidationError);
    }
  });

  it("uses the thread ID as the channel ID", () => {
    const adapter = createAdapter();
    expect(adapter.channelIdFromThreadId(CHAT_THREAD)).toBe(CHAT_THREAD);
    expect(adapter.channelIdFromThreadId(WHISPER_THREAD)).toBe(WHISPER_THREAD);
  });

  it("describes threads", async () => {
    const adapter = createAdapter();
    expect(await adapter.fetchThread(WHISPER_THREAD)).toEqual({
      channelId: WHISPER_THREAD,
      id: WHISPER_THREAD,
      isDM: true,
      metadata: { kind: "whisper", userId: VIEWER_ID },
    });
  });

  it("parses raw chat and whisper messages", async () => {
    const { adapter } = await initialized();
    const chatMessage = adapter.parseMessage({
      event: chatEvent(),
      kind: "chat",
    });
    expect(chatMessage.threadId).toBe(CHAT_THREAD);

    const outbound = adapter.parseMessage({
      event: whisperEvent({ from_user_id: BOT_ID, to_user_id: VIEWER_ID }),
      kind: "whisper",
    });
    expect(outbound.threadId).toBe(WHISPER_THREAD);
    expect(outbound.author.isMe).toBe(true);
  });

  it("renders formatted content as one line", () => {
    const adapter = createAdapter();
    expect(
      adapter.renderFormatted({
        children: [
          { children: [{ type: "text", value: "one" }], type: "paragraph" },
          { children: [{ type: "text", value: "two" }], type: "paragraph" },
        ],
        type: "root",
      })
    ).toBe("one two");
  });
});
