import { AuthenticationError } from "@chat-adapter/shared";
import type {
  CardActionEvent,
  LarkChannel,
  LarkChannelOptions,
  ReactionEvent as LarkReactionEvent,
  NormalizedMessage,
  SendInput,
  SendOptions,
  SendResult,
  StreamInput,
} from "@larksuiteoapi/node-sdk";
import type { ActionEvent, ChatInstance, ReactionEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLarkAdapter, LarkAdapter } from "./index";

const NO_REACTION_PATTERN = /No reaction of type/;

// ===========================================================================
// Hand-rolled fakes (per user instruction: no vi.mock)
// ===========================================================================

interface ChannelCall {
  args: unknown[];
  method: string;
}

interface FakeChannelState {
  addReactionCalls: Array<{ messageId: string; emojiType: string }>;
  connectCalls: number;
  disconnectCalls: number;
  editCalls: Array<{ messageId: string; text: string }>;
  handlers: Map<string, (...a: unknown[]) => unknown>;
  lastStreamAppendedChunks: string[];
  options: LarkChannelOptions | null;
  rawClientCalls: ChannelCall[];
  recallCalls: string[];
  removeReactionByEmojiCalls: Array<{ messageId: string; emojiType: string }>;
  /** Controls the bool `removeReactionByEmoji` returns (found-and-removed). */
  removeReactionByEmojiReturn: boolean;
  sendCalls: Array<{ to: string; input: SendInput; opts?: SendOptions }>;
  streamCalls: Array<{ to: string; input: StreamInput; opts?: SendOptions }>;
}

function createFakeChannelState(): FakeChannelState {
  return {
    options: null,
    handlers: new Map(),
    connectCalls: 0,
    disconnectCalls: 0,
    sendCalls: [],
    streamCalls: [],
    editCalls: [],
    recallCalls: [],
    addReactionCalls: [],
    removeReactionByEmojiCalls: [],
    removeReactionByEmojiReturn: true,
    rawClientCalls: [],
    lastStreamAppendedChunks: [],
  };
}

/** Build a fake `LarkChannel` sufficient for LarkAdapter to drive. */
function createFakeChannel(
  state: FakeChannelState,
  opts: LarkChannelOptions
): LarkChannel {
  state.options = opts;

  const rawClient = {
    im: {
      v1: {
        message: {
          get: async (args: unknown) => {
            state.rawClientCalls.push({ method: "message.get", args: [args] });
            // Default: message has a root_id of om_root_1
            return {
              data: {
                items: [
                  {
                    message_id: "om_fetched",
                    root_id: "om_root_1",
                    parent_id: "om_parent",
                    chat_id: "oc_chat_1",
                  },
                ],
              },
            };
          },
          patch: async (args: unknown) => {
            state.rawClientCalls.push({
              method: "message.patch",
              args: [args],
            });
            return { data: {} };
          },
          delete: async (args: unknown) => {
            state.rawClientCalls.push({
              method: "message.delete",
              args: [args],
            });
            return { data: {} };
          },
          list: async (args: unknown) => {
            state.rawClientCalls.push({ method: "message.list", args: [args] });
            return {
              data: {
                has_more: false,
                page_token: "",
                items: [],
              },
            };
          },
        },
      },
    },
  };

  const fake = {
    botIdentity: { openId: "ou_bot", name: "TestBot" },
    rawClient,
    rawWsClient: undefined,
    on(event: string, handler: (...a: unknown[]) => unknown) {
      state.handlers.set(event, handler);
      return () => state.handlers.delete(event);
    },
    async connect() {
      state.connectCalls++;
    },
    async disconnect() {
      state.disconnectCalls++;
    },
    async send(
      to: string,
      input: SendInput,
      sendOpts?: SendOptions
    ): Promise<SendResult> {
      state.sendCalls.push({ to, input, opts: sendOpts });
      return {
        messageId: `om_sent_${state.sendCalls.length}`,
      };
    },
    async stream(
      to: string,
      input: StreamInput,
      sendOpts?: SendOptions
    ): Promise<SendResult> {
      state.streamCalls.push({ to, input, opts: sendOpts });
      if ("markdown" in input) {
        const controller = {
          messageId: "om_streaming",
          append: async (chunk: string) => {
            state.lastStreamAppendedChunks.push(chunk);
          },
          setContent: async (_full: string) => {
            // noop for tests
          },
        };
        await input.markdown(controller);
      }
      return { messageId: "om_streamed" };
    },
    async editMessage(messageId: string, text: string) {
      state.editCalls.push({ messageId, text });
    },
    async recallMessage(messageId: string) {
      state.recallCalls.push(messageId);
    },
    async addReaction(messageId: string, emojiType: string) {
      state.addReactionCalls.push({ messageId, emojiType });
      return "r_1";
    },
    async removeReactionByEmoji(messageId: string, emojiType: string) {
      state.removeReactionByEmojiCalls.push({ messageId, emojiType });
      return state.removeReactionByEmojiReturn;
    },
    updatePolicy() {
      /* noop */
    },
    getPolicy() {
      return {};
    },
  } as unknown as LarkChannel;

  return fake;
}

