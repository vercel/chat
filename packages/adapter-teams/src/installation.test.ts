import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
} from "@chat-adapter/tests";
import { Chat, type InstallationEvent, type WebhookOptions } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postTeamsMessage } from "./api/messages";
import { TeamsAdapter } from "./index";
import type { TeamsConversationReference } from "./types";

const appId = "11111111-2222-3333-4444-555555555555";
const botId = `28:${appId}`;
const serviceUrl = "https://smba.trafficmanager.net/amer/";
const token = {
  appId,
  serviceUrl,
  from: "azure" as const,
  fromId: appId,
  isExpired: () => false,
  toString: () => "test-token",
};

class InstallationAdapter extends TeamsAdapter {
  stubWebhookOptions(options: WebhookOptions) {
    vi.spyOn(this.bridgeAdapter, "getWebhookOptions").mockReturnValue(options);
  }

  allowUnauthenticatedWebhooks() {
    const server = this.app.server as unknown as {
      authorize: () => Promise<unknown>;
    };
    vi.spyOn(server, "authorize").mockResolvedValue({ success: true, token });
  }

  receive(body: { type: string; [key: string]: unknown }) {
    return this.app.process({ body, token });
  }

  // Compile-time regression for the Microsoft SDK's conversation event union.
  registerTypedJoinRoutes() {
    this.app.on("conversationUpdate.teamMemberAdded", async () => {});
    this.app.on("conversationUpdate.teamMemberRemoved", async () => {});
  }
}

/** Synthetic Microsoft-documented lifecycle shape; see sample-messages.md. */
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
  let adapter: InstallationAdapter;
  let chat: ReturnType<typeof createMockChatInstance>;
  const logger = createMockLogger();
  const options = { waitUntil: vi.fn() };

  beforeEach(async () => {
    adapter = new InstallationAdapter({ appId, appPassword: "secret", logger });
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
      expect.objectContaining({
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
        conversationReference: expect.objectContaining({
          bot: expect.objectContaining({ id: botId }),
          user: expect.objectContaining({
            id: "29:installer",
            aadObjectId: "installer-aad",
          }),
          conversation: expect.objectContaining(body.conversation),
          serviceUrl: serviceUrl.slice(0, -1),
        }),
      }),
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
  ])("emits %s metadata without a service URL", async (action) => {
    await adapter.receive({ ...activity(action), serviceUrl: undefined });
    const processor =
      action === "add" ? chat.processInstalled : chat.processUninstalled;
    expect(processor).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "personal-installation",
        channelId: undefined,
        conversationReference: undefined,
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
        conversationReference: expect.objectContaining({ user: undefined }),
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
  ] as const)("preserves %s location and classification", async (conversationType) => {
    const conversationId = "19:selected@thread.tacv2";
    const body = {
      ...activity(),
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
        channelId: adapter.encodeThreadId({
          conversationId,
          conversationType,
          serviceUrl,
        }),
        raw: expect.objectContaining({ channelData: body.channelData }),
      }),
      options
    );
    await adapter.receive({
      ...body,
      type: "conversationUpdate",
      id: "join",
      membersAdded: [{ id: botId }],
    });
    expect(chat.processInstalled).toHaveBeenCalledOnce();
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledOnce();
  });

  it("allows older custom Chat instances to omit lifecycle processors", async () => {
    chat.processInstalled = undefined;
    chat.processUninstalled = undefined;
    await expect(adapter.receive(activity())).resolves.toMatchObject({
      status: 200,
    });
    await expect(adapter.receive(activity("remove"))).resolves.toMatchObject({
      status: 200,
    });
  });

  it("accepts the upstream typed team membership routes", () => {
    expect(() => adapter.registerTypedJoinRoutes()).not.toThrow();
  });

  it("tracks asynchronous installation work through the actual webhook bridge", async () => {
    const runtime = new InstallationAdapter({
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

  it("persists references, replaces reinstalls, and sends later to each saved service URL", async () => {
    const saved = new Map<string, string>();
    const runtime = new InstallationAdapter({
      appId,
      appPassword: "secret",
      logger,
    });
    const tasks: Promise<unknown>[] = [];
    runtime.stubWebhookOptions({ waitUntil: (task) => tasks.push(task) });
    const bot = new Chat({
      userName: "bot",
      adapters: { teams: runtime },
      state: createMockState(),
      logger,
    });
    const key = (event: InstallationEvent) =>
      `${event.tenantId}:${event.conversationId}`;
    bot.onInstalled((event) => {
      saved.set(key(event), JSON.stringify(event.conversationReference));
    });
    bot.onUninstalled((event) => {
      saved.delete(key(event));
    });
    await bot.initialize();
    const body = activity();
    await runtime.receive({
      ...body,
      recipient: {
        ...body.recipient,
        properties: { accessToken: "never-save" },
      },
    });
    await Promise.all(tasks);
    const first = saved.get("tenant:personal-installation");
    expect(first).not.toContain("never-save");
    expect(first).not.toContain("secret");
    expect(first).not.toContain("test-token");
    const nextServiceUrl = "https://smba.trafficmanager.net/emea/";
    await runtime.receive({
      ...body,
      id: "reinstall",
      serviceUrl: nextServiceUrl,
    });
    await Promise.all(tasks);
    const second = saved.get("tenant:personal-installation");
    expect(second).not.toBe(first);

    // A fresh transport with only persisted JSON and separately supplied credentials.
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "proactive-message" }), {
          status: 200,
        })
    );
    for (const [serialized, endpoint] of [
      [first, serviceUrl],
      [second, nextServiceUrl],
    ]) {
      const reference: TeamsConversationReference = JSON.parse(
        serialized ?? "{}"
      );
      await postTeamsMessage({
        credentials: { accessToken: "fresh-token" },
        conversationId: reference.conversation.id,
        serviceUrl: reference.serviceUrl,
        text: "Welcome back",
        fetch,
      });
      expect(fetch).toHaveBeenLastCalledWith(
        new URL(`${endpoint}v3/conversations/personal-installation/activities`),
        expect.objectContaining({
          body: expect.not.stringContaining("installation-add"),
        })
      );
    }
    await runtime.receive({ ...activity("remove"), serviceUrl: undefined });
    await Promise.all(tasks);
    expect(saved.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
