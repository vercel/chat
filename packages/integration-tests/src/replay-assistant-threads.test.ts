/**
 * Replay tests for Slack Assistants API.
 *
 * Covers assistant_thread_started, assistant_thread_context_changed,
 * setSuggestedPrompts, setAssistantStatus, setAssistantTitle.
 */

import type {
  AssistantContextChangedEvent,
  AssistantThreadStartedEvent,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";
import { getSlackThreadId } from "./slack-utils";

const BOT_NAME = "TestBot";
const BOT_USER_ID = "U_BOT_123";
const USER_ID = "U_USER_456";
const DM_CHANNEL = "D0ACX51K95H";
const THREAD_TS = "1771460497.092039";
const CONTEXT_CHANNEL = "C_CONTEXT_789";
const TEAM_ID = "T_TEAM_123";

function createAssistantThreadStartedPayload(overrides?: {
  channelId?: string;
  threadTs?: string;
  userId?: string;
  context?: Record<string, unknown>;
}) {
  return {
    type: "event_callback",
    team_id: TEAM_ID,
    api_app_id: "A_APP_123",
    event: {
      type: "assistant_thread_started",
      assistant_thread: {
        user_id: overrides?.userId ?? USER_ID,
        channel_id: overrides?.channelId ?? DM_CHANNEL,
        thread_ts: overrides?.threadTs ?? THREAD_TS,
        context: overrides?.context ?? {
          thread_entry_point: "app_home",
          force_search: false,
        },
      },
      event_ts: "1771460497.111180",
    },
    event_id: "Ev_TEST_123",
    event_time: 1771460497,
  };
}

describe("Slack Assistant Thread Started", () => {
  let ctx: SlackTestContext;
  let capturedEvent: AssistantThreadStartedEvent | null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEvent = null;
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  describe("event routing + handler dispatch", () => {
    beforeEach(() => {
      ctx = createSlackTestContext(
        { botName: BOT_NAME, botUserId: BOT_USER_ID },
        {
          onAssistantThreadStarted: (event) => {
            capturedEvent = event;
          },
        }
      );
    });

    it("should route assistant_thread_started to handler", async () => {
      await ctx.sendWebhook(createAssistantThreadStartedPayload());

      expect(capturedEvent).not.toBeNull();
    });

    it("should map event data correctly", async () => {
      await ctx.sendWebhook(createAssistantThreadStartedPayload());

      expect(capturedEvent?.threadId).toBe(
        getSlackThreadId(DM_CHANNEL, THREAD_TS)
      );
      expect(capturedEvent?.userId).toBe(USER_ID);
      expect(capturedEvent?.channelId).toBe(DM_CHANNEL);
      expect(capturedEvent?.threadTs).toBe(THREAD_TS);
      expect(capturedEvent?.adapter.name).toBe("slack");
    });

    it("should extract context with thread_entry_point", async () => {
      await ctx.sendWebhook(createAssistantThreadStartedPayload());

      expect(capturedEvent?.context.threadEntryPoint).toBe("app_home");
    });

    it("should extract context.channelId when present", async () => {
      await ctx.sendWebhook(
        createAssistantThreadStartedPayload({
          context: {
            channel_id: CONTEXT_CHANNEL,
            team_id: TEAM_ID,
            thread_entry_point: "channel",
          },
        })
      );

      expect(capturedEvent?.context.channelId).toBe(CONTEXT_CHANNEL);
      expect(capturedEvent?.context.teamId).toBe(TEAM_ID);
      expect(capturedEvent?.context.threadEntryPoint).toBe("channel");
    });

    it("should handle missing context fields gracefully", async () => {
      await ctx.sendWebhook(
        createAssistantThreadStartedPayload({ context: {} })
      );

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent?.context.channelId).toBeUndefined();
      expect(capturedEvent?.context.teamId).toBeUndefined();
    });
  });

  describe("setSuggestedPrompts integration", () => {
    beforeEach(() => {
      ctx = createSlackTestContext(
        { botName: BOT_NAME, botUserId: BOT_USER_ID },
        {
          onAssistantThreadStarted: async (event) => {
            capturedEvent = event;
            const adapter = event.adapter as ReturnType<
              typeof import("@chat-adapter/slack").createSlackAdapter
            >;
            await adapter.setSuggestedPrompts(
              event.channelId,
              event.threadTs,
              [
                { title: "Fix a bug", message: "Fix the bug in..." },
                { title: "Add feature", message: "Add a feature..." },
              ],
              "What can I help with?"
            );
          },
        }
      );
    });

    it("should call setSuggestedPrompts with correct args", async () => {
      await ctx.sendWebhook(createAssistantThreadStartedPayload());

      expect(
        ctx.mockClient.assistant.threads.setSuggestedPrompts
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: DM_CHANNEL,
          thread_ts: THREAD_TS,
          prompts: [
            { title: "Fix a bug", message: "Fix the bug in..." },
            { title: "Add feature", message: "Add a feature..." },
          ],
          title: "What can I help with?",
        })
      );
    });
  });

  describe("error handling", () => {
    it("should not crash when handler throws", async () => {
      ctx = createSlackTestContext(
        { botName: BOT_NAME, botUserId: BOT_USER_ID },
        {
          onAssistantThreadStarted: () => {
            throw new Error("Handler exploded");
          },
        }
      );

      // Should not throw
      await ctx.sendWebhook(createAssistantThreadStartedPayload());
    });

    it("should not crash when setSuggestedPrompts API fails", async () => {
      ctx = createSlackTestContext(
        { botName: BOT_NAME, botUserId: BOT_USER_ID },
        {
          onAssistantThreadStarted: async (event) => {
            const adapter = event.adapter as ReturnType<
              typeof import("@chat-adapter/slack").createSlackAdapter
            >;
            await adapter.setSuggestedPrompts(
              event.channelId,
              event.threadTs,
              []
            );
          },
        }
      );

      ctx.mockClient.assistant.threads.setSuggestedPrompts.mockRejectedValue(
        new Error("Slack API error")
      );

      // Handler will throw from the rejected promise, but processAssistantThreadStarted catches it
      await ctx.sendWebhook(createAssistantThreadStartedPayload());
    });

    it("should still handle messages when no assistant handler registered", async () => {
      ctx = createSlackTestContext(
        { botName: BOT_NAME, botUserId: BOT_USER_ID },
        {
          onMention: async (thread) => {
            await thread.post("Hello!");
          },
        }
      );

      // assistant_thread_started should be silently handled (no error)
      await ctx.sendWebhook(createAssistantThreadStartedPayload());

      // Regular mention should still work
      await ctx.sendWebhook({
        type: "event_callback",
        team_id: TEAM_ID,
        event: {
          type: "app_mention",
          user: USER_ID,
          text: `<@${BOT_USER_ID}> hello`,
          ts: "1771460500.000001",
          thread_ts: "1771460500.000001",
          channel: "C_CHANNEL_123",
          event_ts: "1771460500.000001",
        },
        event_id: "Ev_MSG_123",
        event_time: 1771460500,
      });

      expect(ctx.captured.mentionMessage).not.toBeNull();
      expect(ctx.captured.mentionMessage?.text).toContain("hello");
    });
  });

  describe("multiple handlers", () => {
    it("should call all registered handlers in order", async () => {
      const callOrder: number[] = [];

      ctx = createSlackTestContext(
        { botName: BOT_NAME, botUserId: BOT_USER_ID },
        {}
      );

      ctx.chat.onAssistantThreadStarted(() => {
        callOrder.push(1);
      });
      ctx.chat.onAssistantThreadStarted(() => {
        callOrder.push(2);
      });

      await ctx.sendWebhook(createAssistantThreadStartedPayload());

      expect(callOrder).toEqual([1, 2]);
    });
  });
});

