import { describe, expectTypeOf, it } from "vitest";
import {
  ADAPTERS,
  type AdapterFeatures,
  type AdapterSlug,
  type CatalogAdapter,
  type CatalogEntry,
  type CommunityAdapterSlug,
  type FeatureKey,
  type FeatureSupport,
  getAdapter,
  getCatalogEntry,
  type getFeatureCategories,
  getFeatureSupport,
  isAdapterSlug,
  type PlatformFeatureKey,
  type StateFeatureKey,
} from "./index";

describe("adapter slugs", () => {
  it("separates official and vendor-official slugs from community slugs", () => {
    expectTypeOf<"slack">().toMatchTypeOf<AdapterSlug>();
    expectTypeOf<"kapso">().toMatchTypeOf<AdapterSlug>();
    expectTypeOf<"mattermost">().not.toMatchTypeOf<AdapterSlug>();
    expectTypeOf<"mattermost">().toMatchTypeOf<CommunityAdapterSlug>();
    expectTypeOf<"slack">().not.toMatchTypeOf<CommunityAdapterSlug>();
  });

  it("narrows strings with isAdapterSlug", () => {
    const input: string = "slack";
    if (isAdapterSlug(input)) {
      expectTypeOf(input).toEqualTypeOf<AdapterSlug>();
    }
  });
});

describe("lookups", () => {
  it("returns a defined entry for known slugs", () => {
    expectTypeOf(getAdapter("slack")).toEqualTypeOf<CatalogAdapter>();
  });

  it("returns an optional entry for arbitrary strings", () => {
    const slug: string = "slack";
    expectTypeOf(getAdapter(slug)).toEqualTypeOf<CatalogAdapter | undefined>();
    expectTypeOf(getCatalogEntry(slug)).toEqualTypeOf<
      CatalogEntry | undefined
    >();
  });

  it("keeps literal types on catalog entries", () => {
    expectTypeOf(ADAPTERS.slack.type).toEqualTypeOf<"platform">();
    expectTypeOf(ADAPTERS.redis.type).toEqualTypeOf<"state">();
    expectTypeOf(ADAPTERS.kapso.group).toEqualTypeOf<"vendor-official">();
  });
});

describe("catalog entries", () => {
  it("discriminates community entries by group", () => {
    const entry = {} as CatalogEntry;
    if (entry.group === "community") {
      expectTypeOf(entry).not.toHaveProperty("env");
      expectTypeOf(entry.author).toEqualTypeOf<string>();
    } else {
      expectTypeOf(entry.env).not.toBeUndefined();
      expectTypeOf(entry.factoryExport).toEqualTypeOf<string>();
    }
  });
});

describe("features", () => {
  it("derives feature keys from the categories", () => {
    expectTypeOf<"streaming">().toMatchTypeOf<PlatformFeatureKey>();
    expectTypeOf<"distributedLocking">().toMatchTypeOf<StateFeatureKey>();
    expectTypeOf<"streaming">().not.toMatchTypeOf<StateFeatureKey>();
    expectTypeOf<"notAFeature">().not.toMatchTypeOf<FeatureKey>();
  });

  it("rejects unknown feature keys and statuses", () => {
    expectTypeOf({
      streaming: "yes",
    } as const).toMatchTypeOf<AdapterFeatures>();
    expectTypeOf({
      notAFeature: "yes",
    } as const).not.toMatchTypeOf<AdapterFeatures>();
    expectTypeOf({
      streaming: "maybe",
    } as const).not.toMatchTypeOf<AdapterFeatures>();
  });

  it("types category keys as feature keys", () => {
    type CategoryKey = ReturnType<
      typeof getFeatureCategories
    >[number]["features"][number]["key"];
    expectTypeOf<CategoryKey>().toEqualTypeOf<FeatureKey>();
  });

  it("only accepts known feature keys in getFeatureSupport", () => {
    expectTypeOf(getFeatureSupport).parameter(1).toEqualTypeOf<FeatureKey>();
    expectTypeOf(
      getFeatureSupport("slack", "streaming")
    ).toEqualTypeOf<FeatureSupport>();
  });
});
