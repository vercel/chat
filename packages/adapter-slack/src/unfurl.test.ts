/** Tests for unfurl polling through signed Slack webhooks and Chat handlers. */

import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import { createMockState, mockLogger } from "@chat-adapter/tests";
import { Chat } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlackAdapter, SlackAdapter } from "./index";
import type { SlackAdapterConfig } from "./types";

const SIGNING_SECRET = "test-signing-secret";
const CHANNEL = "C123";
const MESSAGE_TS = "1234567890.123456";
const URL = "https://example.com/article";
const PREVIOUS_URL = "https://example.com/previous";
const UNFURL_KEY = `slack:unfurls:${CHANNEL}:${MESSAGE_TS}`;
const BASE_CONFIG: SlackAdapterConfig = {
  botToken: "xoxb-test-token",
  botUserId: "U_BOT",
  signingSecret: SIGNING_SECRET,
  logger: mockLogger,
};
const shutdownBots: (() => Promise<void>)[] = [];

function messageEvent(text = `<${URL}>`) {
  return {
    type: "message",
    channel: CHANNEL,
    ts: MESSAGE_TS,
    user: "U_USER",
    username: "testuser",
    text,
  };
}

function editEvent() {
  return {
    type: "message",
    subtype: "message_changed",
    hidden: true,
    channel: CHANNEL,
    ts: "1234567891.000000",
    message: {
      ...messageEvent(),
      edited: { user: "U_USER", ts: "1234567891.000000" },
    },
    previous_message: messageEvent(`<${PREVIOUS_URL}>`),
  };
}

function unfurlEvent() {
  return {
    type: "message",
    subtype: "message_changed",
    hidden: true,
    channel: CHANNEL,
    ts: "1234567891.000000",
    message: {
      ...messageEvent(),
      attachments: [
        {
          from_url: URL,
          title: "Example article",
          text: "Article description",
        },
      ],
    },
  };
}

function webhookRequest(event: Record<string, unknown>): Request {
  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T123",
    event,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": `v0=${signature}`,
    },
    body,
  });
}

async function createBot(config: Partial<SlackAdapterConfig> = {}) {
  const state = createMockState();
  const adapter = createSlackAdapter({ ...BASE_CONFIG, ...config });
  const bot = new Chat({
    userName: "testbot",
    adapters: { slack: adapter },
    state,
    logger: mockLogger,
  });
  const onMessage = vi.fn();
  const onEdit = vi.fn();
  bot.onNewMessage(onMessage);
  bot.onMessageUpdated(onEdit);
  await bot.initialize();
  shutdownBots.push(async () => await bot.shutdown());

  const pending: Promise<unknown>[] = [];
  return {
    adapter,
    onMessage,
    onEdit,
    state,
    pending,
    unfurlReads: () =>
      vi.mocked(state.get).mock.calls.filter(([key]) => key === UNFURL_KEY),
    deliver: async (event: Record<string, unknown>) =>
      await adapter.handleWebhook(webhookRequest(event), {
        waitUntil: (task) => pending.push(task),
      }),
  };
}

