import { describe, expect, it, vi } from "vitest";
import { Chat } from "./chat";
import { activeConversation } from "./context";
import { createMockAdapter, createMockState, mockLogger } from "./mock-adapter";
import type { InstallationEvent } from "./types";

describe.each(["Installed", "Uninstalled"] as const)("on%s", (kind) => {
  function setup(channelId: string | undefined = "teams:conversation:service") {
    const adapter = createMockAdapter("teams");
    const chat = new Chat({
      userName: "bot",
      adapters: { teams: adapter },
      state: createMockState(),
      logger: mockLogger,
    });
    const event: InstallationEvent = {
      action: kind === "Installed" ? "add" : "remove",
      adapter,
      channelId,
      conversationId: "personal-conversation",
      id: "installation-activity",
      userId: "installer",
      tenantId: "tenant",
      locale: "en-US",
      raw: {},
    };
    return { chat, event };
  }

  it("runs registered handlers in order with the destination context", async () => {
    const { chat, event } = setup();
    const order: number[] = [];
    chat[`on${kind}`](async (received) => {
      await Promise.resolve();
      expect(received).toBe(event);
      expect(activeConversation()).toBe(event.channelId);
      order.push(1);
    });
    chat[`on${kind}`](() => {
      order.push(2);
    });
    const tasks: Promise<unknown>[] = [];
    chat[`process${kind}`](event, { waitUntil: (task) => tasks.push(task) });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(order).toEqual([1, 2]);
  });

  it("waits for asynchronous handlers, including events without a destination", async () => {
    const { chat, event } = setup();
    event.channelId = undefined;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;
    chat[`on${kind}`](async () => {
      expect(activeConversation()).toBeUndefined();
      await gate;
      completed = true;
    });
    const tasks: Promise<unknown>[] = [];
    chat[`process${kind}`](event, { waitUntil: (task) => tasks.push(task) });
    expect(completed).toBe(false);
    release();
    await Promise.all(tasks);
    expect(completed).toBe(true);
  });

  it("logs handler errors and resolves the background task", async () => {
    const { chat, event } = setup();
    const error = new Error("handler failed");
    chat[`on${kind}`](() => {
      throw error;
    });
    const tasks: Promise<unknown>[] = [];
    chat[`process${kind}`](event, { waitUntil: (task) => tasks.push(task) });
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
    expect(mockLogger.error).toHaveBeenCalledWith(`${kind} handler error`, {
      error,
      conversationId: event.conversationId,
      activityId: event.id,
    });
  });

  it("runs without waitUntil and accepts having no handlers", async () => {
    const { chat, event } = setup();
    chat[`process${kind}`](event);
    const handler = vi.fn();
    chat[`on${kind}`](handler);
    chat[`process${kind}`](event);
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledExactlyOnceWith(event)
    );
  });
});
