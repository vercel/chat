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

class JoinAdapter extends TeamsAdapter {
  prepare(options?: WebhookOptions) {
    vi.spyOn(this.app.api.users, "getToken").mockResolvedValue({});
    const send = vi.spyOn(this.app, "send").mockResolvedValue({
      id: "welcome",
      type: "message",
    });
    const lookup = vi
      .spyOn(this.bridgeAdapter, "getWebhookOptions")
      .mockReturnValue(options);
    return { send, lookup };
  }

  receive(body: { type: string; [key: string]: unknown }) {
    return this.app.process({
      body,
      token: {
        appId,
        serviceUrl,
        from: "azure",
        fromId: appId,
        isExpired: () => false,
        toString: () => "test-token",
      },
    });
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
  let mocks: ReturnType<JoinAdapter["prepare"]>;

  beforeEach(async () => {
    adapter = new JoinAdapter({ appId, appPassword: "test", logger });
    chat = createMockChatInstance();
    options = { waitUntil: vi.fn() };
    mocks = adapter.prepare(options);
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
    expect(mocks.lookup).toHaveBeenCalledWith("join-activity");
    expect(chat.getState().set).toHaveBeenCalledWith(
      "teams:serviceUrl:29:inviter",
      serviceUrl,
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

  it.each([
    { membersAdded: [{ id: "29:user" }] },
    { membersAdded: [] },
    { membersAdded: undefined, membersRemoved: [{ id: botId }] },
    { recipient: { id: "28:other-app" } },
    { conversation: { id: "personal", conversationType: "personal" } },
    { conversation: { id: "19:unknown" } },
    { conversation: { id: "", conversationType: "channel" } },
    { serviceUrl: "" },
    { type: "installationUpdate", action: "add" },
    { type: "installationUpdate", action: "remove" },
  ])("does not emit a bot join for %j", async (overrides) => {
    const response = await adapter.receive({ ...activity(), ...overrides });
    expect(response.status).toBe(200);
    expect(chat.processMemberJoinedChannel).not.toHaveBeenCalled();
  });

  it("dispatches only the bot when several members are added", async () => {
    await adapter.receive({
      ...activity(),
      membersAdded: [{ id: "29:user" }, { id: botId }, { id: botId }],
    });
    expect(chat.processMemberJoinedChannel).toHaveBeenCalledOnce();
  });

  it("runs an asynchronous welcome handler using the existing channel API", async () => {
    const runtime = new JoinAdapter({ appId, appPassword: "test", logger });
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (task: Promise<unknown>) => tasks.push(task);
    const { send } = runtime.prepare({ waitUntil });
    const bot = new Chat({
      userName: "test",
      adapters: { teams: runtime },
      state: createMockState(),
      logger,
    });
    const handler = vi.fn(async (event: MemberJoinedChannelEvent) => {
      expect(event.userId).toBe(event.adapter.botUserId);
      await Promise.resolve();
      await bot.channel(event.channelId).post("Welcome");
    });
    bot.onMemberJoinedChannel(handler);
    await bot.initialize();

    await runtime.receive(activity());
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(handler).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ text: "Welcome" })
    );
  });
});
