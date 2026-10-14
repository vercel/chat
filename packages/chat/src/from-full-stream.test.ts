import { describe, expect, it } from "vitest";
import { fromFullStream } from "./from-full-stream";

/** Helper: collect all yielded strings from the async generator. */
async function collect(stream: AsyncIterable<string>): Promise<string> {
  let result = "";
  for await (const chunk of stream) {
    result += chunk;
  }
  return result;
}

/** Helper: create an async iterable from an array of events. */
async function* events(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) {
    yield item;
  }
}

describe("fromFullStream", () => {
  describe("fullStream (object events)", () => {
    it("extracts text-delta values", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "hello" },
        { type: "text-delta", textDelta: " world" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("hello world");
    });

    it("injects separator between steps", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "hello." },
        { type: "finish-step" },
        { type: "text-delta", textDelta: "how are you?" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe(
        "hello.\n\nhow are you?"
      );
    });

    it("does not add trailing separator after final finish-step", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "done." },
        { type: "finish-step" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("done.");
    });

    it("handles multiple steps", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "step 1" },
        { type: "finish-step" },
        { type: "text-delta", textDelta: "step 2" },
        { type: "finish-step" },
        { type: "text-delta", textDelta: "step 3" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe(
        "step 1\n\nstep 2\n\nstep 3"
      );
    });

    it("skips tool-call and other non-text events", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "before" },
        { type: "tool-call", toolName: "search", args: {} },
        { type: "tool-result", toolName: "search", result: "data" },
        { type: "finish-step" },
        { type: "tool-call-streaming-start", toolName: "lookup" },
        { type: "text-delta", textDelta: " after" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("before\n\n after");
    });

    it("handles consecutive finish-step events", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "a" },
        { type: "finish-step" },
        { type: "finish-step" },
        { type: "text-delta", textDelta: "b" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("a\n\nb");
    });

    it("does not inject separator when finish-step comes before any text", async () => {
      const stream = events([
        { type: "finish-step" },
        { type: "text-delta", textDelta: "first text" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("first text");
    });

    it("ignores text-delta with non-string textDelta", async () => {
      const stream = events([
        { type: "text-delta", textDelta: 123 },
        { type: "text-delta", textDelta: null },
        { type: "text-delta" },
        { type: "text-delta", textDelta: "ok" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("ok");
    });
  });

  describe("AG-UI streams (TanStack AI chat())", () => {
    it("extracts TEXT_MESSAGE_CONTENT deltas", async () => {
      const stream = events([
        { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
        { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hello" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: " world" },
        { type: "TEXT_MESSAGE_END", messageId: "m1" },
        { type: "RUN_FINISHED", threadId: "t1", runId: "r1" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("hello world");
    });

    it("injects separator between text messages in a tool loop", async () => {
      const stream = events([
        { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Looking." },
        { type: "TEXT_MESSAGE_END", messageId: "m1" },
        { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "search" },
        { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"q":"x"}' },
        { type: "TOOL_CALL_END", toolCallId: "c1" },
        { type: "TOOL_CALL_RESULT", toolCallId: "c1", content: "data" },
        { type: "TEXT_MESSAGE_START", messageId: "m2", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m2", delta: "Found it." },
        { type: "TEXT_MESSAGE_END", messageId: "m2" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe(
        "Looking.\n\nFound it."
      );
    });

    it("does not add trailing separator after final TEXT_MESSAGE_END", async () => {
      const stream = events([
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "done" },
        { type: "TEXT_MESSAGE_END", messageId: "m1" },
        { type: "RUN_FINISHED", threadId: "t1", runId: "r1" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("done");
    });

    it("does not inject separator when TEXT_MESSAGE_END comes before any text", async () => {
      const stream = events([
        { type: "TEXT_MESSAGE_START", messageId: "m0", role: "assistant" },
        { type: "TEXT_MESSAGE_END", messageId: "m0" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "first" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("first");
    });

    it("skips tool-call ARGS deltas even though they carry a delta field", async () => {
      const stream = events([
        { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"secret":1}' },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "visible" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("visible");
    });

    it("skips reasoning and run lifecycle events", async () => {
      const stream = events([
        { type: "REASONING_START", messageId: "r1" },
        { type: "REASONING_MESSAGE_CONTENT", messageId: "r1", delta: "hmm" },
        { type: "REASONING_END", messageId: "r1" },
        { type: "STEP_STARTED", stepName: "think" },
        { type: "STEP_FINISHED", stepName: "think" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "answer" },
        { type: "RUN_ERROR", message: "boom" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("answer");
    });

    it("skips STATE_DELTA even though its delta is an array", async () => {
      const stream = events([
        { type: "STATE_DELTA", delta: [{ op: "add", path: "/x", value: 1 }] },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "text" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("text");
    });

    it("ignores TEXT_MESSAGE_CONTENT with non-string delta", async () => {
      const stream = events([
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: 42 },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "ok" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("ok");
    });

    it("handles AI SDK and AG-UI events in the same stream", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "a" },
        { type: "finish-step" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "b" },
        { type: "TEXT_MESSAGE_END", messageId: "m1" },
        { type: "text-delta", text: "c" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("a\n\nb\n\nc");
    });
  });

  describe("textStream (plain strings)", () => {
    it("passes through string chunks", async () => {
      const stream = events(["hello", " ", "world"]);
      expect(await collect(fromFullStream(stream))).toBe("hello world");
    });

    it("handles single string chunk", async () => {
      const stream = events(["complete message"]);
      expect(await collect(fromFullStream(stream))).toBe("complete message");
    });
  });

  describe("fullStream v6 (text property)", () => {
    it("extracts text-delta with text property (AI SDK v6)", async () => {
      const stream = events([
        { type: "text-delta", id: "0", text: "hello" },
        { type: "text-delta", id: "0", text: " world" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("hello world");
    });

    it("injects separator between steps with text property", async () => {
      const stream = events([
        { type: "text-delta", id: "0", text: "step 1." },
        { type: "finish-step" },
        { type: "text-delta", id: "0", text: "step 2." },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("step 1.\n\nstep 2.");
    });

    it("prefers text over textDelta when both present", async () => {
      const stream = events([
        { type: "text-delta", text: "v6", textDelta: "v5" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("v6");
    });
  });

  describe("mixed and edge cases", () => {
    it("returns empty string for empty stream", async () => {
      const stream = events([]);
      expect(await collect(fromFullStream(stream))).toBe("");
    });

    it("ignores invalid events (null, primitives, missing type)", async () => {
      const stream = events([
        null,
        undefined,
        42,
        { noType: true },
        { type: "text-delta", textDelta: "valid" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("valid");
    });

    it("handles mixed strings and objects", async () => {
      const stream = events([
        "hello",
        { type: "text-delta", textDelta: " world" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("hello world");
    });
  });

  describe("StreamChunk objects", () => {
    it("passes structured chunks through, including reasoning", async () => {
      const chunks = [
        { type: "reasoning", text: "thinking" },
        { type: "plan_update", title: "Plan" },
        { type: "task_update", id: "t1", title: "Task", status: "pending" },
        { type: "markdown_text", text: "answer" },
      ];
      const seen: unknown[] = [];
      for await (const chunk of fromFullStream(events(chunks))) {
        seen.push(chunk);
      }
      expect(seen).toEqual(chunks);
    });

    it("skips AI SDK v4 reasoning events, which have no text field", async () => {
      const stream = events([
        { type: "reasoning", textDelta: "hmm" },
        { type: "text-delta", textDelta: "answer" },
      ]);
      const seen: unknown[] = [];
      for await (const chunk of fromFullStream(stream)) {
        seen.push(chunk);
      }
      expect(seen).toEqual(["answer"]);
    });
  });
});
