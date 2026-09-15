import type { ZodType } from "zod";
import type { ChatToolSpec } from "../tools/spec";
import {
  applyOverrides,
  type ChatToolName,
  type ChatToolsBaseOptions,
  createToolSpecFactories,
  selectToolSpecs,
} from "../toolset";

/**
 * A Chat SDK tool shaped for TanStack AI's `chat({ tools })`.
 *
 * Structurally compatible with `Tool` / `AnyTool` from `@tanstack/ai`, so the
 * array returned by {@link createTanStackTools} can be passed to `chat()`
 * directly. Declared locally so `chat/ai/tanstack` has no runtime dependency
 * on `@tanstack/ai`.
 */
export interface TanStackTool<TInput = unknown, TOutput = unknown> {
  description: string;
  execute(args: TInput, context?: unknown): Promise<TOutput>;
  inputSchema: ZodType<TInput>;
  lazy?: boolean;
  metadata?: Record<string, unknown>;
  name: string;
  needsApproval?: boolean;
}

/**
 * Per-tool overrides for TanStack AI tools. `name`, `inputSchema`,
 * `outputSchema`, and `execute` are intentionally excluded so tool semantics
 * stay stable.
 */
export type TanStackToolOverrides = Partial<
  Pick<TanStackTool, "description" | "lazy" | "metadata" | "needsApproval">
>;

export interface TanStackChatToolsOptions extends ChatToolsBaseOptions {
  /**
   * Per-tool overrides for customizing tool behavior (description,
   * needsApproval, metadata, lazy) without changing the underlying
   * implementation. Core tool fields cannot be overridden.
   *
   * @example
   * ```ts
   * createTanStackTools({
   *   chat,
   *   overrides: {
   *     deleteMessage: { needsApproval: false },
   *     postMessage: { description: 'Reply in the active support thread.' },
   *   },
   * })
   * ```
   */
  overrides?: Partial<Record<ChatToolName, TanStackToolOverrides>>;
}

const PROTECTED_TOOL_FIELDS = new Set<string>([
  "execute",
  "inputSchema",
  "name",
  "outputSchema",
]);

/**
 * TanStack AI converts tool input schemas to JSON Schema through the Standard
 * JSON Schema interface (`schema["~standard"].jsonSchema`). zod implements it
 * from 4.2 onward; older versions make TanStack throw at conversion time with
 * a less direct message, so fail early here instead.
 */
function assertStandardJsonSchema(schema: unknown): void {
  const standard = (
    schema as { "~standard"?: { jsonSchema?: { input?: unknown } } } | null
  )?.["~standard"];
  if (typeof standard?.jsonSchema?.input !== "function") {
    throw new Error(
      "createTanStackTools requires zod 4.2 or newer: TanStack AI converts tool input schemas through the Standard JSON Schema interface (`~standard.jsonSchema`), which the installed zod version does not implement."
    );
  }
}

function toTanStackTool<TInput, TOutput>(
  spec: ChatToolSpec<TInput, TOutput>
): TanStackTool<TInput, TOutput> {
  const built: TanStackTool<TInput, TOutput> = {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: (args) => spec.execute(args),
  };
  if (spec.needsApproval !== undefined) {
    built.needsApproval = spec.needsApproval;
  }
  return built;
}

/**
 * Create a set of Chat SDK tools for TanStack AI.
 *
 * Returns plain tool objects accepted by `chat({ tools })` from
 * `@tanstack/ai`, with the same tools, presets, approval flags, scope guard,
 * and override rules as `createChatTools` from `chat/ai`.
 *
 * Requires zod 4.2 or newer for the input schemas. `needsApproval: true`
 * makes TanStack pause the run with a tool-approval interrupt; a server-side
 * bot has to resume that run itself (see the TanStack AI docs on tool
 * approval), so most bots pass `requireApproval: false` or handle approval
 * before calling `chat()`.
 *
 * @example
 * ```ts
 * import { chat } from '@tanstack/ai'
 * import { vercelGatewayText } from '@tanstack/ai-vercel-gateway'
 * import { createTanStackTools, toTanStackMessages } from 'chat/ai/tanstack'
 *
 * bot.onNewMention(async (thread, message) => {
 *   const history = await thread.adapter.fetchMessages(thread.id, { limit: 20 })
 *   const stream = chat({
 *     adapter: vercelGatewayText('anthropic/claude-opus-5'),
 *     systemPrompts: ['You are a helpful assistant.'],
 *     messages: await toTanStackMessages(history.messages),
 *     tools: createTanStackTools({ chat: bot, preset: 'messenger', requireApproval: false }),
 *   })
 *   await thread.post(stream)
 * })
 * ```
 */
export function createTanStackTools({
  overrides,
  preset,
  ...base
}: TanStackChatToolsOptions): TanStackTool[] {
  const factories = createToolSpecFactories(base, "createTanStackTools");
  const specs = selectToolSpecs(factories, preset);

  const first = specs[0];
  if (first) {
    assertStandardJsonSchema(first[1].inputSchema);
  }

  return specs.map(
    ([name, spec]) =>
      applyOverrides(
        toTanStackTool(spec) as unknown as Record<string, unknown>,
        overrides?.[name],
        PROTECTED_TOOL_FIELDS
      ) as unknown as TanStackTool
  );
}
