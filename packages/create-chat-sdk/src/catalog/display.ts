import type { CatalogAdapter } from "chat/adapters";
import { listPlatformAdapters } from "chat/adapters";
import { isCliCompatibleAdapter } from "./compatibility.js";

type PlatformAdapterGroup = CatalogAdapter["group"];

const compareAdapterNames = (
  first: CatalogAdapter,
  second: CatalogAdapter
): number => first.name.localeCompare(second.name);

/**
 * List platform adapters for CLI display.
 *
 * Official adapters keep catalog order. Vendor-official adapters are sorted by
 * display name so third-party entries stay easy to scan as the catalog grows.
 *
 * @param group - Platform adapter group to list.
 * @returns Platform adapters in CLI display order.
 */
export function listCliPlatformAdapters(
  group: PlatformAdapterGroup
): CatalogAdapter[] {
  const adapters = listPlatformAdapters().filter(
    (adapter) => adapter.group === group && isCliCompatibleAdapter(adapter.slug)
  );

  if (group === "vendor-official") {
    return [...adapters].sort(compareAdapterNames);
  }

  return adapters;
}
