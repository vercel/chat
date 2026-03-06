import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelImpl, deriveChannelId } from "./channel";
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "./mock-adapter";
import { ThreadImpl } from "./thread";
import type { Adapter, Message, ThreadSummary } from "./types";

describe("ChannelImpl", () => {
  describe("basic properties", () => {
    it("should have correct id and adapter", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });

      expect(channel.id).toBe("slack:C123");
      expect(channel.adapter).toBe(mockAdapter);
      expect(channel.isDM).toBe(false);
      expect(channel.name).toBeNull();
    });

    it("should set isDM when configured", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:D123",
        adapter: mockAdapter,
        stateAdapter: mockState,
        isDM: true,
      });

      expect(channel.isDM).toBe(true);
    });
  });

  describe("state management", () => {
    let channel: ChannelImpl<{ topic?: string; count?: number }>;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      const mockAdapter = createMockAdapter();
      mockState = createMockState();

      channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });
    });

    it("should return null when no state has been set", async () => {
      const state = await channel.state;
      expect(state).toBeNull();
    });

    it("should set and retrieve state", async () => {
      await channel.setState({ topic: "general" });
      const state = await channel.state;
      expect(state).toEqual({ topic: "general" });
    });

    it("should merge state by default", async () => {
      await channel.setState({ topic: "general" });
      await channel.setState({ count: 5 });
      const state = await channel.state;
      expect(state).toEqual({ topic: "general", count: 5 });
    });

    it("should replace state when option is set", async () => {
      await channel.setState({ topic: "general", count: 5 });
      await channel.setState({ count: 10 }, { replace: true });
      const state = await channel.state;
      expect(state).toEqual({ count: 10 });
    });

    it("should use channel-state: key prefix", async () => {
      await channel.setState({ topic: "general" });
      expect(mockState.set).toHaveBeenCalledWith(
        "channel-state:slack:C123",
        { topic: "general" },
        expect.any(Number)
      );
    });
  });

  describe("messages iterator (newest first)", () => {
    let channel: ChannelImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });
    });

    it("should use fetchChannelMessages when available", async () => {
      const messages = [
        createTestMessage("msg-1", "Oldest"),
        createTestMessage("msg-2", "Middle"),
        createTestMessage("msg-3", "Newest"),
      ];

      (
        mockAdapter.fetchChannelMessages as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        messages,
        nextCursor: undefined,
      });

      const collected: Message[] = [];
      for await (const msg of channel.messages) {
        collected.push(msg);
      }

      // Should be reversed (newest first)
      expect(collected).toHaveLength(3);
      expect(collected[0].text).toBe("Newest");
      expect(collected[1].text).toBe("Middle");
      expect(collected[2].text).toBe("Oldest");

      expect(mockAdapter.fetchChannelMessages).toHaveBeenCalledWith(
        "slack:C123",
        expect.objectContaining({ direction: "backward" })
      );
    });

    it("should fall back to fetchMessages when fetchChannelMessages is not available", async () => {
      mockAdapter.fetchChannelMessages = undefined;

      const messages = [
        createTestMessage("msg-1", "First"),
        createTestMessage("msg-2", "Second"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        }
      );

      const collected: Message[] = [];
      for await (const msg of channel.messages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].text).toBe("Second");
      expect(collected[1].text).toBe("First");

      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123",
        expect.objectContaining({ direction: "backward" })
      );
    });

    it("should auto-paginate through multiple pages", async () => {
      let callCount = 0;
      (
        mockAdapter.fetchChannelMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            messages: [
              createTestMessage("msg-3", "Page 1 Newest"),
              createTestMessage("msg-4", "Page 1 Older"),
            ],
            nextCursor: "cursor-1",
          };
        }
        return {
          messages: [
            createTestMessage("msg-1", "Page 2 Newest"),
            createTestMessage("msg-2", "Page 2 Older"),
          ],
          nextCursor: undefined,
        };
      });

      const collected: Message[] = [];
      for await (const msg of channel.messages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(4);
      // Each page is reversed internally
      expect(collected[0].text).toBe("Page 1 Older");
      expect(collected[1].text).toBe("Page 1 Newest");
      expect(collected[2].text).toBe("Page 2 Older");
      expect(collected[3].text).toBe("Page 2 Newest");
      expect(mockAdapter.fetchChannelMessages).toHaveBeenCalledTimes(2);
    });

    it("should allow breaking out early", async () => {
      (
        mockAdapter.fetchChannelMessages as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        messages: [
          createTestMessage("msg-1", "First"),
          createTestMessage("msg-2", "Second"),
          createTestMessage("msg-3", "Third"),
        ],
        nextCursor: "more",
      });

      const collected: Message[] = [];
      for await (const msg of channel.messages) {
        collected.push(msg);
        if (collected.length >= 2) {
          break;
        }
      }

      expect(collected).toHaveLength(2);
      expect(mockAdapter.fetchChannelMessages).toHaveBeenCalledTimes(1);
    });

    it("should handle empty channel", async () => {
      (
        mockAdapter.fetchChannelMessages as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        messages: [],
        nextCursor: undefined,
      });

      const collected: Message[] = [];
      for await (const msg of channel.messages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(0);
    });
  });

  describe("threads iterator", () => {
    let channel: ChannelImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });
    });

    it("should iterate threads from adapter.listThreads", async () => {
      const threadSummaries = [
        {
          id: "slack:C123:1234.5678",
          rootMessage: createTestMessage("msg-1", "Thread 1"),
          replyCount: 5,
        },
        {
          id: "slack:C123:2345.6789",
          rootMessage: createTestMessage("msg-2", "Thread 2"),
          replyCount: 3,
        },
      ];

      (mockAdapter.listThreads as ReturnType<typeof vi.fn>).mockResolvedValue({
        threads: threadSummaries,
        nextCursor: undefined,
      });

      const collected: ThreadSummary[] = [];
      for await (const t of channel.threads()) {
        collected.push(t);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].id).toBe("slack:C123:1234.5678");
      expect(collected[0].replyCount).toBe(5);
      expect(collected[1].id).toBe("slack:C123:2345.6789");
    });

    it("should return empty iterable when adapter has no listThreads", async () => {
      mockAdapter.listThreads = undefined;

      const collected: ThreadSummary[] = [];
      for await (const t of channel.threads()) {
        collected.push(t);
      }

      expect(collected).toHaveLength(0);
    });

    it("should auto-paginate threads", async () => {
      let callCount = 0;
      (mockAdapter.listThreads as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++;
          if (callCount === 1) {
            return {
              threads: [
                {
                  id: "slack:C123:1111",
                  rootMessage: createTestMessage("msg-1", "T1"),
                  replyCount: 2,
                },
              ],
              nextCursor: "cursor-1",
            };
          }
          return {
            threads: [
              {
                id: "slack:C123:2222",
                rootMessage: createTestMessage("msg-2", "T2"),
                replyCount: 1,
              },
            ],
            nextCursor: undefined,
          };
        }
      );

      const collected: ThreadSummary[] = [];
      for await (const t of channel.threads()) {
        collected.push(t);
      }

      expect(collected).toHaveLength(2);
      expect(mockAdapter.listThreads).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchMetadata", () => {
    it("should fetch channel info and set name", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });

      expect(channel.name).toBeNull();

      const info = await channel.fetchMetadata();

      expect(info.id).toBe("slack:C123");
      expect(info.name).toBe("#slack:C123");
      expect(channel.name).toBe("#slack:C123");
    });

    it("should return basic info when adapter has no fetchChannelInfo", async () => {
      const mockAdapter = createMockAdapter();
      mockAdapter.fetchChannelInfo = undefined;
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });

      const info = await channel.fetchMetadata();

      expect(info.id).toBe("slack:C123");
      expect(info.isDM).toBe(false);
      expect(info.metadata).toEqual({});
    });
  });

  describe("post", () => {
    it("should use postChannelMessage when available", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });

      const result = await channel.post("Hello channel!");

      expect(mockAdapter.postChannelMessage).toHaveBeenCalledWith(
        "slack:C123",
        "Hello channel!"
      );
      expect(result.text).toBe("Hello channel!");
    });

    it("should fall back to postMessage when postChannelMessage is not available", async () => {
      const mockAdapter = createMockAdapter();
      mockAdapter.postChannelMessage = undefined;
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });

      await channel.post("Hello!");

      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123",
        "Hello!"
      );
    });

    it("should handle streaming by accumulating text", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });

      async function* textStream() {
        yield "Hello";
        yield " ";
        yield "World";
      }

      const result = await channel.post(textStream());

      expect(mockAdapter.postChannelMessage).toHaveBeenCalledWith(
        "slack:C123",
        "Hello World"
      );
      expect(result.text).toBe("Hello World");
    });
  });

  describe("post with different message formats", () => {
    let channel: ChannelImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();

      channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
      });
    });

    it("should handle raw message format", async () => {
      const result = await channel.post({ raw: "raw text message" });

      expect(mockAdapter.postChannelMessage).toHaveBeenCalledWith(
        "slack:C123",
        { raw: "raw text message" }
      );
      expect(result.text).toBe("raw text message");
    });

    it("should handle markdown message format", async () => {
      const result = await channel.post({ markdown: "**bold** text" });

      expect(result.text).toBe("bold text");
    });

    it("should handle AST message format", async () => {
      const {
        root: rootFn,
        paragraph: paragraphFn,
        text: textFn,
      } = await import("./markdown");
      const ast = rootFn([paragraphFn([textFn("from ast")])]);
      const result = await channel.post({ ast });

      expect(result.text).toBe("from ast");
    });

    it("should handle raw message with attachments", async () => {
      const result = await channel.post({
        raw: "text with attachment",
        attachments: [{ type: "image", url: "https://example.com/img.png" }],
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].type).toBe("image");
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const channel = new ChannelImpl({
        id: "slack:C123",
        adapter: mockAdapter,
        stateAdapter: mockState,
        isDM: false,
      });

      const json = channel.toJSON();
      expect(json).toEqual({
        _type: "chat:Channel",
        id: "slack:C123",
        adapterName: "slack",
        isDM: false,
      });
    });

    it("should deserialize from JSON", () => {
      const json = {
        _type: "chat:Channel" as const,
        id: "slack:C123",
        adapterName: "slack",
        isDM: false,
      };

      const mockAdapter = createMockAdapter();
      const channel = ChannelImpl.fromJSON(json, mockAdapter);

      expect(channel.id).toBe("slack:C123");
      expect(channel.isDM).toBe(false);
      expect(channel.adapter).toBe(mockAdapter);
    });
  });
});

