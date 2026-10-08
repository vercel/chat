/**
 * Catalog of Chat SDK adapters: official, vendor-official, and community.
 *
 * Each entry describes an adapter's package, maintainer, capabilities, and,
 * for official and vendor-official adapters, the factory export, peer
 * dependencies, and environment variables needed to set it up. The module
 * imports no adapter packages and no provider SDKs, so it is safe to use from
 * websites, build scripts, setup screens, and CLIs.
 *
 * @example List every adapter with its capabilities.
 * ```typescript
 * import { getFeatureSupport, listAdapters } from "@chat-adapter/catalog";
 *
 * for (const adapter of listAdapters({ type: "platform" })) {
 *   const streaming = getFeatureSupport(adapter, "streaming");
 *   console.log(adapter.name, adapter.group, streaming.status);
 * }
 * ```
 *
 * @example Find secrets for one adapter.
 * ```typescript
 * import { getSecretEnvVars } from "@chat-adapter/catalog";
 *
 * const keys = getSecretEnvVars("slack").map((envVar) => envVar.key);
 * ```
 */

import { ADAPTERS, COMMUNITY_ADAPTERS } from "./adapters";
import {
  type FeatureKey,
  type FeatureSupport,
  normalizeFeatureValue,
} from "./features";
import type {
  AdapterGroup,
  AdapterListing,
  AdapterType,
  CatalogAdapter,
  CatalogEntry,
  EnvVar,
} from "./types";

export { ADAPTERS, COMMUNITY_ADAPTERS } from "./adapters";
export {
  type AdapterFeatures,
  type FeatureCategory,
  type FeatureDefinition,
  type FeatureKey,
  type FeatureStatus,
  type FeatureSupport,
  type FeatureValue,
  getFeatureCategories,
  normalizeFeatureValue,
  PLATFORM_FEATURE_CATEGORIES,
  type PlatformFeatureKey,
  STATE_FEATURE_CATEGORIES,
  type StateFeatureKey,
} from "./features";
export type {
  AdapterEnvSpec,
  AdapterGroup,
  AdapterListing,
  AdapterType,
  CatalogAdapter,
  CatalogEntry,
  CommunityAdapter,
  EnvGroup,
  EnvVar,
} from "./types";

/**
 * Slug for an official or vendor-official adapter.
 */
export type AdapterSlug = keyof typeof ADAPTERS;

/**
 * Slug for a community adapter.
 */
export type CommunityAdapterSlug = keyof typeof COMMUNITY_ADAPTERS;

/**
 * Official and vendor-official adapter slugs, sorted alphabetically.
 */
export const ADAPTER_NAMES = Object.keys(ADAPTERS).sort() as AdapterSlug[];

const ALL_ENTRIES: readonly CatalogEntry[] = [
  ...Object.values(ADAPTERS),
  ...Object.values(COMMUNITY_ADAPTERS),
];

const ENTRIES_BY_SLUG: ReadonlyMap<string, CatalogEntry> = new Map(
  ALL_ENTRIES.map((entry) => [entry.slug, entry])
);

/**
 * Filters for {@link listAdapters}.
 */
export interface ListAdaptersOptions {
  /**
   * Only return adapters in these groups. Defaults to every group.
   */
  group?: AdapterGroup | readonly AdapterGroup[];
  /**
   * Only return platform or state adapters. Defaults to both.
   */
  type?: AdapterType;
}

/**
 * Return every adapter in the catalog, including community adapters.
 *
 * Official and vendor-official adapters come first, in the order chat-sdk.dev
 * lists them, followed by community adapters.
 *
 * @param options - Optional group and type filters.
 * @returns Matching catalog entries.
 *
 * @example
 * ```typescript
 * const vendorPlatforms = listAdapters({
 *   group: "vendor-official",
 *   type: "platform",
 * });
 * ```
 */
export const listAdapters = (
  options: ListAdaptersOptions = {}
): readonly CatalogEntry[] => {
  const groups =
    options.group === undefined
      ? undefined
      : new Set<AdapterGroup>(
          typeof options.group === "string" ? [options.group] : options.group
        );
  return ALL_ENTRIES.filter(
    (entry) =>
      (!groups || groups.has(entry.group)) &&
      (!options.type || entry.type === options.type)
  );
};

