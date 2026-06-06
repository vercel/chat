/**
 * Modal views round-trip: trigger generation, views.open/update, and
 * view_submission interactivity against the emulator store.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, Modal, type ModalSubmitEvent, TextInput } from "chat";
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
import { createSlackViewSubmissionRequest } from "../../slack-utils";
import { createWaitUntilTracker } from "../../test-scenarios";
import {
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_BOT_TOKEN,
  generateViewTriggerId,
  type SlackEmulatorHandle,
  silentLogger,
} from "./utils";

describe("Slack emulator: modal views round-trip", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }> | undefined;
  let adapter!: SlackAdapter;
  let tracker!: ReturnType<typeof createWaitUntilTracker>;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      botToken: EMULATOR_BOT_TOKEN,
      signingSecret: emulator.signingSecret,
      userName: EMULATOR_BOT_NAME,
      logger: silentLogger,
    });
    chat = new Chat({
      userName: EMULATOR_BOT_NAME,
      adapters: { slack: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    tracker = createWaitUntilTracker();
    await chat.initialize();
  });

  afterEach(async () => {
    if (chat) {
      await chat.shutdown();
      chat = undefined;
    }
    emulator.reset();
  });

  it("opens and updates a modal via views.open and views.update", async () => {
    const { triggerId } = await generateViewTriggerId(emulator);
    const modal = Modal({
      title: "Feedback",
      callbackId: "feedback_form",
      children: [
        TextInput({
          id: "note",
          label: "Your note",
          placeholder: "Type here",
        }),
      ],
    });

    const opened = await adapter.openModal(triggerId, modal);
    const stored = emulator.slackStore.views.findOneBy(
      "view_id",
      opened.viewId
    );
    expect(stored?.callback_id).toBe("feedback_form");
    expect(stored?.type).toBe("modal");

    await adapter.updateModal(
      opened.viewId,
      Modal({
        title: "Updated feedback",
        callbackId: "feedback_form",
        children: [
          TextInput({
            id: "note",
            label: "Updated label",
          }),
        ],
      })
    );

    const updated = emulator.slackStore.views.findOneBy(
      "view_id",
      opened.viewId
    );
    expect(updated?.title?.text).toBe("Updated feedback");
  });

  it("delivers view_submission to onModalSubmit", async () => {
    if (!chat) {
      throw new Error("chat not initialized");
    }

    const captured = vi.fn<(event: ModalSubmitEvent) => void>();
    chat.onModalSubmit("feedback_form", (event) => {
      captured(event);
    });

    const { triggerId } = await generateViewTriggerId(emulator);
    const { viewId } = await adapter.openModal(
      triggerId,
      Modal({
        title: "Feedback",
        callbackId: "feedback_form",
        children: [TextInput({ id: "note", label: "Note" })],
      })
    );

    const req = createSlackViewSubmissionRequest(
      {
        viewId,
        callbackId: "feedback_form",
        teamId: emulator.teamId,
        userId: emulator.humanUserId,
        stateValues: {
          note: {
            note: { type: "plain_text_input", value: "great emulator" },
          },
        },
      },
      emulator.signingSecret
    );

    const res = await chat.webhooks.slack(req, {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(res.status).toBe(200);
    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toMatchObject({
      callbackId: "feedback_form",
      viewId,
      values: { note: "great emulator" },
    });
  });
});
