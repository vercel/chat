import { type Tool, tool } from "ai";
import { z } from "zod";
import type { Message } from "../../message";
import type { ChannelVisibility, ThreadSummary } from "../../types";
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

type ProjectedMessage = ReturnType<typeof projectMessage>;

// Tool factories carry explicit `Tool<Input, Output>` return types so the
// emitted declarations only reference types exported from `ai`. Relying on
// inference would surface `ai` internals (e.g. `ExecutableTool` from
// `@ai-sdk/provider-utils`) that consumers cannot resolve.

const FETCH_MESSAGES_INPUT = z.object({
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
});

export const fetchMessages = (
  chat: ChatBinding
): Tool<
  z.infer<typeof FETCH_MESSAGES_INPUT>,
  { messages: ProjectedMessage[]; nextCursor: string | undefined }
> =>
  tool({
    description:
      "Fetch recent messages from a thread, ordered chronologically (oldest first within the page). Use to read the conversation before responding.",
    inputSchema: FETCH_MESSAGES_INPUT,
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

const FETCH_CHANNEL_MESSAGES_INPUT = z.object({
  channelId: z.string().describe("Full channel id"),
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  direction: FETCH_DIRECTION,
});

export const fetchChannelMessages = (
  chat: ChatBinding
): Tool<
  z.infer<typeof FETCH_CHANNEL_MESSAGES_INPUT>,
  { messages: ProjectedMessage[]; nextCursor: string | undefined }
> =>
  tool({
    description:
      "Fetch top-level messages in a channel (not thread replies). Returns messages in chronological order within the page.",
    inputSchema: FETCH_CHANNEL_MESSAGES_INPUT,
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

const FETCH_THREAD_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
});

export const fetchThread = (
  chat: ChatBinding
): Tool<
  z.infer<typeof FETCH_THREAD_INPUT>,
  {
    id: string;
    channelId: string;
    channelName: string | undefined;
    channelVisibility: ChannelVisibility | undefined;
    isDM: boolean;
  }
> =>
  tool({
    description:
      "Fetch metadata about a thread (channel id, channel name, visibility, DM status, etc).",
    inputSchema: FETCH_THREAD_INPUT,
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

const LIST_THREADS_INPUT = z.object({
  channelId: z.string().describe("Full channel id"),
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export const listThreads = (
  chat: ChatBinding
): Tool<
  z.infer<typeof LIST_THREADS_INPUT>,
  {
    threads: {
      id: string;
      replyCount: number | undefined;
      lastReplyAt: string | undefined;
      rootMessage: ProjectedMessage;
    }[];
    nextCursor: string | undefined;
  }
> =>
  tool({
    description:
      "List recent threads in a channel. Returns lightweight summaries with the root message of each thread.",
    inputSchema: LIST_THREADS_INPUT,
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

const GET_THREAD_PARTICIPANTS_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
});

export const getThreadParticipants = (
  chat: ChatBinding
): Tool<
  z.infer<typeof GET_THREAD_PARTICIPANTS_INPUT>,
  {
    participants: {
      userId: string;
      userName: string;
      fullName: string;
      isBot: boolean | "unknown";
    }[];
  }
> =>
  tool({
    description:
      "Return the unique non-bot participants in a thread. Useful for deciding whether to subscribe (1:1) or stay quiet (group).",
    inputSchema: GET_THREAD_PARTICIPANTS_INPUT,
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

const SUBSCRIBE_THREAD_INPUT = z.object({
  threadId: z.string().describe("Full thread id to subscribe to"),
});

export const subscribeThread = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof SUBSCRIBE_THREAD_INPUT>,
  { subscribed: boolean; threadId: string }
> =>
  tool({
    description:
      "Subscribe to all future messages in a thread. After subscribing, the bot will receive every message in this thread (not just @mentions).",
    needsApproval,
    inputSchema: SUBSCRIBE_THREAD_INPUT,
    execute: async ({
      threadId,
    }): Promise<{ subscribed: boolean; threadId: string }> => {
      const thread = chat.thread(threadId);
      await thread.subscribe();
      return { subscribed: true, threadId };
    },
  });

const UNSUBSCRIBE_THREAD_INPUT = z.object({
  threadId: z.string().describe("Full thread id to unsubscribe from"),
});

export const unsubscribeThread = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
): Tool<
  z.infer<typeof UNSUBSCRIBE_THREAD_INPUT>,
  { subscribed: boolean; threadId: string }
> =>
  tool({
    description:
      "Unsubscribe from a thread. The bot will stop receiving non-mention messages in this thread.",
    needsApproval,
    inputSchema: UNSUBSCRIBE_THREAD_INPUT,
    execute: async ({
      threadId,
    }): Promise<{ subscribed: boolean; threadId: string }> => {
      const thread = chat.thread(threadId);
      await thread.unsubscribe();
      return { subscribed: false, threadId };
    },
  });

const START_TYPING_INPUT = z.object({
  threadId: z.string().describe("Full thread id"),
  status: z
    .string()
    .optional()
    .describe(
      "Optional human-readable status (some platforms display this, others ignore it)"
    ),
});

export const startTyping = (
  chat: ChatBinding
): Tool<
  z.infer<typeof START_TYPING_INPUT>,
  { typing: boolean; threadId: string }
> =>
  tool({
    description:
      "Show a typing indicator in a thread. Use this when starting a long-running operation so users know the bot is working.",
    inputSchema: START_TYPING_INPUT,
    execute: async ({
      threadId,
      status,
    }): Promise<{ typing: boolean; threadId: string }> => {
      const thread = chat.thread(threadId);
      await thread.startTyping(status);
      return { typing: true, threadId };
    },
  });
