import { createMemoryState } from "@chat-adapter/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { Chat, type Logger, type Message } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockTeamsApp,
  createTeamsWebhookRequest,
  injectMockTeamsApp,
  type MockTeamsApp,
  TEAMS_APP_PASSWORD,
} from "./teams-utils";
import { createWaitUntilTracker } from "./test-scenarios";

const EDITED_REGEX = /edited/;

async function* textStream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

const APP_ID = "11111111-2222-3333-4444-555555555555";
const BOT_ID = `28:${APP_ID}`;
const BOT_NAME = "Chat SDK Demo";

/** The captured channel mention from packages/adapter-teams/sample-messages.md. */
const channelMessage = {
  text: "<at>Chat SDK Demo</at> test",
  textFormat: "plain",
  attachments: [
    {
      contentType: "text/html",
      content:
        '<p><span itemtype="http://schema.skype.com/Mention" itemscope="" itemid="0">Chat SDK Demo</span>&nbsp;test</p>',
    },
  ],
  type: "message",
  timestamp: "2025-12-23T03:19:23.0597717Z",
  localTimestamp: "2025-12-22T19:19:23.0597717-08:00",
  id: "1766459963017",
  channelId: "msteams",
  serviceUrl:
    "https://smba.trafficmanager.net/amer/a1b2c3d4-e5f6-7890-abcd-ef1234567890/",
  from: {
    id: "29:1xXxFakeUserBase64IdStringForTeamsPlatformAbcDeFgHiJkLmNoPqRsTuVwXyZ012345ABCDEF",
    name: "Test User",
    aadObjectId: "00000000-1111-2222-3333-444444444444",
  },
  conversation: {
    isGroup: true,
    conversationType: "channel",
    tenantId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    id: "19:d441d38c655c47a085215b2726e76927@thread.tacv2;messageid=1766459963017",
  },
  recipient: { id: BOT_ID, name: BOT_NAME },
  entities: [
    {
      mentioned: { id: BOT_ID, name: BOT_NAME },
      text: "<at>Chat SDK Demo</at>",
      type: "mention",
    },
    {
      locale: "en-US",
      country: "US",
      platform: "Web",
      timezone: "America/Los_Angeles",
      type: "clientInfo",
    },
  ],
  channelData: {
    teamsChannelId: "19:d441d38c655c47a085215b2726e76927@thread.tacv2",
    teamsTeamId: "19:8j-Mnacwmq2QFDbzykeQH5v55m6cN1X3QJ5viHvGIIQ1@thread.tacv2",
    channel: { id: "19:d441d38c655c47a085215b2726e76927@thread.tacv2" },
    team: {
      id: "19:8j-Mnacwmq2QFDbzykeQH5v55m6cN1X3QJ5viHvGIIQ1@thread.tacv2",
    },
    tenant: { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
  },
  locale: "en-US",
  localTimezone: "America/Los_Angeles",
};

/**
 * No messageUpdate has been captured. This shape is the captured message
 * activity above plus the fields Microsoft documents for edits and undeletes:
 * `type: "messageUpdate"` and `channelData.eventType`.
 */
function messageUpdate(
  eventType: "editMessage" | "undeleteMessage",
  overrides: { from?: { id: string; name: string }; text?: string } = {}
) {
  return {
    ...channelMessage,
    type: "messageUpdate",
    text: overrides.text ?? "<at>Chat SDK Demo</at> test edited",
    from: overrides.from ?? channelMessage.from,
    channelData: { ...channelMessage.channelData, eventType },
  };
}

interface UpdatedCall {
  message: Message;
  previousMessage: Message | undefined;
  threadId: string;
}

describe("Teams message updates", () => {
  let chat: Chat<{ teams: TeamsAdapter }>;
  let teamsAdapter: TeamsAdapter;
  let mockTeamsApp: MockTeamsApp;
  let tracker: ReturnType<typeof createWaitUntilTracker>;
  let mentionThreadId: string | undefined;
  let updated: UpdatedCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    mentionThreadId = undefined;
    updated = [];

    teamsAdapter = createTeamsAdapter({
      appId: APP_ID,
      appPassword: TEAMS_APP_PASSWORD,
      userName: BOT_NAME,
      logger: mockLogger,
    });
    mockTeamsApp = createMockTeamsApp();
    injectMockTeamsApp(teamsAdapter, mockTeamsApp);

    chat = new Chat({
      userName: BOT_NAME,
      adapters: { teams: teamsAdapter },
      state: createMemoryState(),
      logger: "error",
    });

    chat.onNewMention((thread) => {
      mentionThreadId = thread.id;
    });
    chat.onMessageUpdated((thread, message, previousMessage) => {
      updated.push({ threadId: thread.id, message, previousMessage });
    });

    tracker = createWaitUntilTracker();
  });

  afterEach(async () => {
    await chat.shutdown();
  });

  /** Send an activity and assert how many `waitUntil` tasks it registered. */
  const sendActivity = async (activity: unknown, expectedTasks: number) => {
    const before = tracker.taskCount();
    const response = await chat.webhooks.teams(
      createTeamsWebhookRequest(activity),
      { waitUntil: tracker.waitUntil }
    );
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper called from tests
    expect(response.status).toBe(200);
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper called from tests
    expect(tracker.taskCount() - before).toBe(expectedTasks);
    await tracker.waitForAll();
  };

  it("reports an edited channel mention to onMessageUpdated", async () => {
    await sendActivity(channelMessage, 1);
    expect(mentionThreadId).toBeDefined();

    await sendActivity(messageUpdate("editMessage"), 1);

    expect(updated).toHaveLength(1);
    const [call] = updated;
    expect(call?.threadId).toBe(mentionThreadId);
    expect(call?.message.text).toMatch(EDITED_REGEX);
    expect(call?.message.isMention).toBe(true);
    expect(call?.message.metadata.edited).toBe(true);
    expect(call?.previousMessage).toBeUndefined();
    expect(mockTeamsApp.contexts.get(channelMessage.id)).toHaveLength(2);
  });

  it("ignores undeletes but reports edits of the same message", async () => {
    await sendActivity(messageUpdate("undeleteMessage"), 0);
    expect(updated).toHaveLength(0);

    await sendActivity(messageUpdate("editMessage"), 1);
    expect(updated).toHaveLength(1);
  });

  it("skips edits made by the bot itself", async () => {
    await sendActivity(
      messageUpdate("editMessage", {
        from: { id: BOT_ID, name: BOT_NAME },
        text: "Bot reply edited",
      }),
      1
    );
    expect(updated).toHaveLength(0);

    await sendActivity(messageUpdate("editMessage"), 1);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.message.author.userId).toBe(channelMessage.from.id);
  });

  it("posts a DM edit's streamed reply as its own message while the original reply streams", async () => {
    const dmMessage = {
      ...channelMessage,
      id: "dm-1",
      text: "hello",
      attachments: [],
      entities: [],
      conversation: {
        conversationType: "personal",
        tenantId: channelMessage.conversation.tenantId,
        id: "a:personal-chat-id",
      },
      channelData: { tenant: channelMessage.channelData.tenant },
    };
    const dmEdit = {
      ...dmMessage,
      type: "messageUpdate",
      text: "hello again",
      channelData: { ...dmMessage.channelData, eventType: "editMessage" },
    };

    let reachedOriginal: () => void = () => {};
    const originalParked = new Promise<void>((resolve) => {
      reachedOriginal = resolve;
    });
    let releaseOriginal: () => void = () => {};
    const originalReleased = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    chat.onDirectMessage(async (thread) => {
      reachedOriginal();
      await originalReleased;
      await thread.post(textStream(["original ", "reply"]));
    });
    chat.onMessageUpdated(async (thread) => {
      await thread.post(textStream(["edited ", "reply"]));
    });

    const originalTasks = createWaitUntilTracker();
    const original = chat.webhooks.teams(createTeamsWebhookRequest(dmMessage), {
      waitUntil: originalTasks.waitUntil,
    });
    await originalParked;

    const editTasks = createWaitUntilTracker();
    const editResponse = await chat.webhooks.teams(
      createTeamsWebhookRequest(dmEdit),
      { waitUntil: editTasks.waitUntil }
    );
    expect(editResponse.status).toBe(200);
    expect(editTasks.taskCount()).toBe(1);
    await editTasks.waitForAll();

    expect(mockTeamsApp.sentActivities).toContainEqual(
      expect.objectContaining({ text: "edited reply" })
    );

    releaseOriginal();
    expect((await original).status).toBe(200);
    expect(originalTasks.taskCount()).toBe(1);
    await originalTasks.waitForAll();

    const [originalCtx, editCtx] =
      mockTeamsApp.contexts.get(dmMessage.id) ?? [];
    expect(originalCtx?.activity.type).toBe("message");
    expect(editCtx?.activity.type).toBe("messageUpdate");
    expect(originalCtx?.stream.emit.mock.calls).toEqual([
      ["original "],
      ["reply"],
    ]);
    expect(editCtx?.stream.emit).not.toHaveBeenCalled();
    expect(mockTeamsApp.sentActivities).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("original") })
    );
  });
});