// =============================================================================
// assistant_thread_context_changed
// =============================================================================

function createContextChangedPayload(overrides?: {
  context?: Record<string, unknown>;
}) {
  return {
    type: "event_callback",
    team_id: TEAM_ID,
    api_app_id: "A_APP_123",
    event: {
      type: "assistant_thread_context_changed",
      assistant_thread: {
        user_id: USER_ID,
        channel_id: DM_CHANNEL,
        thread_ts: THREAD_TS,
        context: overrides?.context ?? {
          channel_id: CONTEXT_CHANNEL,
          team_id: TEAM_ID,
          thread_entry_point: "channel",
        },
      },
      event_ts: "1771460500.111180",
    },
    event_id: "Ev_CTX_123",
    event_time: 1771460500,
  };
}

describe("Slack Assistant Context Changed", () => {
  let ctx: SlackTestContext;
  let capturedEvent: AssistantContextChangedEvent | null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEvent = null;
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should route context_changed to handler", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAssistantContextChanged: (event) => {
          capturedEvent = event;
        },
      }
    );

    await ctx.sendWebhook(createContextChangedPayload());

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent?.threadId).toBe(
      getSlackThreadId(DM_CHANNEL, THREAD_TS)
    );
    expect(capturedEvent?.context.channelId).toBe(CONTEXT_CHANNEL);
    expect(capturedEvent?.context.threadEntryPoint).toBe("channel");
  });

  it("should not crash when no handler registered", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {}
    );

    await ctx.sendWebhook(createContextChangedPayload());
  });
});

