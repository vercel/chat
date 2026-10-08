import { describe, expect, test } from "vitest";

// Load both modules as namespace objects so the tests can compare every
// export, not just the ones named here.
const catalog: Record<string, unknown> = await import("@chat-adapter/catalog");
const legacy: Record<string, unknown> = await import("./index");
const { ADAPTERS, getSecretEnvVars } = await import("@chat-adapter/catalog");
const { getAdapter, getSecretEnvVars: legacyGetSecretEnvVars } = await import(
  "./index"
);

describe("chat/adapters (deprecated)", () => {
  test("keeps exactly the original runtime exports", () => {
    expect(Object.keys(legacy).sort()).toEqual([
      "ADAPTERS",
      "ADAPTER_NAMES",
      "getAdapter",
      "getSecretEnvVars",
      "isAdapterSlug",
      "listEnvVars",
      "listPlatformAdapters",
      "listStateAdapters",
    ]);
  });

  test("re-exports the catalog package rather than a copy", () => {
    for (const [name, value] of Object.entries(legacy)) {
      expect(value, name).toBe(catalog[name]);
    }
  });

  test("returns catalog data through the legacy helpers", () => {
    expect(getAdapter("slack")).toBe(ADAPTERS.slack);
    expect(legacyGetSecretEnvVars("slack")).toEqual(getSecretEnvVars("slack"));
  });
});