describe("deriveChannelId", () => {
  it("should use adapter.channelIdFromThreadId when available", () => {
    const mockAdapter = createMockAdapter();

    const channelId = deriveChannelId(mockAdapter, "slack:C123:1234.5678");
    expect(channelId).toBe("slack:C123");
    expect(mockAdapter.channelIdFromThreadId).toHaveBeenCalledWith(
      "slack:C123:1234.5678"
    );
  });

  it("should use default fallback (first two parts)", () => {
    const mockAdapter = createMockAdapter();
    mockAdapter.channelIdFromThreadId = undefined;

    const channelId = deriveChannelId(mockAdapter, "slack:C123:1234.5678");
    expect(channelId).toBe("slack:C123");
  });

  it("should work with different adapters", () => {
    const mockAdapter = createMockAdapter("gchat");
    mockAdapter.channelIdFromThreadId = undefined;

    const channelId = deriveChannelId(
      mockAdapter,
      "gchat:spaces/ABC123:dGhyZWFk"
    );
    expect(channelId).toBe("gchat:spaces/ABC123");
  });
});

describe("thread.channel", () => {
  it("should return a Channel for the thread's parent channel", () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const thread = new ThreadImpl({
      id: "slack:C123:1234.5678",
      adapter: mockAdapter,
      channelId: "C123",
      stateAdapter: mockState,
    });

    const channel = thread.channel;
    expect(channel.id).toBe("slack:C123");
    expect(channel.adapter).toBe(mockAdapter);
  });

  it("should cache the channel instance", () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const thread = new ThreadImpl({
      id: "slack:C123:1234.5678",
      adapter: mockAdapter,
      channelId: "C123",
      stateAdapter: mockState,
    });

    const channel1 = thread.channel;
    const channel2 = thread.channel;
    expect(channel1).toBe(channel2);
  });

  it("should inherit isDM from thread", () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const thread = new ThreadImpl({
      id: "slack:D123:1234.5678",
      adapter: mockAdapter,
      channelId: "D123",
      stateAdapter: mockState,
      isDM: true,
    });

    expect(thread.channel.isDM).toBe(true);
  });
});