// ---------------------------------------------------------------------------
// Fake ChatInstance
// ---------------------------------------------------------------------------

interface ChatCalls {
  processAction: Array<{ event: unknown; options?: unknown }>;
  processMessage: Array<{
    adapter: unknown;
    threadId: string;
    message: unknown;
    options?: unknown;
  }>;
  processReaction: Array<{ event: unknown; options?: unknown }>;
}

function createFakeChat(): { chat: ChatInstance; calls: ChatCalls } {
  const calls: ChatCalls = {
    processMessage: [],
    processAction: [],
    processReaction: [],
  };
  const chat = {
    getLogger: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      child: () => chat.getLogger(),
    }),
    getState: () => ({}) as never,
    getUserName: () => "bot",
    handleIncomingMessage: async () => {},
    processMessage: (
      adapter: unknown,
      threadId: string,
      message: unknown,
      options?: unknown
    ) => {
      calls.processMessage.push({ adapter, threadId, message, options });
    },
    processAction: async (event: unknown, options?: unknown) => {
      calls.processAction.push({ event, options });
    },
    processReaction: (event: unknown, options?: unknown) => {
      calls.processReaction.push({ event, options });
    },
    processAppHomeOpened: () => {},
    processAssistantContextChanged: () => {},
    processAssistantThreadStarted: () => {},
    processMemberJoinedChannel: () => {},
    processModalClose: () => {},
    processModalSubmit: async () => undefined,
    processSlashCommand: () => {},
  } as unknown as ChatInstance;
  return { chat, calls };
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildNormalizedMessage(
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    messageId: "om_msg_1",
    chatId: "oc_chat_1",
    chatType: "group",
    senderId: "ou_user_1",
    senderName: "Alice",
    content: "Hello **world**",
    rawContentType: "post",
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    rootId: undefined,
    threadId: undefined,
    replyToMessageId: undefined,
    createTime: 1_700_000_000_000,
    raw: undefined,
    ...overrides,
  };
}

function buildCardActionEvent(
  overrides: Partial<CardActionEvent> = {}
): CardActionEvent {
  return {
    messageId: "om_card_msg",
    chatId: "oc_chat_1",
    operator: { openId: "ou_user_1", name: "Alice" },
    action: { value: "approve", tag: "button", name: "approve_btn" },
    ...overrides,
  };
}

