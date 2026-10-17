import type { Chat } from "../chat";
import type { ReadScope, ScopeGuard } from "./scope";

/**
 * The Chat instance used by all tools to dispatch operations.
 * Always typed as `Chat<any, any>` so callers can pass strongly-typed
 * `Chat` instances without having to repeat their adapter/state generics.
 */
// biome-ignore lint/suspicious/noExplicitAny: tools accept any Chat instance regardless of adapter/state generics
export type ChatBinding = Chat<any, any>;

/**
 * Scope options accepted by the standalone tool factories that target a
 * thread or channel, such as `fetchMessages(chat, { scope })`. They behave
 * like the `scope` and `strictScope` options on `createChatTools`.
 */
export interface ToolScopeOptions {
  /**
   * Confine the tool to a single conversation. Defaults to the conversation
   * being handled. Inside a handler with no conversation, calls reject before
   * accessing the platform; outside any handler they run workspace-wide and
   * log a warning. Pass `false` to reach every conversation the bot can see.
   */
  scope?: ReadScope | false;
  /**
   * Confine a thread scope to that thread alone, rejecting sibling threads
   * and the parent channel. A channel scope is unaffected.
   *
   * @default false
   */
  strictScope?: boolean;
}

/**
 * Options for the standalone write-tool factories that target a thread or
 * channel, such as `postMessage(chat, { needsApproval: false })`.
 */
export interface ToolOptions extends ToolScopeOptions {
  /**
   * Scope guard the tool calls on its target id before executing. Takes
   * precedence over `scope` and `strictScope`.
   *
   * @deprecated Pass `scope` instead.
   */
  guard?: ScopeGuard;
  /** @default true */
  needsApproval?: boolean;
}

/** Options the tool specs receive from the toolset and standalone factories. */
export interface ToolSpecOptions {
  /** Scope guard the tool calls on its target id before executing. */
  guard?: ScopeGuard;
  needsApproval?: boolean;
}