describe("ChannelImpl.postEphemeral", () => {
  let channel: ChannelImpl;
  let mockAdapter: Adapter;
  let mockState: ReturnType<typeof createMockState>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    mockState = createMockState();

    channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });
  });

  it("should use adapter postEphemeral when available", async () => {
    const mockPostEphemeral = vi.fn().mockResolvedValue({
      id: "eph-1",
      threadId: "slack:C123",
      usedFallback: false,
      raw: {},
    });
    mockAdapter.postEphemeral = mockPostEphemeral;

    const result = await channel.postEphemeral("U456", "Secret!", {
      fallbackToDM: true,
    });

    expect(mockPostEphemeral).toHaveBeenCalledWith(
      "slack:C123",
      "U456",
      "Secret!"
    );
    expect(result).toEqual({
      id: "eph-1",
      threadId: "slack:C123",
      usedFallback: false,
      raw: {},
    });
  });

  it("should extract userId from Author object", async () => {
    const mockPostEphemeral = vi.fn().mockResolvedValue({
      id: "eph-1",
      threadId: "slack:C123",
      usedFallback: false,
      raw: {},
    });
    mockAdapter.postEphemeral = mockPostEphemeral;

    const author = {
      userId: "U789",
      userName: "testuser",
      fullName: "Test User",
      isBot: false as const,
      isMe: false as const,
    };

    await channel.postEphemeral(author, "Hello!", { fallbackToDM: false });

    expect(mockPostEphemeral).toHaveBeenCalledWith(
      "slack:C123",
      "U789",
      "Hello!"
    );
  });

  it("should return null when adapter has no postEphemeral and fallbackToDM is false", async () => {
    mockAdapter.postEphemeral = undefined;

    const result = await channel.postEphemeral("U456", "Secret!", {
      fallbackToDM: false,
    });

    expect(result).toBeNull();
  });

  it("should fallback to DM when adapter has no postEphemeral and fallbackToDM is true", async () => {
    mockAdapter.postEphemeral = undefined;

    const result = await channel.postEphemeral("U456", "Secret!", {
      fallbackToDM: true,
    });

    expect(mockAdapter.openDM).toHaveBeenCalledWith("U456");
    expect(mockAdapter.postMessage).toHaveBeenCalledWith(
      "slack:DU456:",
      "Secret!"
    );
    expect(result).toEqual({
      id: "msg-1",
      threadId: "slack:DU456:",
      usedFallback: true,
      raw: {},
    });
  });

  it("should return null when no postEphemeral, no openDM, and fallbackToDM is true", async () => {
    mockAdapter.postEphemeral = undefined;
    mockAdapter.openDM = undefined;

    const result = await channel.postEphemeral("U456", "Secret!", {
      fallbackToDM: true,
    });

    expect(result).toBeNull();
  });
});

