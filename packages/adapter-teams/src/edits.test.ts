import { readFile } from "node:fs/promises";
import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
} from "@chat-adapter/tests";
import { Chat, type Message, type WebhookOptions } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appId, botId, TestTeamsAdapter } from "./test-utils";

const BODY_PATTERN = /body: '((?:[^'\\]|\\.)*)'/g;
const JSON_BLOCK_PATTERN = /```json\n(.+)\n```/g;
const JS_STRING_ESCAPE = /\\(.)/g;

const logger = createMockLogger();

interface SampleActivity {
  channelData: Record<string, unknown>;
  conversation: { conversationType?: string; id: string };
  entities?: { mentioned?: { id?: string }; type?: string }[];
  from: { aadObjectId?: string; id: string; name?: string };
  id: string;
  serviceUrl: string;
  text?: string;
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Activities from sample-messages.md: the logged `body: '…'` strings and the
 * fenced JSON blocks. Lookups below throw when a sample is missing, so a
 * format change fails the tests instead of leaving them with nothing to check.
 */
async function loadSamples(): Promise<SampleActivity[]> {
  const markdown = await readFile(
    new URL("../sample-messages.md", import.meta.url),
    { encoding: "utf8" }
  );
  // Each logged body is a single-quoted JS string literal holding JSON.
  const logged = Array.from(markdown.matchAll(BODY_PATTERN), ([, literal]) =>
    JSON.parse(literal.replace(JS_STRING_ESCAPE, "$1"))
  );
  const blocks = Array.from(markdown.matchAll(JSON_BLOCK_PATTERN), ([, json]) =>
    JSON.parse(json)
  );
  return [...logged, ...blocks] as SampleActivity[];
}

const samples = await loadSamples();

function sample(
  description: string,
  predicate: (activity: SampleActivity) => boolean
): SampleActivity {
  const found = samples.find(predicate);
  if (!found) {
    throw new Error(`sample-messages.md has no ${description}`);
  }
  return structuredClone(found);
}

/** Microsoft's documented personal-chat edit. */
const documentedEdit = () =>
  sample(
    "documented editMessage",
    (a) =>
      a.type === "messageUpdate" && a.channelData.eventType === "editMessage"
  );

/** A captured top-level channel post that @mentions the bot. */
const channelMention = () =>
  sample(
    "channel message mentioning the bot",
    (a) =>
      a.type === "message" &&
      a.conversation.conversationType === "channel" &&
      !!a.entities?.some((e) => e.type === "mention")
  );

/**
 * Synthetic channel edit: the captured channel post re-sent as a
 * `messageUpdate`. It keeps the post's `conversation.id`, which carries
 * `;messageid=<root>`. No channel edit has been captured to confirm that.
 */
function channelEdit(eventType = "editMessage"): SampleActivity {
  const post = channelMention();
  return {
    ...post,
    type: "messageUpdate",
    channelData: { ...post.channelData, eventType },
  };
}

describe("Teams message edits", () => {
  let adapter: TestTeamsAdapter;
  let chat: ReturnType<typeof createMockChatInstance>;
  let options: WebhookOptions;
  let optionsStub: ReturnType<TestTeamsAdapter["stubWebhookOptions"]>;

  beforeEach(async () => {
    adapter = new TestTeamsAdapter({ appId, appPassword: "test", logger });
    chat = createMockChatInstance();
    options = { waitUntil: vi.fn() };
    optionsStub = adapter.stubWebhookOptions(options);
    vi.spyOn(adapter, "getUser").mockResolvedValue(null);
    await adapter.initialize(chat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function updated() {
    const calls = vi.mocked(chat.processMessageUpdated).mock.calls;
    return Promise.all(
      calls.map(async ([event, eventOptions]) => {
        const { message, ...rest } = event as {
          message: () => Promise<Message>;
          threadId: string;
        };
        return { ...rest, message: await message(), options: eventOptions };
      })
    );
  }

  it("reports Microsoft's documented personal-chat edit as a message update", async () => {
    const activity = documentedEdit();
    const response = await adapter.receive(activity);

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    const updates = await updated();
    expect(updates).toHaveLength(1);
    const [update] = updates;
    expect(update?.threadId).toBe(
      adapter.encodeThreadId({
        conversationId: activity.conversation.id,
        conversationType: "personal",
        serviceUrl: activity.serviceUrl,
      })
    );
    expect(adapter.isDM(update?.threadId ?? "")).toBe(true);
    expect(update?.options).toBe(options);
    expect(update?.message.id).toBe(activity.id);
    expect(update?.message.author.userId).toBe(activity.from.id);
    expect(update?.message.isMention).toBe(false);
    expect(update?.message.metadata.edited).toBe(true);
    expect(update?.message.metadata.editedAt).toEqual(
      new Date(activity.timestamp)
    );
    expect(update).not.toHaveProperty("previousMessage");
  });

  it("puts a channel edit on the same thread as the post it edits", async () => {
    await adapter.receive(channelMention());
    const originalThreadId = vi.mocked(chat.processMessage).mock.calls[0]?.[1];
    expect(originalThreadId).toEqual(expect.any(String));

    await adapter.receive(channelEdit());

    const [update] = await updated();
    expect(update?.threadId).toBe(originalThreadId);
    expect(update?.message.text).toBe("@Chat SDK Demo test");
    expect(update?.message.isMention).toBe(true);
  });

  it("marks a channel edit that mentions only another bot as not a mention", async () => {
    const activity = channelEdit();
    activity.entities = [
      {
        type: "mention",
        mentioned: { id: "28:other-app" },
      },
    ];
    await adapter.receive(activity);
    expect((await updated())[0]?.message.isMention).toBe(false);
  });

  it("hydrates the editor's email", async () => {
    const activity = documentedEdit();
    vi.mocked(chat.getState().get).mockImplementation(async (key: string) =>
      key === `teams:userInfo:${activity.from.aadObjectId}`
        ? JSON.stringify({ email: "alice@contoso.com", fullName: "Alice" })
        : null
    );
    await adapter.receive(activity);
    expect((await updated())[0]?.message.author.email).toBe(
      "alice@contoso.com"
    );
  });

  it("remembers the editor's tenant so the bot can open a DM with them", async () => {
    const activity = documentedEdit();
    await adapter.receive(activity);

    const create = vi.fn().mockResolvedValue({ id: "a:new-dm" });
    const app = (adapter as unknown as { app: { apiFor: () => unknown } }).app;
    vi.spyOn(app, "apiFor").mockReturnValue({ conversations: { create } });
    await adapter.openDM(activity.from.id);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: (activity.channelData.tenant as { id: string }).id,
      })
    );
  });

  it("keeps each request's webhook options when an edit reuses its message's id", async () => {
    optionsStub.mockRestore();
    adapter.allowUnauthenticatedWebhooks();
    let parked: () => void = () => {};
    let resume: (user: null) => void = () => {};
    const reached = new Promise<void>((resolve) => {
      parked = resolve;
    });
    const post = channelMention();
    const edit = channelEdit();
    expect(edit.id).toBe(post.id);
    // The captured post has an aadObjectId, so its sender lookup reads state.
    vi.mocked(chat.getState().get).mockImplementationOnce(() => {
      parked();
      return new Promise((resolve) => {
        resume = resolve;
      });
    });
    const request = (body: unknown) =>
      new Request("https://example.com/api/webhooks/teams", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
    const messageOptions: WebhookOptions = { waitUntil: vi.fn() };
    const editOptions: WebhookOptions = { waitUntil: vi.fn() };

    const original = adapter.handleWebhook(request(post), messageOptions);
    await reached;
    await adapter.handleWebhook(request(edit), editOptions);
    resume(null);
    await original;

    expect((await updated())[0]?.options).toBe(editOptions);
    expect(vi.mocked(chat.processMessage).mock.calls[0]?.[3]).toBe(
      messageOptions
    );
  });

  it("ignores an undelete but reports an edit of the same message", async () => {
    await adapter.receive(channelEdit("undeleteMessage"));
    expect(chat.processMessageUpdated).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();

    await adapter.receive(channelEdit("editMessage"));
    expect(chat.processMessageUpdated).toHaveBeenCalledOnce();
  });
});

describe("Teams DM edits while the original message is streaming", () => {
  async function* chunks(parts: string[]) {
    for (const part of parts) {
      yield part;
    }
  }

  it("posts the edit handler's stream as its own message instead of into the original's streamer", async () => {
    const edit = documentedEdit();
    const { eventType: _eventType, ...messageChannelData } = edit.channelData;
    const post: SampleActivity = {
      ...edit,
      type: "message",
      text: "hello",
      channelData: messageChannelData,
    };
    const adapter = new TestTeamsAdapter({
      appId,
      appPassword: "test",
      logger,
    });
    const tasks: Promise<unknown>[] = [];
    adapter.stubWebhookOptions({ waitUntil: (task) => tasks.push(task) });
    const send = adapter.stubOutbound();
    vi.spyOn(adapter, "getUser").mockResolvedValue(null);
    const native = vi
      .spyOn(
        adapter as unknown as {
          streamViaEmit: (
            threadId: string,
            textStream: AsyncIterable<string>,
            stream: unknown
          ) => Promise<unknown>;
        },
        "streamViaEmit"
      )
      .mockImplementation(async (threadId) => ({
        id: "streamed",
        threadId,
        raw: {},
      }));
    const bot = new Chat({
      userName: "test",
      adapters: { teams: adapter },
      state: createMockState(),
      logger,
    });

    let reachedOriginal: () => void = () => {};
    const originalParked = new Promise<void>((resolve) => {
      reachedOriginal = resolve;
    });
    let releaseOriginal: () => void = () => {};
    const originalReleased = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    bot.onDirectMessage(async (thread) => {
      reachedOriginal();
      await originalReleased;
      await thread.post(chunks(["original ", "reply"]));
    });
    bot.onMessageUpdated(async (thread) => {
      await thread.post(chunks(["edited ", "reply"]));
    });
    await bot.initialize();

    const original = adapter.receive(post);
    await originalParked;
    const originalTasks = tasks.length;
    await adapter.receive(edit);
    expect(tasks.length).toBe(originalTasks + 1);
    await tasks[originalTasks];

    expect(native).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: edit.conversation.id }),
      expect.objectContaining({ text: "edited reply" })
    );

    releaseOriginal();
    await original;
    await Promise.all(tasks);

    expect(native).toHaveBeenCalledOnce();
    expect(native.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ emit: expect.any(Function) })
    );
  });
});

it("finds a bot mention in the captured channel post", () => {
  expect(
    channelMention().entities?.some((e) => e.mentioned?.id === botId)
  ).toBe(true);
});
