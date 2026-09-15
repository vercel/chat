import type { Chat } from "../chat";
import type { ScopeGuard } from "./scope";

/**
 * The Chat instance used by all tools to dispatch operations.
 * Always typed as `Chat<any, any>` so callers can pass strongly-typed
 * `Chat` instances without having to repeat their adapter/state generics.
 */
// biome-ignore lint/suspicious/noExplicitAny: tools accept any Chat instance regardless of adapter/state generics
export type ChatBinding = Chat<any, any>;

/**
 * Common options for write tools that may require approval before executing.
 */
export interface ToolOptions {
  /** Scope guard the tool calls on its target id before executing. */
  guard?: ScopeGuard;
  needsApproval?: boolean;
}
