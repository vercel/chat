import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
} from "@chat-adapter/tests";
import { Chat, type MemberJoinedChannelEvent, type WebhookOptions } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsAdapter } from "./index";

const appId = "11111111-2222-3333-4444-555555555555";
const botId = `28:${appId}`;
const serviceUrl = "https://smba.trafficmanager.net/amer/";
const conversationId = "19:channel@thread.tacv2";
const logger = createMockLogger();

const token = {
  appId,
  serviceUrl,
  from: "azure" as const,
  fromId: appId,
  isExpired: () => false,
  toString: () => "test-token",
};

class JoinAdapter extends TeamsAdapter {
  /** Return fixed WebhookOptions from the bridge instead of the real map. */
  stubWebhookOptions(options?: WebhookOptions) {
    return vi
      .spyOn(this.bridgeAdapter, "getWebhookOptions")
      .mockReturnValue(options);
  }

  /** Stub outbound Bot Framework calls so welcome posts do not hit the network. */
  stubOutbound() {
    vi.spyOn(this.app.api.users, "getToken").mockResolvedValue({});
    return vi.spyOn(this.app, "send").mockResolvedValue({
      id: "welcome",
      type: "message",
    });
  }

  /** Accept webhooks without a JWT so handleWebhook can be driven end to end. */
  allowUnauthenticatedWebhooks() {
    const server = this.app.server as unknown as {
      authorize: () => Promise<unknown>;
    };
    vi.spyOn(server, "authorize").mockResolvedValue({ success: true, token });
  }

  receive(body: { type: string; [key: string]: unknown }) {
    return this.app.process({ body, token });
  }
}

function activity() {
  return {
    type: "conversationUpdate",
    id: "join-activity",
    channelId: "msteams",
    serviceUrl,
    from: { id: "29:inviter", aadObjectId: "inviter-aad" },
    recipient: { id: botId },
    conversation: {
      id: conversationId,
      conversationType: "channel",
      isGroup: true,
      tenantId: "tenant",
    },
    membersAdded: [{ id: botId }],
    channelData: {
      eventType: "teamMemberAdded",
      team: { id: "19:team", aadGroupId: "team-aad" },
      settings: { selectedChannel: { id: conversationId } },
      tenant: { id: "tenant" },
    },
  };
}

