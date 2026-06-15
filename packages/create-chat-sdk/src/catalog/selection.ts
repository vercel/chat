import {
  ADAPTER_NAMES,
  ADAPTERS,
  type AdapterSlug,
  type CatalogAdapter,
  isAdapterSlug,
  listStateAdapters,
} from "chat/adapters";
import { AdapterSelectionError } from "../errors.js";
import type { AdapterSelection } from "../types.js";
import { cliIncompatibilityReason } from "./compatibility.js";

const DEFAULT_STATE_SLUG = "memory" satisfies AdapterSlug;

const adapterValues = (): string => ADAPTER_NAMES.join(", ");

const getKnownAdapter = (slug: AdapterSlug): CatalogAdapter => ADAPTERS[slug];

/**
 * Return the default state adapter used for non-interactive scaffolding.
 *
 * @returns The memory state adapter catalog entry.
 */
export const defaultStateAdapter = (): CatalogAdapter =>
  getKnownAdapter(DEFAULT_STATE_SLUG);

/**
 * Resolve an adapter flag value to a catalog slug.
 *
 * @param value - Raw CLI flag value.
 * @returns Catalog slug.
 * @throws AdapterSelectionError when the value is unknown.
 */
export function resolveAdapterValue(value: string): AdapterSlug {
  if (isAdapterSlug(value)) {
    const reason = cliIncompatibilityReason(value);
    if (reason) {
      throw new AdapterSelectionError(
        `The ${value} adapter is not supported by create-chat-sdk because ${reason}.`
      );
    }
    return value;
  }

  throw new AdapterSelectionError(
    `Unknown adapter value: ${value}. Available values: ${adapterValues()}`
  );
}

/**
 * Resolve adapter CLI flag values to selected platform and state adapters.
 *
 * @param values - Raw `--adapter` values.
 * @returns Platform adapters and state adapter.
 * @throws AdapterSelectionError when an unknown or duplicate state adapter is supplied.
 */
export function resolveAdapterSelection(
  values: readonly string[]
): AdapterSelection {
  const platformSlugs = new Set<AdapterSlug>();
  const platformAdapters: CatalogAdapter[] = [];
  let stateAdapter: CatalogAdapter | undefined;

  for (const value of values) {
    const slug = resolveAdapterValue(value);
    const adapter = getKnownAdapter(slug);

    if (adapter.type === "state") {
      if (stateAdapter && stateAdapter.slug !== adapter.slug) {
        throw new AdapterSelectionError(
          `Choose one state adapter. Received "${stateAdapter.slug}" and "${adapter.slug}"`
        );
      }
      stateAdapter = adapter;
      continue;
    }

    if (!platformSlugs.has(slug)) {
      platformSlugs.add(slug);
      platformAdapters.push(adapter);
    }
  }

  return {
    platformAdapters,
    stateAdapter: stateAdapter ?? defaultStateAdapter(),
  };
}

/**
 * Return state adapters sorted by catalog slug.
 *
 * @returns State adapter entries.
 */
export const stateAdapterOptions = (): readonly CatalogAdapter[] =>
  listStateAdapters();
