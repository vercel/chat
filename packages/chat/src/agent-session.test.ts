import { describe, expect, it, vi } from "vitest";
import { Chat } from "./chat";
import { createMockAdapter, createMockState } from "./mock-adapter";
import type {
  AgentSessionStoppedEvent,
  AgentSessionTitleChangedEvent,
} from "./types";

describe("agent session events", () => {
  it("dispatches stop events to registered handlers", async () => {
    const adapter = createMockAdapter("slack");
    const chat = new Chat({
      userName: "bot",
      adapters: { slack: adapter },
      state: createMockState(),
      logger: "error",
    });
    const handler = vi.fn();
    chat.onAgentSessionStopped(handler);
    const event: AgentSessionStoppedEvent = {
      adapter,
      channelId: "D1",
      streamingMessageTs: ["2.3"],
      threadId: "slack:D1:1.2",
      threadTs: "1.2",
      userId: "U1",
    };
    let task: Promise<unknown> | undefined;

    chat.processAgentSessionStopped(event, {
      waitUntil: (promise) => {
        task = promise;
      },
    });
    await task;

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("dispatches title changes to registered handlers", async () => {
    const adapter = createMockAdapter("slack");
    const chat = new Chat({
      userName: "bot",
      adapters: { slack: adapter },
      state: createMockState(),
      logger: "error",
    });
    const handler = vi.fn();
    chat.onAgentSessionTitleChanged(handler);
    const event: AgentSessionTitleChangedEvent = {
      adapter,
      channelId: "D1",
      previousTitle: "Old title",
      threadId: "slack:D1:1.2",
      threadTs: "1.2",
      title: "New title",
      userId: "U1",
    };
    let task: Promise<unknown> | undefined;

    chat.processAgentSessionTitleChanged(event, {
      waitUntil: (promise) => {
        task = promise;
      },
    });
    await task;

    expect(handler).toHaveBeenCalledWith(event);
  });
});
