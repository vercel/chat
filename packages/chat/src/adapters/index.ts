/**
 * Deprecated alias for `@chat-adapter/catalog`.
 *
 * The adapter catalog moved to the `@chat-adapter/catalog` package, which also
 * lists community adapters and each adapter's capabilities. This subpath
 * re-exports the original API so existing imports keep working.
 *
 * @deprecated Import from `@chat-adapter/catalog` instead.
 */

import {
  ADAPTER_NAMES,
  ADAPTERS as CATALOG_ADAPTERS,
  type CatalogAdapter as CatalogPackageAdapter,
} from "@chat-adapter/catalog";

export {
  ADAPTER_NAMES,
  type AdapterEnvSpec,
  type AdapterSlug,
  type EnvGroup,
  type EnvVar,
  getAdapter,
  getSecretEnvVars,
  isAdapterSlug,
  listEnvVars,
  listPlatformAdapters,
  listStateAdapters,
} from "@chat-adapter/catalog";

/**
 * An official or vendor-official adapter, with the metadata setup tools need
 * to install and configure it.
 *
 * `features` and `readme` are optional here so objects written against the
 * original `chat/adapters` shape still type-check.
 *
 * @deprecated Import `CatalogAdapter` from `@chat-adapter/catalog` instead.
 */
export interface CatalogAdapter
  extends Omit<CatalogPackageAdapter, "features" | "readme"> {
  features?: CatalogPackageAdapter["features"];
  readme?: string;
}

/**
 * Official and vendor-official adapters keyed by slug, in alphabetical key
 * order.
 *
 * @deprecated Import `ADAPTERS` from `@chat-adapter/catalog` instead. Its keys
 * follow chat-sdk.dev listing order.
 */
export const ADAPTERS = Object.fromEntries(
  ADAPTER_NAMES.map((slug) => [slug, CATALOG_ADAPTERS[slug]])
) as typeof CATALOG_ADAPTERS;
