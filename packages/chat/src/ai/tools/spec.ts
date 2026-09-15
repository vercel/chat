import type { ZodType } from "zod";

/**
 * Framework-agnostic description of a Chat SDK tool.
 *
 * Every tool in `chat/ai` is defined once as a spec and then wrapped for a
 * specific agent framework: `createChatTools` turns specs into Vercel AI SDK
 * tools and `createTanStackTools` (from `chat/ai/tanstack`) turns them into
 * TanStack AI tools. Specs never import from either framework, so the
 * TanStack entry stays dependency-free at runtime.
 *
 * `execute` is declared as a method so a spec with a narrow input type is
 * assignable to `ChatToolSpec<unknown, unknown>` collections.
 */
export interface ChatToolSpec<TInput = unknown, TOutput = unknown> {
  description: string;
  execute(input: TInput): Promise<TOutput>;
  inputSchema: ZodType<TInput>;
  name: string;
  needsApproval?: boolean;
}
