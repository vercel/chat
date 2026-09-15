import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createTeamsAdapter } from "@chat-adapter/teams";
import type {
  InstalledEvent,
  InstalledHandler,
  UninstalledHandler,
} from "chat";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import { DOCS_CONTENT_DIR } from "./documentation-test-utils";

const document = readFileSync(
  join(DOCS_CONTENT_DIR, "adapters/official/teams.mdx"),
  "utf8"
);
const example = document
  .split("## Installation lifecycle")[1]
  .split("```typescript\n")[1]
  .split("```")[0];
const { outputText } = transpileModule(example, {
  compilerOptions: { module: ModuleKind.CommonJS },
});
const adapter = createTeamsAdapter({ appId: "bot", appPassword: "secret" });

function setup() {
  const store = new Map<string, string>();
  const post = vi.fn().mockResolvedValue(undefined);
  const bot = {
    onInstalled: vi.fn<(handler: InstalledHandler) => void>(),
    onUninstalled: vi.fn<(handler: UninstalledHandler) => void>(),
    channel: vi.fn(() => ({ post })),
  };
  runInNewContext(outputText, { bot, installationStore: store, exports: {} });
  return {
    store,
    post,
    install: bot.onInstalled.mock.calls[0][0],
    uninstall: bot.onUninstalled.mock.calls[0][0],
  };
}

function event(overrides: Partial<InstalledEvent> = {}): InstalledEvent {
  return {
    adapter,
    action: "add",
    id: "installation",
    tenantId: "tenant",
    conversationId: "selected-channel",
    channelId: "destination",
    raw: { channelData: { team: { id: "team" } } },
    ...overrides,
  };
}

describe("Teams installation documentation", () => {
  it.each([
    "add",
    "add-upgrade",
  ] as const)("persists %s and cleans up when an upgrade removes the bot", async (action) => {
    const { store, install, uninstall, post } = setup();
    const installed = event({ action });
    await install(installed);
    expect([...store.values()]).toEqual(["destination"]);
    await uninstall({ ...installed, action: "remove-upgrade" });
    expect(store.size).toBe(0);
    expect(post).toHaveBeenCalledExactlyOnceWith("Thanks for installing!");
  });

  it.each([
    "remove",
    "remove-upgrade",
  ] as const)("cleans up the selected channel on a team-scoped %s", async (action) => {
    const { store, install, uninstall } = setup();
    const installed = event();
    await install(installed);
    await uninstall({
      ...installed,
      action,
      conversationId: "team-root",
      channelId: undefined,
    });
    expect(store.size).toBe(0);
  });

  it("replaces a team's destination on reinstall without deleting other tenants", async () => {
    const { store, install, uninstall } = setup();
    await install(event());
    await install(event({ tenantId: "other", channelId: "other-tenant" }));
    const reinstalled = event({
      conversationId: "new-channel",
      channelId: "new-destination",
    });
    await install(reinstalled);
    expect([...store.values()].sort()).toEqual([
      "new-destination",
      "other-tenant",
    ]);
    await uninstall({
      ...reinstalled,
      action: "remove",
      conversationId: "team",
    });
    expect([...store.values()]).toEqual(["other-tenant"]);
  });

  it("keeps conversations without a team separate and cleans up without a destination", async () => {
    const { store, install, uninstall, post } = setup();
    const personal = event({ conversationId: "personal", raw: {} });
    const group = event({
      conversationId: "group",
      channelId: "group-destination",
      raw: {},
    });
    await install(personal);
    await install(group);
    expect(store.size).toBe(2);
    await uninstall({ ...personal, action: "remove", channelId: undefined });
    expect([...store.values()]).toEqual(["group-destination"]);
    await uninstall({
      ...group,
      action: "remove-upgrade",
      channelId: undefined,
    });
    expect(store.size).toBe(0);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
