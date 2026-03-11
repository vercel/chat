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
        { type: "step-finish" },
        { type: "text-delta", textDelta: "how are you?" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe(
        "hello.\n\nhow are you?"
      );
    });

    it("does not add trailing separator after final step-finish", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "done." },
        { type: "step-finish" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("done.");
    });

    it("handles multiple steps", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "step 1" },
        { type: "step-finish" },
        { type: "text-delta", textDelta: "step 2" },
        { type: "step-finish" },
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
        { type: "step-finish" },
        { type: "tool-call-streaming-start", toolName: "lookup" },
        { type: "text-delta", textDelta: " after" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("before\n\n after");
    });

    it("handles consecutive step-finish events", async () => {
      const stream = events([
        { type: "text-delta", textDelta: "a" },
        { type: "step-finish" },
        { type: "step-finish" },
        { type: "text-delta", textDelta: "b" },
      ]);
      expect(await collect(fromFullStream(stream))).toBe("a\n\nb");
    });

    it("does not inject separator when step-finish comes before any text", async () => {
      const stream = events([
        { type: "step-finish" },
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
        { type: "step-finish" },
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
});
