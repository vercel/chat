import type { Tool } from "ai";
import { type ToolOverrides, toAiTool } from "./tools/ai-sdk";
import type { ChatToolSpec } from "./tools/spec";
import {
  applyOverrides,
  type ChatToolName,
  type ChatToolSpecFactories,
  type ChatToolsBaseOptions,
  createToolSpecFactories,
  selectToolSpecs,
} from "./toolset";

const PROTECTED_TOOL_FIELDS = new Set<string>([
  "args",
  "execute",
  "id",
  "inputSchema",
  "outputSchema",
  "supportsDeferredResults",
  "type",
]);

export interface ChatToolsOptions extends ChatToolsBaseOptions {
  /**
   * Per-tool overrides for customizing tool behavior (description, title,
   * needsApproval, etc.) without changing the underlying implementation.
   * Core tool fields cannot be overridden.
   *
   * @example
   * ```ts
   * createChatTools({
   *   chat,
   *   overrides: {
   *     deleteMessage: { needsApproval: false },
   *     postMessage: { description: 'Reply in the active support thread.' },
   *   },
   * })
   * ```
   */
  overrides?: Partial<Record<ChatToolName, ToolOverrides>>;
}

type AiToolOf<TSpec> =
  TSpec extends ChatToolSpec<infer TInput, infer TOutput>
    ? Tool<TInput, TOutput>
    : never;

type ChatToolMap = {
  [K in ChatToolName]: AiToolOf<ReturnType<ChatToolSpecFactories[K]>>;
};

/**
 * Create a set of Chat SDK tools for the Vercel AI SDK.
 *
 * Lets an AI agent operate inside a workspace: read messages, post replies,
 * send DMs, react, edit, delete, and manage thread subscriptions across
 * every adapter the supplied {@link ChatBinding} has registered.
 *
 * Write operations and arbitrary user profile lookups require approval by
 * default. Control this globally or per-tool via `requireApproval`. Use
 * `preset` to scope the toolset.
 *
 * Using TanStack AI instead? Import `createTanStackTools` from
 * `chat/ai/tanstack`; it exposes the same tools, options, and presets.
 *
 * @example
 * ```ts
 * import { Chat } from 'chat'
 * import { createChatTools } from 'chat/ai'
 * import { generateText } from 'ai'
 *
 * const chat = new Chat({ ... })
 *
 * const result = await generateText({
 *   model: yourModel,
 *   tools: createChatTools({ chat, preset: 'messenger' }),
 *   prompt: 'Reply in thread slack:C123:1234.5678 with the daily summary.',
 * })
 * ```
 *
 * @example Granular approval
 * ```ts
 * createChatTools({
 *   chat,
 *   preset: 'moderator',
 *   requireApproval: {
 *     deleteMessage: true,
 *     editMessage: true,
 *     postMessage: false,
 *     addReaction: false,
 *   },
 * })
 * ```
 */
export function createChatTools({
  overrides,
  preset,
  ...base
}: ChatToolsOptions) {
  const factories = createToolSpecFactories(base, "createChatTools");

  const entries = selectToolSpecs(factories, preset).map(
    ([name, spec]) =>
      [
        name,
        applyOverrides(
          toAiTool(spec) as Record<string, unknown>,
          overrides?.[name],
          PROTECTED_TOOL_FIELDS
        ),
      ] as const
  );

  return Object.fromEntries(entries) as Partial<ChatToolMap>;
}

/** The shape of the object returned by {@link createChatTools}. */
export type ChatTools = ReturnType<typeof createChatTools>;

export {
  type AiAssistantMessage,
  type AiFilePart,
  type AiImagePart,
  type AiMessage,
  type AiMessagePart,
  type AiTextPart,
  type AiUserMessage,
  type ToAiMessagesOptions,
  toAiMessages,
} from "./messages";
export type { ReadScope } from "./scope";
export {
  addReaction,
  deleteMessage,
  editMessage,
  fetchChannelMessages,
  fetchMessages,
  fetchThread,
  getChannelInfo,
  getThreadParticipants,
  getUser,
  listThreads,
  postChannelMessage,
  postMessage,
  removeReaction,
  sendDirectMessage,
  startTyping,
  subscribeThread,
  type ToolOverrides,
  unsubscribeThread,
} from "./tools/ai-sdk";
export type {
  ApprovalConfig,
  ChatApprovalToolName,
  ChatToolName,
  ChatToolPreset,
  ChatWriteToolName,
} from "./toolset";
export type { ChatBinding, ToolOptions } from "./types";