describe("ChannelImpl.startTyping", () => {
  it("should call adapter.startTyping with channel id", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    await channel.startTyping();

    expect(mockAdapter.startTyping).toHaveBeenCalledWith(
      "slack:C123",
      undefined
    );
  });

  it("should pass status string to adapter.startTyping", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    await channel.startTyping("thinking...");

    expect(mockAdapter.startTyping).toHaveBeenCalledWith(
      "slack:C123",
      "thinking..."
    );
  });
});

describe("ChannelImpl.mentionUser", () => {
  it("should return formatted mention string", () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    expect(channel.mentionUser("U456")).toBe("<@U456>");
  });

  it("should handle different user ID formats", () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    expect(channel.mentionUser("UABC123DEF")).toBe("<@UABC123DEF>");
    expect(channel.mentionUser("bot-user")).toBe("<@bot-user>");
  });
});

describe("ChannelImpl.post error cases", () => {
  it("should handle postChannelMessage returning a threadId override", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();
    (
      mockAdapter.postChannelMessage as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "msg-2",
      threadId: "slack:C123:new-thread",
      raw: {},
    });

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    const result = await channel.post("Hello!");

    expect(result.threadId).toBe("slack:C123:new-thread");
  });

  it("should return a SentMessage with edit/delete capabilities", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    const result = await channel.post("Hello!");

    expect(typeof result.edit).toBe("function");
    expect(typeof result.delete).toBe("function");
    expect(typeof result.addReaction).toBe("function");
    expect(typeof result.removeReaction).toBe("function");
  });

  it("should allow editing a sent message", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    const result = await channel.post("Hello!");
    await result.edit("Updated!");

    expect(mockAdapter.editMessage).toHaveBeenCalledWith(
      "slack:C123",
      "msg-1",
      "Updated!"
    );
  });

  it("should allow deleting a sent message", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    const result = await channel.post("Hello!");
    await result.delete();

    expect(mockAdapter.deleteMessage).toHaveBeenCalledWith(
      "slack:C123",
      "msg-1"
    );
  });

  it("should allow adding a reaction to a sent message", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    const result = await channel.post("Hello!");
    await result.addReaction("thumbsup");

    expect(mockAdapter.addReaction).toHaveBeenCalledWith(
      "slack:C123",
      "msg-1",
      "thumbsup"
    );
  });

  it("should allow removing a reaction from a sent message", async () => {
    const mockAdapter = createMockAdapter();
    const mockState = createMockState();

    const channel = new ChannelImpl({
      id: "slack:C123",
      adapter: mockAdapter,
      stateAdapter: mockState,
    });

    const result = await channel.post("Hello!");
    await result.removeReaction("thumbsup");

    expect(mockAdapter.removeReaction).toHaveBeenCalledWith(
      "slack:C123",
      "msg-1",
      "thumbsup"
    );
  });
});

