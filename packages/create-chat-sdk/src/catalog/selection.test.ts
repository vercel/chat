import { ADAPTER_NAMES, getAdapter } from "chat/adapters";
import { describe, expect, it } from "vitest";
import { CLI_SCAFFOLD_SPEC, getCliScaffoldSpec } from "./scaffold-spec.js";
import {
  defaultStateAdapter,
  resolveAdapterSelection,
  resolveAdapterValue,
  stateAdapterOptions,
} from "./selection.js";

describe("CLI_SCAFFOLD_SPEC", () => {
  it("covers every catalog adapter", () => {
    expect(Object.keys(CLI_SCAFFOLD_SPEC).sort()).toEqual([...ADAPTER_NAMES]);
  });

  it("throws for unknown scaffold specs", () => {
    expect(() => getCliScaffoldSpec("not-real")).toThrow(
      "Missing scaffold spec for not-real"
    );
  });
});

describe("resolveAdapterValue", () => {
  it("returns catalog slugs", () => {
    expect(resolveAdapterValue("slack")).toBe("slack");
  });

  it("throws on unknown values", () => {
    expect(() => resolveAdapterValue("not-real")).toThrow(
      "Unknown adapter value: not-real"
    );
  });

  it("rejects adapters incompatible with the webhook-only scaffold", () => {
    expect(() => resolveAdapterValue("matrix")).toThrow("not supported");
    expect(() => resolveAdapterValue("lark")).toThrow("not supported");
    expect(() => resolveAdapterValue("cloudflare-agents")).toThrow(
      "not supported"
    );
  });
});

describe("resolveAdapterSelection", () => {
  it("resolves platforms and state adapters", () => {
    const selection = resolveAdapterSelection(["slack", "redis"]);
    expect(selection.platformAdapters.map((adapter) => adapter.slug)).toEqual([
      "slack",
    ]);
    expect(selection.stateAdapter.slug).toBe("redis");
  });

  it("dedupes repeated platform adapters", () => {
    const selection = resolveAdapterSelection(["slack", "slack"]);
    expect(selection.platformAdapters).toHaveLength(1);
  });

  it("defaults to memory state", () => {
    const selection = resolveAdapterSelection(["slack"]);
    expect(selection.stateAdapter.slug).toBe("memory");
  });

  it("throws on multiple state adapters", () => {
    expect(() => resolveAdapterSelection(["memory", "redis"])).toThrow(
      'Choose one state adapter. Received "memory" and "redis"'
    );
  });
});

describe("state adapter helpers", () => {
  it("returns memory as the default state adapter", () => {
    expect(defaultStateAdapter()).toBe(getAdapter("memory"));
  });

  it("returns only state adapter options", () => {
    expect(
      stateAdapterOptions().every((adapter) => adapter.type === "state")
    ).toBe(true);
  });
});