function buildReactionEvent(
  overrides: Partial<LarkReactionEvent> = {}
): LarkReactionEvent {
  return {
    messageId: "om_reacted_msg",
    operator: { openId: "ou_user_1" },
    emojiType: "THUMBSUP",
    action: "added",
    actionTime: 1_700_000_000_000,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("LarkAdapter — construction", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("LARK_")) {
        delete process.env[key];
      }
    }
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("exports createLarkAdapter factory", () => {
    expect(typeof createLarkAdapter).toBe("function");
  });

  it("creates an instance with appId and appSecret", () => {
    const adapter = createLarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
    });
    expect(adapter).toBeInstanceOf(LarkAdapter);
    expect(adapter.name).toBe("lark");
  });

  it("throws AuthenticationError when appId missing", () => {
    expect(() => new LarkAdapter({ appSecret: "secret_test" })).toThrow(
      AuthenticationError
    );
  });

  it("throws AuthenticationError when appSecret missing", () => {
    expect(() => new LarkAdapter({ appId: "cli_test" })).toThrow(
      AuthenticationError
    );
  });

  it("resolves appId and appSecret from env vars", () => {
    process.env.LARK_APP_ID = "cli_env";
    process.env.LARK_APP_SECRET = "secret_env";
    const adapter = new LarkAdapter();
    expect(adapter).toBeInstanceOf(LarkAdapter);
  });

  it("defaults userName to 'bot'", () => {
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
    });
    expect(adapter.userName).toBe("bot");
  });

  it("uses config.userName when provided", () => {
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      userName: "mybot",
    });
    expect(adapter.userName).toBe("mybot");
  });

  it("has persistMessageHistory === false", () => {
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
    });
    expect(adapter.persistMessageHistory).toBe(false);
  });
});

// ===========================================================================
// Lifecycle
// ===========================================================================

describe("LarkAdapter — lifecycle", () => {
  function build(): {
    adapter: LarkAdapter;
    state: FakeChannelState;
    chatHarness: ReturnType<typeof createFakeChat>;
  } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    return { adapter, state, chatHarness: createFakeChat() };
  }

  it("initialize() creates LarkChannel with websocket transport", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    expect(state.options?.transport).toBe("websocket");
    expect(state.options?.appId).toBe("cli_test");
    expect(state.options?.appSecret).toBe("secret_test");
  });

  it("initialize() tags the User-Agent with source=vercel-chat", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    expect(state.options?.source).toBe("vercel-chat");
  });

  it("initialize() disables channel safety (Vercel chat SDK handles it)", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    // staleMessageWindowMs must be ∞ (not 0!) — 0 means "0 ms tolerance"
    // which drops every real message. See comment in src/index.ts.
    expect(state.options?.safety?.staleMessageWindowMs).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(state.options?.safety?.chatQueue?.enabled).toBe(false);
    expect(state.options?.safety?.batch?.text?.delayMs).toBe(0);
  });

  it("initialize() plumbs chat.getLogger('lark') into channel logger", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    expect(state.options?.logger).toBeDefined();
  });

  it("initialize() registers message, cardAction, reaction handlers", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    expect(state.handlers.has("message")).toBe(true);
    expect(state.handlers.has("cardAction")).toBe(true);
    expect(state.handlers.has("reaction")).toBe(true);
  });

  it("initialize() calls channel.connect()", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    expect(state.connectCalls).toBe(1);
  });

  it("disconnect() calls channel.disconnect()", async () => {
    const { adapter, state, chatHarness } = build();
    await adapter.initialize(chatHarness.chat);
    await adapter.disconnect();
    expect(state.disconnectCalls).toBe(1);
  });

  it("handleWebhook() returns 501 (ws-only adapter)", async () => {
    const { adapter } = build();
    const response = await adapter.handleWebhook(new Request("http://x/"));
    expect(response.status).toBe(501);
  });
});

// ===========================================================================
// Inbound — message
// ===========================================================================

