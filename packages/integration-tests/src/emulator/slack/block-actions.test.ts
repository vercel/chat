/**
 * Inbound `block_actions` interactivity: a user clicks a Block Kit button, the
 * signed form-urlencoded payload is routed through `chat.webhooks.slack(...)`
 * to `chat.handleAction`, and `onAction` handlers run with a live Thread so the
 * bot can post a threaded reply that lands in the emulator store.
 *
 * Complements views.test.ts (view_submission) — this is the other half of
 * Slack interactivity and was previously only exercised by the mock-client
 * replay tests, never against the real HTTP webhook path.
 */

import type { ActionEvent } from "chat";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSlackBlockActionsRequest } from "../../slack-utils";
import {
  createEmulatorChatHarness,
  createSlackEmulator,
  EMULATOR_BOT_USER_ID,
  type EmulatorChatHarness,
  type SlackEmulatorHandle,
} from "./utils";

describe("Slack emulator: inbound block_actions flow", () => {
  let emulator: SlackEmulatorHandle;
  let harness: EmulatorChatHarness;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    harness = await createEmulatorChatHarness(emulator);
  });

  afterEach(async () => {
    await harness.teardown();
  });

  /**
   * Deliver a signed block_actions button click for the seeded human user in
   * the seeded channel, assert the webhook returned 200, and drain the tracker
   * so the `onAction` handler's `waitUntil` work has settled.
   */
  async function deliverAction(options: {
    actionId: string;
    actionValue?: string;
    messageTs: string;
    triggerId?: string;
  }): Promise<void> {
    const req = createSlackBlockActionsRequest(
      {
        actionId: options.actionId,
        actionValue: options.actionValue,
        channel: emulator.channelId,
        messageTs: options.messageTs,
        userId: emulator.humanUserId,
        triggerId: options.triggerId,
      },
      emulator.signingSecret
    );
    const res = await harness.chat.webhooks.slack(req, {
      waitUntil: harness.tracker.waitUntil,
    });
    if (res.status !== 200) {
      throw new Error(`block_actions webhook returned ${res.status}`);
    }
    await harness.tracker.waitForAll();
  }

  it("delivers a button click to onAction and posts a threaded reply", async () => {
    const captured = vi.fn<(event: ActionEvent) => void>();
    harness.chat.onAction(async (event) => {
      captured(event);
      await event.thread?.post(`approved ${event.value}`);
    });

    const messageTs = "1700000000.700001";
    await deliverAction({
      actionId: "approve",
      actionValue: "ticket-42",
      messageTs,
      triggerId: "trigger-abc",
    });

    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toMatchObject({
      actionId: "approve",
      value: "ticket-42",
      triggerId: "trigger-abc",
      threadId: `slack:${emulator.channelId}:${messageTs}`,
      user: expect.objectContaining({ userId: emulator.humanUserId }),
    });

    // The handler's reply posted through the real chat.postMessage path and
    // landed in the emulator store, threaded under the clicked message.
    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId &&
          m.user === EMULATOR_BOT_USER_ID &&
          m.thread_ts === messageTs
      );
    expect(replies.map((r) => r.text)).toEqual(["approved ticket-42"]);
  });

  it("routes only matching action IDs to a filtered onAction handler", async () => {
    const onConfirm = vi.fn<(event: ActionEvent) => void>();
    harness.chat.onAction(["confirm"], (event) => {
      onConfirm(event);
    });

    // A non-matching action id must not trigger the filtered handler, but the
    // webhook still acknowledges with 200.
    await deliverAction({ actionId: "cancel", messageTs: "1700000000.700002" });
    expect(onConfirm).not.toHaveBeenCalled();

    // The matching action id fires the handler exactly once.
    await deliverAction({
      actionId: "confirm",
      actionValue: "yes",
      messageTs: "1700000000.700003",
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
      actionId: "confirm",
      value: "yes",
    });
  });
});
