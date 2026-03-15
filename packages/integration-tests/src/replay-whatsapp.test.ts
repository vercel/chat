/**
 * Replay tests for WhatsApp webhook flows.
 *
 * These tests replay WhatsApp webhook payloads recorded from real interactions
 * to verify DM handling, message history, and channel operations.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createWhatsAppAdapter,
  type WhatsAppAdapter,
} from "@chat-adapter/whatsapp";
import {
  type Channel,
  Chat,
  type Logger,
  type Message,
  type Thread,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/replay/dm/whatsapp.json";
import { createWaitUntilTracker } from "./test-scenarios";
import {
  createMockWhatsAppApi,
  createWhatsAppWebhookRequest,
  type MockWhatsAppApi,
  setupWhatsAppFetchMock,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
} from "./whatsapp-utils";

interface CapturedDM {
  channel: Channel | null;
  message: Message | null;
  thread: Thread | null;
}

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

describe("Replay Tests - WhatsApp DM", () => {
  let adapter: WhatsAppAdapter;
  let captured: CapturedDM;
  let chat: Chat<{ whatsapp: WhatsAppAdapter }>;
  let cleanupFetchMock: (() => void) | undefined;
  let mockApi: MockWhatsAppApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockWhatsAppApi();
    cleanupFetchMock = setupWhatsAppFetchMock(mockApi, {
      phoneNumberId: fixtures.phoneNumberId,
    });

    adapter = createWhatsAppAdapter({
      accessToken: WHATSAPP_ACCESS_TOKEN,
      appSecret: WHATSAPP_APP_SECRET,
      phoneNumberId: fixtures.phoneNumberId,
      verifyToken: WHATSAPP_VERIFY_TOKEN,
      userName: fixtures.botName,
      logger: mockLogger,
    });

    chat = new Chat({
      adapters: { whatsapp: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: fixtures.botName,
    });

    captured = {
      channel: null,
      message: null,
      thread: null,
    };

    chat.onDirectMessage(async (thread, message, channel) => {
      captured.thread = thread;
      captured.message = message;
      captured.channel = channel;
      await channel.post(`Echo: ${message.text}`);
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanupFetchMock?.();
  });

  async function sendWebhook(payload: unknown): Promise<void> {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.whatsapp(createWhatsAppWebhookRequest(payload), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();
  }

  it("should parse a DM webhook and call the DM handler", async () => {
    await sendWebhook(fixtures.firstMessage);

    expect(captured.message).not.toBeNull();
    expect(captured.message?.text).toBe("What is Vercel?");
    expect(captured.message?.author.fullName).toBe("Test User");
    expect(captured.message?.author.userId).toBe("15550002222");
    expect(captured.message?.author.isBot).toBe(false);
    expect(captured.message?.author.isMe).toBe(false);
  });

  it("should construct correct thread and channel IDs", async () => {
    await sendWebhook(fixtures.firstMessage);

    expect(captured.thread).not.toBeNull();
    expect(captured.thread?.id).toBe(
      `whatsapp:${fixtures.phoneNumberId}:15550002222`
    );
    expect(captured.thread?.isDM).toBe(true);
    expect(captured.thread?.adapter.name).toBe("whatsapp");

    // On WhatsApp, channel === thread (every DM is its own channel)
    expect(captured.channel).not.toBeNull();
    expect(captured.channel?.id).toBe(captured.thread?.id);
    expect(captured.channel?.isDM).toBe(true);
  });

  it("should send a response via the WhatsApp API", async () => {
    await sendWebhook(fixtures.firstMessage);

    expect(mockApi.sentMessages).toHaveLength(1);
    expect(mockApi.sentMessages[0].to).toBe("15550002222");
    expect(mockApi.sentMessages[0].text).toContain("Echo: What is Vercel?");
  });

  it("should ignore status update webhooks", async () => {
    await sendWebhook(fixtures.statusUpdate);

    expect(captured.message).toBeNull();
    expect(mockApi.sentMessages).toHaveLength(0);
  });

  it("should handle sequential DM messages", async () => {
    await sendWebhook(fixtures.firstMessage);
    expect(captured.message?.text).toBe("What is Vercel?");

    mockApi.clearMocks();
    captured.message = null;

    await sendWebhook(fixtures.secondMessage);
    expect((captured as CapturedDM).message?.text).toBe("Tell me more");
    expect(mockApi.sentMessages).toHaveLength(1);
    expect(mockApi.sentMessages[0].text).toContain("Echo: Tell me more");
  });

  it("should persist message history for DM threads", async () => {
    await sendWebhook(fixtures.firstMessage);
    mockApi.clearMocks();
    captured.message = null;

    await sendWebhook(fixtures.secondMessage);

    // The channel should have message history via the cache
    const channel = captured.channel;
    expect(channel).not.toBeNull();
    const messages: Message[] = [];
    if (channel) {
      for await (const msg of channel.messages) {
        messages.push(msg);
      }
    }
    // Should have: first user msg, bot reply, second user msg, bot reply
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });
});
