import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelImpl, type SerializedChannel } from "./channel";
import { Chat } from "./chat";
import { clearChatSingleton } from "./chat-singleton";
import { Message, type SerializedMessage } from "./message";
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "./mock-adapter";
import { reviver } from "./reviver";
import { StreamingPlan } from "./streaming-plan";
import { type SerializedThread, ThreadImpl } from "./thread";
import type { Channel, Thread } from "./types";

describe("Serialization", () => {
  describe("revived streaming configuration", () => {
    const id = "slack:C123:1234.5678";
    const methods = [
      "json",
      "reviver",
      "standalone",
      "workflow",
      "adapter",
    ] as const;
    let adapter: ReturnType<typeof createMockAdapter>;
    let state: ReturnType<typeof createMockState>;

    beforeEach(() => {
      clearChatSingleton();
      adapter = createMockAdapter("slack");
      state = createMockState();
    });

    afterEach(() => {
      clearChatSingleton();
      vi.useRealTimers();
    });

    function restore(chat: Chat, method: (typeof methods)[number]): ThreadImpl {
      const data = chat.thread(id).toJSON();
      switch (method) {
        case "json":
          return ThreadImpl.fromJSON(data);
        case "reviver":
          return JSON.parse(JSON.stringify(data), chat.reviver()) as ThreadImpl;
        case "standalone":
          return JSON.parse(JSON.stringify(data), reviver) as ThreadImpl;
        case "workflow":
          return ThreadImpl[WORKFLOW_DESERIALIZE](data);
        case "adapter":
          return ThreadImpl.fromJSON(data, adapter);
        default:
          throw new Error("Unknown restoration method");
      }
    }

    async function* stream() {
      yield "Hello";
    }

    describe.each(methods)("%s", (method) => {
      it.each([
        null,
        "Loading...",
        "",
        undefined,
      ])("uses the current Chat placeholder %s after lazy restoration", async (placeholder) => {
        const original = new Chat({
          userName: "bot",
          adapters: { slack: adapter },
          state,
          logger: "silent",
          fallbackStreamingPlaceholderText:
            method === "reviver" ? placeholder : "Old configuration",
        });
        const thread = restore(original, method);
        clearChatSingleton();
        expect(thread.toJSON()).not.toHaveProperty(
          "fallbackStreamingPlaceholderText"
        );
        new Chat({
          userName: "bot",
          adapters: { slack: adapter },
          state,
          logger: "silent",
          fallbackStreamingPlaceholderText: placeholder,
        }).registerSingleton();

        await thread.post(stream());

        expect(adapter.postMessage).toHaveBeenNthCalledWith(
          1,
          id,
          placeholder === null ? { markdown: "Hello" } : (placeholder ?? "...")
        );
      });

      it.each([
        undefined,
        250,
      ])("restores the fallback edit interval with override %s", async (interval) => {
        vi.useFakeTimers();
        const chat = new Chat({
          userName: "bot",
          adapters: { slack: adapter },
          state,
          logger: "silent",
          streamingUpdateIntervalMs: 1000,
        });
        const thread = restore(chat, method);
        chat.registerSingleton();
        let finish: () => void = () => {};
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        async function* delayed() {
          yield "Hello";
          await pending;
        }
        const posting = thread.post(
          new StreamingPlan(delayed(), { updateIntervalMs: interval })
        );
        try {
          await vi.advanceTimersByTimeAsync((interval ?? 1000) - 1);
          expect(adapter.editMessage).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
          expect(adapter.editMessage).toHaveBeenCalledWith(id, "msg-1", {
            markdown: "Hello",
          });
        } finally {
          finish();
          await posting;
        }
      });

      it.each([
        undefined,
        250,
      ])("passes restored defaults and the interval override %s to native streaming", async (interval) => {
        const chat = new Chat({
          userName: "bot",
          adapters: { slack: adapter },
          state,
          logger: "silent",
          streamingUpdateIntervalMs: 1000,
          fallbackStreamingPlaceholderText: null,
        });
        adapter.stream = vi
          .fn()
          .mockResolvedValue({ id: "msg-1", threadId: id, raw: {} });
        const thread = restore(chat, method);
        chat.registerSingleton();

        await thread.post(
          interval === undefined
            ? stream()
            : new StreamingPlan(stream(), { updateIntervalMs: interval })
        );

        expect(adapter.stream).toHaveBeenCalledWith(
          id,
          expect.anything(),
          expect.objectContaining({
            updateIntervalMs: interval ?? 1000,
            fallbackStreamingPlaceholderText: null,
          })
        );
      });
    });

    it.each([
      null,
      "Thread placeholder",
      "",
    ])("preserves explicit lazy thread overrides with placeholder %s", async (placeholder) => {
      new Chat({
        userName: "bot",
        adapters: { slack: adapter },
        state,
        logger: "silent",
        streamingUpdateIntervalMs: 1000,
        fallbackStreamingPlaceholderText: "Bot placeholder",
      }).registerSingleton();
      adapter.stream = vi
        .fn()
        .mockResolvedValue({ id: "msg-1", threadId: id, raw: {} });
      const thread = new ThreadImpl({
        id,
        channelId: "slack:C123",
        adapterName: "slack",
        streamingUpdateIntervalMs: 250,
        fallbackStreamingPlaceholderText: placeholder,
      });

      await thread.post(stream());

      expect(adapter.stream).toHaveBeenCalledWith(
        id,
        expect.anything(),
        expect.objectContaining({
          updateIntervalMs: 250,
          fallbackStreamingPlaceholderText: placeholder,
        })
      );
    });

    it("does not inherit another Chat configuration for directly constructed threads", async () => {
      new Chat({
        userName: "other",
        adapters: { slack: createMockAdapter("slack") },
        state: createMockState(),
        logger: "silent",
        streamingUpdateIntervalMs: 1000,
        fallbackStreamingPlaceholderText: null,
      }).registerSingleton();
      adapter.stream = vi
        .fn()
        .mockResolvedValue({ id: "msg-1", threadId: id, raw: {} });
      const thread = new ThreadImpl({
        id,
        channelId: "slack:C123",
        adapter,
        stateAdapter: state,
      });

      await thread.post(stream());

      expect(adapter.stream).toHaveBeenCalledWith(
        id,
        expect.anything(),
        expect.objectContaining({ updateIntervalMs: 500 })
      );
      expect(vi.mocked(adapter.stream).mock.calls[0][2]).not.toHaveProperty(
        "fallbackStreamingPlaceholderText"
      );
    });

    it("can stream with an explicit restored adapter without a singleton", async () => {
      const thread = ThreadImpl.fromJSON(
        {
          _type: "chat:Thread",
          id,
          channelId: "slack:C123",
          adapterName: "slack",
          isDM: false,
        },
        adapter
      );

      await thread.post(stream());

      expect(adapter.postMessage).toHaveBeenNthCalledWith(1, id, "...");
    });

    it.each([
      "submit",
      "close",
    ])("keeps restored modal %s context bound to its Chat", async (method) => {
      const owner = new Chat({
        userName: "owner",
        adapters: { slack: adapter },
        state,
        logger: "silent",
        fallbackStreamingPlaceholderText: null,
        streamingUpdateIntervalMs: 1200,
      });
      const other = new Chat({
        userName: "other",
        adapters: { slack: createMockAdapter("slack") },
        state: createMockState(),
        logger: "silent",
        fallbackStreamingPlaceholderText: "Other",
      });
      await state.set("modal-context:slack:context", {
        thread: owner.thread(id).toJSON(),
        channel: owner.channel("slack:C123").toJSON(),
      });
      let restored: { relatedThread?: Thread; relatedChannel?: Channel } = {};
      const handler = vi.fn((event: typeof restored) => {
        restored = event;
      });
      owner.onModalSubmit("modal", handler);
      owner.onModalClose("modal", handler);
      other.registerSingleton();
      const event = {
        callbackId: "modal",
        viewId: "view",
        user: createTestMessage("message", "Hello").author,
        adapter,
        raw: {},
        values: {},
      };
      if (method === "submit") {
        await owner.processModalSubmit(event, "context");
      } else {
        const tasks: Promise<unknown>[] = [];
        owner.processModalClose(event, "context", {
          waitUntil: (task) => tasks.push(task),
        });
        await Promise.all(tasks);
      }
      expect(handler).toHaveBeenCalled();
      const { relatedThread: thread, relatedChannel: channel } = restored;
      expect(thread).toBeDefined();
      expect(channel).toBeDefined();
      if (!(thread && channel)) {
        throw new Error("Modal context was not restored");
      }
      await thread.post(stream());
      expect(adapter.postMessage).toHaveBeenNthCalledWith(1, id, {
        markdown: "Hello",
      });
      await thread.setState({ owner: "owner" });
      await channel.setState({ owner: "owner" });
      expect(await owner.thread(id).state).toEqual({ owner: "owner" });
      expect(await owner.channel("slack:C123").state).toEqual({
        owner: "owner",
      });
      expect(await other.thread(id).state).toBeNull();
      expect(await other.channel("slack:C123").state).toBeNull();
      adapter.stream = vi.fn().mockResolvedValue(null);
      await thread.post(stream());
      expect(adapter.stream).toHaveBeenCalledWith(
        id,
        expect.anything(),
        expect.objectContaining({
          updateIntervalMs: 1200,
          fallbackStreamingPlaceholderText: null,
        })
      );
    });
  });

  describe("restored runtime ownership", () => {
    afterEach(() => {
      clearChatSingleton();
    });

    describe.each([
      "json",
      "standalone",
      "workflow",
      "adapter",
    ])("%s", (method) => {
      it.each(
        ["adapter", "state", "stream"].flatMap((access) =>
          ["replaced", "cleared"].map((singleton) => ({ access, singleton }))
        )
      )("retains the runtime after resolving $access first with the singleton $singleton", async ({
        access,
        singleton,
      }) => {
        clearChatSingleton();
        const adapter = createMockAdapter("slack");
        const state = createMockState();
        const first = new Chat({
          userName: "first",
          adapters: { slack: adapter },
          state,
          logger: "silent",
          fallbackStreamingPlaceholderText: null,
          streamingUpdateIntervalMs: 1200,
        });
        const other = createMockAdapter("slack");
        const second = new Chat({
          userName: "second",
          adapters: { slack: other },
          state: createMockState(),
          logger: "silent",
          fallbackStreamingPlaceholderText: "Other",
          streamingUpdateIntervalMs: 250,
        });
        const data = {
          thread: first.thread("slack:C123:1234.5678").toJSON(),
          channel: first.channel("slack:C123").toJSON(),
        };
        const restored =
          method === "standalone"
            ? (JSON.parse(JSON.stringify(data), reviver) as {
                thread: ThreadImpl;
                channel: ChannelImpl;
              })
            : {
                thread:
                  method === "workflow"
                    ? ThreadImpl[WORKFLOW_DESERIALIZE](data.thread)
                    : ThreadImpl.fromJSON(
                        data.thread,
                        method === "adapter" ? adapter : undefined
                      ),
                channel:
                  method === "workflow"
                    ? ChannelImpl[WORKFLOW_DESERIALIZE](data.channel)
                    : ChannelImpl.fromJSON(
                        data.channel,
                        method === "adapter" ? adapter : undefined
                      ),
              };
        first.registerSingleton();
        adapter.stream = vi.fn().mockResolvedValue(null);
        async function* stream() {
          yield "Reply";
        }
        if (access === "adapter") {
          expect(restored.thread.adapter).toBe(adapter);
          expect(restored.channel.adapter).toBe(adapter);
        } else if (access === "state") {
          await restored.thread.state;
          await restored.channel.state;
        } else {
          await restored.thread.post(stream());
          await restored.channel.post("Channel");
        }
        second.registerSingleton();
        if (singleton === "cleared") {
          clearChatSingleton();
        }
        await restored.thread.setState({ owner: "first" });
        await restored.channel.setState({ owner: "first" });
        await restored.thread.subscribe();
        expect(restored.thread.adapter).toBe(adapter);
        expect(restored.channel.adapter).toBe(adapter);
        expect(await first.thread(data.thread.id).state).toEqual({
          owner: "first",
        });
        expect(await first.channel(data.channel.id).state).toEqual({
          owner: "first",
        });
        expect(await second.thread(data.thread.id).state).toBeNull();
        expect(await second.channel(data.channel.id).state).toBeNull();
        expect(await first.getState().isSubscribed(data.thread.id)).toBe(true);
        expect(await second.getState().isSubscribed(data.thread.id)).toBe(
          false
        );
        await restored.thread.post(stream());
        expect(adapter.stream).toHaveBeenLastCalledWith(
          data.thread.id,
          expect.anything(),
          expect.objectContaining({
            updateIntervalMs: 1200,
            fallbackStreamingPlaceholderText: null,
          })
        );
        clearChatSingleton();
        await restored.thread.post(stream());
        expect(adapter.stream).toHaveBeenLastCalledWith(
          data.thread.id,
          expect.anything(),
          expect.objectContaining({
            updateIntervalMs: 1200,
            fallbackStreamingPlaceholderText: null,
          })
        );
        expect(await restored.thread.channel.state).toEqual({ owner: "first" });
        expect(other.postMessage).not.toHaveBeenCalled();
        expect(JSON.stringify(restored)).toBe(JSON.stringify(data));
      });
    });

    it("does not borrow an unrelated runtime for an explicit adapter", async () => {
      clearChatSingleton();
      const adapter = createMockAdapter("slack");
      const owner = new Chat({
        userName: "owner",
        adapters: { slack: adapter },
        state: createMockState(),
        logger: "silent",
        fallbackStreamingPlaceholderText: null,
        streamingUpdateIntervalMs: 1200,
      });
      const other = new Chat({
        userName: "other",
        adapters: { slack: createMockAdapter("slack") },
        state: createMockState(),
        logger: "silent",
        fallbackStreamingPlaceholderText: "Other",
        streamingUpdateIntervalMs: 250,
      });
      const thread = ThreadImpl.fromJSON(
        owner.thread("slack:C123:1234.5678").toJSON(),
        adapter
      );
      const channel = ChannelImpl.fromJSON(
        owner.channel("slack:C123").toJSON(),
        adapter
      );
      other.registerSingleton();
      adapter.stream = vi.fn().mockResolvedValue(null);
      async function* stream() {
        yield "Reply";
      }
      await thread.post(stream());
      expect(adapter.postMessage).toHaveBeenNthCalledWith(1, thread.id, "...");
      expect(adapter.stream).toHaveBeenCalledWith(
        thread.id,
        expect.anything(),
        expect.objectContaining({ updateIntervalMs: 500 })
      );
      expect(vi.mocked(adapter.stream).mock.calls[0][2]).not.toHaveProperty(
        "fallbackStreamingPlaceholderText"
      );
      expect(() => thread.state).toThrow("bot.reviver()");
      expect(() => channel.state).toThrow("bot.reviver()");
      await expect(thread.setState({ owner: "owner" })).rejects.toThrow(
        "bot.reviver()"
      );
      await expect(channel.setState({ owner: "owner" })).rejects.toThrow(
        "bot.reviver()"
      );
      await expect(thread.subscribe()).rejects.toThrow("bot.reviver()");
      expect(await other.thread(thread.id).state).toBeNull();
      expect(await other.channel(channel.id).state).toBeNull();
      owner.registerSingleton();
      await thread.setState({ owner: "owner" });
      await channel.setState({ owner: "owner" });
      other.registerSingleton();
      await thread.post(stream());
      expect(adapter.stream).toHaveBeenLastCalledWith(
        thread.id,
        expect.anything(),
        expect.objectContaining({
          updateIntervalMs: 1200,
          fallbackStreamingPlaceholderText: null,
        })
      );
      expect(await owner.thread(thread.id).state).toEqual({ owner: "owner" });
      expect(await owner.channel(channel.id).state).toEqual({ owner: "owner" });
    });
  });

  describe("ThreadImpl.toJSON()", () => {
    it("should serialize thread with correct type tag", () => {
      const mockAdapter = createMockAdapter("slack");
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        isDM: false,
      });

      const json = thread.toJSON();

      expect(json).toEqual({
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        channelVisibility: "unknown",
        currentMessage: undefined,
        isDM: false,
        adapterName: "slack",
      });
    });

    it("should serialize DM thread correctly", () => {
      const mockAdapter = createMockAdapter("slack");
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:DU123:",
        adapter: mockAdapter,
        channelId: "DU123",
        stateAdapter: mockState,
        isDM: true,
      });

      const json = thread.toJSON();

      expect(json._type).toBe("chat:Thread");
      expect(json.isDM).toBe(true);
    });

    it("should serialize external channel thread correctly", () => {
      const mockAdapter = createMockAdapter("slack");
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        channelVisibility: "external",
      });

      const json = thread.toJSON();

      expect(json._type).toBe("chat:Thread");
      expect(json.channelVisibility).toBe("external");
    });

    it("should serialize private channel thread correctly", () => {
      const mockAdapter = createMockAdapter("slack");
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        channelVisibility: "private",
      });

      const json = thread.toJSON();

      expect(json._type).toBe("chat:Thread");
      expect(json.channelVisibility).toBe("private");
    });

    it("should serialize workspace channel thread correctly", () => {
      const mockAdapter = createMockAdapter("slack");
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        channelVisibility: "workspace",
      });

      const json = thread.toJSON();

      expect(json.channelVisibility).toBe("workspace");
    });

    it("should produce JSON-serializable output", () => {
      const mockAdapter = createMockAdapter("teams");
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "teams:channel123:thread456",
        adapter: mockAdapter,
        channelId: "channel123",
        stateAdapter: mockState,
      });

      const json = thread.toJSON();
      const stringified = JSON.stringify(json);
      const parsed = JSON.parse(stringified);

      expect(parsed).toEqual(json);
    });
  });

  describe("ThreadImpl.fromJSON()", () => {
    let chat: Chat;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockState = createMockState();
      chat = new Chat({
        userName: "test-bot",
        adapters: {
          slack: createMockAdapter("slack"),
          teams: createMockAdapter("teams"),
        },
        state: mockState,
        logger: "silent",
      });
      // Register singleton for lazy resolution
      chat.registerSingleton();
    });

    afterEach(() => {
      clearChatSingleton();
    });

    it("should reconstruct thread from JSON", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const thread = ThreadImpl.fromJSON(json);

      expect(thread.id).toBe("slack:C123:1234.5678");
      expect(thread.channelId).toBe("C123");
      expect(thread.isDM).toBe(false);
      expect(thread.adapter.name).toBe("slack");
    });

    it("should reconstruct DM thread", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:DU456:",
        channelId: "DU456",
        isDM: true,
        adapterName: "slack",
      };

      const thread = ThreadImpl.fromJSON(json);

      expect(thread.isDM).toBe(true);
    });

    it("should throw error for unknown adapter on access", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "discord:channel:thread",
        channelId: "channel",
        isDM: false,
        adapterName: "discord",
      };

      const thread = ThreadImpl.fromJSON(json);
      // Error is thrown on adapter access, not during fromJSON
      expect(() => thread.adapter).toThrow(
        'Adapter "discord" not found in Chat singleton'
      );
    });

    it("should round-trip correctly", () => {
      const mockAdapter = createMockAdapter("slack");

      const original = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        isDM: true,
      });

      const json = original.toJSON();
      const restored = ThreadImpl.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.channelId).toBe(original.channelId);
      expect(restored.isDM).toBe(original.isDM);
      expect(restored.adapter.name).toBe(original.adapter.name);
    });

    it("should round-trip channelVisibility correctly", () => {
      const mockAdapter = createMockAdapter("slack");

      const original = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        channelVisibility: "external",
      });

      const json = original.toJSON();
      const restored = ThreadImpl.fromJSON(json);

      expect(restored.channelVisibility).toBe("external");
    });

    it("should default channelVisibility to unknown when missing from JSON", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const thread = ThreadImpl.fromJSON(json);

      expect(thread.channelVisibility).toBe("unknown");
    });

    it("should serialize currentMessage", () => {
      const mockAdapter = createMockAdapter("slack");
      const currentMessage = createTestMessage("msg-1", "Hello", {
        raw: { team_id: "T123" },
        author: {
          userId: "U456",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
      });

      const original = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage,
      });

      const json = original.toJSON();

      expect(json.currentMessage).toBeDefined();
      expect(json.currentMessage?._type).toBe("chat:Message");
      expect(json.currentMessage?.author.userId).toBe("U456");
      expect(json.currentMessage?.raw).toEqual({ team_id: "T123" });
    });

    it("should round-trip with currentMessage for streaming", () => {
      const mockAdapter = createMockAdapter("slack");
      const currentMessage = createTestMessage("msg-1", "Hello", {
        raw: { team_id: "T123" },
        author: {
          userId: "U456",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
      });

      const original = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage,
      });

      const json = original.toJSON();
      const restored = ThreadImpl.fromJSON(json);

      expect(json.currentMessage?.author.userId).toBe("U456");
      expect(json.currentMessage?.raw).toEqual({ team_id: "T123" });

      expect(restored.id).toBe(original.id);
      expect(restored.channelId).toBe(original.channelId);
    });
  });

  describe("Message.toJSON()", () => {
    it("should serialize message with correct type tag", () => {
      const message = createTestMessage("msg-1", "Hello world");

      const json = message.toJSON();

      expect(json._type).toBe("chat:Message");
      expect(json.id).toBe("msg-1");
      expect(json.text).toBe("Hello world");
    });

    it("should convert Date to ISO string", () => {
      const message = createTestMessage("msg-1", "Test", {
        metadata: {
          dateSent: new Date("2024-01-15T10:30:00.000Z"),
          edited: true,
          editedAt: new Date("2024-01-15T11:00:00.000Z"),
        },
      });

      const json = message.toJSON();

      expect(json.metadata.dateSent).toBe("2024-01-15T10:30:00.000Z");
      expect(json.metadata.editedAt).toBe("2024-01-15T11:00:00.000Z");
    });

    it("should handle undefined editedAt", () => {
      const message = createTestMessage("msg-1", "Test", {
        metadata: {
          dateSent: new Date("2024-01-15T10:30:00.000Z"),
          edited: false,
        },
      });

      const json = message.toJSON();

      expect(json.metadata.editedAt).toBeUndefined();
    });

    it("should serialize author correctly", () => {
      const message = createTestMessage("msg-1", "Test");

      const json = message.toJSON();

      expect(json.author).toEqual({
        userId: "U123",
        userName: "testuser",
        fullName: "Test User",
        isBot: false,
        isMe: false,
      });
    });

    it("should serialize attachments without data/fetchData", () => {
      const message = createTestMessage("msg-1", "Test", {
        attachments: [
          {
            type: "image",
            url: "https://example.com/image.png",
            name: "image.png",
            mimeType: "image/png",
            size: 1024,
            width: 800,
            height: 600,
            data: Buffer.from("test"),
            fetchData: () => Promise.resolve(Buffer.from("test")),
          },
        ],
      });

      const json = message.toJSON();

      expect(json.attachments).toHaveLength(1);
      expect(json.attachments[0]).toEqual({
        type: "image",
        url: "https://example.com/image.png",
        name: "image.png",
        mimeType: "image/png",
        size: 1024,
        width: 800,
        height: 600,
      });
      // Ensure data and fetchData are not present
      expect("data" in json.attachments[0]).toBe(false);
      expect("fetchData" in json.attachments[0]).toBe(false);
    });

    it("should serialize isMention flag", () => {
      const message = createTestMessage("msg-1", "Test", {
        isMention: true,
      });

      const json = message.toJSON();

      expect(json.isMention).toBe(true);
    });

    it("should serialize links without fetchMessage", () => {
      const message = createTestMessage("msg-1", "Check this out", {
        links: [
          {
            url: "https://example.com",
            title: "Example",
            fetchMessage: async () => createTestMessage("linked", "linked"),
          },
          { url: "https://vercel.com", siteName: "Vercel" },
        ],
      });

      const json = message.toJSON();

      expect(json.links).toHaveLength(2);
      expect(json.links?.[0]).toEqual({
        url: "https://example.com",
        title: "Example",
        description: undefined,
        imageUrl: undefined,
        siteName: undefined,
      });
      expect(json.links?.[1]).toEqual({
        url: "https://vercel.com",
        title: undefined,
        description: undefined,
        imageUrl: undefined,
        siteName: "Vercel",
      });
      // fetchMessage should NOT be in serialized output
      expect("fetchMessage" in (json.links?.[0] ?? {})).toBe(false);
    });

    it("should omit links when empty", () => {
      const message = createTestMessage("msg-1", "No links");

      const json = message.toJSON();

      expect(json.links).toBeUndefined();
    });

    it("should produce JSON-serializable output", () => {
      const message = createTestMessage("msg-1", "Hello **world**");

      const json = message.toJSON();
      const stringified = JSON.stringify(json);
      const parsed = JSON.parse(stringified);

      expect(parsed._type).toBe("chat:Message");
      expect(parsed.text).toBe("Hello **world**");
    });
  });

  describe("Message.fromJSON()", () => {
    it("should restore message from JSON", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Hello world",
        formatted: { type: "root", children: [] },
        raw: { some: "data" },
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const message = Message.fromJSON(json);

      expect(message.id).toBe("msg-1");
      expect(message.text).toBe("Hello world");
      expect(message.author.userName).toBe("testuser");
    });

    it("should convert ISO strings back to Date objects", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Test",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: true,
          editedAt: "2024-01-15T11:00:00.000Z",
        },
        attachments: [],
      };

      const message = Message.fromJSON(json);

      expect(message.metadata.dateSent).toBeInstanceOf(Date);
      expect(message.metadata.dateSent.toISOString()).toBe(
        "2024-01-15T10:30:00.000Z"
      );
      expect(message.metadata.editedAt).toBeInstanceOf(Date);
      expect(message.metadata.editedAt?.toISOString()).toBe(
        "2024-01-15T11:00:00.000Z"
      );
    });

    it("should handle undefined editedAt", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Test",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const message = Message.fromJSON(json);

      expect(message.metadata.editedAt).toBeUndefined();
    });

    it("should round-trip correctly", () => {
      const original = createTestMessage("msg-1", "Hello **world**", {
        isMention: true,
        metadata: {
          dateSent: new Date("2024-01-15T10:30:00.000Z"),
          edited: true,
          editedAt: new Date("2024-01-15T11:00:00.000Z"),
        },
        attachments: [
          {
            type: "file",
            url: "https://example.com/file.pdf",
            name: "file.pdf",
          },
        ],
      });

      const json = original.toJSON();
      const restored = Message.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.text).toBe(original.text);
      expect(restored.isMention).toBe(original.isMention);
      expect(restored.metadata.dateSent.getTime()).toBe(
        original.metadata.dateSent.getTime()
      );
      expect(restored.metadata.editedAt?.getTime()).toBe(
        original.metadata.editedAt?.getTime()
      );
      expect(restored.attachments).toEqual([
        {
          type: "file",
          url: "https://example.com/file.pdf",
          name: "file.pdf",
        },
      ]);
    });

    it("should round-trip links correctly", () => {
      const original = createTestMessage("msg-1", "Links test", {
        links: [
          { url: "https://example.com", title: "Example" },
          { url: "https://vercel.com", siteName: "Vercel" },
        ],
      });

      const json = original.toJSON();
      const restored = Message.fromJSON(json);

      expect(restored.links).toHaveLength(2);
      expect(restored.links[0]?.url).toBe("https://example.com");
      expect(restored.links[0]?.title).toBe("Example");
      expect(restored.links[1]?.url).toBe("https://vercel.com");
      expect(restored.links[1]?.siteName).toBe("Vercel");
      // fetchMessage is not preserved across serialization
      expect(restored.links[0]?.fetchMessage).toBeUndefined();
    });

    it("should round-trip replied-to message context", () => {
      const replyTo = createTestMessage("msg-original", "Original message", {
        raw: { platformId: "original-1" },
        author: {
          userId: "U456",
          userName: "original-author",
          fullName: "Original Author",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: new Date("2024-01-14T10:30:00.000Z"),
          edited: false,
        },
        attachments: [
          {
            type: "file",
            name: "original.pdf",
            fetchMetadata: { fileId: "file-1" },
          },
        ],
      });
      const original = createTestMessage("msg-reply", "Reply", { replyTo });

      const restored = Message.fromJSON(original.toJSON());

      expect(restored.replyTo).toBeInstanceOf(Message);
      expect(restored.replyTo?.id).toBe("msg-original");
      expect(restored.replyTo?.text).toBe("Original message");
      expect(restored.replyTo?.author.userName).toBe("original-author");
      expect(restored.replyTo?.raw).toEqual({ platformId: "original-1" });
      expect(restored.replyTo?.metadata.dateSent).toEqual(
        new Date("2024-01-14T10:30:00.000Z")
      );
      expect(restored.replyTo?.attachments).toEqual([
        {
          type: "file",
          name: "original.pdf",
          fetchMetadata: { fileId: "file-1" },
        },
      ]);
    });
  });

  describe("chat.reviver()", () => {
    let chat: Chat;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockState = createMockState();
      chat = new Chat({
        userName: "test-bot",
        adapters: {
          slack: createMockAdapter("slack"),
          teams: createMockAdapter("teams"),
        },
        state: mockState,
        logger: "silent",
      });
    });

    afterEach(() => {
      clearChatSingleton();
    });

    it.each([
      "replaced",
      "cached",
      "cleared",
    ])("keeps threads and channels bound to their Chat when the singleton is %s", async (mode) => {
      const firstAdapter = createMockAdapter("slack");
      const secondAdapter = createMockAdapter("slack");
      const firstState = createMockState();
      const secondState = createMockState();
      const first = new Chat({
        userName: "first",
        adapters: { slack: firstAdapter },
        state: firstState,
        logger: "silent",
        fallbackStreamingPlaceholderText: null,
        streamingUpdateIntervalMs: 1000,
      });
      const second = new Chat({
        userName: "second",
        adapters: { slack: secondAdapter },
        state: secondState,
        logger: "silent",
        fallbackStreamingPlaceholderText: "Second",
        streamingUpdateIntervalMs: 250,
      });
      const id = "slack:C123:1234.5678";
      const payload = JSON.stringify({
        thread: first.thread(id),
        channel: first.channel("slack:C123"),
      });
      const decode = first.reviver();
      const restored = JSON.parse(payload, decode) as {
        thread: ThreadImpl;
        channel: ChannelImpl;
      };
      if (mode === "cached") {
        expect(restored.thread.adapter).toBe(firstAdapter);
        expect(restored.channel.adapter).toBe(firstAdapter);
      }
      const other = JSON.parse(payload, second.reviver()) as {
        thread: ThreadImpl;
        channel: ChannelImpl;
      };
      const delayed = JSON.parse(payload, decode) as typeof restored;
      if (mode === "cleared") {
        clearChatSingleton();
      }

      await restored.thread.setState({ owner: "first" });
      await restored.channel.setState({ owner: "first" });
      await restored.thread.subscribe();
      await other.thread.setState({ owner: "second" });
      await other.channel.setState({ owner: "second" });
      expect(await restored.thread.state).toEqual({ owner: "first" });
      expect(await delayed.thread.state).toEqual({ owner: "first" });
      expect(await restored.thread.channel.state).toEqual({ owner: "first" });
      expect(await other.thread.state).toEqual({ owner: "second" });
      expect(await other.channel.state).toEqual({ owner: "second" });
      expect(await firstState.isSubscribed(id)).toBe(true);
      expect(await secondState.isSubscribed(id)).toBe(false);

      async function* stream() {
        yield "Reply";
      }
      await restored.thread.post(stream());
      await other.thread.post(stream());
      expect(firstAdapter.postMessage).toHaveBeenNthCalledWith(1, id, {
        markdown: "Reply",
      });
      expect(secondAdapter.postMessage).toHaveBeenNthCalledWith(
        1,
        id,
        "Second"
      );
      await restored.channel.post("First channel");
      expect(firstAdapter.postChannelMessage).toHaveBeenCalledWith(
        "slack:C123",
        "First channel"
      );
      expect(secondAdapter.postChannelMessage).not.toHaveBeenCalled();
      firstAdapter.stream = vi
        .fn()
        .mockResolvedValue({ id: "sent", threadId: id, raw: {} });
      await delayed.thread.post(stream());
      expect(firstAdapter.stream).toHaveBeenCalledWith(
        id,
        expect.anything(),
        expect.objectContaining({
          updateIntervalMs: 1000,
          fallbackStreamingPlaceholderText: null,
        })
      );
      expect(JSON.stringify(restored)).toBe(payload);
    });

    it("does not fall back to another Chat's adapter", () => {
      const owner = new Chat({
        userName: "owner",
        adapters: {},
        state: createMockState(),
        logger: "silent",
      });
      const decode = owner.reviver();
      chat.registerSingleton();
      const restored = JSON.parse(
        JSON.stringify({
          thread: chat.thread("slack:C123:1234.5678"),
          channel: chat.channel("slack:C123"),
        }),
        decode
      ) as { thread: ThreadImpl; channel: ChannelImpl };

      expect(() => restored.thread.adapter).toThrow(
        'Adapter "slack" not found'
      );
      expect(() => restored.channel.adapter).toThrow(
        'Adapter "slack" not found'
      );
    });

    it("retains ownership while streams from different bots interleave", async () => {
      const adapter = createMockAdapter("slack");
      const first = new Chat({
        userName: "first",
        adapters: { slack: adapter },
        state: createMockState(),
        fallbackStreamingPlaceholderText: null,
        logger: "silent",
      });
      const id = "slack:C123:1234.5678";
      const payload = JSON.stringify(first.thread(id));
      const thread = JSON.parse(payload, first.reviver()) as ThreadImpl;
      let resume: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let started: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      async function* delayed() {
        started();
        await gate;
        yield "First";
      }
      const pending = thread.post(delayed());
      try {
        await ready;
        const second = JSON.parse(payload, chat.reviver()) as ThreadImpl;
        async function* immediate() {
          yield "Second";
        }
        await second.post(immediate());
        clearChatSingleton();
      } finally {
        resume();
        await pending;
      }
      expect(adapter.postMessage).toHaveBeenCalledWith(id, {
        markdown: "First",
      });
      const sent = await pending;
      await sent.edit("Edited first");
      await sent.delete();
      expect(adapter.editMessage).toHaveBeenCalledWith(
        id,
        sent.id,
        "Edited first"
      );
      expect(adapter.deleteMessage).toHaveBeenCalledWith(id, sent.id);
      expect(chat.getAdapter("slack")?.deleteMessage).not.toHaveBeenCalled();
    });

    it("rebinds serialized objects without retaining the previous runtime", () => {
      const payload = JSON.stringify({
        nested: [
          chat.thread("slack:C123:1234.5678"),
          chat.channel("slack:C123"),
        ],
        message: createTestMessage("message", "Hello"),
        values: [null, false, 0, "", { _type: "unknown" }],
      });
      const restored = JSON.parse(payload, chat.reviver()) as {
        nested: [ThreadImpl, ChannelImpl];
        message: Message;
        values: unknown[];
      };
      expect(restored.message.metadata.dateSent).toBeInstanceOf(Date);
      expect(restored.values).toEqual([
        null,
        false,
        0,
        "",
        { _type: "unknown" },
      ]);
      const adapter = createMockAdapter("slack");
      const receiving = new Chat({
        userName: "receiving",
        adapters: { slack: adapter },
        state: createMockState(),
        logger: "silent",
      });
      const rebound = JSON.parse(
        JSON.stringify(restored),
        receiving.reviver()
      ) as typeof restored;
      clearChatSingleton();
      expect(rebound.nested[0].adapter).toBe(adapter);
      expect(rebound.nested[1].adapter).toBe(adapter);
      expect(restored.nested[0].adapter).toBe(chat.getAdapter("slack"));
      expect(JSON.stringify(rebound)).toBe(payload);

      const thread = ThreadImpl[WORKFLOW_DESERIALIZE](
        ThreadImpl[WORKFLOW_SERIALIZE](restored.nested[0])
      );
      const channel = ChannelImpl[WORKFLOW_DESERIALIZE](
        ChannelImpl[WORKFLOW_SERIALIZE](restored.nested[1])
      );
      expect(() => thread.adapter).toThrow("No Chat singleton registered");
      expect(() => channel.adapter).toThrow("No Chat singleton registered");
      receiving.registerSingleton();
      expect(thread.adapter).toBe(adapter);
      expect(channel.adapter).toBe(adapter);
    });

    it("should revive chat:Thread objects", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const payload = JSON.stringify({ thread: json });
      const parsed = JSON.parse(payload, chat.reviver());

      expect(parsed.thread).toBeInstanceOf(ThreadImpl);
      expect(parsed.thread.id).toBe("slack:C123:1234.5678");
    });

    it("should revive chat:Message objects", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Hello",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const payload = JSON.stringify({ message: json });
      const parsed = JSON.parse(payload, chat.reviver());

      expect(parsed.message.id).toBe("msg-1");
      expect(parsed.message.metadata.dateSent).toBeInstanceOf(Date);
    });

    it("should revive both Thread and Message in same payload", () => {
      const threadJson: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const messageJson: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Hello",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const payload = JSON.stringify({
        thread: threadJson,
        message: messageJson,
      });
      const parsed = JSON.parse(payload, chat.reviver());

      expect(parsed.thread).toBeInstanceOf(ThreadImpl);
      expect(parsed.message.metadata.dateSent).toBeInstanceOf(Date);
    });

    it("should leave non-chat objects unchanged", () => {
      const payload = JSON.stringify({
        name: "test",
        count: 42,
        nested: { _type: "other:Type", value: "unchanged" },
      });

      const parsed = JSON.parse(payload, chat.reviver());

      expect(parsed.name).toBe("test");
      expect(parsed.count).toBe(42);
      expect(parsed.nested._type).toBe("other:Type");
    });

    it("should work with nested structures", () => {
      const messageJson: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Hello",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const payload = JSON.stringify({
        data: {
          messages: [messageJson],
        },
      });

      const parsed = JSON.parse(payload, chat.reviver());

      expect(parsed.data.messages[0].metadata.dateSent).toBeInstanceOf(Date);
    });
  });

  describe("standalone reviver()", () => {
    beforeEach(() => {
      const mockState = createMockState();
      const chat = new Chat({
        userName: "test-bot",
        adapters: {
          slack: createMockAdapter("slack"),
          teams: createMockAdapter("teams"),
        },
        state: mockState,
        logger: "silent",
      });
      chat.registerSingleton();
    });

    afterEach(() => {
      clearChatSingleton();
    });

    it("should revive chat:Thread objects", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const payload = JSON.stringify({ thread: json });
      const parsed = JSON.parse(payload, reviver);

      expect(parsed.thread).toBeInstanceOf(ThreadImpl);
      expect(parsed.thread.id).toBe("slack:C123:1234.5678");
    });

    it("should revive chat:Message objects", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Hello",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const payload = JSON.stringify({ message: json });
      const parsed = JSON.parse(payload, reviver);

      expect(parsed.message.id).toBe("msg-1");
      expect(parsed.message.metadata.dateSent).toBeInstanceOf(Date);
    });

    it("should revive both Thread and Message in same payload", () => {
      const threadJson: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const messageJson: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-1",
        threadId: "slack:C123:1234.5678",
        text: "Hello",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      const payload = JSON.stringify({
        thread: threadJson,
        message: messageJson,
      });
      const parsed = JSON.parse(payload, reviver);

      expect(parsed.thread).toBeInstanceOf(ThreadImpl);
      expect(parsed.message.metadata.dateSent).toBeInstanceOf(Date);
    });

    it("should leave non-chat objects unchanged", () => {
      const payload = JSON.stringify({
        name: "test",
        count: 42,
        nested: { _type: "other:Type", value: "unchanged" },
      });

      const parsed = JSON.parse(payload, reviver);

      expect(parsed.name).toBe("test");
      expect(parsed.count).toBe(42);
      expect(parsed.nested._type).toBe("other:Type");
    });

    it("should be usable directly as JSON.parse second argument", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-direct",
        threadId: "slack:C123:1234.5678",
        text: "Direct usage",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-01-15T10:30:00.000Z",
          edited: false,
        },
        attachments: [],
      };

      // This is the key use case: passing reviver directly without wrapping
      const parsed = JSON.parse(JSON.stringify(json), reviver);

      expect(parsed.id).toBe("msg-direct");
      expect(parsed.text).toBe("Direct usage");
      expect(parsed.metadata.dateSent).toBeInstanceOf(Date);
    });

    it("should allow re-serialization of a revived Thread without singleton", () => {
      const json: SerializedThread = {
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      clearChatSingleton();

      const thread = ThreadImpl.fromJSON(json);
      const reserialized = thread.toJSON();

      expect(reserialized._type).toBe("chat:Thread");
      expect(reserialized.adapterName).toBe("slack");
      expect(reserialized.id).toBe("slack:C123:1234.5678");
    });

    it("should allow re-serialization of a revived Channel without singleton", () => {
      const json: SerializedChannel = {
        _type: "chat:Channel",
        id: "C123",
        isDM: false,
        adapterName: "slack",
      };

      clearChatSingleton();

      const channel = ChannelImpl.fromJSON(json);
      const reserialized = channel.toJSON();

      expect(reserialized._type).toBe("chat:Channel");
      expect(reserialized.adapterName).toBe("slack");
      expect(reserialized.id).toBe("C123");
    });
  });

  describe("@workflow/serde integration", () => {
    let chat: Chat;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockState = createMockState();
      chat = new Chat({
        userName: "test-bot",
        adapters: {
          slack: createMockAdapter("slack"),
          teams: createMockAdapter("teams"),
        },
        state: mockState,
        logger: "silent",
      });
    });

    afterEach(() => {
      // Clear the singleton between tests
      clearChatSingleton();
    });

    describe("ThreadImpl", () => {
      it("should have WORKFLOW_SERIALIZE static method", () => {
        expect(ThreadImpl[WORKFLOW_SERIALIZE]).toBeDefined();
        expect(typeof ThreadImpl[WORKFLOW_SERIALIZE]).toBe("function");
      });

      it("should have WORKFLOW_DESERIALIZE static method", () => {
        expect(ThreadImpl[WORKFLOW_DESERIALIZE]).toBeDefined();
        expect(typeof ThreadImpl[WORKFLOW_DESERIALIZE]).toBe("function");
      });

      it("should serialize via WORKFLOW_SERIALIZE", () => {
        const mockAdapter = createMockAdapter("slack");
        const mockState = createMockState();

        const thread = new ThreadImpl({
          id: "slack:C123:1234.5678",
          adapter: mockAdapter,
          channelId: "C123",
          stateAdapter: mockState,
          isDM: false,
        });

        const serialized = ThreadImpl[WORKFLOW_SERIALIZE](thread);

        expect(serialized).toEqual({
          _type: "chat:Thread",
          id: "slack:C123:1234.5678",
          channelId: "C123",
          channelVisibility: "unknown",
          currentMessage: undefined,
          isDM: false,
          adapterName: "slack",
        });
      });

      it("should deserialize via WORKFLOW_DESERIALIZE with lazy resolution", () => {
        const data: SerializedThread = {
          _type: "chat:Thread",
          id: "slack:C123:1234.5678",
          channelId: "C123",
          isDM: false,
          adapterName: "slack",
        };

        // Register the Chat singleton for lazy resolution
        chat.registerSingleton();

        // WORKFLOW_DESERIALIZE now returns a ThreadImpl with lazy adapter resolution
        const result = ThreadImpl[WORKFLOW_DESERIALIZE](data);

        expect(result).toBeInstanceOf(ThreadImpl);
        expect(result.id).toBe("slack:C123:1234.5678");
        expect(result.channelId).toBe("C123");
        expect(result.isDM).toBe(false);
        // Adapter is lazily resolved from the singleton
        expect(result.adapter.name).toBe("slack");
      });
    });

    describe("Message", () => {
      it("should have WORKFLOW_SERIALIZE static method", () => {
        expect(Message[WORKFLOW_SERIALIZE]).toBeDefined();
        expect(typeof Message[WORKFLOW_SERIALIZE]).toBe("function");
      });

      it("should have WORKFLOW_DESERIALIZE static method", () => {
        expect(Message[WORKFLOW_DESERIALIZE]).toBeDefined();
        expect(typeof Message[WORKFLOW_DESERIALIZE]).toBe("function");
      });

      it("should serialize via WORKFLOW_SERIALIZE", () => {
        const message = createTestMessage("msg-1", "Hello world");

        const serialized = Message[WORKFLOW_SERIALIZE](message);

        expect(serialized._type).toBe("chat:Message");
        expect(serialized.id).toBe("msg-1");
        expect(serialized.text).toBe("Hello world");
        expect(typeof serialized.metadata.dateSent).toBe("string");
      });

      it("should deserialize via WORKFLOW_DESERIALIZE", () => {
        const data: SerializedMessage = {
          _type: "chat:Message",
          id: "msg-1",
          threadId: "slack:C123:1234.5678",
          text: "Hello",
          formatted: { type: "root", children: [] },
          raw: {},
          author: {
            userId: "U123",
            userName: "testuser",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
          metadata: {
            dateSent: "2024-01-15T10:30:00.000Z",
            edited: false,
          },
          attachments: [],
        };

        const message = Message[WORKFLOW_DESERIALIZE](data);

        expect(message.id).toBe("msg-1");
        expect(message.text).toBe("Hello");
        expect(message.metadata.dateSent).toBeInstanceOf(Date);
      });

      it("should round-trip via WORKFLOW_SERIALIZE and WORKFLOW_DESERIALIZE", () => {
        const original = createTestMessage("msg-1", "Test message", {
          isMention: true,
        });

        const serialized = Message[WORKFLOW_SERIALIZE](original);
        const restored = Message[WORKFLOW_DESERIALIZE](serialized);

        expect(restored.id).toBe(original.id);
        expect(restored.text).toBe(original.text);
        expect(restored.isMention).toBe(original.isMention);
        expect(restored.metadata.dateSent.getTime()).toBe(
          original.metadata.dateSent.getTime()
        );
      });
    });
  });
});
