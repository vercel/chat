/**
 * Replay tests for callbackUrl handling on buttons and modals.
 *
 * When a button or modal carries a `callbackUrl`, the SDK POSTs the action
 * payload to that URL in addition to firing any registered handler. These
 * tests replay real Slack webhook payloads with the SDK's encoded callback
 * token (`__cb:<hex>`) and a stored modal context with `callbackUrl`, then
 * assert the SDK resolves the URL and POSTs the right shape.
 *
 * Discord adapter encoding/decoding is covered by unit tests in
 * `packages/adapter-discord/src/cards.test.ts`.
 */

import type { ActionEvent, ModalSubmitEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slackActionFixtures from "../fixtures/replay/actions-reactions/slack.json";
import slackModalFixtures from "../fixtures/replay/modals/slack.json";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";

const CALLBACK_BUTTON_URL = "https://hook.example.com/button-cb";
const CALLBACK_MODAL_URL = "https://hook.example.com/modal-cb";
const CALLBACK_TOKEN = "abcdef0123456789";

describe("Replay Tests - callbackUrl", () => {
  describe("Slack button click with callback token", () => {
    let ctx: SlackTestContext;
    let capturedAction: ActionEvent | null = null;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("ok", { status: 200 }));

      ctx = createSlackTestContext(
        {
          botName: slackActionFixtures.botName,
          botUserId: slackActionFixtures.botUserId,
        },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: (event) => {
            capturedAction = event;
          },
        }
      );
    });

    afterEach(async () => {
      fetchSpy.mockRestore();
      await ctx.chat.shutdown();
    });

    it("decodes the token, POSTs the URL, and passes the original value to onAction", async () => {
      await ctx.sendWebhook(slackActionFixtures.mention);

      // Pre-populate the callback URL store as the SDK would have done at post time.
      await ctx.state.set(`chat:callback:${CALLBACK_TOKEN}`, {
        url: CALLBACK_BUTTON_URL,
        originalValue: "order-99",
      });

      // Synthesize a block_actions payload with the SDK's encoded token as the value.
      const action = {
        ...slackActionFixtures.action,
        actions: [
          {
            ...slackActionFixtures.action.actions[0],
            action_id: "approve",
            value: `__cb:${CALLBACK_TOKEN}`,
          },
        ],
      };

      vi.clearAllMocks();
      await ctx.sendSlackAction(action);

      // Handler sees the original value, not the encoded token.
      expect(capturedAction?.actionId).toBe("approve");
      expect(capturedAction?.value).toBe("order-99");

      // The SDK POSTed to the stored callback URL.
      const callbackCalls = fetchSpy.mock.calls.filter(
        ([url]: [unknown, ...unknown[]]) => url === CALLBACK_BUTTON_URL
      );
      expect(callbackCalls).toHaveLength(1);

      const [, init] = callbackCalls[0] as [
        string,
        { method?: string; body?: string; headers?: Record<string, string> },
      ];
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body ?? "{}");
      expect(body).toMatchObject({
        type: "action",
        actionId: "approve",
        value: "order-99",
      });
      expect(body.user.id).toBe("U00FAKEUSER1");
    });

    it("treats an unknown token as a regular value when nothing is stored", async () => {
      await ctx.sendWebhook(slackActionFixtures.mention);

      const action = {
        ...slackActionFixtures.action,
        actions: [
          {
            ...slackActionFixtures.action.actions[0],
            action_id: "approve",
            value: "__cb:not-a-real-token",
          },
        ],
      };

      vi.clearAllMocks();
      await ctx.sendSlackAction(action);

      // Handler still fires; value is preserved verbatim because no store entry exists.
      expect(capturedAction?.value).toBe("__cb:not-a-real-token");

      // No fetch went to any callback URL.
      const callbackCalls = fetchSpy.mock.calls.filter(
        ([url]: [unknown, ...unknown[]]) =>
          typeof url === "string" && url.startsWith("https://hook.example.com/")
      );
      expect(callbackCalls).toHaveLength(0);
    });
  });

  describe("Slack modal submit with stored callbackUrl", () => {
    let ctx: SlackTestContext;
    let capturedSubmit: ModalSubmitEvent | null = null;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedSubmit = null;
      fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("ok", { status: 200 }));

      ctx = createSlackTestContext(
        {
          botName: slackModalFixtures.botName,
          botUserId: slackModalFixtures.botUserId,
        },
        {
          onModalSubmit: (event) => {
            capturedSubmit = event;
          },
        }
      );
    });

    afterEach(async () => {
      fetchSpy.mockRestore();
      await ctx.chat.shutdown();
    });

    it("POSTs the form values to the modal callbackUrl after the handler runs", async () => {
      await ctx.state.connect();
      const { contextId } = slackModalFixtures.modalContext;

      // Simulate what openModal would have stored, including the callbackUrl.
      await ctx.state.set(`modal-context:slack:${contextId}`, {
        thread: slackModalFixtures.modalContext.thread,
        message: slackModalFixtures.modalContext.message,
        callbackUrl: CALLBACK_MODAL_URL,
      });

      vi.clearAllMocks();
      const response = await ctx.sendSlackViewSubmission(
        slackModalFixtures.viewSubmission
      );
      expect(response.status).toBe(200);

      // The user-provided handler still fires.
      expect(capturedSubmit?.callbackId).toBe("feedback_form");

      // SDK POSTed the modal_submit payload to the stored URL.
      const callbackCalls = fetchSpy.mock.calls.filter(
        ([url]: [unknown, ...unknown[]]) => url === CALLBACK_MODAL_URL
      );
      expect(callbackCalls).toHaveLength(1);

      const [, init] = callbackCalls[0] as [
        string,
        { method?: string; body?: string; headers?: Record<string, string> },
      ];
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body ?? "{}");
      expect(body).toMatchObject({
        type: "modal_submit",
        callbackId: "feedback_form",
        values: {
          message: "Hello!",
          category: "feature",
          email: "user@example.com",
        },
      });
    });

    it("does not POST when the modal context lacks a callbackUrl", async () => {
      await ctx.state.connect();
      const { contextId } = slackModalFixtures.modalContext;

      // Modal context exists but has no callbackUrl — the existing flow.
      await ctx.state.set(`modal-context:slack:${contextId}`, {
        thread: slackModalFixtures.modalContext.thread,
        message: slackModalFixtures.modalContext.message,
      });

      vi.clearAllMocks();
      await ctx.sendSlackViewSubmission(slackModalFixtures.viewSubmission);

      const callbackCalls = fetchSpy.mock.calls.filter(
        ([url]: [unknown, ...unknown[]]) =>
          typeof url === "string" && url.startsWith("https://hook.example.com/")
      );
      expect(callbackCalls).toHaveLength(0);
    });
  });
});