// =============================================================================
// setAssistantStatus + setAssistantTitle
// =============================================================================

describe("Slack Assistant Status and Title", () => {
  let ctx: SlackTestContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should call setAssistantStatus with correct args", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAssistantThreadStarted: async (event) => {
          const adapter = event.adapter as ReturnType<
            typeof import("@chat-adapter/slack").createSlackAdapter
          >;
          await adapter.setAssistantStatus(
            event.channelId,
            event.threadTs,
            "is thinking..."
          );
        },
      }
    );

    await ctx.sendWebhook(createAssistantThreadStartedPayload());

    expect(ctx.mockClient.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: DM_CHANNEL,
        thread_ts: THREAD_TS,
        status: "is thinking...",
      })
    );
  });

  it("should call setAssistantTitle with correct args", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAssistantThreadStarted: async (event) => {
          const adapter = event.adapter as ReturnType<
            typeof import("@chat-adapter/slack").createSlackAdapter
          >;
          await adapter.setAssistantTitle(
            event.channelId,
            event.threadTs,
            "Fix bug in dashboard"
          );
        },
      }
    );

    await ctx.sendWebhook(createAssistantThreadStartedPayload());

    expect(ctx.mockClient.assistant.threads.setTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: DM_CHANNEL,
        thread_ts: THREAD_TS,
        title: "Fix bug in dashboard",
      })
    );
  });

  it("should clear status with empty string", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAssistantThreadStarted: async (event) => {
          const adapter = event.adapter as ReturnType<
            typeof import("@chat-adapter/slack").createSlackAdapter
          >;
          await adapter.setAssistantStatus(event.channelId, event.threadTs, "");
        },
      }
    );

    await ctx.sendWebhook(createAssistantThreadStartedPayload());

    expect(ctx.mockClient.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "",
      })
    );
  });

  it("should pass loading_messages when provided", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAssistantThreadStarted: async (event) => {
          const adapter = event.adapter as ReturnType<
            typeof import("@chat-adapter/slack").createSlackAdapter
          >;
          await adapter.setAssistantStatus(
            event.channelId,
            event.threadTs,
            "is working...",
            ["Thinking...", "Almost there..."]
          );
        },
      }
    );

    await ctx.sendWebhook(createAssistantThreadStartedPayload());

    expect(ctx.mockClient.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "is working...",
        loading_messages: ["Thinking...", "Almost there..."],
      })
    );
  });

  it("should call setSuggestedPrompts without title", async () => {
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAssistantThreadStarted: async (event) => {
          const adapter = event.adapter as ReturnType<
            typeof import("@chat-adapter/slack").createSlackAdapter
          >;
          await adapter.setSuggestedPrompts(event.channelId, event.threadTs, [
            { title: "Help", message: "Help me" },
          ]);
        },
      }
    );

    await ctx.sendWebhook(createAssistantThreadStartedPayload());

    expect(
      ctx.mockClient.assistant.threads.setSuggestedPrompts
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: DM_CHANNEL,
        thread_ts: THREAD_TS,
        prompts: [{ title: "Help", message: "Help me" }],
      })
    );
  });
});
