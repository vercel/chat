import type { AdapterSlug } from "chat/adapters";

/**
 * Adapters present in the public `chat/adapters` catalog that the webhook-only
 * Next.js scaffold cannot host, mapped to the reason shown when one is
 * requested.
 *
 * These adapters need a long-running sync loop or a persistent WebSocket
 * connection that the generated serverless runtime does not provide, so they
 * are hidden from the CLI prompts and rejected when passed via `--adapter`.
 */
const CLI_INCOMPATIBLE_ADAPTERS = {
  "cloudflare-agents":
    "it runs inside a Cloudflare Worker with Durable Objects, not the generated Next.js runtime",
  lark: "it requires a long-running WebSocket connection",
  matrix: "it requires a long-running sync process",
} as const satisfies Partial<Record<AdapterSlug, string>>;

/**
 * Return the reason an adapter is unsupported by the CLI, if any.
 *
 * @param slug - Catalog adapter slug.
 * @returns The incompatibility reason, or `undefined` when the adapter is
 *   compatible with the generated scaffold.
 */
export const cliIncompatibilityReason = (slug: string): string | undefined =>
  (CLI_INCOMPATIBLE_ADAPTERS as Record<string, string>)[slug];

/**
 * Check whether an adapter can be used by the generated scaffold.
 *
 * @param slug - Catalog adapter slug.
 * @returns Whether the adapter is compatible with the CLI.
 */
export const isCliCompatibleAdapter = (slug: string): boolean =>
  !Object.hasOwn(CLI_INCOMPATIBLE_ADAPTERS, slug);
