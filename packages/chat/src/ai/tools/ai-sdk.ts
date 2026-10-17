import { type Tool, tool } from "ai";
import { createScopeGuard, type ScopeGuard } from "../scope";
import type {
  ChatBinding,
  ToolOptions,
  ToolScopeOptions,
  ToolSpecOptions,
} from "../types";
import { getChannelInfoSpec } from "./channels";
import {
  deleteMessageSpec,
  editMessageSpec,
  postChannelMessageSpec,
  postMessageSpec,
  sendDirectMessageSpec,
} from "./messages";
import { addReactionSpec, removeReactionSpec } from "./reactions";
import type { ChatToolSpec } from "./spec";
import {
  fetchChannelMessagesSpec,
  fetchMessagesSpec,
  fetchThreadSpec,
  getThreadParticipantsSpec,
  listThreadsSpec,
  startTypingSpec,
  subscribeThreadSpec,
  unsubscribeThreadSpec,
} from "./threads";
import { getUserSpec } from "./users";

/**
 * Per-tool overrides for customizing tool behavior without changing the
 * underlying implementation. `execute`, `inputSchema`, and `outputSchema`
 * are intentionally excluded so tool semantics stay stable.
 */
export type ToolOverrides = Partial<
  Pick<
    Tool,
    | "description"
    | "inputExamples"
    | "metadata"
    | "needsApproval"
    | "onInputAvailable"
    | "onInputDelta"
    | "onInputStart"
    | "providerOptions"
    | "strict"
    | "title"
    | "toModelOutput"
  >
>;

/**
 * Wrap a Chat SDK tool spec as a Vercel AI SDK tool.
 *
 * The explicit `Tool<Input, Output>` return type keeps the emitted
 * declarations on types exported from `ai`. Relying on inference from
 * `tool()` would surface `ai` internals (e.g. `ExecutableTool` from
 * `@ai-sdk/provider-utils`) that consumers cannot resolve.
 */
export function toAiTool<TInput, TOutput>(
  spec: ChatToolSpec<TInput, TOutput>
): Tool<TInput, TOutput> {
  // The concrete wrappers below pass real zod schemas, which satisfy the AI
  // SDK's `FlexibleSchema`. The generic `ZodType<TInput>` cannot prove that
  // against the SDK's conditional `Tool` type, so narrow once at the boundary.
  const definition = {
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: (input: TInput) => spec.execute(input),
    ...(spec.needsApproval === undefined
      ? {}
      : { needsApproval: spec.needsApproval }),
  } as unknown as Tool<TInput, TOutput>;
  return tool(definition);
}

const scopeGuard = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard
): ScopeGuard | undefined =>
  typeof options === "function"
    ? options
    : createScopeGuard(chat, options.scope, options.strictScope);

const writeSpecOptions = (
  chat: ChatBinding,
  { needsApproval = true, guard, ...scopeOptions }: ToolOptions
): ToolSpecOptions => ({
  needsApproval,
  guard: guard ?? scopeGuard(chat, scopeOptions),
});

export const fetchMessages = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(fetchMessagesSpec(chat, scopeGuard(chat, options)));

export const fetchChannelMessages = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(fetchChannelMessagesSpec(chat, scopeGuard(chat, options)));

export const fetchThread = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(fetchThreadSpec(chat, scopeGuard(chat, options)));

export const listThreads = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(listThreadsSpec(chat, scopeGuard(chat, options)));

export const getThreadParticipants = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(getThreadParticipantsSpec(chat, scopeGuard(chat, options)));

export const getChannelInfo = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(getChannelInfoSpec(chat, scopeGuard(chat, options)));

export const getUser = (chat: ChatBinding, needsApproval = true) =>
  toAiTool(getUserSpec(chat, needsApproval));

export const startTyping = (
  chat: ChatBinding,
  options: ToolScopeOptions | ScopeGuard = {}
) => toAiTool(startTypingSpec(chat, scopeGuard(chat, options)));

export const postMessage = (chat: ChatBinding, options: ToolOptions = {}) =>
  toAiTool(postMessageSpec(chat, writeSpecOptions(chat, options)));

export const postChannelMessage = (
  chat: ChatBinding,
  options: ToolOptions = {}
) => toAiTool(postChannelMessageSpec(chat, writeSpecOptions(chat, options)));

export const sendDirectMessage = (
  chat: ChatBinding,
  { needsApproval = true }: ToolOptions = {}
) => toAiTool(sendDirectMessageSpec(chat, { needsApproval }));

export const editMessage = (chat: ChatBinding, options: ToolOptions = {}) =>
  toAiTool(editMessageSpec(chat, writeSpecOptions(chat, options)));

export const deleteMessage = (chat: ChatBinding, options: ToolOptions = {}) =>
  toAiTool(deleteMessageSpec(chat, writeSpecOptions(chat, options)));

export const addReaction = (chat: ChatBinding, options: ToolOptions = {}) =>
  toAiTool(addReactionSpec(chat, writeSpecOptions(chat, options)));

export const removeReaction = (chat: ChatBinding, options: ToolOptions = {}) =>
  toAiTool(removeReactionSpec(chat, writeSpecOptions(chat, options)));

export const subscribeThread = (chat: ChatBinding, options: ToolOptions = {}) =>
  toAiTool(subscribeThreadSpec(chat, writeSpecOptions(chat, options)));

export const unsubscribeThread = (
  chat: ChatBinding,
  options: ToolOptions = {}
) => toAiTool(unsubscribeThreadSpec(chat, writeSpecOptions(chat, options)));
