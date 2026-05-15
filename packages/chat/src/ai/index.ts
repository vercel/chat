import { getChannelInfo } from "./tools/channels";
import {
  deleteMessage,
  editMessage,
  postChannelMessage,
  postMessage,
  sendDirectMessage,
} from "./tools/messages";
import { addReaction, removeReaction } from "./tools/reactions";
import {
  fetchChannelMessages,
  fetchMessages,
  fetchThread,
  getThreadParticipants,
  listThreads,
  startTyping,
  subscribeThread,
  unsubscribeThread,
} from "./tools/threads";
import { getUser } from "./tools/users";
import type { ChatBinding, ToolOverrides } from "./types";

const PROTECTED_TOOL_FIELDS = new Set<string>([
  "args",
  "execute",
  "id",
  "inputSchema",
  "outputSchema",
  "supportsDeferredResults",
  "type",
]);

export type ChatToolName =
  | "fetchMessages"
  | "fetchChannelMessages"
  | "fetchThread"
  | "listThreads"
  | "getThreadParticipants"
  | "getChannelInfo"
  | "getUser"
  | "startTyping"
  | "postMessage"
  | "postChannelMessage"
  | "sendDirectMessage"
  | "editMessage"
  | "deleteMessage"
  | "addReaction"
  | "removeReaction"
  | "subscribeThread"
  | "unsubscribeThread";

/**
 * Names of every tool that mutates platform state.
 * These default to `needsApproval: true` and can be toggled via
 * `requireApproval` on {@link createChatTools}.
 */
export type ChatWriteToolName =
  | "postMessage"
  | "postChannelMessage"
  | "sendDirectMessage"
  | "editMessage"
  | "deleteMessage"
  | "addReaction"
  | "removeReaction"
  | "subscribeThread"
  | "unsubscribeThread";

/**
 * Whether write operations require user approval.
 *
 * - `true`  — every write tool needs approval (default)
 * - `false` — no write tool needs approval
 * - object  — per-tool override; unspecified write tools default to `true`
 *
 * @example
 * ```ts
 * requireApproval: {
 *   deleteMessage: true,
 *   postMessage: false,
 *   sendDirectMessage: false,
 *   addReaction: false,
 * }
 * ```
 */
export type ApprovalConfig =
  | boolean
  | Partial<Record<ChatWriteToolName, boolean>>;

/**
 * Predefined tool presets for common chat-agent use cases.
 *
 * - `'reader'`    — read-only: fetch threads, messages, channel info, users
 * - `'messenger'` — basic posting: post in thread/channel, DM, react, typing
 * - `'moderator'` — full management: read + write + edit/delete + subscriptions
 */
export type ChatToolPreset = "reader" | "messenger" | "moderator";

const PRESET_TOOLS: Record<ChatToolPreset, ChatToolName[]> = {
  reader: [
    "fetchMessages",
    "fetchChannelMessages",
    "fetchThread",
    "listThreads",
    "getThreadParticipants",
    "getChannelInfo",
    "getUser",
  ],
  messenger: [
    "fetchMessages",
    "fetchThread",
    "getChannelInfo",
    "getUser",
    "postMessage",
    "postChannelMessage",
    "sendDirectMessage",
    "addReaction",
    "removeReaction",
    "startTyping",
  ],
  moderator: [
    "fetchMessages",
    "fetchChannelMessages",
    "fetchThread",
    "listThreads",
    "getThreadParticipants",
    "getChannelInfo",
    "getUser",
    "postMessage",
    "postChannelMessage",
    "sendDirectMessage",
    "editMessage",
    "deleteMessage",
    "addReaction",
    "removeReaction",
    "subscribeThread",
    "unsubscribeThread",
    "startTyping",
  ],
};

export interface ChatToolsOptions {
  /** The Chat instance the tools dispatch operations against. */
  chat: ChatBinding;
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
  /**
   * Restrict the returned tools to a predefined preset.
   * Omit to get all tools (same as `'moderator'`).
   *
   * @example
   * ```ts
   * createChatTools({ chat, preset: 'reader' })
   * createChatTools({ chat, preset: ['reader', 'messenger'] })
   * ```
   */
  preset?: ChatToolPreset | ChatToolPreset[];
  /**
   * Whether write operations require user approval before executing.
   * Defaults to `true` for all write tools.
   *
   * @see {@link ApprovalConfig}
   */
  requireApproval?: ApprovalConfig;
}

