import { createMockChatInstance, createMockLogger } from "@chat-adapter/tests";
import type { Message, WebhookOptions } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appId, botId, serviceUrl, TestTeamsAdapter } from "./test-utils";

const conversationId = "19:channel@thread.tacv2;messageid=1766459963017";
const logger = createMockLogger();

function edit(
  eventType: string,
  entities: unknown[] = [],
  type = "messageUpdate"
) {
  return {
    type,
    id: "1766459963017",
    timestamp: "2025-12-23T03:21:02.000Z",
    channelId: "msteams",
    serviceUrl,
    text: "<at>Chat SDK Demo</at> can you check this?",
    from: { id: "29:user", name: "Test User" },
    recipient: { id: botId },
    conversation: {
      id: conversationId,
      conversationType: "channel",
      isGroup: true,
      tenantId: "tenant",
    },
    entities,
    channelData: { eventType, tenant: { id: "tenant" } },
  };
}

const mentionOf = (id: string) => ({
  type: "mention",
  mentioned: { id, name: "Chat SDK Demo" },
  text: "<at>Chat SDK Demo</at>",
});

describe("Teams message edits", () => {
  let adapter: TestTeamsAdapter;
  let chat: ReturnType<typeof createMockChatInstance>;
  let options: WebhookOptions;
  let optionsStub: ReturnType<TestTeamsAdapter["stubWebhookOptions"]>;

  beforeEach(async () => {
    adapter = new TestTeamsAdapter({ appId, appPassword: "test", logger });
    chat = createMockChatInstance();
    options = { waitUntil: vi.fn() };
    optionsStub = adapter.stubWebhookOptions(options);
    vi.spyOn(adapter, "getUser").mockResolvedValue(null);
    await adapter.initialize(chat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function updated() {
    const calls = vi.mocked(chat.processMessageUpdated).mock.calls;
    return Promise.all(
      calls.map(async ([event, eventOptions]) => {
        const { message, ...rest } = event as {
          message: () => Promise<Message>;
          threadId: string;
        };
        return { ...rest, message: await message(), options: eventOptions };
      })
    );
  }

  it("dispatches an edited message through the SDK router as a message update", async () => {
    const response = await adapter.receive(
      edit("editMessage", [mentionOf(botId)])
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    const updates = await updated();
    expect(updates).toHaveLength(1);
    const [update] = updates;
    expect(update?.threadId).toBe(
      adapter.encodeThreadId({
        conversationId,
        conversationType: "channel",
        serviceUrl,
      })
    );
    expect(update?.options).toBe(options);
    expect(update?.message.id).toBe("1766459963017");
    expect(update?.message.text).toBe("@Chat SDK Demo can you check this?");
    expect(update?.message.isMention).toBe(true);
    expect(update?.message.metadata.edited).toBe(true);
    expect(update?.message.metadata.editedAt).toEqual(
      new Date("2025-12-23T03:21:02.000Z")
    );
    expect(update).not.toHaveProperty("previousMessage");
  });

  it("marks an edit that mentions only another bot as not a mention", async () => {
    await adapter.receive(edit("editMessage", [mentionOf("28:other-app")]));
    expect((await updated())[0]?.message.isMention).toBe(false);
  });

  it("hydrates the editor's email", async () => {
    vi.mocked(chat.getState().get).mockImplementation(async (key: string) =>
      key === "teams:userInfo:aad-user"
        ? JSON.stringify({ email: "alice@contoso.com", fullName: "Alice" })
        : null
    );
    const body = edit("editMessage", [mentionOf(botId)]);
    await adapter.receive({
      ...body,
      from: { ...body.from, aadObjectId: "aad-user" },
    });
    expect((await updated())[0]?.message.author.email).toBe(
      "alice@contoso.com"
    );
  });

  it("keeps each request's webhook options when an edit reuses its message's id", async () => {
    optionsStub.mockRestore();
    adapter.allowUnauthenticatedWebhooks();
    let parked: () => void = () => {};
    let resume: (user: null) => void = () => {};
    const reached = new Promise<void>((resolve) => {
      parked = resolve;
    });
    vi.mocked(adapter.getUser).mockImplementationOnce(() => {
      parked();
      return new Promise((resolve) => {
        resume = resolve;
      });
    });
    const request = (body: unknown) =>
      new Request("https://example.com/api/webhooks/teams", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
    const messageOptions: WebhookOptions = { waitUntil: vi.fn() };
    const editOptions: WebhookOptions = { waitUntil: vi.fn() };

    // The original message waits on its sender lookup while the edit is handled.
    const original = adapter.handleWebhook(
      request(edit("", [mentionOf(botId)], "message")),
      messageOptions
    );
    await reached;
    await adapter.handleWebhook(
      request(edit("editMessage", [mentionOf(botId)])),
      editOptions
    );
    resume(null);
    await original;

    expect((await updated())[0]?.options).toBe(editOptions);
    expect(vi.mocked(chat.processMessage).mock.calls[0]?.[3]).toBe(
      messageOptions
    );
  });

  it("ignores an undelete", async () => {
    await adapter.receive(edit("undeleteMessage", [mentionOf(botId)]));
    expect(chat.processMessageUpdated).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});
