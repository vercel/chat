import { type ChatToolsOptions, createChatTools } from "chat/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";

const TARGET = "slack:C_PRIVATE:1769220155.940449";
const CHANNEL = "slack:C_PUBLIC";
const MISSING = /Tool call blocked: no conversation scope/;
const OUTSIDE = /tools are scoped to/;
const USER = { id: "U_READER", username: "reader", name: "Reader" };
const OPTIONS = { toolCallId: "read", messages: [], context: {} };

function action() {
  return {
    type: "block_actions",
    team: { id: "T_TEST" },
    user: USER,
    container: { type: "view", view_id: "V_HOME" },
    view: { id: "V_HOME", type: "home" },
    actions: [{ type: "button", action_id: "read", value: "read" }],
  };
}

function view(type: string, context?: string) {
  return {
    type,
    team: { id: "T_TEST" },
    user: USER,
    view: {
      id: "V_MODAL",
      type: "modal",
      callback_id: "read",
      state: { values: {} },
      private_metadata: context,
    },
  };
}

describe("Slack interactive tool scope", () => {
  let context: SlackTestContext;
  let scope: ChatToolsOptions["scope"];
  let results: Array<string | undefined>;

  async function read() {
    try {
      const tools = createChatTools({
        chat: context.chat,
        preset: "reader",
        scope,
      });
      const result = await tools.fetchMessages?.execute?.(
        { threadId: TARGET, limit: 1, direction: "backward" },
        OPTIONS
      );
      if (!(result && "messages" in result)) {
        throw new Error("Expected a message result");
      }
      results.push(result.messages[0]?.text);
    } catch (error) {
      results.push(error instanceof Error ? error.message : String(error));
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    scope = undefined;
    results = [];
    context = createSlackTestContext(
      { botName: "testbot", botUserId: "U_BOT" },
      {}
    );
    context.chat.onAction(read);
    context.chat.onOptionsLoad(async () => {
      await read();
      return [];
    });
    context.chat.onModalSubmit(read);
    context.chat.onModalClose(read);
    await context.chat.initialize();
    context.mockClient.conversations.replies.mockResolvedValue({
      ok: true,
      messages: [
        {
          type: "message",
          user: "U_PRIVATE",
          ts: "1769220155.940449",
          text: "private-canary",
        },
      ],
      has_more: false,
    });
  });

  afterEach(async () => {
    await context.chat.shutdown();
  });

  describe.each([
    undefined,
    CHANNEL,
    TARGET,
    false,
  ] as const)("scope %s", (configured) => {
    it.each([
      "home",
      "options",
      "submit",
      "close",
      "missing",
    ])("protects %s dispatch", async (surface) => {
      scope = configured;
      if (surface === "home") {
        await context.sendSlackAction(action());
      } else if (surface === "options") {
        await context.sendSlackViewSubmission({
          type: "block_suggestion",
          team: { id: "T_TEST" },
          user: USER,
          action_id: "read",
          value: "private",
          container: {
            type: "message",
            channel_id: "C_PUBLIC",
            message_ts: "1769220155.940449",
          },
        });
      } else {
        await context.sendSlackViewSubmission(
          view(
            surface === "close" ? "view_closed" : "view_submission",
            surface === "missing" ? "missing-context" : undefined
          )
        );
      }

      expect(results).toHaveLength(1);
      if (configured === false || configured === TARGET) {
        expect(results).toEqual(["private-canary"]);
        expect(context.mockClient.conversations.replies).toHaveBeenCalled();
      } else {
        expect(results[0]).toMatch(
          configured === undefined ? MISSING : OUTSIDE
        );
        expect(context.mockClient.conversations.replies).not.toHaveBeenCalled();
        expect(context.mockClient.conversations.history).not.toHaveBeenCalled();
      }
    });
  });

  it("does not widen scope when a modal context is consumed by the first delivery", async () => {
    await context.state.set(
      "modal-context:slack:context",
      {
        channel: context.chat.channel("slack:C_PRIVATE").toJSON(),
      },
      60_000
    );
    const payload = view("view_submission", "context");
    await context.sendSlackViewSubmission(payload);
    expect(results).toEqual(["private-canary"]);
    context.mockClient.conversations.replies.mockClear();
    await context.sendSlackViewSubmission(payload);

    expect(results).toHaveLength(2);
    expect(results[1]).toMatch(MISSING);
    expect(context.mockClient.conversations.replies).not.toHaveBeenCalled();
  });

  it("retains automatic scope for message actions", async () => {
    await context.sendSlackAction({
      ...action(),
      container: {
        type: "message",
        channel_id: "C_PUBLIC",
        message_ts: "1769220155.940449",
      },
      channel: { id: "C_PUBLIC" },
      message: { ts: "1769220155.940449" },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(OUTSIDE);
    expect(context.mockClient.conversations.replies).not.toHaveBeenCalled();
  });
});
