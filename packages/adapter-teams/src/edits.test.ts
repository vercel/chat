import { createMockChatInstance, createMockLogger } from "@chat-adapter/tests";
import type { Message, WebhookOptions } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appId, botId, serviceUrl, TestTeamsAdapter } from "./test-utils";

const conversationId = "19:channel@thread.tacv2;messageid=1766459963017";
const logger = createMockLogger();

function edit(eventType: string, entities: unknown[] = []) {
  return {
    type: "messageUpdate",
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

  beforeEach(async () => {
    adapter = new TestTeamsAdapter({ appId, appPassword: "test", logger });
    chat = createMockChatInstance();
    options = { waitUntil: vi.fn() };
    adapter.stubWebhookOptions(options);
    vi.spyOn(adapter, "getUser").mockResolvedValue(null);
    await adapter.initialize(chat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function updated() {
    const calls = vi.mocked(chat.processMessageUpdated).mock.calls;
    return calls.map(([event, eventOptions]) => ({
      ...(event as { message: Message; threadId: string }),
      options: eventOptions,
    }));
  }

  it("dispatches an edited message through the SDK router as a message update", async () => {
    const response = await adapter.receive(
      edit("editMessage", [mentionOf(botId)])
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    const [update] = updated();
    expect(updated()).toHaveLength(1);
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
    expect(updated()[0]?.message.isMention).toBe(false);
  });

  it("ignores an undelete", async () => {
    await adapter.receive(edit("undeleteMessage", [mentionOf(botId)]));
    expect(chat.processMessageUpdated).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});
