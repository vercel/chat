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
// A 2000 ms default wait polled every 150 ms: reads at 0, 150, ..., 1950, 2000.
const DEFAULT_WAIT_READS = 15;
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

function selfMessageEvent() {
  return { ...messageEvent(), user: BASE_CONFIG.botUserId };
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

type MockState = ReturnType<typeof createMockState>;

function moveClockBackOnFirstUnfurlRead(state: MockState) {
  let clockMoved = false;
  vi.mocked(state.get).mockImplementation(async (key) => {
    if (key === UNFURL_KEY && !clockMoved) {
      vi.setSystemTime(Date.now() - 60_000);
      clockMoved = true;
    }
    return state.cache.get(key) ?? null;
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
    for (const create of [
      () => createSlackAdapter(config),
      () => new SlackAdapter(config),
    ]) {
      expect(create).toThrow(ValidationError);
      expect(create).toThrow("unfurlWaitMs must be a finite, nonnegative");
    }
  });

  it.each([null, "0"])("rejects a nonnumeric wait of %s", (unfurlWaitMs) => {
    const config = {
      ...BASE_CONFIG,
      unfurlWaitMs: unfurlWaitMs as unknown as number,
    };
    for (const create of [
      () => createSlackAdapter(config),
      () => new SlackAdapter(config),
    ]) {
      expect(create).toThrow(ValidationError);
      expect(create).toThrow("unfurlWaitMs must be a finite, nonnegative");
    }
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
    moveClockBackOnFirstUnfurlRead(bot.state);
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.unfurlReads()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    await Promise.all(bot.pending);
  });

  it("keeps a configured deadline when the clock moves backward mid-poll", async () => {
    const bot = await createBot({ unfurlWaitMs: 25 });
    moveClockBackOnFirstUnfurlRead(bot.state);
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(24);

    expect(bot.unfurlReads()).toHaveLength(1);
    expect(bot.onMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bot.unfurlReads()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    await Promise.all(bot.pending);
  });

  it("skips the preview lookup for the bot's own message", async () => {
    const bot = await createBot();
    const response = await bot.deliver(selfMessageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(response.status).toBe(200);
    expect(bot.pending).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await Promise.all(bot.pending);
    expect(bot.unfurlReads()).toHaveLength(0);
  });

  it("skips the cache when the event attachment has a description but no title", async () => {
    const bot = await createBot();
    await bot.deliver({
      ...messageEvent(),
      attachments: [{ from_url: URL, text: "Event description" }],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.unfurlReads()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([
      { url: URL, description: "Event description" },
    ]);
    await Promise.all(bot.pending);
  });

  it("keeps event metadata and fills only bare links from the cache", async () => {
    const bot = await createBot();
    bot.state.cache.set(UNFURL_KEY, {
      [URL]: { title: "Cached title", description: "Cached description" },
      [PREVIOUS_URL]: {
        title: "Cached previous title",
        description: "Cached previous description",
        siteName: "Example",
      },
    });
    await bot.deliver({
      ...messageEvent(`<${URL}> <${PREVIOUS_URL}>`),
      attachments: [{ from_url: URL, text: "Event description" }],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.unfurlReads()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([
      { url: URL, description: "Event description" },
      {
        url: PREVIOUS_URL,
        title: "Cached previous title",
        description: "Cached previous description",
        siteName: "Example",
      },
    ]);
    await Promise.all(bot.pending);
  });

  it("returns bare links and logs a warning when the cache read fails", async () => {
    const bot = await createBot();
    const error = new Error("state unavailable");
    vi.mocked(bot.state.get).mockImplementation(async (key) => {
      if (key === UNFURL_KEY) {
        throw error;
      }
      return bot.state.cache.get(key) ?? null;
    });
    const warn = vi.mocked(mockLogger.warn);
    warn.mockClear();
    await bot.deliver(messageEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.unfurlReads()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onMessage).toHaveBeenCalledOnce();
    expect(bot.onMessage.mock.calls[0][1].links).toEqual([{ url: URL }]);
    const failures = warn.mock.calls.filter(
      ([message]) => message === "Failed to read cached link previews"
    );
    expect(failures).toHaveLength(1);
    expect(failures[0][1]).toEqual({
      channelId: CHANNEL,
      messageTs: MESSAGE_TS,
      error,
    });
    expect((failures[0][1] as { error: unknown }).error).toBe(error);
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

  it("waits once for an edit and reads the previous snapshot without polling", async () => {
    const bot = await createBot();
    const response = await bot.deliver(editEvent());

    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(1999);
    expect(bot.onEdit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onEdit).toHaveBeenCalledOnce();
    expect(bot.onEdit.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.onEdit.mock.calls[0][2].links).toEqual([{ url: PREVIOUS_URL }]);
    expect(bot.unfurlReads()).toHaveLength(DEFAULT_WAIT_READS + 1);
    await Promise.all(bot.pending);
  });

  it("enriches the previous snapshot from a cached preview", async () => {
    const bot = await createBot();
    bot.state.cache.set(UNFURL_KEY, {
      [PREVIOUS_URL]: {
        title: "Previous title",
        description: "Previous description",
      },
    });
    await bot.deliver(editEvent());
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.unfurlReads()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(bot.onEdit).toHaveBeenCalledOnce();
    expect(bot.onEdit.mock.calls[0][1].links).toEqual([{ url: URL }]);
    expect(bot.onEdit.mock.calls[0][2].links).toEqual([
      {
        url: PREVIOUS_URL,
        title: "Previous title",
        description: "Previous description",
      },
    ]);
    await Promise.all(bot.pending);
  });
});
