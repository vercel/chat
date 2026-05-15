import { tool } from "ai";
import { z } from "zod";
import type { ChatBinding, ToolOptions } from "../types";

export const addReaction = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
) =>
  tool({
    description:
      "Add an emoji reaction to a specific message. Use a well-known emoji name (e.g. 'thumbs_up', 'heart', 'check') or a platform-native shorthand.",
    needsApproval,
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id"),
      messageId: z
        .string()
        .describe("Platform-specific message id to react to"),
      emoji: z
        .string()
        .describe(
          "Emoji name or platform shortcode (e.g. 'thumbs_up', 'white_check_mark')"
        ),
    }),
    execute: async ({ threadId, messageId, emoji }) => {
      const thread = chat.thread(threadId);
      await thread.adapter.addReaction(threadId, messageId, emoji);
      return { added: true, emoji, messageId, threadId };
    },
  });

export const removeReaction = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
) =>
  tool({
    description:
      "Remove an emoji reaction the bot previously added to a message.",
    needsApproval,
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id"),
      messageId: z
        .string()
        .describe("Platform-specific message id to remove the reaction from"),
      emoji: z
        .string()
        .describe(
          "Emoji name or platform shortcode previously added by the bot"
        ),
    }),
    execute: async ({ threadId, messageId, emoji }) => {
      const thread = chat.thread(threadId);
      await thread.adapter.removeReaction(threadId, messageId, emoji);
      return { removed: true, emoji, messageId, threadId };
    },
  });