describe("thread.messages (newest first)", () => {
  let thread: ThreadImpl;
  let mockAdapter: Adapter;
  let mockState: ReturnType<typeof createMockState>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    mockState = createMockState();

    thread = new ThreadImpl({
      id: "slack:C123:1234.5678",
      adapter: mockAdapter,
      channelId: "C123",
      stateAdapter: mockState,
    });
  });

  it("should iterate messages newest first", async () => {
    const messages = [
      createTestMessage("msg-1", "Oldest"),
      createTestMessage("msg-2", "Middle"),
      createTestMessage("msg-3", "Newest"),
    ];

    (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages,
      nextCursor: undefined,
    });

    const collected: Message[] = [];
    for await (const msg of thread.messages) {
      collected.push(msg);
    }

    expect(collected).toHaveLength(3);
    expect(collected[0].text).toBe("Newest");
    expect(collected[1].text).toBe("Middle");
    expect(collected[2].text).toBe("Oldest");
  });

  it("should use backward direction", async () => {
    (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [],
      nextCursor: undefined,
    });

    for await (const _msg of thread.messages) {
      // No messages
    }

    expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      expect.objectContaining({ direction: "backward" })
    );
  });

  it("should handle pagination", async () => {
    let callCount = 0;
    (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        callCount++;
        if (callCount === 1) {
          return {
            messages: [
              createTestMessage("msg-2", "Page 1 Old"),
              createTestMessage("msg-3", "Page 1 New"),
            ],
            nextCursor: "cursor-1",
          };
        }
        return {
          messages: [createTestMessage("msg-1", "Page 2 Old")],
          nextCursor: undefined,
        };
      }
    );

    const collected: Message[] = [];
    for await (const msg of thread.messages) {
      collected.push(msg);
    }

    expect(collected).toHaveLength(3);
    // Page 1 reversed
    expect(collected[0].text).toBe("Page 1 New");
    expect(collected[1].text).toBe("Page 1 Old");
    // Page 2 reversed
    expect(collected[2].text).toBe("Page 2 Old");
  });

  it("should allow getting N most recent messages with break", async () => {
    const messages = [
      createTestMessage("msg-1", "Old"),
      createTestMessage("msg-2", "Middle"),
      createTestMessage("msg-3", "Recent"),
      createTestMessage("msg-4", "Very Recent"),
      createTestMessage("msg-5", "Newest"),
    ];

    (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages,
      nextCursor: "more",
    });

    // Get the 3 most recent messages
    const recent: Message[] = [];
    for await (const msg of thread.messages) {
      recent.push(msg);
      if (recent.length >= 3) {
        break;
      }
    }

    expect(recent).toHaveLength(3);
    expect(recent[0].text).toBe("Newest");
    expect(recent[1].text).toBe("Very Recent");
    expect(recent[2].text).toBe("Recent");
  });
});
