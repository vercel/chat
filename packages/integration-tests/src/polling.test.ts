import { createHash } from "node:crypto";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createTelegramAdapter,
  type TelegramUpdate,
} from "@chat-adapter/telegram";
import { Chat, ConsoleLogger, type Thread } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function message(id: number) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      text: "hello",
      chat: { id: 1, type: "private" },
      from: { id: 2, is_bot: false, first_name: "User" },
    },
  } satisfies TelegramUpdate;
}

function album() {
  return [1, 2].map((id) => ({
    update_id: id,
    message: {
      ...message(id).message,
      media_group_id: "album",
      photo: [
        {
          file_id: String(id),
          file_unique_id: String(id),
          width: 10,
          height: 10,
        },
      ],
    },
  }));
}

const checkpoint = `telegram:polling:${createHash("sha256").update("999").digest("hex")}`;

function fixture(
  updates: TelegramUpdate[],
  state = createMemoryState(),
  identity = 999,
  allowedUserIds?: string[]
) {
  const polls: { offset?: number; limit: number }[] = [];
  let deliver = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, options) => {
      const method = String(input).split("/").at(-1);
      let result: unknown = true;
      if (method === "getMe") {
        result = {
          id: identity,
          is_bot: true,
          first_name: "Bot",
          username: "bot",
        };
      }
      if (method === "getUpdates") {
        const payload = JSON.parse(String(options?.body)) as {
          offset?: number;
          limit: number;
          timeout: number;
        };
        polls.push(payload);
        const pending = updates
          .filter((update) => update.update_id >= (payload.offset ?? 0))
          .slice(0, payload.limit);
        if (pending.length === 0 && payload.timeout !== 0) {
          return new Promise<Response>((resolve, reject) => {
            const abort = () => {
              deliver = () => {};
              reject(new DOMException("Stopped", "AbortError"));
            };
            deliver = () => {
              const arrivals = updates
                .filter((update) => update.update_id >= (payload.offset ?? 0))
                .slice(0, payload.limit);
              if (arrivals.length > 0) {
                deliver = () => {};
                options?.signal?.removeEventListener("abort", abort);
                resolve(Response.json({ ok: true, result: arrivals }));
              }
            };
            if (options?.signal?.aborted) {
              abort();
            } else {
              options?.signal?.addEventListener("abort", abort, { once: true });
            }
          });
        }
        result = pending;
      }
      return Response.json({ ok: true, result });
    })
  );
  const adapter = createTelegramAdapter({
    botToken: "test-token",
    mode: "webhook",
    secretToken: "test-secret",
    allowedUserIds,
    logger: new ConsoleLogger("silent"),
  });
  const bot = new Chat({
    userName: "bot",
    adapters: { telegram: adapter },
    state,
    concurrency: "concurrent",
    logger: "silent",
  });
  return {
    bot,
    adapter,
    polls,
    state,
    deliver(update: TelegramUpdate) {
      updates.push(update);
      deliver();
    },
    async start(limit = 100, retryDelayMs = 10) {
      await bot.initialize();
      await adapter.startPolling({ limit, retryDelayMs, timeout: 1 });
    },
    async stop() {
      await adapter.stopPolling();
      await bot.shutdown();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Telegram polling admission", () => {
  const ordinary = message(1);
  const command: TelegramUpdate = {
    update_id: 1,
    message: {
      ...ordinary.message,
      text: "/help",
      entities: [{ type: "bot_command", offset: 0, length: 5 }],
    },
  };
  const action: TelegramUpdate = {
    update_id: 1,
    callback_query: {
      id: "callback",
      chat_instance: "instance",
      from: ordinary.message.from,
      message: ordinary.message,
      data: "approve",
    },
  };
  const reaction: TelegramUpdate = {
    update_id: 1,
    message_reaction: {
      chat: ordinary.message.chat,
      message_id: 1,
      date: 1,
      user: ordinary.message.from,
      old_reaction: [],
      new_reaction: [{ type: "custom_emoji", custom_emoji_id: "reaction" }],
    },
  };

  it.each([
    ["message", ordinary],
    ["command", command],
    ["action", action],
    ["reaction", reaction],
  ] as const)("processes beyond a full page despite a permanently failing %s", async (_name, update) => {
    const updates = [
      update,
      ...Array.from({ length: 100 }, (_, index) => ({
        ...message(index + 2),
        message: {
          ...message(index + 2).message,
          chat: { id: 2, type: "private" as const },
        },
      })),
      ...album().map((part) => ({
        ...part,
        update_id: part.update_id + 101,
        message: { ...part.message, chat: { id: 3, type: "private" as const } },
      })),
    ];
    const test = fixture(updates);
    const fail = vi.fn(() => {
      throw new Error("Forbidden: bot was blocked by the user");
    });
    const received: string[] = [];
    test.bot.onNewMention((thread) => {
      if (thread.id === "telegram:1") {
        fail();
      }
      received.push(thread.id);
    });
    test.bot.onSlashCommand(fail);
    test.bot.onAction(fail);
    test.bot.onReaction(fail);
    try {
      await test.start(100, 0);
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(104), {
        timeout: 3000,
      });
      await vi.waitFor(() => expect(received).toContain("telegram:3"), {
        timeout: 5000,
      });
      expect(received.filter((id) => id === "telegram:2")).toHaveLength(100);
      // The album handler runs before the loop saves the checkpoint that drops
      // it from pending, so wait for the save instead of reading right away.
      await vi.waitFor(
        async () =>
          expect(await test.state.get(checkpoint)).toMatchObject({
            offset: 104,
            pending: [{ update }],
          }),
        { timeout: 5000 }
      );
    } finally {
      await test.stop();
    }
  });

  it("does not acknowledge failed ordinary updates when saving their retry fails", async () => {
    const test = fixture([
      ordinary,
      {
        ...message(2),
        message: { ...message(2).message, chat: { id: 2, type: "private" } },
      },
    ]);
    const save = test.state.set.bind(test.state);
    let failing = true;
    vi.spyOn(test.state, "set").mockImplementation(async (key, value, ttl) => {
      if (key === checkpoint && failing) {
        throw new Error("Storage unavailable");
      }
      await save(key, value, ttl);
    });
    const handler = vi.fn((thread: Thread) => {
      if (thread.id === "telegram:1") {
        throw new Error("Reply failed");
      }
    });
    test.bot.onNewMention(handler);
    try {
      await test.start();
      await vi.waitFor(() => expect(test.polls.length).toBeGreaterThan(1));
      expect(test.polls.every((poll) => poll.offset === undefined)).toBe(true);
      expect(
        handler.mock.calls.filter(([thread]) => thread.id === "telegram:2")
      ).toHaveLength(1);
      failing = false;
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(3));
      expect(await test.state.get(checkpoint)).toMatchObject({
        offset: 3,
        pending: [{ update: ordinary }],
      });
    } finally {
      failing = false;
      await test.stop();
    }
  });

  it.each([
    ["message", ordinary],
    ["command", command],
    ["action", action],
    ["reaction", reaction],
  ] as const)("saves a failed %s before acknowledgement and retains it until retry succeeds", async (_name, update) => {
    const test = fixture([update]);
    const gate = deferred();
    const handler = vi.fn(async () => {
      if (handler.mock.calls.length === 1) {
        throw new Error("Admission failed");
      }
      await gate.promise;
    });
    test.bot.onNewMention(handler);
    test.bot.onSlashCommand(handler);
    test.bot.onAction(handler);
    test.bot.onReaction(handler);
    try {
      await test.start();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2), {
        timeout: 3000,
      });
      expect(test.polls.some((poll) => poll.offset === 2)).toBe(true);
      expect(await test.state.get(checkpoint)).toMatchObject({
        offset: 2,
        pending: [{ update }],
      });
      gate.resolve();
      await vi.waitFor(async () =>
        expect(await test.state.get(checkpoint)).toBeNull()
      );
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      gate.resolve();
      await test.stop();
    }
  });

  it("settles the entire batch before retrying and does not repeat successful updates", async () => {
    const test = fixture([message(1), { ...action, update_id: 2 }]);
    const gate = deferred();
    const failed = vi.fn().mockRejectedValueOnce(new Error("Admission failed"));
    const pending = vi.fn(() => gate.promise);
    test.bot.onNewMention(failed);
    test.bot.onAction(pending);
    try {
      await test.start();
      await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(test.polls).toHaveLength(1);
      gate.resolve();
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(3));
      await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2), {
        timeout: 3000,
      });
      expect(pending).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve();
      await test.stop();
    }
  });

  it.each([
    ["message", ordinary],
    ["command", command],
    ["action", action],
    ["reaction", reaction],
  ] as const)("recovers a saved failed %s after process loss", async (_name, update) => {
    const first = fixture([update]);
    const fail = vi.fn().mockRejectedValue(new Error("Admission failed"));
    first.bot.onNewMention(fail);
    first.bot.onSlashCommand(fail);
    first.bot.onAction(fail);
    first.bot.onReaction(fail);
    let saved: unknown;
    try {
      await first.start();
      await vi.waitFor(() => expect(first.polls.at(-1)?.offset).toBe(2));
      saved = await first.state.get(checkpoint);
      expect(saved).toMatchObject({ offset: 2, pending: [{ update }] });
    } finally {
      await first.stop();
    }
    const state = createMemoryState();
    await state.connect();
    await state.set(checkpoint, JSON.parse(JSON.stringify(saved)));
    await state.set("dedupe:telegram:1:1", true);
    const second = fixture([], state);
    const handler = vi.fn();
    second.bot.onNewMention(handler);
    second.bot.onSlashCommand(handler);
    second.bot.onAction(handler);
    second.bot.onReaction(handler);
    try {
      await second.start();
      await vi.waitFor(
        async () => expect(await state.get(checkpoint)).toBeNull(),
        { timeout: 3000 }
      );
      expect(handler).toHaveBeenCalledOnce();
      expect(second.polls.every((poll) => poll.offset === 2)).toBe(true);
    } finally {
      await second.stop();
    }
  });

  it("waits for the retry write to finish before acknowledging a failed update", async () => {
    const test = fixture([ordinary]);
    const gate = deferred();
    const save = test.state.set.bind(test.state);
    let writing = false;
    vi.spyOn(test.state, "set").mockImplementation(async (key, value, ttl) => {
      if (key === checkpoint) {
        writing = true;
        await gate.promise;
      }
      await save(key, value, ttl);
    });
    test.bot.onNewMention(() => {
      throw new Error("Reply failed");
    });
    try {
      await test.start();
      await vi.waitFor(() => expect(writing).toBe(true));
      expect(test.polls).toHaveLength(1);
      expect(await test.state.get(checkpoint)).toBeNull();
      gate.resolve();
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(2));
      expect(await test.state.get(checkpoint)).toMatchObject({
        offset: 2,
        pending: [{ update: ordinary }],
      });
    } finally {
      gate.resolve();
      await test.stop();
    }
  });

  it.each([
    ordinary,
    command,
    action,
    reaction,
  ])("preserves default webhook error handling for $update_id", async (update) => {
    const test = fixture([]);
    const handler = vi.fn().mockRejectedValue(new Error("Admission failed"));
    test.bot.onNewMention(handler);
    test.bot.onSlashCommand(handler);
    test.bot.onAction(handler);
    test.bot.onReaction(handler);
    const tasks: Promise<unknown>[] = [];
    try {
      const response = await test.bot.webhooks.telegram(
        new Request("https://example.com/webhooks/telegram", {
          method: "POST",
          headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
          body: JSON.stringify(update),
        }),
        { waitUntil: (task) => tasks.push(task) }
      );
      expect(response.status).toBe(200);
      const results = await Promise.allSettled(tasks);
      expect(handler).toHaveBeenCalledOnce();
      expect(results.every((result) => result.status === "fulfilled")).toBe(
        true
      );
    } finally {
      await Promise.allSettled(tasks);
      await test.stop();
    }
  });

  it("retries every member of a failed album", async () => {
    const updates = [1, 2].map((id) => ({
      update_id: id,
      message: {
        ...ordinary.message,
        message_id: id,
        media_group_id: "album",
        photo: [
          {
            file_id: String(id),
            file_unique_id: String(id),
            width: 10,
            height: 10,
          },
        ],
      },
    }));
    const test = fixture(updates);
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("Admission failed"));
    test.bot.onNewMention(handler);
    try {
      await test.start();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2), {
        timeout: 5000,
      });
      expect(test.polls.at(-1)?.offset).toBe(3);
      for (const [, received] of handler.mock.calls) {
        expect(received.attachments).toHaveLength(2);
      }
      await vi.waitFor(async () =>
        expect(await test.state.get(checkpoint)).toBeNull()
      );
    } finally {
      await test.stop();
    }
  });

  it.each([
    403, 429, 503,
  ])("keeps polling other chats after an album reply fails with %s", async (status) => {
    const test = fixture(album());
    const fetcher = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, options) => {
        if (String(input).endsWith("/sendMessage")) {
          const payload = JSON.parse(String(options?.body)) as {
            chat_id: number;
            text: string;
          };
          if (String(payload.chat_id) === "1") {
            return Response.json(
              {
                ok: false,
                error_code: status,
                description: "Reply failed",
                parameters: { retry_after: 60 },
              },
              { status }
            );
          }
          return Response.json({
            ok: true,
            result: {
              message_id: 100,
              date: 1,
              text: payload.text,
              chat: { id: payload.chat_id, type: "private" },
            },
          });
        }
        return fetcher(input, options);
      })
    );
    const handler = vi.fn(async (thread: Thread) => {
      await thread.post("reply");
    });
    test.bot.onNewMention(handler);
    try {
      await test.start(1, 0);
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce(), {
        timeout: 5000,
      });
      test.deliver({
        ...message(3),
        message: { ...message(3).message, chat: { id: 2, type: "private" } },
      });
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(4), {
        timeout: 3000,
      });
      expect(
        handler.mock.calls.some(([thread]) => thread.id === "telegram:2")
      ).toBe(true);
      expect(await test.state.get(checkpoint)).toMatchObject({
        offset: 4,
        pending: [
          {
            update: { update_id: 1 },
            attempts: 1,
            retryAt: expect.any(Number),
          },
          {
            update: { update_id: 2 },
            attempts: 1,
            retryAt: expect.any(Number),
          },
        ],
      });
      if (status === 429) {
        const saved = await test.state.get<{ pending: { retryAt: number }[] }>(
          checkpoint
        );
        expect(saved?.pending[0].retryAt).toBeGreaterThan(Date.now() + 50_000);
      }
    } finally {
      await test.stop();
    }
  });

  it("preserves album backoff on restart while processing new chats", async () => {
    const state = createMemoryState();
    await state.connect();
    const retryAt = Date.now() + 60_000;
    const pending = album().map((update) => ({
      update,
      receivedAt: 0,
      attempts: 5,
      retryAt,
    }));
    await state.set(
      checkpoint,
      JSON.parse(JSON.stringify({ offset: 3, pending }))
    );
    const test = fixture(
      [
        {
          ...message(3),
          message: { ...message(3).message, chat: { id: 2, type: "private" } },
        },
      ],
      state
    );
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start();
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(4));
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].id).toBe("telegram:2");
      expect(await state.get(checkpoint)).toEqual({ offset: 4, pending });
    } finally {
      await test.stop();
    }
  });

  it("polls between album batches when another album becomes ready during a handler", async () => {
    const state = createMemoryState();
    await state.connect();
    const pending = [
      ...album().map((update) => ({ update, receivedAt: 0 })),
      ...album().map((update) => ({
        update: {
          ...update,
          update_id: update.update_id + 2,
          message: { ...update.message, chat: { id: 2, type: "private" } },
        },
        receivedAt: Date.now(),
      })),
    ];
    await state.set(checkpoint, { offset: 5, pending });
    const test = fixture([], state);
    const gate = deferred();
    const order: string[] = [];
    test.bot.onNewMention(async (thread) => {
      order.push(thread.id);
      if (thread.id === "telegram:1") {
        await gate.promise;
        throw new Error("Reply failed");
      }
    });
    try {
      await test.start();
      await vi.waitFor(() => expect(order).toEqual(["telegram:1"]), {
        timeout: 3000,
      });
      test.deliver({
        ...message(5),
        message: { ...message(5).message, chat: { id: 3, type: "private" } },
      });
      gate.resolve();
      await vi.waitFor(() => expect(order).toContain("telegram:2"), {
        timeout: 3000,
      });
      expect(order.slice(0, 3)).toEqual([
        "telegram:1",
        "telegram:3",
        "telegram:2",
      ]);
    } finally {
      gate.resolve();
      await test.stop();
    }
  });

  it.each([
    [1, 2000],
    [8, 30_000],
  ])("retains the retry count %s and bounds album backoff", async (attempts, delay) => {
    const state = createMemoryState();
    await state.connect();
    await state.set(checkpoint, {
      offset: 3,
      pending: album().map((update) => ({
        update,
        receivedAt: 0,
        attempts,
        retryAt: 0,
      })),
    });
    const test = fixture([], state);
    let failedAt = 0;
    test.bot.onNewMention(() => {
      failedAt = Date.now();
      throw new Error("Reply failed");
    });
    try {
      await test.start(100, 0);
      await vi.waitFor(
        async () => {
          const saved = await state.get<{
            pending: { attempts: number; retryAt: number }[];
          }>(checkpoint);
          expect(
            saved?.pending.every((entry) => entry.attempts === attempts + 1)
          ).toBe(true);
          expect(saved?.pending[0].retryAt).toBeGreaterThanOrEqual(
            failedAt + delay
          );
          expect(saved?.pending[0].retryAt).toBeLessThanOrEqual(
            Date.now() + delay
          );
        },
        { timeout: 3000 }
      );
      expect(test.polls.length).toBeGreaterThan(0);
    } finally {
      await test.stop();
    }
  });

  it("combines an album across polling responses after persisting its members", async () => {
    const test = fixture(album());
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start(1);
      await vi.waitFor(async () => {
        expect(test.polls.at(-1)?.offset).toBe(3);
        expect(await test.state.get(checkpoint)).toMatchObject({
          offset: 3,
          pending: [{ update: { update_id: 1 } }, { update: { update_id: 2 } }],
        });
      });
      expect(handler).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce(), {
        timeout: 5000,
      });
      expect(handler.mock.calls[0]?.[1].attachments).toHaveLength(2);
      await vi.waitFor(async () =>
        expect(await test.state.get(checkpoint)).toBeNull()
      );
    } finally {
      await test.stop();
    }
  });

  it("does not acknowledge album members when checkpoint persistence fails", async () => {
    const test = fixture(album());
    const save = test.state.set.bind(test.state);
    let failing = true;
    vi.spyOn(test.state, "set").mockImplementation(async (key, value, ttl) => {
      if (key === checkpoint && failing) {
        throw new Error("Storage unavailable");
      }
      await save(key, value, ttl);
    });
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start(1);
      await vi.waitFor(() => expect(test.polls.length).toBeGreaterThan(1));
      expect(test.polls.every((poll) => poll.offset === undefined)).toBe(true);
      expect(handler).not.toHaveBeenCalled();
      failing = false;
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce(), {
        timeout: 5000,
      });
      expect(handler.mock.calls[0]?.[1].attachments).toHaveLength(2);
    } finally {
      failing = false;
      await test.stop();
    }
  });

  it("recovers acknowledged album parts on a fresh adapter and state connection", async () => {
    const first = fixture(album());
    let saved: unknown;
    try {
      await first.start(1);
      await vi.waitFor(async () => {
        saved = await first.state.get(checkpoint);
        expect(saved).toMatchObject({ offset: 3, pending: [{}, {}] });
      });
    } finally {
      await first.stop();
    }
    const state = createMemoryState();
    await state.connect();
    await state.set(checkpoint, JSON.parse(JSON.stringify(saved)));
    await state.set("dedupe:telegram:1:2", true);
    await state.set("telegram:incoming-media-group:telegram:1:album", [
      { message: album()[0].message, receivedAt: Date.now() },
    ]);
    const second = fixture([], state);
    const handler = vi.fn();
    second.bot.onNewMention(handler);
    try {
      await second.start(1);
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce(), {
        timeout: 5000,
      });
      expect(handler.mock.calls[0]?.[1].attachments).toHaveLength(2);
      await vi.waitFor(async () =>
        expect(await state.get(checkpoint)).toBeNull()
      );
      expect(second.polls.every((poll) => poll.offset === 3)).toBe(true);
    } finally {
      await second.stop();
    }
  });

  it("combines an album spanning a full polling response", async () => {
    const updates = Array.from({ length: 102 }, (_, index) => {
      const update = album()[index % 2];
      return {
        ...update,
        update_id: index + 1,
        message: {
          ...update.message,
          message_id: index + 1,
          media_group_id: String(Math.floor(index / 3)),
        },
      };
    });
    const test = fixture(updates);
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start(100);
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(34), {
        timeout: 8000,
      });
      for (const [, received] of handler.mock.calls) {
        expect(received.attachments).toHaveLength(3);
      }
      await vi.waitFor(async () =>
        expect(await test.state.get(checkpoint)).toBeNull()
      );
    } finally {
      await test.stop();
    }
  });

  it("includes parts arriving while the collection poll is waiting", async () => {
    const parts = album();
    const test = fixture([parts[0]]);
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start(1);
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(2));
      await new Promise((resolve) => setTimeout(resolve, 100));
      test.deliver(parts[1]);
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce(), {
        timeout: 5000,
      });
      expect(handler.mock.calls[0]?.[1].attachments).toHaveLength(2);
    } finally {
      await test.stop();
    }
  });

  it("does not replay another bot's saved album", async () => {
    const state = createMemoryState();
    await state.connect();
    const saved = {
      offset: 3,
      pending: album().map((update) => ({ update, receivedAt: 0 })),
    };
    await state.set(checkpoint, saved);
    const test = fixture([], state, 1000);
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start();
      await vi.waitFor(() => expect(test.polls).toHaveLength(1));
      expect(handler).not.toHaveBeenCalled();
      expect(await state.get(checkpoint)).toEqual(saved);
      expect(test.polls[0].offset).toBeUndefined();
    } finally {
      await test.stop();
    }
  });

  it("does not buffer albums from users outside the allowlist", async () => {
    const test = fixture(album(), createMemoryState(), 999, ["3"]);
    const save = vi.spyOn(test.state, "set");
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start(1);
      await vi.waitFor(() => expect(test.polls.at(-1)?.offset).toBe(3));
      expect(handler).not.toHaveBeenCalled();
      expect(save.mock.calls.some(([key]) => key === checkpoint)).toBe(false);
    } finally {
      await test.stop();
    }
  });

  it("keeps pending albums through cleanup failures without repeating successful handlers", async () => {
    const test = fixture(album());
    const remove = test.state.delete.bind(test.state);
    let failures = 0;
    vi.spyOn(test.state, "delete").mockImplementation(async (key) => {
      if (key === checkpoint && failures++ === 0) {
        throw new Error("Cleanup failed");
      }
      await remove(key);
    });
    const handler = vi.fn();
    test.bot.onNewMention(handler);
    try {
      await test.start(1);
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce(), {
        timeout: 5000,
      });
      await vi.waitFor(async () =>
        expect(await test.state.get(checkpoint)).toBeNull()
      );
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      await test.stop();
    }
  });

  it("waits for admitted work during shutdown without acknowledging unfinished input", async () => {
    const test = fixture([ordinary]);
    const gate = deferred();
    const handler = vi.fn(() => gate.promise);
    test.bot.onNewMention(handler);
    let stopped = false;
    try {
      await test.start();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      const stopping = test.bot.shutdown().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(stopped).toBe(false);
      expect(test.polls).toHaveLength(1);
      gate.resolve();
      await stopping;
      expect(test.polls).toHaveLength(1);
    } finally {
      gate.resolve();
      await test.stop();
    }
  });
});
