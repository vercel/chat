import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ChatBinding, ToolOptions } from "../types";

const POSTABLE_INPUT = z
  .union([
    z.string().describe("Plain text body"),
    z
      .object({ markdown: z.string() })
      .describe("Markdown body, converted to the platform's native format"),
    z
      .object({ raw: z.string() })
      .describe("Raw body, passed through to the platform untouched"),
  ])
  .describe("Message body");

type PostableInput = z.infer<typeof POSTABLE_INPUT>;

// Tool factories carry explicit `Tool<Input, Output>` return types so the
// emitted declarations only reference types exported from `ai`. Relying on
// inference would surface `ai` internals (e.g. `ExecutableTool` from
// `@ai-sdk/provider-utils`) that consumers cannot resolve.

const POST_MESSAGE_INPUT = z.object({
  threadId: z.string().describe("Full thread id including adapter prefix"),
  message: POSTABLE_INPUT,
});

export const postMessage = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof POST_MESSAGE_INPUT>,
  { messageId: string; threadId: string }
> =>
  tool({
    description:
      "Post a message inside an existing thread. Use this to reply within a conversation the bot already has context for. The threadId is the full id (e.g. 'slack:C123:1234567890.123456').",
    needsApproval,
    inputSchema: POST_MESSAGE_INPUT,
    execute: async ({ threadId, message }) => {
      const thread = chat.thread(threadId);
      const sent = await thread.post(toPostable(message));
      return {
        messageId: sent.id,
        threadId: sent.threadId,
      };
    },
  });

const POST_CHANNEL_MESSAGE_INPUT = z.object({
  channelId: z.string().describe("Full channel id including adapter prefix"),
  message: POSTABLE_INPUT,
});

export const postChannelMessage = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof POST_CHANNEL_MESSAGE_INPUT>,
  { messageId: string; threadId: string }
> =>
  tool({
    description:
      "Post a top-level message to a channel (not threaded under an existing message). The channelId is the full id (e.g. 'slack:C123ABC').",
    needsApproval,
    inputSchema: POST_CHANNEL_MESSAGE_INPUT,
    execute: async ({ channelId, message }) => {
      const channel = chat.channel(channelId);
      const sent = await channel.post(toPostable(message));
      return {
        messageId: sent.id,
        threadId: sent.threadId,
      };
    },
  });

const SEND_DIRECT_MESSAGE_INPUT = z.object({
  userId: z
    .string()
    .describe("Platform-specific user id; the adapter is auto-detected"),
  message: POSTABLE_INPUT,
});

export const sendDirectMessage = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof SEND_DIRECT_MESSAGE_INPUT>,
  { messageId: string; threadId: string }
> =>
  tool({
    description:
      "Open (or reuse) a 1:1 direct-message conversation with a user and post a message in it. The userId format is platform-specific (e.g. 'U123456' for Slack, 'users/123' for Google Chat).",
    needsApproval,
    inputSchema: SEND_DIRECT_MESSAGE_INPUT,
    execute: async ({ userId, message }) => {
      const dm = await chat.openDM(userId);
      const sent = await dm.post(toPostable(message));
      return {
        messageId: sent.id,
        threadId: sent.threadId,
      };
    },
  });

const EDIT_MESSAGE_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
  messageId: z
    .string()
    .describe("Platform-specific message id of the message to edit"),
  message: POSTABLE_INPUT,
});

export const editMessage = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof EDIT_MESSAGE_INPUT>,
  { messageId: string; threadId: string }
> =>
  tool({
    description:
      "Edit a previously posted message in a thread. Replaces the existing message body. Only messages the bot itself authored can be edited on most platforms.",
    needsApproval,
    inputSchema: EDIT_MESSAGE_INPUT,
    execute: async ({ threadId, messageId, message }) => {
      const thread = chat.thread(threadId);
      const result = await thread.adapter.editMessage(
        threadId,
        messageId,
        toPostable(message)
      );
      return { messageId: result.id, threadId: result.threadId };
    },
  });

const DELETE_MESSAGE_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
  messageId: z
    .string()
    .describe("Platform-specific message id of the message to delete"),
});

export const deleteMessage = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof DELETE_MESSAGE_INPUT>,
  { deleted: boolean; messageId: string; threadId: string }
> =>
  tool({
    description:
      "Delete a message from a thread. Only messages the bot itself authored can be deleted on most platforms.",
    needsApproval,
    inputSchema: DELETE_MESSAGE_INPUT,
    execute: async ({
      threadId,
      messageId,
    }): Promise<{ deleted: boolean; messageId: string; threadId: string }> => {
      const thread = chat.thread(threadId);
      await thread.adapter.deleteMessage(threadId, messageId);
      return { deleted: true, messageId, threadId };
    },
  });

function toPostable(
  input: PostableInput
): string | { markdown: string } | { raw: string } {
  if (typeof input === "string") {
    return input;
  }
  if ("markdown" in input) {
    return { markdown: input.markdown };
  }
  return { raw: input.raw };
}
