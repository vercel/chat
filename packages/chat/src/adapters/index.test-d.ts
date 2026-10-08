import { describe, expectTypeOf, it } from "vitest";
import { ADAPTERS, type CatalogAdapter, getAdapter } from "./index";

describe("chat/adapters CatalogAdapter (deprecated)", () => {
  it("accepts objects written against the original shape", () => {
    const adapter: CatalogAdapter = {
      description: "Example adapter.",
      env: {},
      factoryExport: "createExampleAdapter",
      group: "official",
      name: "Example",
      packageName: "@example/adapter",
      peerDeps: [],
      slug: "example",
      type: "platform",
    };
    expectTypeOf(adapter).toMatchTypeOf<CatalogAdapter>();
  });

  it("accepts catalog entries", () => {
    expectTypeOf(getAdapter("slack")).toMatchTypeOf<CatalogAdapter>();
    expectTypeOf(ADAPTERS.slack).toMatchTypeOf<CatalogAdapter>();
  });
});
