import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createTelegramAdapter,
  type TelegramAdapter,
  type TelegramMessage,
} from "@chat-adapter/telegram";
import { Chat, type Message, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockTelegramApi,
  createTelegramWebhookRequest,
  type MockTelegramApi,
  setupTelegramFetchMock,
  TELEGRAM_BOT_TOKEN,
} from "./telegram-utils";
import { createWaitUntilTracker } from "./test-scenarios";

describe("Telegram reply mention routing", () => {
  const bot = { id: 8000000001, is_bot: true, first_name: "Bot" };
  const user = { id: 100000001, is_bot: false, first_name: "User" };
  const group = { id: -1001000000001, type: "supergroup" as const };
  let chat: Chat<{ telegram: TelegramAdapter }>;
  let api: MockTelegramApi;
  let cleanup: () => void;

  beforeEach(() => {
    vi.stubEnv("TELEGRAM_MENTION_ON_REPLY", "false");
    api = createMockTelegramApi();
    cleanup = setupTelegramFetchMock(api, {
      botUserId: String(bot.id),
      userName: "testbot",
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanup();
    vi.unstubAllEnvs();
  });

  it.each([
    { name: "ordinary supergroup reply", enabled: true, addressed: true },
    { name: "disabled reply mentions", enabled: false, addressed: false },
    { name: "default reply mentions", addressed: false },
    {
      name: "another user's reply",
      enabled: true,
      sender: user,
      addressed: false,
    },
    {
      name: "the bot's own reply",
      enabled: true,
      author: bot,
      addressed: false,
    },
    {
      name: "implicit forum reply",
      enabled: true,
      topic: true,
      addressed: false,
    },
    {
      name: "explicit forum reply",
      enabled: true,
      topic: true,
      target: 42,
      addressed: true,
    },
    {
      name: "explicit mention on the topic root",
      enabled: true,
      topic: true,
      text: "@testbot hello",
      addressed: true,
    },
    {
      name: "photo-only reply",
      enabled: true,
      text: "",
      photo: [
        { file_id: "photo", file_unique_id: "unique", width: 10, height: 10 },
      ],
      addressed: true,
    },
  ])("routes $name", async (scenario) => {
    const adapter = createTelegramAdapter({
      botToken: TELEGRAM_BOT_TOKEN,
      mode: "webhook",
      secretToken: "test-secret",
      ...(scenario.enabled === undefined
        ? {}
        : { mentionOnReply: scenario.enabled }),
    });
    chat = new Chat({
      adapters: { telegram: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: "testbot",
    });
    const handler = vi.fn(async (thread: Thread, message: Message) => {
      expect(message.isMention).toBe(true);
      expect(thread.id).toBe(`telegram:${group.id}:5`);
      const posted = await thread.post("reply");
      expect(posted.threadId).toBe(thread.id);
    });
    chat.onNewMention(handler);
    const message: TelegramMessage = {
      message_id: 108,
      date: 1756290000,
      chat: group,
      from: scenario.author ?? user,
      message_thread_id: 5,
      text: scenario.text ?? "and the second one?",
      ...(scenario.topic ? { is_topic_message: true } : {}),
      ...(scenario.photo ? { photo: scenario.photo } : {}),
      reply_to_message: {
        message_id: scenario.target ?? 5,
        date: 1756289940,
        chat: group,
        from: scenario.sender ?? bot,
        text: "first option",
      },
    };
    const tracker = createWaitUntilTracker();
    const request = createTelegramWebhookRequest({ update_id: 1, message });
    request.headers.set("x-telegram-bot-api-secret-token", "test-secret");
    const response = await chat.webhooks.telegram(request, {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(scenario.addressed ? 1 : 0);
    expect(api.calls.filter(({ method }) => method === "sendMessage")).toEqual(
      scenario.addressed
        ? [
            expect.objectContaining({
              payload: expect.objectContaining({
                chat_id: String(group.id),
                message_thread_id: 5,
                text: "reply",
              }),
            }),
          ]
        : []
    );
  });
});
