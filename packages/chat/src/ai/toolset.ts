import { createScopeGuard, type ReadScope } from "./scope";
import { getChannelInfoSpec } from "./tools/channels";
import {
  deleteMessageSpec,
  editMessageSpec,
  postChannelMessageSpec,
  postMessageSpec,
  sendDirectMessageSpec,
} from "./tools/messages";
import { addReactionSpec, removeReactionSpec } from "./tools/reactions";
import type { ChatToolSpec } from "./tools/spec";
import {
  fetchChannelMessagesSpec,
  fetchMessagesSpec,
  fetchThreadSpec,
  getThreadParticipantsSpec,
  listThreadsSpec,
  startTypingSpec,
  subscribeThreadSpec,
  unsubscribeThreadSpec,
} from "./tools/threads";
import { getUserSpec } from "./tools/users";
import type { ChatBinding } from "./types";

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
 * `requireApproval` on `createChatTools` and `createTanStackTools`.
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
 * Names of tools that require approval by default.
 *
 * This includes every write tool plus `getUser`, whose arbitrary user lookup
 * can expose profile details outside the active conversation.
 */
export type ChatApprovalToolName = ChatWriteToolName | "getUser";

/**
 * Whether sensitive operations require user approval.
 *
 * - `true`  — every approval-gated tool needs approval (default)
 * - `false` — no tool needs approval
 * - object  — per-tool override; unspecified approval-gated tools default to `true`
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
  | Partial<Record<ChatApprovalToolName, boolean>>;

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

/**
 * Options shared by every framework-specific tool factory
 * (`createChatTools`, `createTanStackTools`).
 */
export interface ChatToolsBaseOptions {
  /** The Chat instance the tools dispatch operations against. */
  chat: ChatBinding;
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
   * Whether sensitive operations require user approval before executing.
   * Defaults to `true` for all write tools and `getUser`.
   *
   * @see {@link ApprovalConfig}
   */
  requireApproval?: ApprovalConfig;
  /**
   * Confine tools to a single conversation, so a thread or channel id the
   * model supplies that resolves elsewhere is rejected. Applies to reads and
   * writes that target a thread or channel; `getUser` and `sendDirectMessage`
   * target user ids and are gated by approval instead.
   *
   * Scoping is channel-level: a call is allowed when it resolves to the same
   * channel as the scoped conversation, so a thread scope still permits sibling
   * threads within that channel. Set {@link ChatToolsBaseOptions.strictScope}
   * to tighten a thread scope to that thread alone.
   *
   * Defaults to the conversation being handled, so tools created inside a
   * handler are already confined to it. Set this when the agent runs outside
   * a handler and still acts on a user's behalf, or pass a channel id to
   * operate channel-wide.
   *
   * Pass `false` to reach every conversation the bot can see. When no
   * scope resolves (outside a handler, no explicit scope), tools run
   * workspace-wide and a warning is logged.
   *
   * @example
   * ```ts
   * bot.onNewMention(async (thread) => {
   *   const tools = createChatTools({ chat, preset: 'reader' })
   * })
   * ```
   */
  scope?: ReadScope | false;
  /**
   * Tighten `scope` from channel-level (default) to conversation-level.
   *
   * By default a call is in scope when it resolves to the same channel as the
   * scoped conversation, so a thread scope still permits sibling threads in
   * that channel. Set `true` to confine a thread scope to that thread alone:
   * sibling threads and the parent channel are both rejected, which matters
   * on platforms where a channel is the widest surface available (a GitHub
   * channel is an entire repo). A channel scope is unaffected; it still
   * allows any thread within the channel.
   *
   * @default false
   */
  strictScope?: boolean;
}

function resolveApproval(
  toolName: ChatApprovalToolName,
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

/**
 * Merge user overrides into a built tool, dropping any key in
 * `protectedFields` so tool semantics stay stable.
 */
export function applyOverrides(
  tool: Record<string, unknown>,
  overrides: object | undefined,
  protectedFields: ReadonlySet<string>
): Record<string, unknown> {
  if (!overrides) {
    return tool;
  }

  const safeOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !protectedFields.has(key))
  );
  return { ...tool, ...safeOverrides };
}

/**
 * Build the lazy spec factories for every Chat SDK tool, wired with the
 * approval flags and scope guard derived from `options`.
 *
 * Each entry is built lazily so a preset filter skips both the approval
 * lookup and the spec (and its zod schema) construction for tools the agent
 * will never see.
 */
export function createToolSpecFactories(
  {
    chat,
    requireApproval = true,
    scope,
    strictScope = false,
  }: ChatToolsBaseOptions,
  caller: string
) {
  if (!chat) {
    throw new Error(
      `${caller} requires a \`chat\` instance. Pass your \`new Chat({ ... })\` instance as the \`chat\` option.`
    );
  }

  const guard = createScopeGuard(chat, scope, strictScope);

  const approval = (name: ChatApprovalToolName) => ({
    needsApproval: resolveApproval(name, requireApproval),
  });
  // Write tools take the same guard as reads so a thread/channel id the model
  // supplies that resolves outside the scoped conversation is rejected.
  const guardedApproval = (name: ChatWriteToolName) => ({
    ...approval(name),
    guard,
  });

  return {
    fetchMessages: () => fetchMessagesSpec(chat, guard),
    fetchChannelMessages: () => fetchChannelMessagesSpec(chat, guard),
    fetchThread: () => fetchThreadSpec(chat, guard),
    listThreads: () => listThreadsSpec(chat, guard),
    getThreadParticipants: () => getThreadParticipantsSpec(chat, guard),
    getChannelInfo: () => getChannelInfoSpec(chat, guard),
    getUser: () => getUserSpec(chat, approval("getUser").needsApproval),
    startTyping: () => startTypingSpec(chat, guard),
    postMessage: () => postMessageSpec(chat, guardedApproval("postMessage")),
    postChannelMessage: () =>
      postChannelMessageSpec(chat, guardedApproval("postChannelMessage")),
    // User-id tools do not resolve to a conversation, so approval is their
    // gate instead of the conversation-scope guard.
    sendDirectMessage: () =>
      sendDirectMessageSpec(chat, approval("sendDirectMessage")),
    editMessage: () => editMessageSpec(chat, guardedApproval("editMessage")),
    deleteMessage: () =>
      deleteMessageSpec(chat, guardedApproval("deleteMessage")),
    addReaction: () => addReactionSpec(chat, guardedApproval("addReaction")),
    removeReaction: () =>
      removeReactionSpec(chat, guardedApproval("removeReaction")),
    subscribeThread: () =>
      subscribeThreadSpec(chat, guardedApproval("subscribeThread")),
    unsubscribeThread: () =>
      unsubscribeThreadSpec(chat, guardedApproval("unsubscribeThread")),
  } satisfies Record<ChatToolName, () => ChatToolSpec>;
}

export type ChatToolSpecFactories = ReturnType<typeof createToolSpecFactories>;

/**
 * Build the specs selected by `preset` (all tools when omitted), in the
 * canonical tool order.
 */
export function selectToolSpecs(
  factories: ChatToolSpecFactories,
  preset: ChatToolPreset | ChatToolPreset[] | undefined
): [ChatToolName, ChatToolSpec][] {
  const allowed = preset ? resolvePresetTools(preset) : null;
  return (Object.entries(factories) as [ChatToolName, () => ChatToolSpec][])
    .filter(([name]) => !allowed || allowed.has(name))
    .map(([name, build]) => [name, build()]);
}