describe("LarkAdapter — inbound message", () => {
  async function setupAndEmit(
    nm: NormalizedMessage
  ): Promise<{ state: FakeChannelState; calls: ChatCalls }> {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    const { chat, calls } = createFakeChat();
    await adapter.initialize(chat);
    const handler = state.handlers.get("message");
    await handler?.(nm);
    return { state, calls };
  }

  it("emits chat.processMessage on a message event", async () => {
    const { calls } = await setupAndEmit(buildNormalizedMessage());
    expect(calls.processMessage).toHaveLength(1);
  });

  it("derives threadId from root_id when present (ignores thread_id)", async () => {
    // thread_id is a topic-container ID (omt_*), not a message ID — it
    // cannot be used as replyTo on the send API. We use root_id/message_id.
    const { calls } = await setupAndEmit(
      buildNormalizedMessage({
        messageId: "om_msg",
        rootId: "om_root",
        threadId: "omt_topic",
      })
    );
    expect(calls.processMessage[0].threadId).toBe("lark:oc_chat_1:om_root");
  });

  it("derives threadId from message_id when root_id is absent", async () => {
    const { calls } = await setupAndEmit(
      buildNormalizedMessage({
        messageId: "om_msg",
        threadId: "omt_topic",
      })
    );
    expect(calls.processMessage[0].threadId).toBe("lark:oc_chat_1:om_msg");
  });

  it("message factory produces Message with parsed mdast content", async () => {
    const { calls } = await setupAndEmit(
      buildNormalizedMessage({ content: "Hello **world**" })
    );
    const factory = calls.processMessage[0].message as () => Promise<{
      text: string;
      formatted: { type: string };
      raw: NormalizedMessage;
    }>;
    const msg = await factory();
    expect(msg.text).toContain("Hello");
    expect(msg.formatted.type).toBe("root");
    expect(msg.raw.messageId).toBe("om_msg_1");
  });

  it("message factory author uses senderId/senderName", async () => {
    const { calls } = await setupAndEmit(
      buildNormalizedMessage({
        senderId: "ou_user_99",
        senderName: "Bob",
      })
    );
    const factory = calls.processMessage[0].message as () => Promise<{
      author: { userId: string; fullName: string };
    }>;
    const msg = await factory();
    expect(msg.author.userId).toBe("ou_user_99");
    expect(msg.author.fullName).toBe("Bob");
  });

  it("treats chatType='private' as group for threadId purposes", async () => {
    const { calls } = await setupAndEmit(
      buildNormalizedMessage({
        chatType: "private" as NormalizedMessage["chatType"],
      })
    );
    expect(calls.processMessage[0].threadId).toContain("lark:oc_chat_1:");
  });
});

// ===========================================================================
// Inbound — cardAction
// ===========================================================================

describe("LarkAdapter — inbound cardAction", () => {
  async function setupAndEmit(
    evt: CardActionEvent
  ): Promise<{ state: FakeChannelState; calls: ChatCalls }> {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    const { chat, calls } = createFakeChat();
    await adapter.initialize(chat);
    const handler = state.handlers.get("cardAction");
    await handler?.(evt);
    return { state, calls };
  }

  it("fetches root_id via rawClient.im.v1.message.get before dispatching", async () => {
    const { state } = await setupAndEmit(buildCardActionEvent());
    expect(state.rawClientCalls.some((c) => c.method === "message.get")).toBe(
      true
    );
  });

  it("calls chat.processAction with fetched threadId", async () => {
    const { calls } = await setupAndEmit(buildCardActionEvent());
    expect(calls.processAction).toHaveLength(1);
    const event = calls.processAction[0].event as ActionEvent;
    // Fake's message.get returns root_id: "om_root_1"
    expect(event.threadId).toBe("lark:oc_chat_1:om_root_1");
  });

  it("actionId prefers action.name over action.tag", async () => {
    const { calls } = await setupAndEmit(
      buildCardActionEvent({
        action: { value: "x", tag: "button", name: "approve_btn" },
      })
    );
    expect((calls.processAction[0].event as ActionEvent).actionId).toBe(
      "approve_btn"
    );
  });

  it("actionId falls back to action.tag when name absent", async () => {
    const { calls } = await setupAndEmit(
      buildCardActionEvent({ action: { value: "x", tag: "button" } })
    );
    expect((calls.processAction[0].event as ActionEvent).actionId).toBe(
      "button"
    );
  });

  it("serializes action.value object to JSON string", async () => {
    const { calls } = await setupAndEmit(
      buildCardActionEvent({
        action: { value: { id: 42, type: "order" }, tag: "button" },
      })
    );
    const event = calls.processAction[0].event as ActionEvent;
    expect(event.value).toBe('{"id":42,"type":"order"}');
  });

  it("passes string action.value through unchanged", async () => {
    const { calls } = await setupAndEmit(
      buildCardActionEvent({ action: { value: "approve", tag: "button" } })
    );
    expect((calls.processAction[0].event as ActionEvent).value).toBe("approve");
  });

  it("user field populated from operator", async () => {
    const { calls } = await setupAndEmit(
      buildCardActionEvent({
        operator: { openId: "ou_clicker", name: "Clicker" },
      })
    );
    const event = calls.processAction[0].event as ActionEvent;
    expect(event.user.userId).toBe("ou_clicker");
    expect(event.user.fullName).toBe("Clicker");
  });
});

