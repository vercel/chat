/**
 * Modal views round-trip: trigger generation, views.open/update, and
 * view_submission interactivity against the emulator store.
 */

import { Modal, type ModalSubmitEvent, TextInput } from "chat";
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
import {
  createEmulatorChatHarness,
  createSlackEmulator,
  type EmulatorChatHarness,
  generateViewTriggerId,
  type SlackEmulatorHandle,
} from "./utils";

describe("Slack emulator: modal views round-trip", () => {
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

  it("opens and updates a modal via views.open and views.update", async () => {
    const triggerId = await generateViewTriggerId(emulator);
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

    const opened = await harness.adapter.openModal(triggerId, modal);
    const stored = emulator.slackStore.views.findOneBy(
      "view_id",
      opened.viewId
    );
    expect(stored?.callback_id).toBe("feedback_form");
    expect(stored?.type).toBe("modal");

    await harness.adapter.updateModal(
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
    const captured = vi.fn<(event: ModalSubmitEvent) => void>();
    harness.chat.onModalSubmit("feedback_form", (event) => {
      captured(event);
    });

    const triggerId = await generateViewTriggerId(emulator);
    const { viewId } = await harness.adapter.openModal(
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

    const res = await harness.chat.webhooks.slack(req, {
      waitUntil: harness.tracker.waitUntil,
    });
    await harness.tracker.waitForAll();

    expect(res.status).toBe(200);
    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toMatchObject({
      callbackId: "feedback_form",
      viewId,
      values: { note: "great emulator" },
    });
  });
});