describe("Teams bot joins", () => {
  let adapter: JoinAdapter;
  let chat: ReturnType<typeof createMockChatInstance>;
  let options: WebhookOptions;
  let lookup: ReturnType<JoinAdapter["stubWebhookOptions"]>;

  beforeEach(async () => {
    adapter = new JoinAdapter({ appId, appPassword: "test", logger });
    chat = createMockChatInstance();
    options = { waitUntil: vi.fn() };
    lookup = adapter.stubWebhookOptions(options);
    await adapter.initialize(chat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("exposes the configured bot identity", () => {
    expect(adapter.botUserId).toBe(botId);
  });

  it("uses the resolved app identity with environment fallback", () => {
    vi.stubEnv("TEAMS_APP_ID", "environment-app");
    const fallback = new TeamsAdapter({ appPassword: "test", logger });
    const explicit = new TeamsAdapter({
      appId,
      appPassword: "test",
      logger,
    });
    expect(fallback.botUserId).toBe("28:environment-app");
    expect(explicit.botUserId).toBe(botId);
  });

  it("dispatches the captured channel-join shape through the SDK router", async () => {
    const response = await adapter.receive(activity());
    expect(response.status).toBe(200);
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledExactlyOnceWith(
      {
        adapter,
        channelId: adapter.encodeThreadId({ conversationId, serviceUrl }),
        userId: botId,
        inviterId: "29:inviter",
      },
      options
    );
    expect(lookup).toHaveBeenCalledWith("join-activity");
  });

  it("caches Graph channel context from the team-install payload", async () => {
    await adapter.receive(activity());
    expect(chat.getState().set).toHaveBeenCalledWith(
      `teams:channelContext:${conversationId}`,
      JSON.stringify({ teamId: "team-aad", channelId: conversationId }),
      expect.any(Number)
    );
  });

  it("dispatches group-chat joins without channelData", async () => {
    const body = activity();
    await adapter.receive({
      ...body,
      conversation: {
        id: "group-chat",
        conversationType: "groupChat",
        isGroup: true,
      },
      channelData: undefined,
    });
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: adapter.encodeThreadId({
          conversationId: "group-chat",
          conversationType: "groupChat",
          serviceUrl,
        }),
        userId: botId,
      }),
      options
    );
  });

  it("uses group metadata when conversationType is absent", async () => {
    const body = activity();
    await adapter.receive({
      ...body,
      conversation: { ...body.conversation, conversationType: undefined },
    });
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledOnce();
  });

  it("falls back to the 19: prefix when the conversation type is unresolved", async () => {
    await adapter.receive({
      ...activity(),
      conversation: { id: "19:unknown@thread.tacv2" },
      channelData: undefined,
    });
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        channelId: adapter.encodeThreadId({
          conversationId: "19:unknown@thread.tacv2",
          serviceUrl,
        }),
        userId: botId,
      }),
      options
    );
  });

  it("matches the bot identity regardless of app ID casing", async () => {
    const upperAppId = appId.toUpperCase();
    const upper = new JoinAdapter({
      appId: upperAppId,
      appPassword: "test",
      logger,
    });
    upper.stubWebhookOptions(options);
    await upper.initialize(chat);

    await upper.receive(activity());
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: `28:${upperAppId}` }),
      options
    );
    expect(upper.botUserId).toBe(`28:${upperAppId}`);
  });

  it.each([
    { membersAdded: [{ id: "29:user" }] },
    { membersAdded: [] },
    { membersAdded: undefined, membersRemoved: [{ id: botId }] },
    { recipient: { id: "28:other-app" } },
    { conversation: { id: "personal", conversationType: "personal" } },
    { conversation: { id: "a:unknown" } },
    { conversation: { id: "", conversationType: "channel" } },
    { serviceUrl: "" },
    { type: "installationUpdate", action: "add" },
    { type: "installationUpdate", action: "remove" },
  ])("does not emit a bot join for %j", async (overrides) => {
    const response = await adapter.receive({ ...activity(), ...overrides });
    expect(response.status).toBe(200);
    expect(chat.processMemberJoinedChannel).not.toHaveBeenCalled();
  });

  it("logs the skip reason at debug level", async () => {
    await adapter.receive({
      ...activity(),
      membersAdded: [{ id: "29:user" }],
    });
    expect(logger.debug).toHaveBeenCalledWith(
      "Ignoring conversationUpdate",
      expect.objectContaining({
        activityId: "join-activity",
        reason: "bot was not among the added members",
      })
    );
  });

  it("warns instead of silently dropping joins when no app ID is configured", async () => {
    vi.stubEnv("TEAMS_APP_ID", "");
    const unconfigured = new JoinAdapter({ appPassword: "test", logger });
    unconfigured.stubWebhookOptions(options);
    await unconfigured.initialize(chat);
    expect(unconfigured.botUserId).toBeUndefined();

    await unconfigured.receive(activity());
    expect(chat.processMemberJoinedChannel).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("TEAMS_APP_ID")
    );
  });

  it("dispatches only the bot when several members are added", async () => {
    await adapter.receive({
      ...activity(),
      membersAdded: [{ id: "29:user" }, { id: botId }, { id: botId }],
    });
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledOnce();
  });

  it("passes handleWebhook options to the join through the bridge", async () => {
    const runtime = new JoinAdapter({ appId, appPassword: "test", logger });
    runtime.allowUnauthenticatedWebhooks();
    await runtime.initialize(chat);
    const webhookOptions: WebhookOptions = { waitUntil: vi.fn() };

    const response = await runtime.handleWebhook(
      new Request("https://example.com/api/webhooks/teams", {
        method: "POST",
        body: JSON.stringify(activity()),
        headers: { "content-type": "application/json" },
      }),
      webhookOptions
    );

    expect(response.status).toBe(200);
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: botId }),
      webhookOptions
    );
  });

  it("runs an asynchronous welcome handler using the existing channel API", async () => {
    const runtime = new JoinAdapter({ appId, appPassword: "test", logger });
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (task: Promise<unknown>) => tasks.push(task);
    runtime.stubWebhookOptions({ waitUntil });
    const send = runtime.stubOutbound();
    const bot = new Chat({
      userName: "test",
      adapters: { teams: runtime },
      state: createMockState(),
      logger,
    });
    let received: MemberJoinedChannelEvent | undefined;
    const handler = vi.fn(async (event: MemberJoinedChannelEvent) => {
      received = event;
      await Promise.resolve();
      await bot.channel(event.channelId).post("Welcome");
    });
    bot.onMemberJoinedChannel(handler);
    await bot.initialize();

    await runtime.receive(activity());
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(handler).toHaveBeenCalledOnce();
    expect(received?.userId).toBe(botId);
    expect(received?.adapter.botUserId).toBe(botId);
    expect(send).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ text: "Welcome" })
    );
  });
});
