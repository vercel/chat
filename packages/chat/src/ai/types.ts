import type { Tool } from "ai";
import type { Chat } from "../chat";

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
  needsApproval?: boolean;
}

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
