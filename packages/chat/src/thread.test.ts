import { beforeEach, describe, expect, it, vi } from "vitest";
import { Card } from "./cards";
import type { Message } from "./message";
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
  mockLogger,
} from "./mock-adapter";
import { Plan } from "./plan";
import { StreamingPlan } from "./streaming-plan";
import { ThreadImpl } from "./thread";
import type { Adapter, ScheduledMessage, StreamChunk } from "./types";
import { NotImplementedError } from "./types";

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
      // Should not edit with empty content
      expect(mockAdapter.editMessage).not.toHaveBeenCalled();
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

      // Should post a non-empty fallback since stream must return a SentMessage
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        { markdown: " " }
      );
      expect(mockAdapter.editMessage).not.toHaveBeenCalled();
    });

    it("should not post empty content when table is buffered with null placeholder", async () => {
      mockAdapter.stream = undefined;

      const threadNoPlaceholder = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        fallbackStreamingPlaceholderText: null,
      });

      const textStream = createTextStream([
        "| A | B |\n",
        "|---|---|\n",
        "| 1 | 2 |\n",
      ]);
      await threadNoPlaceholder.post(textStream);

      const postCalls = (mockAdapter.postMessage as ReturnType<typeof vi.fn>)
        .mock.calls;
      for (const call of postCalls) {
        const content = call[1];
        if (typeof content === "object" && "markdown" in content) {
          expect(content.markdown.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("should not edit placeholder to empty during LLM warm-up", async () => {
      mockAdapter.stream = undefined;
      const editFn = mockAdapter.editMessage as ReturnType<typeof vi.fn>;

      const textStream = createTextStream(["Hello world"]);
      await thread.post(textStream);

      for (const call of editFn.mock.calls) {
        const content = call[2];
        if (typeof content === "object" && "markdown" in content) {
          expect(content.markdown.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("should not post empty content during streaming with whitespace chunks", async () => {
      mockAdapter.stream = undefined;

      const threadNoPlaceholder = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        fallbackStreamingPlaceholderText: null,
      });

      const textStream = createTextStream(["  ", "\n", "  \n"]);
      await threadNoPlaceholder.post(textStream);

      const postCalls = (mockAdapter.postMessage as ReturnType<typeof vi.fn>)
        .mock.calls;
      for (const call of postCalls) {
        const content = call[1];
        if (typeof content === "object" && "markdown" in content) {
          expect(content.markdown.length).toBeGreaterThan(0);
        }
      }
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

    it.each([
      {
        expectedTeamId: "T123",
        label: "team_id",
        raw: { team_id: "T123", type: "app_mention" },
      },
      {
        expectedTeamId: "T234",
        label: "team string",
        raw: { team: "T234", type: "message" },
      },
      {
        expectedTeamId: "T345",
        label: "team.id",
        raw: { team: { id: "T345" }, type: "block_actions" },
      },
      {
        expectedTeamId: "T456",
        label: "user.team_id fallback",
        raw: {
          type: "block_actions",
          user: { team_id: "T456" },
        },
      },
    ])("should pass stream options from Slack current message context via $label", async ({
      raw,
      expectedTeamId,
    }) => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const threadWithContext = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage: createTestMessage("original-msg", "test", {
          raw,
          author: {
            userId: "U456",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
        }),
      });

      const textStream = createTextStream(["Hello"]);
      await threadWithContext.post(textStream);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          recipientUserId: "U456",
          recipientTeamId: expectedTeamId,
        })
      );
    });

    it("should forward structured stream chunks to adapter.stream from an action-created thread", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const threadWithActionContext = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage: createTestMessage("action-msg", "", {
          raw: {
            team: { domain: "workspace", id: "T123" },
            type: "block_actions",
          },
          author: {
            userId: "U456",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
        }),
      });

      const taskChunk: StreamChunk = {
        id: "task-1",
        status: "pending",
        title: "Thinking",
        type: "task_update",
      };
      async function* structuredStream(): AsyncIterable<string | StreamChunk> {
        yield "Picking option...";
        yield taskChunk;
      }

      await threadWithActionContext.post(
        structuredStream() as unknown as AsyncIterable<string>
      );

      expect(mockStream).toHaveBeenCalledTimes(1);
      const [, passedStream] = mockStream.mock.calls[0];
      const collected: Array<string | StreamChunk> = [];
      for await (const chunk of passedStream as AsyncIterable<
        string | StreamChunk
      >) {
        collected.push(chunk);
      }
      expect(collected).toContain("Picking option...");
      expect(collected).toContainEqual(taskChunk);
    });

    it("should pass StreamingPlan PostableObject options to adapter.stream", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello"]);
      const streamMsg = new StreamingPlan(textStream, {
        groupTasks: "plan",
        endWith: [{ type: "actions" }],
        updateIntervalMs: 1000,
      });
      await thread.post(streamMsg);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          taskDisplayMode: "plan",
          stopBlocks: [{ type: "actions" }],
          updateIntervalMs: 1000,
        })
      );
    });

    it("should pass StreamingPlan with only groupTasks", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello"]);
      await thread.post(
        new StreamingPlan(textStream, { groupTasks: "timeline" })
      );

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          taskDisplayMode: "timeline",
        })
      );
      const options = mockStream.mock.calls[0][2];
      expect(options.stopBlocks).toBeUndefined();
    });

    it("should pass StreamingPlan with only endWith", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello"]);
      await thread.post(
        new StreamingPlan(textStream, { endWith: [{ type: "actions" }] })
      );

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          stopBlocks: [{ type: "actions" }],
        })
      );
      const options = mockStream.mock.calls[0][2];
      expect(options.taskDisplayMode).toBeUndefined();
    });

    it("should pass StreamingPlan with only updateIntervalMs", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello"]);
      await thread.post(
        new StreamingPlan(textStream, { updateIntervalMs: 2000 })
      );

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.objectContaining({
          updateIntervalMs: 2000,
        })
      );
      const options = mockStream.mock.calls[0][2];
      expect(options.taskDisplayMode).toBeUndefined();
      expect(options.stopBlocks).toBeUndefined();
    });

    it("should route StreamingPlan through fallback when adapter has no native streaming", async () => {
      mockAdapter.stream = undefined;

      const textStream = createTextStream(["Hello", " ", "World"]);
      await thread.post(
        new StreamingPlan(textStream, {
          groupTasks: "plan",
          endWith: [{ type: "actions" }],
          updateIntervalMs: 2000,
        })
      );

      // Should post initial placeholder and edit with final content
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "..."
      );
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "Hello World" }
      );
    });

    it("should still work without options (backward compat)", async () => {
      const mockStream = vi.fn().mockResolvedValue({
        id: "msg-stream",
        threadId: "t1",
        raw: "Hello",
      });
      mockAdapter.stream = mockStream;

      const textStream = createTextStream(["Hello"]);
      await thread.post(textStream);

      expect(mockStream).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Object),
        expect.any(Object)
      );
      const options = mockStream.mock.calls[0][2];
      expect(options.taskDisplayMode).toBeUndefined();
      expect(options.stopBlocks).toBeUndefined();
    });
  });

  describe("fallback streaming error logging", () => {
    it("should log when an intermediate edit fails", async () => {
      const adapter = createMockAdapter();
      const editError = new Error("422 Validation Failed");
      vi.mocked(adapter.editMessage).mockRejectedValueOnce(editError);

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter,
        channelId: "C123",
        stateAdapter: createMockState(),
        streamingUpdateIntervalMs: 10,
        logger: mockLogger,
      });

      async function* slowStream(): AsyncIterable<string> {
        yield "Hel";
        await new Promise((r) => setTimeout(r, 50));
        yield "lo";
      }

      await thread.post(slowStream());

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "fallbackStream edit failed",
        editError
      );
    });
  });

  describe("streaming with StreamChunk objects", () => {
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

    it("should pass StreamChunk objects through to adapter.stream", async () => {
      let capturedChunks: (string | StreamChunk)[] = [];
      const mockStream = vi
        .fn()
        .mockImplementation(
          async (
            _threadId: string,
            stream: AsyncIterable<string | StreamChunk>
          ) => {
            capturedChunks = [];
            for await (const chunk of stream) {
              capturedChunks.push(chunk);
            }
            return { id: "msg-stream", threadId: "t1", raw: {} };
          }
        );
      mockAdapter.stream = mockStream;

      async function* mixedStream() {
        yield "Hello ";
        yield {
          type: "task_update" as const,
          id: "tool-1",
          title: "Running bash",
          details: "Installing dependencies",
          status: "in_progress",
        };
        yield "world";
        yield {
          type: "task_update" as const,
          id: "tool-1",
          title: "Running bash",
          details: "Installed dependencies",
          status: "complete",
          output: "Done",
        };
      }

      const result = await thread.post(mixedStream() as AsyncIterable<string>);

      // Should have been called with the mixed stream
      expect(mockStream).toHaveBeenCalled();

      // All chunks (strings and objects) should pass through
      expect(capturedChunks).toHaveLength(4);
      expect(capturedChunks[0]).toBe("Hello ");
      expect(capturedChunks[1]).toEqual(
        expect.objectContaining({
          type: "task_update",
          details: "Installing dependencies",
          status: "in_progress",
        })
      );
      expect(capturedChunks[2]).toBe("world");
      expect(capturedChunks[3]).toEqual(
        expect.objectContaining({
          type: "task_update",
          details: "Installed dependencies",
          output: "Done",
          status: "complete",
        })
      );

      // Accumulated text should only include strings, not task_update chunks
      expect(result.text).toBe("Hello world");
    });

    it("should accumulate text from markdown_text StreamChunks", async () => {
      let capturedChunks: (string | StreamChunk)[] = [];
      const mockStream = vi
        .fn()
        .mockImplementation(
          async (
            _threadId: string,
            stream: AsyncIterable<string | StreamChunk>
          ) => {
            capturedChunks = [];
            for await (const chunk of stream) {
              capturedChunks.push(chunk);
            }
            return { id: "msg-stream", threadId: "t1", raw: {} };
          }
        );
      mockAdapter.stream = mockStream;

      async function* mdChunkStream() {
        yield { type: "markdown_text" as const, text: "Hello " };
        yield { type: "plan_update" as const, title: "Analyzing code" };
        yield { type: "markdown_text" as const, text: "World" };
      }

      const result = await thread.post(
        mdChunkStream() as AsyncIterable<string>
      );

      // markdown_text chunks contribute to accumulated text; plan_update does not
      expect(result.text).toBe("Hello World");
    });

    it("should extract only text for fallback streaming when chunks are present", async () => {
      // No native stream — falls back to post+edit
      mockAdapter.stream = undefined;

      async function* mixedStream() {
        yield "Hello";
        yield {
          type: "task_update" as const,
          id: "tool-1",
          title: "Running bash",
          details: "Installing dependencies",
          status: "in_progress",
        };
        yield " World";
      }

      await thread.post(mixedStream() as AsyncIterable<string>);

      // Should post placeholder then edit with text-only content
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "..."
      );
      expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
        "slack:C123:1234.5678",
        "msg-1",
        { markdown: "Hello World" }
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

    it("should update a specific task by ID", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);
      const task1 = await plan.addTask({ title: "Step 1" });
      const task2 = await plan.addTask({ title: "Step 2" });

      const updated = await plan.updateTask({
        id: task1?.id,
        output: "Step 1 result",
        status: "complete",
      });

      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(task1?.id);
      expect(updated?.status).toBe("complete");

      const step2 = plan.tasks.find((t) => t.id === task2?.id);
      expect(step2?.status).toBe("in_progress");
    });

    it("should return null when updating by non-existent ID", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);
      await plan.addTask({ title: "Step 1" });

      const updated = await plan.updateTask({
        id: "non-existent-id",
        output: "nope",
      });

      expect(updated).toBeNull();
    });

    it("should still update last in_progress task when no ID provided", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);
      await plan.addTask({ title: "Step 1" });
      await plan.addTask({ title: "Step 2" });

      const updated = await plan.updateTask("Some output");

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("Step 2");
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

    it("should return null when calling addTask before post", async () => {
      const plan = new Plan({ initialMessage: "Not posted yet" });
      const task = await plan.addTask({ title: "Task 1" });
      expect(task).toBeNull();
    });

    it("should return null when calling updateTask before post", async () => {
      const plan = new Plan({ initialMessage: "Not posted yet" });
      const updated = await plan.updateTask("some output");
      expect(updated).toBeNull();
    });

    it("should return null when calling complete before post", async () => {
      const plan = new Plan({ initialMessage: "Not posted yet" });
      await plan.complete({ completeMessage: "Done" });
      expect(plan.tasks[0].status).toBe("in_progress");
    });

    it("should propagate editObject errors from addTask", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi
        .fn()
        .mockRejectedValue(new Error("rate limited"));
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);

      await expect(plan.addTask({ title: "Task 1" })).rejects.toThrow(
        "rate limited"
      );
      expect(plan.tasks).toHaveLength(2);
    });

    it("should continue accepting edits after a failed edit", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi
        .fn()
        .mockRejectedValueOnce(new Error("rate limited"))
        .mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);

      await expect(plan.addTask({ title: "Task 1" })).rejects.toThrow();
      await plan.addTask({ title: "Task 2" });
      expect(plan.tasks).toHaveLength(3);
      expect(mockEditObject).toHaveBeenCalledTimes(2);
    });

    it("should set error status via updateTask", async () => {
      const mockPostObject = vi.fn().mockResolvedValue({
        id: "plan-msg-1",
        threadId: "slack:C123:1234.5678",
      });
      const mockEditObject = vi.fn().mockResolvedValue(undefined);
      mockAdapter.postObject = mockPostObject;
      mockAdapter.editObject = mockEditObject;

      const plan = new Plan({ initialMessage: "Start" });
      await thread.post(plan);
      await plan.addTask({ title: "Risky step" });
      await plan.updateTask({ status: "error", output: "Something failed" });

      const current = plan.currentTask;
      expect(current?.status).toBe("error");
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
        channelVisibility: "unknown",
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

  describe("schedule()", () => {
    let mockAdapter: Adapter;
    let mockState: ReturnType<typeof createMockState>;
    let thread: ThreadImpl;

    const futureDate = new Date("2030-01-01T00:00:00Z");

    function mockScheduleResult(
      overrides?: Partial<ScheduledMessage>
    ): ScheduledMessage {
      return {
        scheduledMessageId: "Q123",
        channelId: "C123",
        postAt: futureDate,
        raw: { ok: true },
        cancel: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

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

    // ---- Error handling: adapter without scheduling support ----

    it("should throw NotImplementedError when adapter has no scheduleMessage", async () => {
      await expect(
        thread.schedule("Hello", { postAt: futureDate })
      ).rejects.toThrow(NotImplementedError);
    });

    it("should include 'scheduling' as the feature in NotImplementedError", async () => {
      try {
        await thread.schedule("Hello", { postAt: futureDate });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NotImplementedError);
        expect((err as NotImplementedError).feature).toBe("scheduling");
      }
    });

    it("should include descriptive message in NotImplementedError", async () => {
      await expect(
        thread.schedule("Hello", { postAt: futureDate })
      ).rejects.toThrow("Scheduled messages are not supported by this adapter");
    });

    // ---- Basic delegation ----

    it("should delegate to adapter.scheduleMessage with correct threadId", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      await thread.schedule("Hello", { postAt: futureDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "Hello",
        { postAt: futureDate }
      );
    });

    it("should return the ScheduledMessage from adapter", async () => {
      const expected = mockScheduleResult();
      mockAdapter.scheduleMessage = vi.fn().mockResolvedValue(expected);

      const result = await thread.schedule("Hello", { postAt: futureDate });

      expect(result).toBe(expected);
    });

    // ---- Return value shape ----

    it("should return scheduledMessageId from adapter", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult({ scheduledMessageId: "Q999" }));

      const result = await thread.schedule("Hello", { postAt: futureDate });
      expect(result.scheduledMessageId).toBe("Q999");
    });

    it("should return channelId from adapter", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult({ channelId: "C456" }));

      const result = await thread.schedule("Hello", { postAt: futureDate });
      expect(result.channelId).toBe("C456");
    });

    it("should return postAt from adapter", async () => {
      const customDate = new Date("2035-06-15T12:00:00Z");
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult({ postAt: customDate }));

      const result = await thread.schedule("Hello", { postAt: futureDate });
      expect(result.postAt).toBe(customDate);
    });

    it("should return raw platform response from adapter", async () => {
      const rawResponse = {
        ok: true,
        scheduled_message_id: "Q123",
        post_at: 123,
      };
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult({ raw: rawResponse }));

      const result = await thread.schedule("Hello", { postAt: futureDate });
      expect(result.raw).toBe(rawResponse);
    });

    it("should return a cancel function", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const result = await thread.schedule("Hello", { postAt: futureDate });
      expect(typeof result.cancel).toBe("function");
    });

    // ---- cancel() ----

    it("should invoke cancel without errors", async () => {
      const cancelFn = vi.fn().mockResolvedValue(undefined);
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult({ cancel: cancelFn }));

      const result = await thread.schedule("Hello", { postAt: futureDate });
      await result.cancel();

      expect(cancelFn).toHaveBeenCalledOnce();
    });

    it("should propagate errors from cancel", async () => {
      const cancelFn = vi.fn().mockRejectedValue(new Error("already sent"));
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult({ cancel: cancelFn }));

      const result = await thread.schedule("Hello", { postAt: futureDate });

      await expect(result.cancel()).rejects.toThrow("already sent");
    });

    // ---- Different message formats ----

    it("should pass string messages through directly", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      await thread.schedule("Plain text", { postAt: futureDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Plain text",
        expect.any(Object)
      );
    });

    it("should pass raw message objects through", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const rawMsg = { raw: "raw text" };
      await thread.schedule(rawMsg, { postAt: futureDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        expect.any(String),
        rawMsg,
        expect.any(Object)
      );
    });

    it("should pass markdown message objects through", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const mdMsg = { markdown: "**bold** text" };
      await thread.schedule(mdMsg, { postAt: futureDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        expect.any(String),
        mdMsg,
        expect.any(Object)
      );
    });

    it("should pass AST message objects through", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const astMsg = {
        ast: { type: "root" as const, children: [] },
      };
      await thread.schedule(astMsg, { postAt: futureDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        expect.any(String),
        astMsg,
        expect.any(Object)
      );
    });

    // ---- JSX / CardElement conversion ----

    it("should convert JSX Card elements to CardElement before passing to adapter", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const jsxCard = Card({ title: "Reminder" });
      await thread.schedule(jsxCard, { postAt: futureDate });

      const passedMessage = (
        mockAdapter.scheduleMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];

      // Should be converted to a CardElement (plain object), not the JSX element
      expect(passedMessage).toHaveProperty("type", "card");
      expect(passedMessage).toHaveProperty("title", "Reminder");
    });

    it("should convert Card JSX with children to CardElement", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const jsxCard = Card({ title: "With Subtitle", subtitle: "Sub" });
      await thread.schedule(jsxCard, { postAt: futureDate });

      const passedMessage = (
        mockAdapter.scheduleMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][1];
      expect(passedMessage).toHaveProperty("type", "card");
      expect(passedMessage).toHaveProperty("title", "With Subtitle");
      expect(passedMessage).toHaveProperty("subtitle", "Sub");
    });

    // ---- postAt variations ----

    it("should pass the exact Date object to adapter", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const specificDate = new Date("2028-12-25T08:00:00Z");
      await thread.schedule("Merry Christmas!", { postAt: specificDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Merry Christmas!",
        { postAt: specificDate }
      );
    });

    // ---- Adapter error propagation ----

    it("should propagate errors thrown by adapter.scheduleMessage", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockRejectedValue(new Error("Slack API error"));

      await expect(
        thread.schedule("Hello", { postAt: futureDate })
      ).rejects.toThrow("Slack API error");
    });

    it("should not call adapter.postMessage when scheduling", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      await thread.schedule("Hello", { postAt: futureDate });

      expect(mockAdapter.postMessage).not.toHaveBeenCalled();
    });

    // ---- Different thread IDs ----

    it("should use the thread's own ID for scheduling", async () => {
      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValue(mockScheduleResult());

      const otherThread = new ThreadImpl({
        id: "slack:C999:9999.0000",
        adapter: mockAdapter,
        channelId: "C999",
        stateAdapter: mockState,
      });

      await otherThread.schedule("Hello", { postAt: futureDate });

      expect(mockAdapter.scheduleMessage).toHaveBeenCalledWith(
        "slack:C999:9999.0000",
        "Hello",
        { postAt: futureDate }
      );
    });

    // ---- Multiple schedules ----

    it("should allow scheduling multiple messages on the same thread", async () => {
      const result1 = mockScheduleResult({ scheduledMessageId: "Q1" });
      const result2 = mockScheduleResult({ scheduledMessageId: "Q2" });
      const result3 = mockScheduleResult({ scheduledMessageId: "Q3" });

      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValueOnce(result1)
        .mockResolvedValueOnce(result2)
        .mockResolvedValueOnce(result3);

      const s1 = await thread.schedule("First", { postAt: futureDate });
      const s2 = await thread.schedule("Second", { postAt: futureDate });
      const s3 = await thread.schedule("Third", { postAt: futureDate });

      expect(s1.scheduledMessageId).toBe("Q1");
      expect(s2.scheduledMessageId).toBe("Q2");
      expect(s3.scheduledMessageId).toBe("Q3");
      expect(mockAdapter.scheduleMessage).toHaveBeenCalledTimes(3);
    });

    it("should cancel individual messages independently", async () => {
      const cancel1 = vi.fn().mockResolvedValue(undefined);
      const cancel2 = vi.fn().mockResolvedValue(undefined);

      mockAdapter.scheduleMessage = vi
        .fn()
        .mockResolvedValueOnce(
          mockScheduleResult({ scheduledMessageId: "Q1", cancel: cancel1 })
        )
        .mockResolvedValueOnce(
          mockScheduleResult({ scheduledMessageId: "Q2", cancel: cancel2 })
        );

      const s1 = await thread.schedule("First", { postAt: futureDate });
      await thread.schedule("Second", { postAt: futureDate });

      await s1.cancel();

      expect(cancel1).toHaveBeenCalledOnce();
      expect(cancel2).not.toHaveBeenCalled();
    });
  });

  describe("getParticipants", () => {
    it("should return unique non-bot authors from messages", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const msg1 = createTestMessage("1", "Hello", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      });
      const msg2 = createTestMessage("2", "Hi", {
        author: {
          userId: "U2",
          userName: "bob",
          fullName: "Bob",
          isBot: false,
          isMe: false,
        },
      });
      const msg3 = createTestMessage("3", "Hello again", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      });

      mockAdapter.fetchMessages = vi
        .fn()
        .mockResolvedValue({ messages: [msg1, msg2, msg3], nextCursor: null });

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      const participants = await thread.getParticipants();
      expect(participants).toHaveLength(2);
      expect(participants.map((p) => p.userId)).toEqual(
        expect.arrayContaining(["U1", "U2"])
      );
    });

    it("should exclude bot messages", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const humanMsg = createTestMessage("1", "Hello", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      });
      const selfBotMsg = createTestMessage("2", "Hi there!", {
        author: {
          userId: "B1",
          userName: "bot",
          fullName: "Bot",
          isBot: true,
          isMe: true,
        },
      });
      const thirdPartyBotMsg = createTestMessage("3", "Notification", {
        author: {
          userId: "B2",
          userName: "jira-bot",
          fullName: "Jira Bot",
          isBot: true,
          isMe: false,
        },
      });

      mockAdapter.fetchMessages = vi.fn().mockResolvedValue({
        messages: [humanMsg, selfBotMsg, thirdPartyBotMsg],
        nextCursor: null,
      });

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      const participants = await thread.getParticipants();
      expect(participants).toHaveLength(1);
      expect(participants[0].userId).toBe("U1");
    });

    it("should return empty array for thread with only bot messages", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      mockAdapter.fetchMessages = vi.fn().mockResolvedValue({
        messages: [
          createTestMessage("1", "Bot message", {
            author: {
              userId: "B1",
              userName: "bot",
              fullName: "Bot",
              isBot: true,
              isMe: true,
            },
          }),
        ],
        nextCursor: null,
      });

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
      });

      const participants = await thread.getParticipants();
      expect(participants).toHaveLength(0);
    });

    it("should include currentMessage author", async () => {
      const mockAdapter = createMockAdapter();
      const mockState = createMockState();

      const currentMsg = createTestMessage("1", "Hey bot", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      });

      mockAdapter.fetchMessages = vi
        .fn()
        .mockResolvedValue({ messages: [], nextCursor: null });

      const thread = new ThreadImpl({
        id: "slack:C123:1234.5678",
        adapter: mockAdapter,
        channelId: "C123",
        stateAdapter: mockState,
        currentMessage: currentMsg,
      });

      const participants = await thread.getParticipants();
      expect(participants).toHaveLength(1);
      expect(participants[0].userId).toBe("U1");
    });
  });
});