// ===========================================================================
// Inbound — reaction
// ===========================================================================

describe("LarkAdapter — inbound reaction", () => {
  async function setupAndEmit(
    evt: LarkReactionEvent
  ): Promise<{ state: FakeChannelState; calls: ChatCalls }> {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    const { chat, calls } = createFakeChat();
    await adapter.initialize(chat);
    const handler = state.handlers.get("reaction");
    await handler?.(evt);
    return { state, calls };
  }

  it("fetches root_id via rawClient.im.v1.message.get", async () => {
    const { state } = await setupAndEmit(buildReactionEvent());
    expect(state.rawClientCalls.some((c) => c.method === "message.get")).toBe(
      true
    );
  });

  it("calls chat.processReaction with added=true for emoji add", async () => {
    const { calls } = await setupAndEmit(
      buildReactionEvent({ action: "added" })
    );
    expect(calls.processReaction).toHaveLength(1);
    const event = calls.processReaction[0].event as ReactionEvent;
    expect(event.added).toBe(true);
  });

  it("calls chat.processReaction with added=false for emoji remove", async () => {
    const { calls } = await setupAndEmit(
      buildReactionEvent({ action: "removed" })
    );
    const event = calls.processReaction[0].event as ReactionEvent;
    expect(event.added).toBe(false);
  });

  it("maps Lark emoji_type to normalized EmojiValue", async () => {
    const { calls } = await setupAndEmit(
      buildReactionEvent({ emojiType: "THUMBSUP" })
    );
    const event = calls.processReaction[0].event as ReactionEvent;
    expect(event.emoji.name).toBe("thumbs_up");
  });
});

// ===========================================================================
// Outbound — postMessage
// ===========================================================================

describe("LarkAdapter — postMessage", () => {
  function build(): { adapter: LarkAdapter; state: FakeChannelState } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    return { adapter, state };
  }

  it("calls channel.send with markdown payload", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.postMessage("lark:oc_chat:om_root", {
      markdown: "Hello **bot**",
    });
    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0].input).toEqual({ markdown: "Hello **bot**" });
  });

  it("sets replyTo to rootId when rootId present in threadId", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.postMessage("lark:oc_chat:om_root", { markdown: "hi" });
    expect(state.sendCalls[0].opts?.replyTo).toBe("om_root");
  });

  it("omits replyTo for openDM placeholder threadId (empty rootId)", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.postMessage("lark:ou_user_1:", { markdown: "hi" });
    expect(state.sendCalls[0].opts?.replyTo).toBeUndefined();
  });

  it("passes chatId to channel.send (channel handles ou_* vs oc_* routing)", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.postMessage("lark:ou_user_99:", { markdown: "dm" });
    expect(state.sendCalls[0].to).toBe("ou_user_99");
  });

  it("returns RawMessage shape {id, raw, threadId}", async () => {
    const { adapter } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    const result = await adapter.postMessage("lark:oc_chat:om_root", {
      markdown: "hi",
    });
    expect(result.id).toBe("om_sent_1");
    expect(result.threadId).toBe("lark:oc_chat:om_root");
    expect(result.raw).toBeDefined();
  });
});

// ===========================================================================
// Outbound — stream
// ===========================================================================

