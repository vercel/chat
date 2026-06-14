import { listPlatformAdapters } from "chat/adapters";
import { describe, expect, it } from "vitest";
import { listCliPlatformAdapters } from "./display.js";

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
});
