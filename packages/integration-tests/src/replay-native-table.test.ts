/**
 * Replay test for native Slack table block rendering.
 *
 * Verifies that a card with a Table element produces a native Slack table block
 * (using raw_text cells and first-row-as-headers schema) instead of ASCII fallback.
 */

import { Card, CardText, Table } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slackFixtures from "../fixtures/replay/native-table/slack.json";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";

describe("Replay Tests - Native Table Block", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createSlackTestContext(
        {
          botName: slackFixtures.botName,
          botUserId: slackFixtures.botUserId,
        },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            if (event.actionId === "show-table") {
              await event.thread?.post(
                Card({
                  title: "Team Directory",
                  children: [
                    CardText("Here's the current team roster:"),
                    Table({
                      headers: ["Name", "Role", "Location", "Status"],
                      rows: [
                        [
                          "Alice Chen",
                          "Engineering Lead",
                          "San Francisco",
                          "Active",
                        ],
                        ["Bob Smith", "Designer", "New York", "Active"],
                        ["Carol Wu", "Product Manager", "London", "On Leave"],
                      ],
                    }),
                  ],
                })
              );
            }
          },
        }
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should render table as native Slack table block with raw_text cells", async () => {
      // Subscribe via mention
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      // Click "Show Table" button
      await ctx.sendSlackAction(slackFixtures.action);

      // Verify postMessage was called with blocks
      const postCall = ctx.mockClient.chat.postMessage.mock.calls[0]?.[0];
      expect(postCall).toBeDefined();
      expect(postCall.blocks).toBeDefined();

      const blocks = postCall.blocks;

      // Should have: header, section (text), table
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe("header");
      expect(blocks[1].type).toBe("section");
      expect(blocks[2].type).toBe("table");

      // Verify table block uses native schema
      const tableBlock = blocks[2];
      expect(tableBlock.rows).toBeDefined();
      expect(tableBlock.rows).toHaveLength(4); // 1 header row + 3 data rows

      // First row should be headers
      expect(tableBlock.rows[0]).toEqual([
        { type: "raw_text", text: "Name" },
        { type: "raw_text", text: "Role" },
        { type: "raw_text", text: "Location" },
        { type: "raw_text", text: "Status" },
      ]);

      // Data rows
      expect(tableBlock.rows[1][0]).toEqual({
        type: "raw_text",
        text: "Alice Chen",
      });
      expect(tableBlock.rows[2][0]).toEqual({
        type: "raw_text",
        text: "Bob Smith",
      });
      expect(tableBlock.rows[3][0]).toEqual({
        type: "raw_text",
        text: "Carol Wu",
      });

      // Should NOT have the old columns/plain_text schema
      expect(tableBlock.columns).toBeUndefined();
    });
  });
});
