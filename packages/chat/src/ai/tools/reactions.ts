import { z } from "zod";
import type { ChatBinding, ToolOptions } from "../types";
import type { ChatToolSpec } from "./spec";

// Spec factories carry explicit `ChatToolSpec<Input, Output>` return types so
// the framework wrappers (AI SDK, TanStack AI) inherit precise input and output
// types without surfacing framework internals in the emitted declarations.

const ADD_REACTION_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
  messageId: z.string().describe("Platform-specific message id to react to"),
  emoji: z
    .string()
    .describe(
      "Emoji name or platform shortcode (e.g. 'thumbs_up', 'white_check_mark')"
    ),
});

export const addReactionSpec = (
  chat: ChatBinding,
  { needsApproval = true, guard }: ToolOptions = {}
): ChatToolSpec<
  z.infer<typeof ADD_REACTION_INPUT>,
  { added: boolean; emoji: string; messageId: string; threadId: string }
> => ({
  name: "addReaction",
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
    guard?.(threadId);
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

export const removeReactionSpec = (
  chat: ChatBinding,
  { needsApproval = true, guard }: ToolOptions = {}
): ChatToolSpec<
  z.infer<typeof REMOVE_REACTION_INPUT>,
  { removed: boolean; emoji: string; messageId: string; threadId: string }
> => ({
  name: "removeReaction",
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
    guard?.(threadId);
    const thread = chat.thread(threadId);
    await thread.adapter.removeReaction(threadId, messageId, emoji);
    return { removed: true, emoji, messageId, threadId };
  },
});