describe("LarkAdapter — stream", () => {
  function build(): { adapter: LarkAdapter; state: FakeChannelState } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    return { adapter, state };
  }

  async function* makeStream(chunks: unknown[]): AsyncIterable<unknown> {
    for (const c of chunks) {
      yield c;
    }
  }

  it("calls channel.stream with markdown producer", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.stream(
      "lark:oc_chat:om_root",
      makeStream(["hello"]) as AsyncIterable<string>
    );
    expect(state.streamCalls).toHaveLength(1);
  });

  it("sets replyTo to rootId when present in threadId", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.stream(
      "lark:oc_chat:om_root",
      makeStream(["hi"]) as AsyncIterable<string>
    );
    expect(state.streamCalls[0].opts?.replyTo).toBe("om_root");
  });

  it("omits replyTo for openDM placeholder threadId (empty rootId)", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.stream(
      "lark:ou_user_1:",
      makeStream(["hi"]) as AsyncIterable<string>
    );
    expect(state.streamCalls[0].opts?.replyTo).toBeUndefined();
  });

  it("appends string chunks to markdown stream", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.stream(
      "lark:oc_chat:om_root",
      makeStream(["foo", "bar"]) as AsyncIterable<string>
    );
    expect(state.lastStreamAppendedChunks).toEqual(["foo", "bar"]);
  });

  it("extracts text from markdown_text chunks", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.stream(
      "lark:oc_chat:om_root",
      makeStream([
        { type: "markdown_text", text: "hi" },
        { type: "markdown_text", text: " there" },
      ])
    );
    expect(state.lastStreamAppendedChunks).toEqual(["hi", " there"]);
  });

  it("skips non-markdown_text chunks (task_update, plan_update)", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.stream(
      "lark:oc_chat:om_root",
      makeStream([
        { type: "task_update", id: "t1", title: "x", status: "pending" },
        { type: "plan_update", title: "plan" },
      ])
    );
    expect(state.lastStreamAppendedChunks).toEqual([]);
  });

  it("returns RawMessage shape after streaming", async () => {
    const { adapter } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    const result = await adapter.stream(
      "lark:oc_chat:om_root",
      makeStream(["hi"]) as AsyncIterable<string>
    );
    expect(result.id).toBe("om_streamed");
    expect(result.threadId).toBe("lark:oc_chat:om_root");
  });
});

// ===========================================================================
// Outbound — editMessage / deleteMessage
// ===========================================================================

describe("LarkAdapter — editMessage / deleteMessage", () => {
  function build(): { adapter: LarkAdapter; state: FakeChannelState } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    return { adapter, state };
  }

  it("editMessage calls channel.editMessage (handles post/text format)", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.editMessage("lark:oc_chat:om_root", "om_msg_1", {
      markdown: "edited",
    });
    expect(state.editCalls).toHaveLength(1);
    expect(state.editCalls[0]).toEqual({
      messageId: "om_msg_1",
      text: "edited",
    });
  });

  it("deleteMessage calls channel.recallMessage", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.deleteMessage("lark:oc_chat:om_root", "om_msg_1");
    expect(state.recallCalls).toEqual(["om_msg_1"]);
  });
});

// ===========================================================================
// Outbound — reactions
// ===========================================================================

describe("LarkAdapter — addReaction / removeReaction", () => {
  function build(): { adapter: LarkAdapter; state: FakeChannelState } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    return { adapter, state };
  }

  it("addReaction maps 'thumbs_up' to 'THUMBSUP' via channel.addReaction", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.addReaction("lark:oc_chat:om_root", "om_msg_1", "thumbs_up");
    expect(state.addReactionCalls).toHaveLength(1);
    expect(state.addReactionCalls[0]).toEqual({
      messageId: "om_msg_1",
      emojiType: "THUMBSUP",
    });
  });

  it("addReaction throws for unknown emoji", async () => {
    const { adapter } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await expect(
      adapter.addReaction(
        "lark:oc_chat:om_root",
        "om_msg_1",
        "totally_unknown_emoji"
      )
    ).rejects.toThrow();
  });

  it("removeReaction calls channel.removeReactionByEmoji with mapped emoji_type", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.removeReaction(
      "lark:oc_chat:om_root",
      "om_msg_1",
      "thumbs_up"
    );
    expect(state.removeReactionByEmojiCalls).toHaveLength(1);
    expect(state.removeReactionByEmojiCalls[0]).toEqual({
      messageId: "om_msg_1",
      emojiType: "THUMBSUP",
    });
  });

  it("removeReaction throws when the bot has no matching reaction", async () => {
    const { adapter, state } = build();
    state.removeReactionByEmojiReturn = false;
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await expect(
      adapter.removeReaction("lark:oc_chat:om_root", "om_msg_1", "thumbs_up")
    ).rejects.toThrow(NO_REACTION_PATTERN);
  });
});

