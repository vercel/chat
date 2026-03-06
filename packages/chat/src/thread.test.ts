import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "./mock-adapter";
import { Plan } from "./plan";
import { ThreadImpl } from "./thread";
import type { Adapter, Message } from "./types";

describe("ThreadImpl", () => {
  describe("Per-thread state", () => {
    let thread: ThreadImpl<{ aiMode?: boolean; counter?: number }>;
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

    it("should return null when no state has been set", async () => {
      const state = await thread.state;
      expect(state).toBeNull();
    });

    it("should return stored state", async () => {
      // Pre-populate state in cache
      mockState.cache.set("thread-state:slack:C123:1234.5678", {
        aiMode: true,
      });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true });
    });

    it("should set state and retrieve it", async () => {
      await thread.setState({ aiMode: true });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true });
    });

    it("should merge state by default", async () => {
      // Set initial state
      await thread.setState({ aiMode: true });

      // Set additional state - should merge
      await thread.setState({ counter: 5 });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true, counter: 5 });
    });

    it("should overwrite existing keys when merging", async () => {
      await thread.setState({ aiMode: true, counter: 1 });
      await thread.setState({ counter: 10 });

      const state = await thread.state;
      expect(state).toEqual({ aiMode: true, counter: 10 });
    });

    it("should replace entire state when replace option is true", async () => {
      await thread.setState({ aiMode: true, counter: 5 });
      await thread.setState({ counter: 10 }, { replace: true });

      const state = await thread.state;
      expect(state).toEqual({ counter: 10 });
      expect((state as { aiMode?: boolean }).aiMode).toBeUndefined();
    });

    it("should use correct key prefix for state storage", async () => {
      await thread.setState({ aiMode: true });

      expect(mockState.set).toHaveBeenCalledWith(
        "thread-state:slack:C123:1234.5678",
        { aiMode: true },
        expect.any(Number) // TTL
      );
    });

    it("should call get with correct key", async () => {
      await thread.state;

      expect(mockState.get).toHaveBeenCalledWith(
        "thread-state:slack:C123:1234.5678"
      );
    });
  });

  describe("post with different message formats", () => {
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

    it("should post a string message", async () => {
      const result = await thread.post("Hello world");

      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "Hello world"
      );
      expect(result.text).toBe("Hello world");
      expect(result.id).toBe("msg-1");
    });

    it("should post a raw message", async () => {
      const result = await thread.post({ raw: "raw text" });

      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { raw: "raw text" }
      );
      expect(result.text).toBe("raw text");
    });

    it("should post a markdown message", async () => {
      const result = await thread.post({ markdown: "**bold** text" });

      expect(result.text).toBe("bold text");
    });

    it("should set correct author on sent message", async () => {
      const result = await thread.post("Hello");

      expect(result.author.isBot).toBe(true);
      expect(result.author.isMe).toBe(true);
      expect(result.author.userId).toBe("self");
      expect(result.author.userName).toBe("slack-bot");
    });

    it("should use threadId override from postMessage response", async () => {
      (mockAdapter.postMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-2",
        threadId: "slack:C123:new-thread-id",
        raw: {},
      });

      const result = await thread.post("Hello");

      expect(result.threadId).toBe("slack:C123:new-thread-id");
    });
  });

  describe("Streaming", () => {
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

    // Helper to create an async iterable from an array of chunks
    async function* createTextStream(
      chunks: string[],
      delayMs = 0
    ): AsyncIterable<string> {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        yield chunk;
      }
    }

    it("should use adapter native streaming when available", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello World",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello", " ", "World"]);
      await thread.post(textStream);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object), // The async iterable
        expect.any(Object) // Stream options
      );
      // Should NOT call postMessage for fallback
      expect(mockAdapter.postMessage).not.toHaveBeenCalled();
    });

    it("should fall back to post+edit when adapter has no native streaming", async () => {
      // Ensure no stream method
      mockAdapter.stream = undefined;

      const textStream = createTextStream(["Hello", " ", "World"]);
      await thread.post(textStream);

      // Should post initial placeholder
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "..."
      );
      // Should edit with final content wrapped as markdown
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "Hello World" }
      );
    });

    it("should accumulate text chunks during streaming", async () => {
      mockAdapter.stream = undefined;

      const textStream = createTextStream([
        "This ",
        "is ",
        "a ",
        "test ",
        "message.",
      ]);
      const result = await thread.post(textStream);

      // Final edit should have all accumulated text wrapped as markdown
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "This is a test message." }
      );
      expect(result.text).toBe("This is a test message.");
    });

    it("should throttle edits to avoid rate limits", async () => {
      vi.useFakeTimers();
      mockAdapter.stream = undefined;

      // Create a stream that yields chunks over time
      const chunks = ["A", "B", "C", "D", "E"];
      let chunkIndex = 0;
      const textStream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIndex < chunks.length) {
                const value = chunks[chunkIndex++];
                return { value, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };

      const postPromise = thread.post(textStream);

      // Initially should just post
      await vi.advanceTimersByTimeAsync(0);
      expect(mockAdapter.postMessage).toHaveBeenCalledTimes(1);

      // Advance time and let stream complete
      await vi.advanceTimersByTimeAsync(2000);
      await postPromise;

      // Should have final edit wrapped as markdown
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "ABCDE" }
      );

      vi.useRealTimers();
    });

    it("should return SentMessage with edit and delete capabilities", async () => {
      mockAdapter.stream = undefined;

      const textStream = createTextStream(["Hello"]);
      const result = await thread.post(textStream);

      expect(result.id).toBe("msg-1");
      expect(typeof result.edit).toBe("function");
      expect(typeof result.delete).toBe("function");
      expect(typeof result.addReaction).toBe("function");
      expect(typeof result.removeReaction).toBe("function");
    });

    it("should handle empty stream", async () => {
      mockAdapter.stream = undefined;

      const textStream = createTextStream([]);
      await thread.post(textStream);

      // Should post initial placeholder
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "..."
      );
      // Should edit with empty string wrapped as markdown (final content)
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "" }
      );
    });

    it("should support disabling the placeholder for fallback streaming", async () => {
      mockAdapter.stream = undefined;

      const threadNoPlaceholder = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        fallbackStreamingPlaceholderText: null,
      });

      const textStream = createTextStream(["H", "i"]);
      await threadNoPlaceholder.post(textStream);

      expect(mockAdapter.postMessage).not.toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "..."
      );
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "Hi" }
      );
    });

    it("should handle empty stream with disabled placeholder", async () => {
      mockAdapter.stream = undefined;

      const threadNoPlaceholder = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        fallbackStreamingPlaceholderText: null,
      });

      const textStream = createTextStream([]);
      await threadNoPlaceholder.post(textStream);

      // Should still post a message (empty) even with no chunks, wrapped as markdown
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { markdown: "" }
      );
      // No edit needed since post content matches accumulated
      expect(mockAdapter.editMessage).not.toHaveBeenCalled();
    });

    it("should preserve newlines in streamed text (native path)", async () => {
      let capturedChunks: string[] = [];
      const mockStream = vi
        .fn()
        .mockImplementation(
          async (_threadId: string, textStream: AsyncIterable<string>) => {
            capturedChunks = [];
            for await (const chunk of textStream) {
              capturedChunks.push(chunk);
            }
            return {
              id: "msg-stream",
              threadId: "t1",
              raw: {},
            };
          }
        );
      mockAdapter.stream = mockStream;

      // Simulate an LLM streaming two paragraphs with a single newline between them
      const textStream = createTextStream([
        "hello",
        ".",
        "\n",
        "how",
        " are",
        " you?",
      ]);
      const result = await thread.post(textStream);

      // The accumulated text should preserve the newline
      expect(result.text).toBe("hello.\nhow are you?");
      // All chunks should have been passed through to the adapter
      expect(capturedChunks).toEqual([
        "hello",
        ".",
        "\n",
        "how",
        " are",
        " you?",
      ]);
    });

    it("should preserve double newlines (paragraph breaks) in streamed text", async () => {
      let capturedChunks: string[] = [];
      const mockStream = vi
        .fn()
        .mockImplementation(
          async (_threadId: string, textStream: AsyncIterable<string>) => {
            capturedChunks = [];
            for await (const chunk of textStream) {
              capturedChunks.push(chunk);
            }
            return {
              id: "msg-stream",
              threadId: "t1",
              raw: {},
            };
          }
        );
      mockAdapter.stream = mockStream;

      // Simulate an LLM streaming two paragraphs with double newline
      const textStream = createTextStream(["hello.", "\n\n", "how are you?"]);
      const result = await thread.post(textStream);

      // Plain text extraction from parsed markdown joins paragraphs without separator
      // (mdast-util-to-string behavior). The formatted AST preserves paragraph structure.
      expect(result.text).toBe("hello.how are you?");
      expect(capturedChunks).toEqual(["hello.", "\n\n", "how are you?"]);
    });

    it("should concatenate multi-step text without separator (demonstrates bug)", async () => {
      let capturedChunks: string[] = [];
      const mockStream = vi
        .fn()
        .mockImplementation(
          async (_threadId: string, textStream: AsyncIterable<string>) => {
            capturedChunks = [];
            for await (const chunk of textStream) {
              capturedChunks.push(chunk);
            }
            return {
              id: "msg-stream",
              threadId: "t1",
              raw: {},
            };
          }
        );
      mockAdapter.stream = mockStream;

      // Simulate a multi-step AI agent where step 1 produces "hello."
      // and step 2 produces "how are you?" with NO separator between steps.
      // This is what happens with AI SDK's textStream across tool-call steps.
      const textStream = createTextStream([
        "hello",
        ".",
        "how",
        " are",
        " you?",
      ]);
      const result = await thread.post(textStream);

      // BUG: text from separate steps is concatenated without any whitespace
      expect(result.text).toBe("hello.how are you?");
    });

    it("should preserve newlines in fallback streaming path", async () => {
      mockAdapter.stream = undefined;

      const textStream = createTextStream(["hello.", "\n", "how are you?"]);
      const result = await thread.post(textStream);

      // Final edit should have all accumulated text with newline preserved, wrapped as markdown
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "hello.\nhow are you?" }
      );
      expect(result.text).toBe("hello.\nhow are you?");
    });

    it("should close incomplete markdown in intermediate fallback edits", async () => {
      mockAdapter.stream = undefined;

      // Simulate streaming where intermediate state has unclosed bold marker
      const textStream = createTextStream(["Hello **wor", "ld** done"], 50);

      // Use short interval so intermediate edit fires between chunks
      const threadWithInterval = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        streamingUpdateIntervalMs: 10,
      });

      const result = await threadWithInterval.post(textStream);

      // Final result text is plain text (markdown formatting stripped)
      expect(result.text).toBe("Hello world done");

      // Check that intermediate edits used remend to close the bold marker
      const editCalls = vi.mocked(mockAdapter.editMessage).mock.calls;
      for (const [, , content] of editCalls) {
        // Content should be wrapped as { markdown: string }
        const markdownContent =
          typeof content === "string"
            ? content
            : (content as { markdown: string }).markdown;
        // Every intermediate edit should have balanced markdown (no dangling **)
        const openCount = (markdownContent.match(/\*\*/g) || []).length;
        expect(openCount % 2).toBe(0);
      }
    });

    it("should pass stream options from current message context", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      // Create thread with current message context
      const threadWithContext = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage: {
          id: "original-msg",
          threadId: "slack:C123:1234.5678",
          text: "test",
          formatted: { type: "root", children: [] },
          raw: { team_id: "T123" },
          author: {
            userId: "U456",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
          metadata: { dateSent: new Date(), edited: false },
          attachments: [],
        },
      });

      const textStream = createTextStream(["Hello"]);
      await threadWithContext.post(textStream);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          recipientUserId: "U456",
          recipientTeamId: "T123",
        })
      );
    });
  });

  describe("allMessages iterator", () => {
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

    it("should iterate through all messages in chronological order", async () => {
      const messages = [
        createTestMessage("msg-1", "First message"),
        createTestMessage("msg-2", "Second message"),
        createTestMessage("msg-3", "Third message"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        }
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(3);
      expect(collected[0].text).toBe("First message");
      expect(collected[1].text).toBe("Second message");
      expect(collected[2].text).toBe("Third message");
    });

    it("should use forward direction for pagination", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        }
      );

      // Consume the iterator
      for await (const _msg of thread.allMessages) {
        // No messages
      }

      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.objectContaining({
          direction: "forward",
          limit: 100,
        })
      );
    });

    it("should handle pagination across multiple pages", async () => {
      const page1 = [
        createTestMessage("msg-1", "Page 1 - Message 1"),
        createTestMessage("msg-2", "Page 1 - Message 2"),
      ];
      const page2 = [
        createTestMessage("msg-3", "Page 2 - Message 1"),
        createTestMessage("msg-4", "Page 2 - Message 2"),
      ];
      const page3 = [createTestMessage("msg-5", "Page 3 - Message 1")];

      let callCount = 0;
      (
        mockAdapter.fetchMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async (_threadId, options) => {
        callCount++;
        if (callCount === 1) {
          expect(options?.cursor).toBeUndefined();
          return { messages: page1, nextCursor: "cursor-1" };
        }
        if (callCount === 2) {
          expect(options?.cursor).toBe("cursor-1");
          return { messages: page2, nextCursor: "cursor-2" };
        }
        expect(options?.cursor).toBe("cursor-2");
        return { messages: page3, nextCursor: undefined };
      });

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(5);
      expect(collected.map((m) => m.text)).toEqual([
        "Page 1 - Message 1",
        "Page 1 - Message 2",
        "Page 2 - Message 1",
        "Page 2 - Message 2",
        "Page 3 - Message 1",
      ]);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(3);
    });

    it("should handle empty thread", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        }
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(0);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should stop when nextCursor is undefined", async () => {
      const messages = [createTestMessage("msg-1", "Single message")];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        }
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(1);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should stop when empty page is returned with cursor", async () => {
      // Edge case: adapter returns a cursor but no messages (shouldn't happen, but be defensive)
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: "some-cursor", // Cursor present but no messages
        }
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
      }

      expect(collected).toHaveLength(0);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should allow breaking out of iteration early", async () => {
      const page1 = [
        createTestMessage("msg-1", "Message 1"),
        createTestMessage("msg-2", "Message 2"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: page1,
          nextCursor: "more-available",
        }
      );

      const collected: Message[] = [];
      for await (const msg of thread.allMessages) {
        collected.push(msg);
        if (msg.id === "msg-1") {
          break; // Break after first message
        }
      }

      expect(collected).toHaveLength(1);
      expect(collected[0].id).toBe("msg-1");
      // Should only fetch once since we broke early within first page
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("should be reusable (can iterate multiple times)", async () => {
      const messages = [createTestMessage("msg-1", "Test message")];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        }
      );

      // First iteration
      const first: Message[] = [];
      for await (const msg of thread.allMessages) {
        first.push(msg);
      }

      // Second iteration
      const second: Message[] = [];
      for await (const msg of thread.allMessages) {
        second.push(msg);
      }

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe("refresh", () => {
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

    it("should update recentMessages from API", async () => {
      const messages = [
        createTestMessage("msg-1", "Recent 1"),
        createTestMessage("msg-2", "Recent 2"),
      ];

      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages,
          nextCursor: undefined,
        }
      );

      expect(thread.recentMessages).toHaveLength(0);

      await thread.refresh();

      expect(thread.recentMessages).toHaveLength(2);
      expect(thread.recentMessages[0].text).toBe("Recent 1");
      expect(thread.recentMessages[1].text).toBe("Recent 2");
    });

    it("should fetch with limit of 50", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        }
      );

      await thread.refresh();

      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { limit: 50 }
      );
    });

    it("should use default (backward) direction", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        }
      );

      await thread.refresh();

      // refresh() doesn't specify direction, so adapter uses its default (backward)
      expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { limit: 50 }
      );
    });
  });

  describe("fetchMessages direction behavior", () => {
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

    it("should pass direction option to adapter", async () => {
      (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          messages: [],
          nextCursor: undefined,
        }
      );

      // Test that allMessages passes forward direction
      for await (const _msg of thread.allMessages) {
        // No messages
      }

      const call = (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(call[1]).toEqual(
        expect.objectContaining({
          direction: "forward",
        })
      );
    });
  });

  describe("concurrent iteration safety", () => {
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

    it("should handle concurrent iterations independently", async () => {
      let callCount = 0;
      (
        mockAdapter.fetchMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async () => {
        callCount++;
        // Return different data for each call to prove independence
        return {
          messages: [
            createTestMessage(`msg-${callCount}`, `Call ${callCount}`),
          ],
          nextCursor: undefined,
        };
      });

      // Start two concurrent iterations
      const results = await Promise.all([
        (async () => {
          const msgs: Message[] = [];
          for await (const msg of thread.allMessages) {
            msgs.push(msg);
          }
          return msgs;
        })(),
        (async () => {
          const msgs: Message[] = [];
          for await (const msg of thread.allMessages) {
            msgs.push(msg);
          }
          return msgs;
        })(),
      ]);

      // Each iteration should have its own messages
      expect(results[0]).toHaveLength(1);
      expect(results[1]).toHaveLength(1);
      // They should have fetched independently
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(2);
    });

    it("should not share cursor state between iterations", async () => {
      const cursors: (string | undefined)[] = [];
      (
        mockAdapter.fetchMessages as ReturnType<typeof vi.fn>
      ).mockImplementation(async (_threadId, options) => {
        cursors.push(options?.cursor);
        return {
          messages: [createTestMessage("msg-1", "Test")],
          nextCursor: undefined,
        };
      });

      // Two sequential iterations
      for await (const _msg of thread.allMessages) {
        // Consume
      }
      for await (const _msg of thread.allMessages) {
        // Consume
      }

      // Both iterations should start with undefined cursor
      expect(cursors).toEqual([undefined, undefined]);
    });
  });

  describe("postEphemeral", () => {
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

    it("should use adapter postEphemeral when available", async () => {
      const mockPostEphemeral = vi.fn().mockResolvedValue({
        id: "ephemeral-1",
        threadId: "slack:C123:1234.5678",
        usedFallback: false,
        raw: {},
      });
      mockAdapter.postEphemeral = mockPostEphemeral;

      const result = await thread.postEphemeral("U456", "Secret message", {
        fallbackToDM: true,
      });

      expect(mockPostEphemeral).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "U456",
        "Secret message"
      );
      expect(result).toEqual({
        id: "ephemeral-1",
        threadId: "slack:C123:1234.5678",
        usedFallback: false,
        raw: {},
      });
    });

    it("should extract userId from Author object", async () => {
      const mockPostEphemeral = vi.fn().mockResolvedValue({
        id: "ephemeral-1",
        threadId: "slack:C123:1234.5678",
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

      await thread.postEphemeral(author, "Secret message", {
        fallbackToDM: true,
      });

      expect(mockPostEphemeral).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "U789",
        "Secret message"
      );
    });

    it("should fallback to DM when adapter has no postEphemeral and fallbackToDM is true", async () => {
      // Ensure no postEphemeral method
      mockAdapter.postEphemeral = undefined;

      const result = await thread.postEphemeral("U456", "Secret message", {
        fallbackToDM: true,
      });

      // Should open DM
      expect(mockAdapter.openDM).toHaveBeenCalledWith("U456");
      // Should post message to DM thread
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:DU456:",
        "Secret message"
      );
      // Should return with usedFallback: true
      expect(result).toEqual({
        id: "msg-1",
        threadId: "slack:DU456:",
        usedFallback: true,
        raw: {},
      });
    });

    it("should return null when adapter has no postEphemeral and fallbackToDM is false", async () => {
      // Ensure no postEphemeral method
      mockAdapter.postEphemeral = undefined;

      const result = await thread.postEphemeral("U456", "Secret message", {
        fallbackToDM: false,
      });

      // Should not open DM or post message
      expect(mockAdapter.openDM).not.toHaveBeenCalled();
      expect(mockAdapter.postMessage).not.toHaveBeenCalled();
      // Should return null
      expect(result).toBeNull();
    });

    it("should return null when adapter has no postEphemeral or openDM", async () => {
      // Remove both methods
      mockAdapter.postEphemeral = undefined;
      mockAdapter.openDM = undefined;

      const result = await thread.postEphemeral("U456", "Secret message", {
        fallbackToDM: true,
      });

      // Should return null since no fallback is possible
      expect(result).toBeNull();
    });

    // Note: Streaming is prevented at the type level - postEphemeral accepts
    // AdapterPostableMessage | CardJSXElement which excludes AsyncIterable<string>
  });

  describe("post with Plan", () => {
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

    it("should post fallback text when adapter does not support plans", async () => {
      const plan = new Plan({ initialMessage: "Starting..." });
      await thread.post(plan);

      // Should have posted fallback text via postMessage
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.stringContaining("Starting...")
      );

      expect(plan.title).toBe("Starting...");
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].status).toBe("in_progress");
      expect(plan.id).toBe("msg-1");
    });

    it("should update via editMessage in fallback mode", async () => {
      const plan = new Plan({ initialMessage: "Starting..." });
      await thread.post(plan);

      const task = await plan.addTask({ title: "Task 1" });
      expect(task).not.toBeNull();
      expect(task?.title).toBe("Task 1");

      // Should edit the message with updated fallback text
      expect(mockAdapter.editMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        expect.stringContaining("Task 1")
      );
    });

    it("should complete plan via editMessage in fallback mode", async () => {
      const plan = new Plan({ initialMessage: "Starting..." });
      await thread.post(plan);

      await plan.addTask({ title: "Step 1" });
      await plan.complete({ completeMessage: "All done!" });

      expect(plan.title).toBe("All done!");
      for (const task of plan.tasks) {
        expect(task.status).toBe("complete");
      }

      // Last editMessage call should contain completed status icons
      const lastCall = (
        mockAdapter.editMessage as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1);
      expect(lastCall?.[2]).toContain("✅");
    });

    it("should call adapter postObject when supported", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Working..." });
      await thread.post(plan);

      expect(mockPostObject).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "plan",
        expect.objectContaining({
          title: "Working...",
          tasks: expect.arrayContaining([
            expect.objectContaining({
              title: "Working...",
              status: "in_progress",
            }),
          ]),
        })
      );
      expect(plan.id).toBe("plan-msg-1");
    });

    it("should add tasks and call editObject", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Starting" });
      await thread.post(plan);
      const task = await plan.addTask({
        title: "Fetch data",
        children: ["Call API", "Parse response"],
      });

      expect(task).not.toBeNull();
      expect(task?.title).toBe("Fetch data");
      expect(task?.status).toBe("in_progress");
      expect(mockEditObject).toHaveBeenCalled();

      // Plan title should be updated to current task
      expect(plan.title).toBe("Fetch data");
      expect(plan.tasks).toHaveLength(2);
    });

    it("should update current task with output", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Working" });
      await thread.post(plan);
      await plan.addTask({ title: "Step 1" });
      const updated = await plan.updateTask("Got result: 42");

      expect(updated).not.toBeNull();
      expect(mockEditObject).toHaveBeenCalled();
    });

    it("should complete plan and mark tasks done", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Starting" });
      await thread.post(plan);
      await plan.addTask({ title: "Task 1" });
      await plan.complete({ completeMessage: "All done!" });

      expect(plan.title).toBe("All done!");
      // All tasks should be completed
      for (const task of plan.tasks) {
        expect(task.status).toBe("complete");
      }
    });

    it("should reset plan and start fresh", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "First run" });
      await thread.post(plan);
      await plan.addTask({ title: "Task A" });
      await plan.addTask({ title: "Task B" });

      expect(plan.tasks).toHaveLength(3);

      const newTask = await plan.reset({ initialMessage: "Second run" });
      expect(newTask).not.toBeNull();
      expect(plan.title).toBe("Second run");
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].status).toBe("in_progress");
    });

    it("should return currentTask correctly", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);

      // Initially, current task is the first one
      let current = plan.currentTask;
      expect(current?.title).toBe("Start");
      expect(current?.status).toBe("in_progress");

      // After adding a new task, current should be the new one
      await plan.addTask({ title: "Step 2" });
      current = plan.currentTask;
      expect(current?.title).toBe("Step 2");
      expect(current?.status).toBe("in_progress");

      // After completion, currentTask returns the last task
      await plan.complete({ completeMessage: "Done" });
      current = plan.currentTask;
      expect(current?.title).toBe("Step 2");
      expect(current?.status).toBe("complete");
    });

    it("should handle various PlanContent formats in initialMessage", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      // String
      let plan = new Plan({ initialMessage: "Simple string" });
      await thread.post(plan);
      expect(plan.title).toBe("Simple string");

      // Array of strings
      plan = new Plan({ initialMessage: ["Line 1", "Line 2"] });
      await thread.post(plan);
      expect(plan.title).toBe("Line 1 Line 2");

      // Empty string defaults to "Plan"
      plan = new Plan({ initialMessage: "" });
      await thread.post(plan);
      expect(plan.title).toBe("Plan");
    });

    it("should ensure sequential edits via queue", async () => {
      const editOrder: number[] = [];
      let editCount = 0;

      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockImplementation(async () => {
        const myOrder = ++editCount;
        // Simulate varying async delays
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        editOrder.push(myOrder);
      });
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);

      // Fire off multiple updates concurrently
      await Promise.all([
        plan.addTask({ title: "Task 1" }),
        plan.updateTask("Output 1"),
        plan.addTask({ title: "Task 2" }),
      ]);

      // Despite random delays, edits should complete in order
      expect(editOrder).toEqual([1, 2, 3]);
    });
  });

  describe("subscribe and unsubscribe", () => {
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

    it("should subscribe via state adapter", async () => {
      await thread.subscribe();

      expect(mockState.subscribe).toHaveBeenCalledWith("slack:C123:1234.5678");
    });

    it("should call adapter.onThreadSubscribe when available", async () => {
      const mockOnSubscribe = vi.fn().mockResolvedValue(undefined);
      mockAdapter.onThreadSubscribe = mockOnSubscribe;

      await thread.subscribe();

      expect(mockOnSubscribe).toHaveBeenCalledWith("slack:C123:1234.5678");
    });

    it("should not error when adapter has no onThreadSubscribe", async () => {
      mockAdapter.onThreadSubscribe = undefined;

      await expect(thread.subscribe()).resolves.toBeUndefined();
      expect(mockState.subscribe).toHaveBeenCalledWith("slack:C123:1234.5678");
    });

    it("should unsubscribe via state adapter", async () => {
      await thread.subscribe();
      await thread.unsubscribe();

      expect(mockState.unsubscribe).toHaveBeenCalledWith(
        "slack:C123:1234.5678"
      );
    });
  });

  describe("isSubscribed", () => {
    let thread: ThreadImpl;
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;

    beforeEach(() => {
      mockAdapter = createMockAdapter();
      mockState = createMockState();
    });

    it("should return false when not subscribed", async () => {
      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      const result = await thread.isSubscribed();
      expect(result).toBe(false);
    });

    it("should return true after subscribing", async () => {
      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      await thread.subscribe();
      const result = await thread.isSubscribed();
      expect(result).toBe(true);
    });

    it("should return false after unsubscribing", async () => {
      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      await thread.subscribe();
      await thread.unsubscribe();
      const result = await thread.isSubscribed();
      expect(result).toBe(false);
    });

    it("should short-circuit and return true when isSubscribedContext is set", async () => {
      thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        isSubscribedContext: true,
      });

      const result = await thread.isSubscribed();
      expect(result).toBe(true);
      // Should NOT have called the state adapter
      expect(mockState.isSubscribed).not.toHaveBeenCalled();
    });
  });

  describe("recentMessages getter/setter", () => {
    it("should start with empty array by default", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      expect(thread.recentMessages).toEqual([]);
    });

    it("should initialize with initialMessage when provided", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();
      const msg = createTestMessage("msg-1", "Initial");

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        initialMessage: msg,
      });

      expect(thread.recentMessages).toHaveLength(1);
      expect(thread.recentMessages[0].text).toBe("Initial");
    });

    it("should allow setting recentMessages", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      const messages = [
        createTestMessage("msg-1", "First"),
        createTestMessage("msg-2", "Second"),
      ];

      thread.recentMessages = messages;

      expect(thread.recentMessages).toHaveLength(2);
      expect(thread.recentMessages[0].text).toBe("First");
      expect(thread.recentMessages[1].text).toBe("Second");
    });

    it("should allow replacing recentMessages", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();
      const msg = createTestMessage("msg-1", "Initial");

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        initialMessage: msg,
      });

      const newMessages = [createTestMessage("msg-2", "Replaced")];
      thread.recentMessages = newMessages;

      expect(thread.recentMessages).toHaveLength(1);
      expect(thread.recentMessages[0].text).toBe("Replaced");
    });
  });

  describe("startTyping", () => {
    it("should call adapter.startTyping with thread id", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      await thread.startTyping();

      expect(mockAdapter.startTyping).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        undefined
      );
    });

    it("should pass status to adapter.startTyping", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      await thread.startTyping("thinking...");

      expect(mockAdapter.startTyping).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "thinking..."
      );
    });
  });

  describe("mentionUser", () => {
    it("should return formatted mention string", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      expect(thread.mentionUser("U456")).toBe("<@U456>");
    });

    it("should handle various user ID formats", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      expect(thread.mentionUser("UABC123")).toBe("<@UABC123>");
      expect(thread.mentionUser("bot-user-id")).toBe("<@bot-user-id>");
    });
  });

  describe("createSentMessageFromMessage", () => {
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

    it("should wrap a Message as a SentMessage with same fields", () => {
      const msg = createTestMessage("msg-1", "Hello world");

      const sent = thread.createSentMessageFromMessage(msg);

      expect(sent.id).toBe("msg-1");
      expect(sent.text).toBe("Hello world");
      expect(sent.threadId).toBe(msg.threadId);
      expect(sent.author).toBe(msg.author);
      expect(sent.metadata).toBe(msg.metadata);
      expect(sent.attachments).toBe(msg.attachments);
    });

    it("should provide edit capability", async () => {
      const msg = createTestMessage("msg-1", "Hello world");

      const sent = thread.createSentMessageFromMessage(msg);
      await sent.edit("Updated content");

      expect(mockAdapter.editMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "Updated content"
      );
    });

    it("should provide delete capability", async () => {
      const msg = createTestMessage("msg-1", "Hello world");

      const sent = thread.createSentMessageFromMessage(msg);
      await sent.delete();

      expect(mockAdapter.deleteMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "msg-1"
      );
    });

    it("should provide addReaction capability", async () => {
      const msg = createTestMessage("msg-1", "Hello world");

      const sent = thread.createSentMessageFromMessage(msg);
      await sent.addReaction("thumbsup");

      expect(mockAdapter.addReaction).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "thumbsup"
      );
    });

    it("should provide removeReaction capability", async () => {
      const msg = createTestMessage("msg-1", "Hello world");

      const sent = thread.createSentMessageFromMessage(msg);
      await sent.removeReaction("thumbsup");

      expect(mockAdapter.removeReaction).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        "thumbsup"
      );
    });

    it("should preserve isMention from original message", () => {
      const msg = createTestMessage("msg-1", "Hello @bot", {
        isMention: true,
      });

      const sent = thread.createSentMessageFromMessage(msg);
      expect(sent.isMention).toBe(true);
    });

    it("should provide toJSON that delegates to the original message", () => {
      const msg = createTestMessage("msg-1", "Hello world");

      const sent = thread.createSentMessageFromMessage(msg);
      const json = sent.toJSON();

      expect(json._type).toBe("chat:Message");
      expect(json.id).toBe("msg-1");
      expect(json.text).toBe("Hello world");
    });
  });

  describe("Streaming with updateIntervalMs", () => {
    it("should use custom streamingUpdateIntervalMs from config", async () => {
      vi.useFakeTimers();
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();
      mockAdapter.stream = undefined;

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        streamingUpdateIntervalMs: 1000,
      });

      let chunkIndex = 0;
      const chunks = ["A", "B", "C"];
      const textStream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIndex < chunks.length) {
                const value = chunks[chunkIndex++];
                return { value, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };

      const postPromise = thread.post(textStream);

      // Let everything resolve
      await vi.advanceTimersByTimeAsync(5000);
      await postPromise;

      // Final text should be accumulated, wrapped as markdown
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "ABC" }
      );

      vi.useRealTimers();
    });

    it("should default streamingUpdateIntervalMs to 500", async () => {
      vi.useFakeTimers();
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();
      mockAdapter.stream = undefined;

      // No streamingUpdateIntervalMs specified - should default to 500
      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      let chunkIndex = 0;
      const chunks = ["X"];
      const textStream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunkIndex < chunks.length) {
                const value = chunks[chunkIndex++];
                return { value, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };

      const postPromise = thread.post(textStream);
      await vi.advanceTimersByTimeAsync(2000);
      await postPromise;

      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "X" }
      );

      vi.useRealTimers();
    });

    it("should use custom placeholder text for fallback streaming", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();
      mockAdapter.stream = undefined;

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        fallbackStreamingPlaceholderText: "Loading...",
      });

      async function* textStream() {
        yield "Done";
      }

      await thread.post(textStream());

      // First post should use the custom placeholder
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "Loading..."
      );
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        isDM: true,
      });

      const json = thread.toJSON();
      expect(json).toEqual({
        _type: "chat:Thread",
        id: "slack:C123:1234.5678",
        channelId: "C123",
        currentMessage: undefined,
        isDM: true,
        adapterName: "slack",
      });
    });

    it("should serialize with currentMessage", () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();
      const msg = createTestMessage("msg-1", "Current");

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage: msg,
      });

      const json = thread.toJSON();
      expect(json.currentMessage).toBeDefined();
      expect(json.currentMessage?._type).toBe("chat:Message");
      expect(json.currentMessage?.text).toBe("Current");
    });

    it("should deserialize from JSON with explicit adapter", () => {
      const mockAdapter = createMockAdapter();

      const json = {
        _type: "chat:Thread" as const,
        id: "slack:C123:1234.5678",
        channelId: "C123",
        isDM: false,
        adapterName: "slack",
      };

      const thread = ThreadImpl.fromJSON(json, mockAdapter);

      expect(thread.id).toBe("slack:C123:1234.5678");
      expect(thread.channelId).toBe("C123");
      expect(thread.isDM).toBe(false);
      expect(thread.adapter).toBe(mockAdapter);
    });

    it("should deserialize with currentMessage", () => {
      const mockAdapter = createMockAdapter();
      const msg = createTestMessage("msg-1", "Serialized");
      const serializedMsg = msg.toJSON();

      const json = {
        _type: "chat:Thread" as const,
        id: "slack:C123:1234.5678",
        channelId: "C123",
        currentMessage: serializedMsg,
        isDM: false,
        adapterName: "slack",
      };

      const thread = ThreadImpl.fromJSON(json, mockAdapter);

      // The currentMessage is internal so we test via toJSON roundtrip
      const roundTripped = thread.toJSON();
      expect(roundTripped.currentMessage?.text).toBe("Serialized");
    });
  });

  describe("SentMessage.toJSON from post", () => {
    it("should serialize a sent message via toJSON", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      const result = await thread.post("Hello world");
      const json = result.toJSON();

      expect(json._type).toBe("chat:Message");
      expect(json.text).toBe("Hello world");
      expect(json.author.isBot).toBe(true);
      expect(json.author.isMe).toBe(true);
    });
  });
});