describe("unfurlWaitMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    await Promise.all(
      shutdownBots.splice(0).map(async (shutdown) => await shutdown())
    );
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects an invalid wait of %s through the factory and constructor", (unfurlWaitMs) => {
    const config = { ...BASE_CONFIG, unfurlWaitMs };
    expect(() => createSlackAdapter(config)).toThrow(ValidationError);
    expect(() => new SlackAdapter(config)).toThrow(ValidationError);
  });

  it.each([null, "0"])("rejects a nonnumeric wait of %s", (unfurlWaitMs) => {
    const config = {
      ...BASE_CONFIG,
      unfurlWaitMs: unfurlWaitMs as unknown as number,
    };
    expect(() => createSlackAdapter(config)).toThrow(ValidationError);
    expect(() => new SlackAdapter(config)).toThrow(ValidationError);
  });

  it.each([0, 0.5, 25, 2000])("accepts a finite wait of %s", (unfurlWaitMs) => {
    expect(() =>
      createSlackAdapter({ ...BASE_CONFIG, unfurlWaitMs })
    ).not.toThrow();
  });

  it("acknowledges the webhook before the default wait and waits once for multiple links", async () => {
    const bot = await createBot();
    const response = await bot.deliver(
      messageEvent(`<${URL}> <${PREVIOUS_URL}>`)
    );

    expect(response.status).toBe(200);
    expect(bot.pending).toHaveLength(1);
    expect(bot.onMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1999);
    expect(bot.onMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([
      { url: URL },
      { url: PREVIOUS_URL },
    ]);
    await Promise.all(bot.pending);
  });

  it("reads the cache once without waiting when disabled", async () => {
    const bot = await createBot({ unfurlWaitMs: 0 });
    const response = await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(response.status).toBe(200);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.unfurlReads()).toHaveLength(1);
    await Promise.all(bot.pending);
  });

  it("does not poll when the clock moves backward during a cache-only read", async () => {
    const bot = await createBot({ unfurlWaitMs: 0 });
    let clockMoved = false;
    vi.mocked(bot.state.get).mockImplementation(async (key) => {
      if (key === UNFURL_KEY && !clockMoved) {
        vi.setSystemTime(Date.now() - 60_000);
        clockMoved = true;
        return null;
      }
      return bot.state.cache.get(key) ?? null;
    });
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.unfurlReads()).toHaveLength(1);
    await Promise.all(bot.pending);
  });

  it("preserves environment authentication when only the wait is configured", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-env-test-token");
    vi.stubEnv("SLACK_SIGNING_SECRET", SIGNING_SECRET);
    const bot = await createBot({
      botToken: undefined,
      signingSecret: undefined,
      unfurlWaitMs: 0,
    });
    const response = await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.adapter.webClient.token).toBe("xoxb-env-test-token");
    expect(response.status).toBe(200);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.unfurlReads()).toHaveLength(1);
    await Promise.all(bot.pending);
  });

  it("uses cached metadata when waiting is disabled", async () => {
    const bot = await createBot({ unfurlWaitMs: 0 });
    await bot.deliver(unfurlEvent());
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.onEdit).not.toHaveBeenCalled();
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([
      expect.objectContaining({
        url: URL,
        title: "Example article",
        description: "Article description",
      }),
    ]);
    expect(bot.unfurlReads()).toHaveLength(1);
    await Promise.all(bot.pending);
  });

  it.each([
    25, 225,
  ])("stops polling at a configured %s ms deadline", async (unfurlWaitMs) => {
    const bot = await createBot({ unfurlWaitMs });
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(unfurlWaitMs - 1);
    expect(bot.onMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    await Promise.all(bot.pending);
  });

  it("uses an unfurl delivered while the message is waiting", async () => {
    const bot = await createBot();
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(100);
    expect(bot.onMessage).not.toHaveBeenCalled();
    await bot.deliver(unfurlEvent());
    await vi.advanceTimersByTimeAsync(50);

    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links[0].title).toBe(
      "Example article"
    );
    expect(bot.onEdit).not.toHaveBeenCalled();
    expect(bot.unfurlReads()).toHaveLength(2);
    await Promise.all(bot.pending);
  });

  it("parses both edit snapshots without waiting when disabled", async () => {
    const bot = await createBot({ unfurlWaitMs: 0 });
    const response = await bot.deliver(editEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(response.status).toBe(200);
    expect(bot.onEdit).toHaveBeenCalledOnce();
    expect(bot.onEdit.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.onEdit.mock.calls[0][2].links).toEqual([{ url: PREVIOUS_URL }]);
    expect(bot.unfurlReads()).toHaveLength(2);
    expect(bot.onMessage).not.toHaveBeenCalled();
    await Promise.all(bot.pending);
  });

  it("preserves the default wait for both edit snapshots", async () => {
    const bot = await createBot();
    const response = await bot.deliver(editEvent());

    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(3999);
    expect(bot.onEdit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bot.onEdit).toHaveBeenCalledOnce();
    expect(bot.onEdit.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.onEdit.mock.calls[0][2].links).toEqual([{ url: PREVIOUS_URL }]);
    await Promise.all(bot.pending);
  });

  it("does not read the unfurl cache for a message without links", async () => {
    const bot = await createBot();
    await bot.deliver(messageEvent("hello"));
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([]);
    expect(bot.unfurlReads()).toHaveLength(0);
    await Promise.all(bot.pending);
  });

  it("does not wait when the message already contains preview metadata", async () => {
    const bot = await createBot();
    await bot.deliver({
      ...messageEvent(),
      attachments: [{ from_url: URL, title: "Attached title" }],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links[0].title).toBe(
      "Attached title"
    );
    expect(bot.unfurlReads()).toHaveLength(0);
    await Promise.all(bot.pending);
  });

  it("delivers bare links when the unfurl cache read fails", async () => {
    const bot = await createBot();
    vi.mocked(bot.state.get).mockImplementation(async (key) => {
      if (key === UNFURL_KEY) {
        throw new Error("Unfurl cache unavailable");
      }
      return bot.state.cache.get(key) ?? null;
    });
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.unfurlReads()).toHaveLength(1);
    await Promise.all(bot.pending);
  });
});
