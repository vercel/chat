/**
 * Replay tests for Telegram webhook flows.
 *
 * These tests replay Telegram webhook payloads recorded from real interactions
 * to verify subscribed-thread behavior for mention and non-mention messages.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createTelegramAdapter,
  type TelegramAdapter,
} from "@chat-adapter/telegram";
import { Chat, type Logger, type Message, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/replay/telegram.json";
import {
  createMockTelegramApi,
  createTelegramWebhookRequest,
  type MockTelegramApi,
  setupTelegramFetchMock,
  TELEGRAM_BOT_TOKEN,
} from "./telegram-utils";
import { createWaitUntilTracker } from "./test-scenarios";

interface CapturedMessages {
  followUpMessage: Message | null;
  followUpThread: Thread | null;
  mentionMessage: Message | null;
  mentionThread: Thread | null;
}

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

describe("Replay Tests - Telegram", () => {
  let adapter: TelegramAdapter;
  let captured: CapturedMessages;
  let chat: Chat<{ telegram: TelegramAdapter }>;
  let cleanupFetchMock: (() => void) | undefined;
  let mockApi: MockTelegramApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockTelegramApi();
    cleanupFetchMock = setupTelegramFetchMock(mockApi, {
      botUserId: fixtures.botUserId,
      userName: fixtures.botName,
    });

    adapter = createTelegramAdapter({
      botToken: TELEGRAM_BOT_TOKEN,
      logger: mockLogger,
      userName: fixtures.botName,
    });

    chat = new Chat({
      adapters: { telegram: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: fixtures.botName,
    });

    captured = {
      followUpMessage: null,
      followUpThread: null,
      mentionMessage: null,
      mentionThread: null,
    };

    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      captured.mentionThread = thread;
      await thread.subscribe();
      await thread.post("Thanks for mentioning me!");
    });

    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      captured.followUpThread = thread;

      // Matches the Telegram-aware gating used in the example app.
      if (!(thread.adapter.name === "telegram" || message.isMention)) {
        return;
      }

      await thread.post("Thanks for your message!");
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanupFetchMock?.();
  });

  async function sendWebhook(payload: unknown): Promise<void> {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.telegram(createTelegramWebhookRequest(payload), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();
  }

  it("replays mention webhook and subscribes thread", async () => {
    await sendWebhook(fixtures.mention);

    expect(captured.mentionMessage).not.toBeNull();
    expect(captured.mentionMessage?.text).toContain("@vercelchatsdkbot");
    expect(captured.mentionMessage?.isMention).toBe(true);

    expect(captured.mentionThread).not.toBeNull();
    expect(captured.mentionThread?.id).toBe("telegram:7527593");
    expect(captured.mentionThread?.adapter.name).toBe("telegram");

    expect(mockApi.sentMessages).toContainEqual(
      expect.objectContaining({
        chatId: 7527593,
        text: expect.stringContaining("Thanks for mentioning me"),
      })
    );
  });

  it("replays non-mention follow-up in subscribed thread", async () => {
    await sendWebhook(fixtures.mention);
    mockApi.clearMocks();

    await sendWebhook(fixtures.followUp);

    expect(captured.followUpMessage).not.toBeNull();
    expect(captured.followUpMessage?.text).toBe("how are you");
    expect(captured.followUpMessage?.isMention).toBe(false);
    expect(captured.followUpThread?.id).toBe("telegram:7527593");

    expect(mockApi.sentMessages).toContainEqual(
      expect.objectContaining({
        chatId: 7527593,
        text: expect.stringContaining("Thanks for your message"),
      })
    );
  });
});
