import { listPlatformAdapters, listStateAdapters } from "chat/adapters";
import { describe, expect, it } from "vitest";
import { listCliPlatformAdapters, listCliStateAdapters } from "./display.js";

describe("listCliPlatformAdapters", () => {
  it("keeps official adapters in catalog order", () => {
    expect(listCliPlatformAdapters("official")).toEqual(
      listPlatformAdapters().filter((adapter) => adapter.group === "official")
    );
  });

  it("sorts vendor-official adapters alphabetically by display name", () => {
    const names = listCliPlatformAdapters("vendor-official").map(
      (adapter) => adapter.name
    );

    expect(names).toEqual(
      [...names].sort((first, second) => first.localeCompare(second))
    );
  });

  it("omits adapters that the webhook-only scaffold cannot host", () => {
    const slugs = listCliPlatformAdapters("vendor-official").map(
      (adapter) => adapter.slug
    );
    expect(slugs).not.toContain("matrix");
    expect(slugs).not.toContain("lark");
  });
});

describe("listCliStateAdapters", () => {
  it("returns only state adapters", () => {
    expect(
      listCliStateAdapters().every((adapter) => adapter.type === "state")
    ).toBe(true);
  });

  it("includes state adapters the scaffold can host", () => {
    const slugs = listCliStateAdapters().map((adapter) => adapter.slug);
    expect(slugs).toContain("memory");
    expect(slugs).toContain("redis");
  });

  it("omits state adapters the webhook-only scaffold cannot host", () => {
    const catalogSlugs = listStateAdapters().map((adapter) => adapter.slug);
    const cliSlugs = listCliStateAdapters().map((adapter) => adapter.slug);
    // Cloudflare Agents ships in the catalog but runs inside a Worker, so it is
    // hidden from the CLI even though it is a catalog state adapter.
    expect(catalogSlugs).toContain("cloudflare-agents");
    expect(cliSlugs).not.toContain("cloudflare-agents");
  });
});
