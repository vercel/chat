/**
 * Replay tests for modal privateMetadata support.
 * Tests the flow: button click (with value) -> modal open (with privateMetadata) -> modal submit (privateMetadata roundtrips).
 */

import type { ActionEvent, ModalSubmitEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slackFixtures from "../fixtures/replay/modals/slack-private-metadata.json";
import {
  createSlackTestContext,
  expectValidAction,
  type SlackTestContext,
} from "./replay-test-utils";

/**
 * Store the modal context in the state adapter to simulate what happens when
 * openModal() is called. Uses the encoded metadata format (JSON with c/m keys).
 */
async function storeModalContext(ctx: SlackTestContext): Promise<void> {
  const { contextId, thread, message } = slackFixtures.modalContext;
  const key = `modal-context:slack:${contextId}`;
  await ctx.state.set(key, { thread, message }, 3600000);
}

describe("Replay Tests - Modal privateMetadata", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedAction: ActionEvent | null = null;
    let capturedModalSubmit: ModalSubmitEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedModalSubmit = null;

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
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle report button click with value", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      await ctx.sendSlackAction(slackFixtures.action);

      expectValidAction(capturedAction, {
        actionId: "report",
        userId: "U0A8WUV28QM",
        userName: "sd0a90bkva4s_user",
        adapterName: "slack",
        channelId: "C0A9D9RTBMF",
        isDM: false,
      });

      expect(capturedAction?.value).toBe("bug");
    });

    it("should decode privateMetadata from view_submission", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);
      vi.clearAllMocks();

      await storeModalContext(ctx);
      const response = await ctx.sendSlackViewSubmission(
        slackFixtures.viewSubmission,
      );

      expect(response.status).toBe(200);
      expect(capturedModalSubmit).not.toBeNull();
      expect(capturedModalSubmit?.callbackId).toBe("report_form");
      expect(capturedModalSubmit?.viewId).toBe("V0AEWMF8C3D");

      // Verify privateMetadata was decoded and exposed on the event
      expect(capturedModalSubmit?.privateMetadata).toBeDefined();
      const metadata = JSON.parse(
        capturedModalSubmit?.privateMetadata as string,
      );
      expect(metadata.reportType).toBe("bug");
      expect(metadata.threadId).toBe("slack:C0A9D9RTBMF:1771116676.529969");
      expect(metadata.reporter).toBe("U0A8WUV28QM");
    });

    it("should decode form values from view_submission", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);

      await storeModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(capturedModalSubmit?.values).toEqual({
        title: "tes",
        steps: "test",
        severity: "high",
      });
    });

    it("should populate relatedThread alongside privateMetadata", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);

      await storeModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      // Both privateMetadata and relatedThread should be available
      expect(capturedModalSubmit?.privateMetadata).toBeDefined();
      expect(capturedModalSubmit?.relatedThread).toBeDefined();
      expect(capturedModalSubmit?.relatedThread?.id).toBe(
        "slack:C0A9D9RTBMF:1771116676.529969",
      );
      expect(capturedModalSubmit?.relatedThread?.channelId).toBe("C0A9D9RTBMF");
    });

    it("should populate relatedMessage alongside privateMetadata", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.action);

      await storeModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(capturedModalSubmit?.privateMetadata).toBeDefined();
      expect(capturedModalSubmit?.relatedMessage).toBeDefined();
      expect(capturedModalSubmit?.relatedMessage?.id).toBe("1771116682.586579");
      expect(capturedModalSubmit?.relatedMessage?.threadId).toBe(
        "slack:C0A9D9RTBMF:1771116676.529969",
      );
    });

    it("should allow handler to use privateMetadata and post to relatedThread", async () => {
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
            if (event.privateMetadata && event.relatedThread) {
              const metadata = JSON.parse(event.privateMetadata);
              await event.relatedThread.post(
                `Bug report (${metadata.reportType}): ${event.values.title}`,
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
          channel: "C0A9D9RTBMF",
          thread_ts: "1771116676.529969",
          text: expect.stringContaining("Bug report (bug): tes"),
        }),
      );
    });
  });
});