function resolveApproval(
  toolName: ChatWriteToolName,
  config: ApprovalConfig
): boolean {
  if (typeof config === "boolean") {
    return config;
  }
  return config[toolName] ?? true;
}

function resolvePresetTools(
  preset: ChatToolPreset | ChatToolPreset[]
): Set<ChatToolName> {
  const presets = Array.isArray(preset) ? preset : [preset];
  const tools = new Set<ChatToolName>();
  for (const p of presets) {
    for (const t of PRESET_TOOLS[p]) {
      tools.add(t);
    }
  }
  return tools;
}

function applyOverrides(
  tool: Record<string, unknown>,
  overrides: ToolOverrides | undefined
): Record<string, unknown> {
  if (!overrides) {
    return tool;
  }

  const safeOverrides = Object.fromEntries(
    Object.entries(overrides as Record<string, unknown>).filter(
      ([key]) => !PROTECTED_TOOL_FIELDS.has(key)
    )
  );
  return { ...tool, ...safeOverrides };
}

/**
 * Create a set of Chat SDK tools for the Vercel AI SDK.
 *
 * Lets an AI agent operate inside a workspace: read messages, post replies,
 * send DMs, react, edit, delete, and manage thread subscriptions across
 * every adapter the supplied {@link ChatBinding} has registered.
 *
 * Write operations require user approval by default. Control this globally
 * or per-tool via `requireApproval`. Use `preset` to scope the toolset.
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
  chat,
  requireApproval = true,
  preset,
  overrides,
}: ChatToolsOptions) {
  if (!chat) {
    throw new Error(
      "createChatTools requires a `chat` instance. Pass your `new Chat({ ... })` instance as the `chat` option."
    );
  }

  const approval = (name: ChatWriteToolName) => ({
    needsApproval: resolveApproval(name, requireApproval),
  });
  const allowed = preset ? resolvePresetTools(preset) : null;

  // Each entry is built lazily so a preset filter skips both the
  // `approval()` lookup and the underlying `tool({ ... })` (and its zod
  // schema) construction for tools the agent will never see.
  const factories = {
    fetchMessages: () => fetchMessages(chat),
    fetchChannelMessages: () => fetchChannelMessages(chat),
    fetchThread: () => fetchThread(chat),
    listThreads: () => listThreads(chat),
    getThreadParticipants: () => getThreadParticipants(chat),
    getChannelInfo: () => getChannelInfo(chat),
    getUser: () => getUser(chat),
    startTyping: () => startTyping(chat),
    postMessage: () => postMessage(chat, approval("postMessage")),
    postChannelMessage: () =>
      postChannelMessage(chat, approval("postChannelMessage")),
    sendDirectMessage: () =>
      sendDirectMessage(chat, approval("sendDirectMessage")),
    editMessage: () => editMessage(chat, approval("editMessage")),
    deleteMessage: () => deleteMessage(chat, approval("deleteMessage")),
    addReaction: () => addReaction(chat, approval("addReaction")),
    removeReaction: () => removeReaction(chat, approval("removeReaction")),
    subscribeThread: () => subscribeThread(chat, approval("subscribeThread")),
    unsubscribeThread: () =>
      unsubscribeThread(chat, approval("unsubscribeThread")),
  } satisfies Record<ChatToolName, () => unknown>;

  type ToolName = keyof typeof factories;
  type Tools = { [K in ToolName]: ReturnType<(typeof factories)[K]> };

  const entries = (Object.entries(factories) as [ToolName, () => unknown][])
    .filter(([name]) => !allowed || allowed.has(name))
    .map(([name, build]) => {
      const built = build() as Record<string, unknown>;
      return [name, applyOverrides(built, overrides?.[name])] as const;
    });

  return Object.fromEntries(entries) as Partial<Tools>;
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
export { getChannelInfo } from "./tools/channels";
export {
  deleteMessage,
  editMessage,
  postChannelMessage,
  postMessage,
  sendDirectMessage,
} from "./tools/messages";
export { addReaction, removeReaction } from "./tools/reactions";
export {
  fetchChannelMessages,
  fetchMessages,
  fetchThread,
  getThreadParticipants,
  listThreads,
  startTyping,
  subscribeThread,
  unsubscribeThread,
} from "./tools/threads";
export { getUser } from "./tools/users";
export type { ChatBinding, ToolOptions, ToolOverrides } from "./types";
