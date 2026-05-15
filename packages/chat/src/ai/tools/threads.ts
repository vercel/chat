import { tool } from "ai";
import { z } from "zod";
import type { Message } from "../../message";
import type { ThreadSummary } from "../../types";
import type { ChatBinding, ToolOptions } from "../types";

const FETCH_DIRECTION = z
  .enum(["forward", "backward"])
  .optional()
  .default("backward");

function projectMessage(message: Message) {
  return {
    id: message.id,
    threadId: message.threadId,
    text: message.text,
    author: {
      userId: message.author.userId,
      userName: message.author.userName,
      fullName: message.author.fullName,
      isBot: message.author.isBot,
      isMe: message.author.isMe,
    },
    dateSent: message.metadata.dateSent?.toISOString(),
    edited: message.metadata.edited,
    isMention: message.isMention,
    attachments: (message.attachments ?? []).map((att) => ({
      type: att.type,
      name: att.name,
      mimeType: att.mimeType,
      url: att.url,
    })),
  };
}

export const fetchMessages = (chat: ChatBinding) =>
  tool({
    description:
      "Fetch recent messages from a thread, ordered chronologically (oldest first within the page). Use to read the conversation before responding.",
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of messages to fetch"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous fetchMessages call"),
      direction: FETCH_DIRECTION.describe(
        "'backward' (default) returns the most recent messages; 'forward' iterates from the oldest"
      ),
    }),
    execute: async ({ threadId, limit, cursor, direction }) => {
      const thread = chat.thread(threadId);
      const result = await thread.adapter.fetchMessages(threadId, {
        limit,
        cursor,
        direction,
      });
      return {
        messages: result.messages.map(projectMessage),
        nextCursor: result.nextCursor,
      };
    },
  });

export const fetchChannelMessages = (chat: ChatBinding) =>
  tool({
    description:
      "Fetch top-level messages in a channel (not thread replies). Returns messages in chronological order within the page.",
    inputSchema: z.object({
      channelId: z.string().describe("Full channel id"),
      limit: z.number().int().min(1).max(100).optional().default(20),
      cursor: z.string().optional(),
      direction: FETCH_DIRECTION,
    }),
    execute: async ({ channelId, limit, cursor, direction }) => {
      const adapterName = channelId.split(":")[0];
      const adapter = adapterName ? chat.getAdapter(adapterName) : undefined;
      if (!adapter?.fetchChannelMessages) {
        throw new Error(
          `Adapter "${adapterName}" does not support fetching channel messages`
        );
      }
      const result = await adapter.fetchChannelMessages(channelId, {
        limit,
        cursor,
        direction,
      });
      return {
        messages: result.messages.map(projectMessage),
        nextCursor: result.nextCursor,
      };
    },
  });

export const fetchThread = (chat: ChatBinding) =>
  tool({
    description:
      "Fetch metadata about a thread (channel id, channel name, visibility, DM status, etc).",
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id"),
    }),
    execute: async ({ threadId }) => {
      const thread = chat.thread(threadId);
      const info = await thread.adapter.fetchThread(threadId);
      return {
        id: info.id,
        channelId: info.channelId,
        channelName: info.channelName,
        channelVisibility: info.channelVisibility,
        isDM: info.isDM ?? false,
      };
    },
  });

export const listThreads = (chat: ChatBinding) =>
  tool({
    description:
      "List recent threads in a channel. Returns lightweight summaries with the root message of each thread.",
    inputSchema: z.object({
      channelId: z.string().describe("Full channel id"),
      limit: z.number().int().min(1).max(100).optional().default(20),
      cursor: z.string().optional(),
    }),
    execute: async ({ channelId, limit, cursor }) => {
      const adapterName = channelId.split(":")[0];
      const adapter = adapterName ? chat.getAdapter(adapterName) : undefined;
      if (!adapter?.listThreads) {
        throw new Error(
          `Adapter "${adapterName}" does not support listing threads`
        );
      }
      const result = await adapter.listThreads(channelId, { limit, cursor });
      return {
        threads: result.threads.map((t: ThreadSummary) => ({
          id: t.id,
          replyCount: t.replyCount,
          lastReplyAt: t.lastReplyAt?.toISOString(),
          rootMessage: projectMessage(t.rootMessage),
        })),
        nextCursor: result.nextCursor,
      };
    },
  });

export const getThreadParticipants = (chat: ChatBinding) =>
  tool({
    description:
      "Return the unique non-bot participants in a thread. Useful for deciding whether to subscribe (1:1) or stay quiet (group).",
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id"),
    }),
    execute: async ({ threadId }) => {
      const thread = chat.thread(threadId);
      const participants = await thread.getParticipants();
      return {
        participants: participants.map((author) => ({
          userId: author.userId,
          userName: author.userName,
          fullName: author.fullName,
          isBot: author.isBot,
        })),
      };
    },
  });

export const subscribeThread = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
) =>
  tool({
    description:
      "Subscribe to all future messages in a thread. After subscribing, the bot will receive every message in this thread (not just @mentions).",
    needsApproval,
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id to subscribe to"),
    }),
    execute: async ({ threadId }) => {
      const thread = chat.thread(threadId);
      await thread.subscribe();
      return { subscribed: true, threadId };
    },
  });

export const unsubscribeThread = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
) =>
  tool({
    description:
      "Unsubscribe from a thread. The bot will stop receiving non-mention messages in this thread.",
    needsApproval,
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id to unsubscribe from"),
    }),
    execute: async ({ threadId }) => {
      const thread = chat.thread(threadId);
      await thread.unsubscribe();
      return { subscribed: false, threadId };
    },
  });

export const startTyping = (chat: ChatBinding) =>
  tool({
    description:
      "Show a typing indicator in a thread. Use this when starting a long-running operation so users know the bot is working.",
    inputSchema: z.object({
      threadId: z.string().describe("Full thread id"),
      status: z
        .string()
        .optional()
        .describe(
          "Optional human-readable status (some platforms display this, others ignore it)"
        ),
    }),
    execute: async ({ threadId, status }) => {
      const thread = chat.thread(threadId);
      await thread.startTyping(status);
      return { typing: true, threadId };
    },
  });
