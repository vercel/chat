import { createMockLogger, createMockState } from "@chat-adapter/tests";
import type { IStreamer } from "@microsoft/teams.apps";
import { Chat } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_SUBMIT_ACTION_ID } from "./cards";
import { appId, botId, serviceUrl, TestTeamsAdapter } from "./test-utils";

const logger = createMockLogger();

/** Fields shared by every activity in one personal chat with the bot. */
const dm = {
  channelData: { tenant: { id: "tenant" } },
  channelId: "msteams",
  conversation: {
    conversationType: "personal",
    id: "a:1-dm",
    tenantId: "tenant",
  },
  from: { aadObjectId: "aad-user-1", id: "29:user-1", name: "Ada" },
  recipient: { id: botId, name: "Bot" },
  serviceUrl,
};

const channelConversationId = "19:channel@thread.tacv2";

async function* chunks(parts: string[]) {
  for (const part of parts) {
    yield part;
  }
}

/** Yields to the event loop so the caller resumes on a later async hop. */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Harness {
  adapter: TestTeamsAdapter;
  bot: Chat;
  /** The thread whose message is still streaming. */
  dmThreadId: string;
  /** Streams a reply the way a handler would, after an async hop. */
  reply: (post: (stream: AsyncIterable<string>) => Promise<unknown>) => void;
}

interface Scenario {
  activity: { type: string; [key: string]: unknown };
  name: string;
  register: (harness: Harness) => void;
}

const scenarios: Scenario[] = [
  {
    name: "a feedback button click",
    activity: {
      ...dm,
      id: "invoke-feedback-1",
      name: "message/submitAction",
      replyToId: "1700000000000",
      type: "invoke",
      value: {
        actionName: "feedback",
        actionValue: { reaction: "like", feedback: "" },
      },
    },
    register: ({ bot, reply }) => {
      bot.onAction("message_feedback", (event) => {
        reply((stream) => event.thread?.post(stream) as Promise<unknown>);
      });
    },
  },
  {
    name: "an adaptiveCard/action invoke",
    activity: {
      ...dm,
      id: "invoke-card-1",
      name: "adaptiveCard/action",
      replyToId: "1700000000000",
      type: "invoke",
      value: {
        action: {
          type: "Action.Execute",
          data: { actionId: "approve", value: "yes" },
        },
      },
    },
    register: ({ bot, reply }) => {
      bot.onAction("approve", (event) => {
        reply((stream) => event.thread?.post(stream) as Promise<unknown>);
      });
    },
  },
  {
    name: "an Action.Submit click sent as a message",
    activity: {
      ...dm,
      id: "1700000000002",
      replyToId: "1700000000000",
      type: "message",
      value: { actionId: "approve", value: "yes" },
    },
    register: ({ bot, reply }) => {
      bot.onAction("approve", (event) => {
        reply((stream) => event.thread?.post(stream) as Promise<unknown>);
      });
    },
  },
  {
    name: "an auto-submit fan-out",
    activity: {
      ...dm,
      id: "invoke-card-2",
      name: "adaptiveCard/action",
      replyToId: "1700000000000",
      type: "invoke",
      value: {
        action: {
          type: "Action.Execute",
          data: { actionId: AUTO_SUBMIT_ACTION_ID, plan: "pro" },
        },
      },
    },
    register: ({ bot, reply }) => {
      bot.onAction("plan", (event) => {
        reply((stream) => event.thread?.post(stream) as Promise<unknown>);
      });
    },
  },
  {
    name: "a dialog open",
    activity: {
      ...dm,
      id: "invoke-task-fetch-1",
      name: "task/fetch",
      replyToId: "1700000000000",
      type: "invoke",
      value: { data: { actionId: "open_form" } },
    },
    register: ({ bot, reply }) => {
      bot.onAction("open_form", (event) => {
        reply((stream) => event.thread?.post(stream) as Promise<unknown>);
      });
    },
  },
  {
    name: "a dialog submit",
    activity: {
      ...dm,
      id: "invoke-task-submit-1",
      name: "task/submit",
      type: "invoke",
      value: { data: { note: "hello" } },
    },
    register: ({ adapter, bot, dmThreadId, reply }) => {
      bot.onModalSubmit(async () => {
        reply((stream) => adapter.stream(dmThreadId, stream));
        return undefined;
      });
    },
  },
  {
    name: "an added reaction",
    activity: {
      ...dm,
      id: "reaction-1",
      reactionsAdded: [{ type: "like" }],
      replyToId: "1700000000000",
      type: "messageReaction",
    },
    register: ({ bot, reply }) => {
      bot.onReaction((event) => {
        reply((stream) => event.thread.post(stream));
      });
    },
  },
  {
    name: "a removed reaction",
    activity: {
      ...dm,
      id: "reaction-2",
      reactionsRemoved: [{ type: "like" }],
      replyToId: "1700000000000",
      type: "messageReaction",
    },
    register: ({ bot, reply }) => {
      bot.onReaction((event) => {
        reply((stream) => event.thread.post(stream));
      });
    },
  },
  {
    name: "an uninstall",
    activity: {
      ...dm,
      action: "remove",
      id: "installation-remove",
      type: "installationUpdate",
    },
    register: ({ adapter, bot, reply }) => {
      bot.onUninstalled((event) => {
        reply((stream) => adapter.stream(event.channelId ?? "", stream));
      });
    },
  },
  {
    name: "the bot joining a channel",
    activity: {
      channelData: {
        eventType: "teamMemberAdded",
        team: { id: "19:team", aadGroupId: "team-aad" },
        tenant: { id: "tenant" },
      },
      channelId: "msteams",
      conversation: {
        conversationType: "channel",
        id: channelConversationId,
        isGroup: true,
        tenantId: "tenant",
      },
      from: dm.from,
      id: "join-activity",
      membersAdded: [{ id: botId }],
      recipient: { id: botId },
      serviceUrl,
      type: "conversationUpdate",
    },
    register: ({ adapter, bot, dmThreadId, reply }) => {
      bot.onMemberJoinedChannel(() => {
        reply((stream) => adapter.stream(dmThreadId, stream));
      });
    },
  },
];

