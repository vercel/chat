import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
} from "@chat-adapter/tests";
import { Chat, type ChatInstance, type InstallationEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appId,
  botId,
  serviceUrl,
  TestTeamsAdapter,
  token,
} from "./test-utils";

/**
 * Synthetic installationUpdate modeled on Microsoft's documented schema. No
 * captured tenant traffic exists for this activity type in sample-messages.md.
 * https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/subscribe-to-conversation-events#installation-update-event
 */
function activity(action = "add") {
  return {
    type: "installationUpdate",
    id: `installation-${action}`,
    action,
    channelId: "msteams",
    locale: "en-US",
    serviceUrl,
    from: {
      id: "29:installer",
      aadObjectId: "installer-aad",
      name: "Installer",
    },
    recipient: { id: botId, name: "Bot" },
    conversation: {
      id: "personal-installation",
      conversationType: "personal",
      tenantId: "tenant",
    },
    channelData: { tenant: { id: "tenant" } },
  };
}

describe("Teams installation lifecycle", () => {
  let adapter: TestTeamsAdapter;
  let chat: ReturnType<typeof createMockChatInstance>;
  const logger = createMockLogger();
  const options = { waitUntil: vi.fn() };

  beforeEach(async () => {
    adapter = new TestTeamsAdapter({ appId, appPassword: "secret", logger });
    chat = createMockChatInstance();
    adapter.stubWebhookOptions(options);
    await adapter.initialize(chat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["add", "processInstalled"],
    ["add-upgrade", "processInstalled"],
    ["remove", "processUninstalled"],
    ["remove-upgrade", "processUninstalled"],
  ] as const)("routes %s exactly once through the SDK", async (action, processor) => {
    const body = activity(action);
    const response = await adapter.receive(body);
    expect(response.status).toBe(200);
    expect(chat[processor]).toHaveBeenCalledExactlyOnceWith(
      {
        adapter,
        id: body.id,
        action,
        conversationId: body.conversation.id,
        channelId: adapter.encodeThreadId({
          conversationId: body.conversation.id,
          conversationType: "personal",
          serviceUrl,
        }),
        userId: "29:installer",
        tenantId: "tenant",
        locale: "en-US",
        raw: expect.objectContaining({ action }),
      },
      options
    );
    expect(chat.processMemberJoinedChannel).not.toHaveBeenCalled();
    const other =
      processor === "processInstalled"
        ? "processUninstalled"
        : "processInstalled";
    expect(chat[other]).not.toHaveBeenCalled();
  });

  it.each([
    "add",
    "remove",
  ])("falls back to the token service URL when %s omits one", async (action) => {
    await adapter.receive({ ...activity(action), serviceUrl: undefined });
    const processor =
      action === "add" ? chat.processInstalled : chat.processUninstalled;
    // The SDK strips the trailing slash when it resolves the reference.
    expect(processor).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "personal-installation",
        channelId: adapter.encodeThreadId({
          conversationId: "personal-installation",
          conversationType: "personal",
          serviceUrl: token.serviceUrl.slice(0, -1),
        }),
      }),
      options
    );
  });

  it("preserves identifiable removal when actor and locale are absent", async () => {
    await adapter.receive({
      ...activity("remove"),
      from: undefined,
      locale: undefined,
    });
    expect(chat.processUninstalled).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "personal-installation",
        userId: undefined,
        locale: undefined,
      }),
      options
    );
  });

  it.each([
    { action: "future-action" },
    { recipient: { id: "28:another-bot" } },
    { recipient: { id: "" } },
    { conversation: { id: "" } },
  ])("ignores malformed or unknown lifecycle activities: %j", async (overrides) => {
    await adapter.receive({ ...activity(), ...overrides });
    expect(chat.processInstalled).not.toHaveBeenCalled();
    expect(chat.processUninstalled).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it.each([
    "channel",
    "groupChat",
  ] as const)("preserves %s location, tenant, and classification", async (conversationType) => {
    const conversationId = "19:selected@thread.tacv2";
    const body = {
      ...activity(),
      // Team and group payloads carry the tenant only in channelData.
      conversation: { id: conversationId, conversationType, isGroup: true },
      channelData: {
        tenant: { id: "tenant" },
        team: { id: "19:team", aadGroupId: "team-aad" },
        settings: { selectedChannel: { id: conversationId } },
      },
    };
    await adapter.receive(body);
    expect(chat.processInstalled).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        tenantId: "tenant",
        channelId: adapter.encodeThreadId({
          conversationId,
          conversationType,
          serviceUrl,
        }),
        raw: expect.objectContaining({ channelData: body.channelData }),
      }),
      options
    );
  });

  it("emits both a join and an install for a team installation", async () => {
    const conversationId = "19:selected@thread.tacv2";
    const body = {
      ...activity(),
      conversation: {
        id: conversationId,
        conversationType: "channel",
        isGroup: true,
      },
      channelData: { tenant: { id: "tenant" }, team: { id: "19:team" } },
    };
    await adapter.receive(body);
    await adapter.receive({
      ...body,
      type: "conversationUpdate",
      id: "join",
      membersAdded: [{ id: botId }],
    });
    const channelId = adapter.encodeThreadId({
      conversationId,
      conversationType: "channel",
      serviceUrl,
    });
    expect(chat.processInstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ channelId }),
      options
    );
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ channelId }),
      options
    );
  });

  it("allows older custom Chat instances to omit lifecycle processors", async () => {
    const legacy: Partial<ChatInstance> = chat;
    legacy.processInstalled = undefined;
    legacy.processUninstalled = undefined;
    await expect(adapter.receive(activity())).resolves.toMatchObject({
      status: 200,
    });
    await expect(adapter.receive(activity("remove"))).resolves.toMatchObject({
      status: 200,
    });
  });

  it("tracks asynchronous installation work through the actual webhook bridge", async () => {
    const runtime = new TestTeamsAdapter({
      appId,
      appPassword: "secret",
      logger,
    });
    runtime.allowUnauthenticatedWebhooks();
    const bot = new Chat({
      userName: "bot",
      adapters: { teams: runtime },
      state: createMockState(),
      logger,
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;
    bot.onInstalled(async () => {
      await gate;
      done = true;
    });
    await bot.initialize();
    const tasks: Promise<unknown>[] = [];
    const response = await runtime.handleWebhook(
      new Request("https://example.com/api/webhooks/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activity()),
      }),
      { waitUntil: (task) => tasks.push(task) }
    );
    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(1);
    expect(done).toBe(false);
    release();
    await Promise.all(tasks);
    expect(done).toBe(true);
  });

  it("persists channel IDs, replaces reinstalls, and posts later to each service URL", async () => {
    const saved = new Map<string, string>();
    const runtime = new TestTeamsAdapter({
      appId,
      appPassword: "secret",
      logger,
    });
    const tasks: Promise<unknown>[] = [];
    runtime.stubWebhookOptions({ waitUntil: (task) => tasks.push(task) });
    const send = runtime.spyActivitySender();
    const bot = new Chat({
      userName: "bot",
      adapters: { teams: runtime },
      state: createMockState(),
      logger,
    });
    const key = (event: InstallationEvent) =>
      `${event.tenantId}:${event.conversationId}`;
    bot.onInstalled((event) => {
      if (event.channelId) {
        saved.set(key(event), event.channelId);
      }
    });
    bot.onUninstalled((event) => {
      saved.delete(key(event));
    });
    await bot.initialize();

    await runtime.receive(activity());
    await Promise.all(tasks);
    const first = saved.get("tenant:personal-installation");
    const nextServiceUrl = "https://smba.trafficmanager.net/emea/";
    await runtime.receive({
      ...activity(),
      id: "reinstall",
      serviceUrl: nextServiceUrl,
    });
    await Promise.all(tasks);
    const second = saved.get("tenant:personal-installation");
    expect(second).not.toBe(first);

    // Only the persisted thread ID is needed to reach each installation later.
    for (const [channelId, endpoint] of [
      [first, serviceUrl],
      [second, nextServiceUrl],
    ] as const) {
      await bot.channel(channelId ?? "").post("Welcome back");
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: "Welcome back" }),
        expect.objectContaining({
          serviceUrl: endpoint.slice(0, -1),
          conversation: { id: "personal-installation" },
        })
      );
    }

    await runtime.receive({ ...activity("remove"), serviceUrl: undefined });
    await Promise.all(tasks);
    expect(saved.size).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
