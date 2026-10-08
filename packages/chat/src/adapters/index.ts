/**
 * Deprecated alias for `@chat-adapter/catalog`.
 *
 * The adapter catalog moved to the `@chat-adapter/catalog` package, which also
 * lists community adapters and each adapter's capabilities. This subpath
 * re-exports the original API so existing imports keep working.
 *
 * @deprecated Import from `@chat-adapter/catalog` instead.
 */

export {
  ADAPTER_NAMES,
  ADAPTERS,
  type AdapterEnvSpec,
  type AdapterSlug,
  type CatalogAdapter,
  type EnvGroup,
  type EnvVar,
  getAdapter,
  getSecretEnvVars,
  isAdapterSlug,
  listEnvVars,
  listPlatformAdapters,
  listStateAdapters,
} from "@chat-adapter/catalog";
