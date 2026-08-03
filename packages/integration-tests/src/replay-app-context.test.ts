import { getAppContext } from "@chat-adapter/slack";
import type { AppContextChangedEvent, Message } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";

const BOT_NAME = "agentbot";
const BOT_USER_ID = "U_BOT_123";
const TEAM_ID = "T_TEAM_123";
const USER_ID = "U_USER_123";
const DM_CHANNEL = "D_DM_123";
const CONTEXT_CHANNEL = "C_CTX_123";

function createAppContextChangedPayload() {
  return {
    type: "event_callback",
    team_id: TEAM_ID,
    api_app_id: "A_APP_123",
    event: {
      type: "app_context_changed",
      channel: DM_CHANNEL,
      user: USER_ID,
      context: {
        entities: [{ type: "slack#/types/channel_id", value: CONTEXT_CHANNEL }],
      },
      event_ts: "1771460500.111180",
    },
    event_id: "Ev_APPCTX_123",
    event_time: 1_771_460_500,
  };
}

function createFoldedDmPayload() {
  return {
    type: "event_callback",
    team_id: TEAM_ID,
    api_app_id: "A_APP_123",
    event: {
      type: "message",
      channel: DM_CHANNEL,
      channel_type: "im",
      user: USER_ID,
      text: "summarize this",
      ts: "1771460600.222190",
      event_ts: "1771460600.222190",
      app_context: {
        entities: [
          {
            type: "slack#/types/message_context",
            value: {
              message_ts: "1771460400.100100",
              channel_id: CONTEXT_CHANNEL,
            },
          },
        ],
      },
    },
    event_id: "Ev_FOLD_123",
    event_time: 1_771_460_600,
  };
}

describe("Slack app_context_changed replay", () => {
  let ctx: SlackTestContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("routes app_context_changed to onAppContextChanged with normalized entities", async () => {
    let captured: AppContextChangedEvent | null = null;
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onAppContextChanged: (event) => {
          captured = event;
        },
      }
    );

    await ctx.sendWebhook(createAppContextChangedPayload());

    expect(captured).not.toBeNull();
    const event = captured as unknown as AppContextChangedEvent;
    expect(event.channelId).toBe(DM_CHANNEL);
    expect(event.userId).toBe(USER_ID);
    expect(event.entities).toEqual([
      { kind: "channel", channelId: CONTEXT_CHANNEL },
    ]);
  });

  it("exposes folded app_context on a DM message via getAppContext", async () => {
    let message: Message | null = null;
    ctx = createSlackTestContext(
      { botName: BOT_NAME, botUserId: BOT_USER_ID },
      {
        onMention: (_thread, msg) => {
          message = msg;
        },
      }
    );

    await ctx.sendWebhook(createFoldedDmPayload());

    expect(message).not.toBeNull();
    expect(getAppContext(message as unknown as Message)).toEqual([
      {
        kind: "message",
        messageTs: "1771460400.100100",
        channelId: CONTEXT_CHANNEL,
      },
    ]);
  });
});