describe("Teams DM activities while a message is streaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(
    scenarios
  )("posts a stream from $name as its own message instead of into the message's streamer", async ({
    activity,
    register,
  }) => {
    const adapter = new TestTeamsAdapter({
      appId,
      appPassword: "test",
      logger,
    });
    const tasks: Promise<unknown>[] = [];
    adapter.stubWebhookOptions({ waitUntil: (task) => tasks.push(task) });
    const send = adapter.stubOutbound();
    vi.spyOn(adapter, "getUser").mockResolvedValue(null);
    const bot = new Chat({
      userName: "test",
      adapters: { teams: adapter },
      state: createMockState(),
      logger,
    });
    const activeStreams = (
      adapter as unknown as { activeStreams: Map<string, IStreamer> }
    ).activeStreams;

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
    await bot.initialize();

    const original = adapter.receive({
      ...dm,
      id: "1700000000001",
      text: "hello",
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "message",
    });
    await originalParked;

    expect(activeStreams.size).toBe(1);
    const [[dmThreadId, streamer]] = [...activeStreams];
    const chunkListeners: ((sent: { id: string }) => void)[] = [];
    vi.spyOn(streamer.events, "once").mockImplementation(((
      _event: string,
      listener: (sent: { id: string }) => void
    ) => {
      chunkListeners.push(listener);
    }) as never);
    const emit = vi.spyOn(streamer, "emit").mockImplementation(() => {
      for (const listener of chunkListeners.splice(0)) {
        listener({ id: "streamed" });
      }
    });

    const replies: Promise<unknown>[] = [];
    const streamerRegisteredDuringReply: boolean[] = [];
    register({
      adapter,
      bot,
      dmThreadId,
      reply: (post) => {
        replies.push(
          (async () => {
            await nextTurn();
            streamerRegisteredDuringReply.push(
              activeStreams.get(dmThreadId) === streamer
            );
            await post(chunks(["side ", "reply"]));
          })()
        );
      },
    });

    await adapter.receive(activity);
    await Promise.all(replies);

    expect(streamerRegisteredDuringReply).toEqual([true]);
    expect(emit).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ conversationId: dm.conversation.id }),
      expect.objectContaining({ text: "side reply" })
    );

    releaseOriginal();
    await original;
    await Promise.all(tasks);

    expect(emit.mock.calls).toEqual([["original "], ["reply"]]);
    expect(send).toHaveBeenCalledOnce();
  });
});