/**
 * Look up any catalog entry by slug, including community adapters.
 *
 * @param slug - Adapter slug to look up.
 * @returns The catalog entry, otherwise `undefined`.
 */
export const getCatalogEntry = (slug: string): CatalogEntry | undefined =>
  ENTRIES_BY_SLUG.get(slug);

const listByType = (type: AdapterType): readonly CatalogAdapter[] =>
  ADAPTER_NAMES.map((slug) => ADAPTERS[slug]).filter(
    (adapter) => adapter.type === type
  );

/**
 * Return every official and vendor-official platform adapter sorted by slug.
 *
 * @returns Catalog entries whose {@link CatalogAdapter.type} is `"platform"`.
 */
export const listPlatformAdapters = (): readonly CatalogAdapter[] =>
  listByType("platform");

/**
 * Return every official and vendor-official state adapter sorted by slug.
 *
 * @returns Catalog entries whose {@link CatalogAdapter.type} is `"state"`.
 */
export const listStateAdapters = (): readonly CatalogAdapter[] =>
  listByType("state");

/**
 * Check whether a string is an official or vendor-official adapter slug.
 *
 * @param slug - Candidate adapter slug.
 * @returns Whether the slug exists in {@link ADAPTERS}.
 *
 * @example
 * ```typescript
 * if (isAdapterSlug(input)) {
 *   const adapter = getAdapter(input);
 * }
 * ```
 */
export const isAdapterSlug = (slug: string): slug is AdapterSlug =>
  Object.hasOwn(ADAPTERS, slug);

/**
 * Look up an official or vendor-official adapter by slug.
 *
 * Use {@link getCatalogEntry} to include community adapters.
 *
 * @param slug - Adapter slug to look up.
 * @returns The catalog entry for known slugs, otherwise `undefined`.
 */
export function getAdapter(slug: AdapterSlug): CatalogAdapter;
export function getAdapter(slug: string): CatalogAdapter | undefined;
export function getAdapter(slug: string): CatalogAdapter | undefined {
  return isAdapterSlug(slug) ? ADAPTERS[slug] : undefined;
}

/**
 * Return an adapter's support for one capability. Undeclared capabilities
 * and unknown slugs return `{ status: "no" }`.
 *
 * @param adapter - Catalog entry or adapter slug.
 * @param feature - Capability key.
 * @returns Normalized support entry.
 *
 * @example
 * ```typescript
 * getFeatureSupport("slack", "streaming");
 * // { status: "yes", label: "Native" }
 * ```
 */
export const getFeatureSupport = (
  adapter: AdapterListing | string,
  feature: FeatureKey
): FeatureSupport => {
  const entry =
    typeof adapter === "string" ? getCatalogEntry(adapter) : adapter;
  return normalizeFeatureValue(entry?.features[feature]);
};

/**
 * Flatten every environment variable referenced by an adapter.
 *
 * Variables are returned in declaration order and de-duplicated by canonical
 * key. Unknown slugs and community adapters return an empty array.
 *
 * @param slug - Adapter slug to inspect.
 * @returns Environment variables declared by the adapter entry.
 */
export const listEnvVars = (slug: string): readonly EnvVar[] => {
  const adapter = getAdapter(slug);
  if (!adapter) {
    return [];
  }

  const all = [
    ...(adapter.env.required ?? []),
    ...(adapter.env.credentialModes ?? []).flatMap((mode) => mode.vars),
    ...(adapter.env.optional ?? []),
  ];
  const byKey = new Map<string, EnvVar>();
  for (const envVar of all) {
    if (!byKey.has(envVar.key)) {
      byKey.set(envVar.key, envVar);
    }
  }
  return [...byKey.values()];
};

/**
 * Return only secret environment variables for an adapter.
 *
 * @param slug - Adapter slug to inspect.
 * @returns Secret variables declared by the adapter entry.
 */
export const getSecretEnvVars = (slug: string): readonly EnvVar[] =>
  listEnvVars(slug).filter((envVar) => envVar.secret);
