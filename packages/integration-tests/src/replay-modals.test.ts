/**
 * Replay tests for modal interactions (button click -> modal open -> modal submit).
 */

import type { ActionEvent, ModalSubmitEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slackFixtures from "../fixtures/replay/modals/slack.json";
import {
  createSlackTestContext,
  expectValidAction,
  type SlackTestContext,
} from "./replay-test-utils";

/**
 * Store the modal context in the state adapter to simulate what happens when
 * openModal() is called. The context includes the serialized thread and message
 * that were captured when the modal was opened (stored in fixtures).
 */
async function storeModalContext(ctx: SlackTestContext): Promise<void> {
  const { contextId, thread, message } = slackFixtures.modalContext;
  const key = `modal-context:slack:${contextId}`;
  await ctx.state.set(key, { thread, message }, 3600000); // 1 hour TTL
}

async function storeEphemeralModalContext(
  ctx: SlackTestContext,
): Promise<void> {
  await ctx.state.connect();
  const { contextId, thread, message } = slackFixtures.ephemeralModalContext;
  const key = `modal-context:slack:${contextId}`;
  await ctx.state.set(key, { thread, message }, 3600000);
}

describe("Replay Tests - Modals", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedAction: ActionEvent | null = null;
    let capturedModalSubmit: ModalSubmitEvent | null = null;
    let openModalCalled = false;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedModalSubmit = null;
      openModalCalled = false;

      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
            if (event.actionId === "feedback") {
              openModalCalled = true;
            }
          },
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle feedback button click (block_actions)", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      await ctx.sendSlackAction(slackFixtures.action);

      expectValidAction(capturedAction, {
        actionId: "feedback",
        userId: "U0A60JBHJBE",
        userName: "vishal.yathish",
        adapterName: "slack",
        channelId: "C0A9GJ2PUTB",
        isDM: false,
      });

      expect(openModalCalled).toBe(true);

      expect(capturedAction?.triggerId).toBe(
        "10367455086084.10229338706656.e675a0c0dacc24a1f7b84a7a426d1197",
      );
    });

    it("should handle modal submission (view_submission)", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);
      vi.clearAllMocks();

      const response = await ctx.sendSlackViewSubmission(
        slackFixtures.viewSubmission,
      );

      expect(response.status).toBe(200);

      expect(capturedModalSubmit).not.toBeNull();
      expect(capturedModalSubmit?.callbackId).toBe("feedback_form");
      expect(capturedModalSubmit?.viewId).toBe("V0AB2P1M2HX");

      expect(capturedModalSubmit?.values).toEqual({
        message: "Hello!",
        category: "feature",
        email: "hello@vercel.com",
      });

      expect(capturedModalSubmit?.user.userId).toBe("U0A60JBHJBE");
      expect(capturedModalSubmit?.user.userName).toBe("vishal.yathish");
      expect(capturedModalSubmit?.user.isBot).toBe(false);
      expect(capturedModalSubmit?.user.isMe).toBe(false);
    });

    it("should populate relatedThread in modal submit event", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);

      await storeModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(capturedModalSubmit?.relatedThread).toBeDefined();
      expect(capturedModalSubmit?.relatedThread?.id).toBe(
        "slack:C0A9GJ2PUTB:1769220155.940449",
      );
      expect(capturedModalSubmit?.relatedThread?.channelId).toBe("C0A9GJ2PUTB");
      expect(capturedModalSubmit?.relatedThread?.isDM).toBe(false);
      expect(capturedModalSubmit?.relatedThread?.adapter.name).toBe("slack");
    });

    it("should populate relatedMessage in modal submit event", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);

      await storeModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(capturedModalSubmit?.relatedMessage).toBeDefined();
      expect(capturedModalSubmit?.relatedMessage?.id).toBe("1769220161.503009");
      expect(capturedModalSubmit?.relatedMessage?.threadId).toBe(
        "slack:C0A9GJ2PUTB:1769220155.940449",
      );

      expect(capturedModalSubmit?.relatedMessage?.author.isBot).toBe(true);
      expect(capturedModalSubmit?.relatedMessage?.author.isMe).toBe(true);
      expect(capturedModalSubmit?.relatedMessage?.author.userId).toBe(
        "U0A6PEGC2TH",
      );
    });

    it("should allow posting to relatedThread from modal submit handler", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
          },
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
            if (event.relatedThread) {
              await event.relatedThread.post(
                `Feedback received from ${event.user.userName}!`,
              );
            }
          },
        },
      );

      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);
      await storeModalContext(ctx);

      vi.clearAllMocks();
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);
      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0A9GJ2PUTB",
          thread_ts: "1769220155.940449",
          text: expect.stringContaining(
            "Feedback received from vishal.yathish",
          ),
        }),
      );
    });

    it("should allow editing relatedMessage from modal submit handler", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
          },
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
            if (event.relatedMessage) {
              await event.relatedMessage.edit("Feedback received! Thank you.");
            }
          },
        },
      );

      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);
      await storeModalContext(ctx);

      vi.clearAllMocks();
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);
      expect(ctx.mockClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0A9GJ2PUTB",
          ts: "1769220161.503009",
          text: expect.stringContaining("Feedback received! Thank you."),
        }),
      );
    });

    it("should handle button click from ephemeral message and provide triggerId for modal", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onAction: async (event) => {
            capturedAction = event;
            if (event.actionId === "ephemeral_modal") {
              openModalCalled = true;
            }
          },
        },
      );

      await ctx.sendSlackAction(slackFixtures.ephemeralAction);

      expect(capturedAction).not.toBeNull();
      expect(capturedAction?.actionId).toBe("ephemeral_modal");
      expect(capturedAction?.triggerId).toBe(
        "10541689532400.10229338706656.500e194be18c7e17dd828032cc9a769f",
      );
      expect(openModalCalled).toBe(true);

      expect(capturedAction?.messageId).toMatch(/^ephemeral:/);
      expect(capturedAction?.messageId).toContain("1771126609.000200");

      expect(capturedAction?.threadId).toBe(
        "slack:C0ACELCQBAB:1771126602.612659",
      );
      expect(capturedAction?.thread.channelId).toBe("C0ACELCQBAB");
    });

    it("should allow editing relatedMessage from ephemeral modal submission", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );

      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
            if (event.relatedMessage) {
              await event.relatedMessage.edit("Updated ephemeral content!");
            }
          },
        },
      );

      await storeEphemeralModalContext(ctx);
      vi.clearAllMocks();
      await ctx.sendSlackViewSubmission(slackFixtures.ephemeralViewSubmission);

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://hooks.slack.com/actions/T0A6R9YLSKA/10497963005175/6JXlnuaOBOquTvi51uTnoFgi",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            replace_original: true,
            text: "Updated ephemeral content!",
            thread_ts: "1771126602.612659",
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it("should allow posting to relatedThread from ephemeral modal submission", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
            if (event.relatedThread) {
              await event.relatedThread.post("Response posted to thread!");
            }
          },
        },
      );

      await storeEphemeralModalContext(ctx);
      vi.clearAllMocks();
      await ctx.sendSlackViewSubmission(slackFixtures.ephemeralViewSubmission);

      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0ACELCQBAB",
          thread_ts: "1771126602.612659",
          text: expect.stringContaining("Response posted to thread!"),
        }),
      );
    });
  });
});
