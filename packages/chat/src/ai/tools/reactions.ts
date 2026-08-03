import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ChatBinding, ToolOptions } from "../types";

// Tool factories carry explicit `Tool<Input, Output>` return types so the
// emitted declarations only reference types exported from `ai`. Relying on
// inference would surface `ai` internals (e.g. `ExecutableTool` from
// `@ai-sdk/provider-utils`) that consumers cannot resolve.

const ADD_REACTION_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
  messageId: z.string().describe("Platform-specific message id to react to"),
  emoji: z
    .string()
    .describe(
      "Emoji name or platform shortcode (e.g. 'thumbs_up', 'white_check_mark')"
    ),
});

export const addReaction = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof ADD_REACTION_INPUT>,
  { added: boolean; emoji: string; messageId: string; threadId: string }
> =>
  tool({
    description:
      "Add an emoji reaction to a specific message. Use a well-known emoji name (e.g. 'thumbs_up', 'heart', 'check') or a platform-native shorthand.",
    needsApproval,
    inputSchema: ADD_REACTION_INPUT,
    execute: async ({
      threadId,
      messageId,
      emoji,
    }): Promise<{
      added: boolean;
      emoji: string;
      messageId: string;
      threadId: string;
    }> => {
      const thread = chat.thread(threadId);
      await thread.adapter.addReaction(threadId, messageId, emoji);
      return { added: true, emoji, messageId, threadId };
    },
  });

const REMOVE_REACTION_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
  messageId: z
    .string()
    .describe("Platform-specific message id to remove the reaction from"),
  emoji: z
    .string()
    .describe("Emoji name or platform shortcode previously added by the bot"),
});

export const removeReaction = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof REMOVE_REACTION_INPUT>,
  { removed: boolean; emoji: string; messageId: string; threadId: string }
> =>
  tool({
    description:
      "Remove an emoji reaction the bot previously added to a message.",
    needsApproval,
    inputSchema: REMOVE_REACTION_INPUT,
    execute: async ({
      threadId,
      messageId,
      emoji,
    }): Promise<{
      removed: boolean;
      emoji: string;
      messageId: string;
      threadId: string;
    }> => {
      const thread = chat.thread(threadId);
      await thread.adapter.removeReaction(threadId, messageId, emoji);
      return { removed: true, emoji, messageId, threadId };
    },
  });