// ===========================================================================
// Outbound — fetchMessages / fetchThread
// ===========================================================================

describe("LarkAdapter — fetchMessages", () => {
  function build(): { adapter: LarkAdapter; state: FakeChannelState } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => createFakeChannel(state, opts),
    });
    return { adapter, state };
  }

  it("calls rawClient.im.v1.message.list with container_id=chatId", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.fetchMessages("lark:oc_chat_1:om_root");
    const call = state.rawClientCalls.find((c) => c.method === "message.list");
    expect(call).toBeDefined();
    expect(JSON.stringify(call?.args)).toContain("oc_chat_1");
  });

  it("maps direction='backward' to sort_type=ByCreateTimeDesc (default)", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.fetchMessages("lark:oc_chat_1:om_root");
    const call = state.rawClientCalls.find((c) => c.method === "message.list");
    expect(JSON.stringify(call?.args)).toContain("ByCreateTimeDesc");
  });

  it("maps direction='forward' to sort_type=ByCreateTimeAsc", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.fetchMessages("lark:oc_chat_1:om_root", {
      direction: "forward",
    });
    const call = state.rawClientCalls.find((c) => c.method === "message.list");
    expect(JSON.stringify(call?.args)).toContain("ByCreateTimeAsc");
  });

  it("passes cursor through as page_token", async () => {
    const { adapter, state } = build();
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    await adapter.fetchMessages("lark:oc_chat_1:om_root", {
      cursor: "page_42",
    });
    const call = state.rawClientCalls.find((c) => c.method === "message.list");
    expect(JSON.stringify(call?.args)).toContain("page_42");
  });
});

// ===========================================================================
// fetchMessage
// ===========================================================================

describe("LarkAdapter — fetchMessage", () => {
  function build(getResponse?: unknown): {
    adapter: LarkAdapter;
    state: FakeChannelState;
  } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => {
        const channel = createFakeChannel(state, opts);
        if (getResponse !== undefined) {
          const rc = channel.rawClient as unknown as {
            im: {
              v1: {
                message: {
                  get: (args: unknown) => Promise<unknown>;
                };
              };
            };
          };
          rc.im.v1.message.get = async (args: unknown) => {
            state.rawClientCalls.push({ method: "message.get", args: [args] });
            return getResponse;
          };
        }
        return channel;
      },
    });
    return { adapter, state };
  }

  it("returns a Message when API returns a matching item", async () => {
    const { adapter } = build({
      data: {
        items: [
          {
            message_id: "om_fetched",
            root_id: "om_root_1",
            chat_id: "oc_chat_1",
            msg_type: "text",
            body: { content: '{"text":"hello"}' },
            sender: { id: "ou_user_1", id_type: "open_id" },
            create_time: "1700000000000",
          },
        ],
      },
    });
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    const msg = await adapter.fetchMessage(
      "lark:oc_chat_1:om_root_1",
      "om_fetched"
    );
    expect(msg).not.toBeNull();
    expect(msg?.id).toBe("om_fetched");
    expect(msg?.text).toContain("hello");
  });

  it("returns null when the API returns no items", async () => {
    const { adapter } = build({ data: { items: [] } });
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    const msg = await adapter.fetchMessage(
      "lark:oc_chat_1:om_root_1",
      "om_nonexistent"
    );
    expect(msg).toBeNull();
  });
});

// ===========================================================================
// listThreads
// ===========================================================================

