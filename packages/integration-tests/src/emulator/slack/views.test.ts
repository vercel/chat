/**
 * Modal views round-trip: trigger generation, views.open/update, and
 * view_submission interactivity against the emulator store.
 */

import {
  type ActionEvent,
  Modal,
  type ModalSubmitEvent,
  RadioSelect,
  Select,
  SelectOption,
  TextInput,
} from "chat";
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
import {
  createSlackInteractiveRequest,
  createSlackViewSubmissionRequest,
} from "../../slack-utils";
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

  it.each([
    { component: Select, type: "static_select" },
    { component: RadioSelect, type: "radio_buttons" },
  ])("dispatches $type changes, updates the view, and preserves submission", async ({
    component,
    type,
  }) => {
    const create = (value = "personal") =>
      Modal({
        title: "Permissions",
        callbackId: "permissions",
        children: [
          component({
            id: "scope",
            label: "Scope",
            dispatchAction: true,
            initialOption: value,
            options: [
              SelectOption({ label: "Personal", value: "personal" }),
              SelectOption({ label: "Team", value: "team" }),
            ],
          }),
          TextInput({ id: "permission", label: `${value} permission` }),
        ],
      });
    const trigger = await generateViewTriggerId(emulator);
    const { viewId } = await harness.adapter.openModal(trigger, create());
    const stored = emulator.slackStore.views.findOneBy("view_id", viewId);
    expect(stored?.blocks[0]).toMatchObject({ dispatch_action: true });

    const action = vi.fn<(event: ActionEvent) => void>();
    const submit = vi.fn<(event: ModalSubmitEvent) => void>();
    harness.chat.onAction("scope", async (event) => {
      action(event);
      await harness.adapter.updateModal(viewId, create(event.value));
    });
    harness.chat.onModalSubmit("permissions", submit);
    const values = {
      scope: {
        scope: {
          type,
          selected_option: {
            text: { type: "plain_text", text: "Team" },
            value: "team",
          },
        },
      },
      permission: { permission: { type: "plain_text_input", value: "read" } },
    };
    const view = {
      id: viewId,
      type: "modal",
      callback_id: "permissions",
      private_metadata: "",
      state: { values },
    };
    const payload = {
      type: "block_actions",
      api_app_id: "A_TEST",
      team: { id: emulator.teamId },
      user: { id: emulator.humanUserId, username: "human" },
      container: { type: "view", view_id: viewId },
      trigger_id: "change-trigger",
      view,
      actions: [
        { action_id: "scope", block_id: "scope", ...values.scope.scope },
      ],
    };
    const response = await harness.chat.webhooks.slack(
      createSlackInteractiveRequest(payload, emulator.signingSecret),
      { waitUntil: harness.tracker.waitUntil }
    );
    await harness.tracker.waitForAll();
    expect(response.status).toBe(200);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[0]).toMatchObject({
      actionId: "scope",
      value: "team",
      thread: null,
      raw: payload,
    });
    const updated = emulator.slackStore.views.findOneBy("view_id", viewId);
    expect(updated?.blocks[0]).toMatchObject({
      dispatch_action: true,
      element: { initial_option: { value: "team" } },
    });
    expect(updated?.blocks[1]).toMatchObject({
      label: { text: "team permission" },
    });

    const submission = await harness.chat.webhooks.slack(
      createSlackInteractiveRequest(
        {
          ...payload,
          type: "view_submission",
          actions: undefined,
          container: undefined,
        },
        emulator.signingSecret
      ),
      { waitUntil: harness.tracker.waitUntil }
    );
    await harness.tracker.waitForAll();
    expect(submission.status).toBe(200);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      callbackId: "permissions",
      values: { scope: "team", permission: "read" },
    });
  });

  it("delivers a cleared optional select without a selected value", async () => {
    const handler = vi.fn<(event: ActionEvent) => void>();
    harness.chat.onAction("scope", handler);
    const selection = { type: "static_select", selected_option: null };
    const response = await harness.chat.webhooks.slack(
      createSlackInteractiveRequest(
        {
          type: "block_actions",
          api_app_id: "A_TEST",
          team: { id: emulator.teamId },
          user: { id: emulator.humanUserId, username: "human" },
          container: { type: "view", view_id: "V_CLEAR" },
          trigger_id: "clear-trigger",
          view: {
            id: "V_CLEAR",
            type: "modal",
            state: { values: { scope: { scope: selection } } },
          },
          actions: [{ action_id: "scope", block_id: "scope", ...selection }],
        },
        emulator.signingSecret
      ),
      { waitUntil: harness.tracker.waitUntil }
    );
    await harness.tracker.waitForAll();
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      actionId: "scope",
      value: undefined,
      thread: null,
    });
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
