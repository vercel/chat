import { describe, expect, it } from "vitest";
import { toChatStream } from "./render";
import { collect, fromEvents } from "./test-utils";

describe("toChatStream", () => {
  it("streams previews and appends only the unsent part of the complete message", async () => {
    const { outcome, stream } = toChatStream(
      fromEvents([
        { messageId: "m1", text: "Hel", type: "text-delta" },
        { messageId: "m1", text: "lo", type: "text-delta" },
        { messageId: "m1", text: "Hello world", type: "message" },
        { reason: "complete", type: "turn-end" },
      ])
    );

    expect(await collect(stream)).toEqual(["Hel", "lo", " world"]);
    expect(outcome.mismatch).toBe(false);
    expect(outcome.ended).toEqual({ reason: "complete", type: "turn-end" });
    expect(outcome.finalText()).toBe("Hello world");
  });

  it("separates consecutive agent messages with a blank line", async () => {
    const { outcome, stream } = toChatStream(
      fromEvents([
        { messageId: "m1", text: "First", type: "message" },
        { messageId: "m2", text: "", type: "message" },
        { messageId: "m3", text: "Second", type: "text-delta" },
      ])
    );

    expect((await collect(stream)).join("")).toBe("First\n\nSecond");
    expect(outcome.finalText()).toBe("First\n\nSecond");
  });

  it("flags a complete message that diverges from its preview", async () => {
    const { outcome, stream } = toChatStream(
      fromEvents([
        { messageId: "m1", text: "Draft", type: "text-delta" },
        { messageId: "m1", text: "Final answer", type: "message" },
      ])
    );

    expect(await collect(stream)).toEqual(["Draft"]);
    expect(outcome.mismatch).toBe(true);
    expect(outcome.finalText()).toBe("Final answer");
  });

  it("renders tool calls as task updates and reuses the tool name", async () => {
    const { stream } = toChatStream(
      fromEvents([
        { id: "t1", name: "web_search", status: "running", type: "tool-call" },
        { id: "t1", status: "complete", type: "tool-call" },
        { id: "t2", status: "error", type: "tool-call" },
      ])
    );

    expect(await collect(stream)).toEqual([
      {
        id: "t1",
        status: "in_progress",
        title: "web_search",
        type: "task_update",
      },
      {
        id: "t1",
        status: "complete",
        title: "web_search",
        type: "task_update",
      },
      { id: "t2", status: "error", title: "Tool", type: "task_update" },
    ]);
  });

  it("stops at approval requests and session endings", async () => {
    const approval = toChatStream(
      fromEvents([
        { requestId: "r1", tools: [], type: "approval-request" },
        { messageId: "m1", text: "ignored", type: "text-delta" },
      ])
    );
    expect(await collect(approval.stream)).toEqual([]);
    expect(approval.outcome.approval?.requestId).toBe("r1");

    const ended = toChatStream(fromEvents([{ type: "session-ended" }]));
    await collect(ended.stream);
    expect(ended.outcome.sessionEnded).toBe(true);
  });
});