describe("LarkAdapter — listThreads", () => {
  function build(listResponse: unknown): {
    adapter: LarkAdapter;
    state: FakeChannelState;
  } {
    const state = createFakeChannelState();
    const adapter = new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
      channelFactory: (opts) => {
        const channel = createFakeChannel(state, opts);
        const rc = channel.rawClient as unknown as {
          im: {
            v1: {
              message: {
                list: (args: unknown) => Promise<unknown>;
              };
            };
          };
        };
        rc.im.v1.message.list = async (args: unknown) => {
          state.rawClientCalls.push({ method: "message.list", args: [args] });
          return listResponse;
        };
        return channel;
      },
    });
    return { adapter, state };
  }

  it("groups messages by root_id into ThreadSummary[]", async () => {
    const { adapter } = build({
      data: {
        has_more: false,
        page_token: "",
        items: [
          {
            message_id: "om_root_a",
            chat_id: "oc_chat",
            msg_type: "text",
            body: { content: '{"text":"root A"}' },
            sender: { id: "ou_u1", id_type: "open_id" },
            create_time: "1700000000000",
          },
          {
            message_id: "om_reply_a1",
            root_id: "om_root_a",
            parent_id: "om_root_a",
            chat_id: "oc_chat",
            msg_type: "text",
            body: { content: '{"text":"reply A1"}' },
            sender: { id: "ou_u2", id_type: "open_id" },
            create_time: "1700000001000",
          },
          {
            message_id: "om_root_b",
            chat_id: "oc_chat",
            msg_type: "text",
            body: { content: '{"text":"root B"}' },
            sender: { id: "ou_u3", id_type: "open_id" },
            create_time: "1700000002000",
          },
        ],
      },
    });
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    const result = await adapter.listThreads("oc_chat");
    expect(result.threads).toHaveLength(2);
    const threadA = result.threads.find(
      (t) => t.rootMessage.id === "om_root_a"
    );
    expect(threadA?.id).toBe("lark:oc_chat:om_root_a");
    expect(threadA?.replyCount).toBe(1);
    const threadB = result.threads.find(
      (t) => t.rootMessage.id === "om_root_b"
    );
    expect(threadB?.replyCount).toBe(0);
  });

  it("emits nextCursor when has_more is true", async () => {
    const { adapter } = build({
      data: {
        has_more: true,
        page_token: "next_page_token",
        items: [
          {
            message_id: "om_root_a",
            chat_id: "oc_chat",
            msg_type: "text",
            body: { content: "{}" },
            sender: { id: "ou_u1", id_type: "open_id" },
            create_time: "1700000000000",
          },
        ],
      },
    });
    const { chat } = createFakeChat();
    await adapter.initialize(chat);
    const result = await adapter.listThreads("oc_chat");
    expect(result.nextCursor).toBe("next_page_token");
  });
});

// ===========================================================================
// openDM / isDM
// ===========================================================================

describe("LarkAdapter — openDM / isDM", () => {
  function build(): LarkAdapter {
    return new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
    });
  }

  it("openDM returns placeholder threadId with empty rootId", async () => {
    const adapter = build();
    const threadId = await adapter.openDM("ou_user_99");
    expect(threadId).toBe("lark:ou_user_99:");
  });

  it("isDM returns true for ou_* prefixed threadIds", () => {
    const adapter = build();
    expect(adapter.isDM("lark:ou_user_99:")).toBe(true);
    expect(adapter.isDM("lark:ou_user_99:om_msg")).toBe(true);
  });

  it("isDM returns false for oc_* prefixed threadIds", () => {
    const adapter = build();
    expect(adapter.isDM("lark:oc_group_1:om_msg")).toBe(false);
  });
});

// ===========================================================================
// parseMessage / renderFormatted — smoke tests
// ===========================================================================

describe("LarkAdapter — parseMessage / renderFormatted", () => {
  function build(): LarkAdapter {
    return new LarkAdapter({
      appId: "cli_test",
      appSecret: "secret_test",
    });
  }

  it("parseMessage returns Message with mdast formatted content", () => {
    const adapter = build();
    const msg = adapter.parseMessage(
      buildNormalizedMessage({ content: "Hello **world**" })
    );
    expect(msg.text).toBe("Hello **world**");
    expect(msg.formatted.type).toBe("root");
    expect(msg.id).toBe("om_msg_1");
  });

  it("renderFormatted produces markdown string from mdast", () => {
    const adapter = build();
    const out = adapter.renderFormatted({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "hi" }],
        },
      ],
    });
    expect(out).toContain("hi");
  });
});
