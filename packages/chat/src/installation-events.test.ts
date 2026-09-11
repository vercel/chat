import { describe, expect, it, vi } from "vitest";
import { Chat } from "./chat";
import { activeConversation } from "./context";
import { createMockAdapter, createMockState, mockLogger } from "./mock-adapter";
import type {
  InstallationEvent,
  InstalledEvent,
  UninstalledEvent,
  WebhookOptions,
} from "./types";

describe.each(["Installed", "Uninstalled"] as const)("on%s", (kind) => {
  function setup(
    { channelId }: { channelId?: string } = {
      channelId: "teams:conversation:service",
    }
  ) {
    const adapter = createMockAdapter("teams");
    const chat = new Chat({
      userName: "bot",
      adapters: { teams: adapter },
      state: createMockState(),
      logger: mockLogger,
    });
    const base = {
      adapter,
      channelId,
      conversationId: "personal-conversation",
      id: "installation-activity",
      userId: "installer",
      tenantId: "tenant",
      locale: "en-US",
      raw: {},
    };
    const installed: InstalledEvent = { ...base, action: "add" };
    const uninstalled: UninstalledEvent = { ...base, action: "remove" };
    const event: InstallationEvent =
      kind === "Installed" ? installed : uninstalled;
    const on = (handler: (event: InstallationEvent) => void | Promise<void>) =>
      kind === "Installed"
        ? chat.onInstalled(handler)
        : chat.onUninstalled(handler);
    const process = (options?: WebhookOptions) =>
      kind === "Installed"
        ? chat.processInstalled(installed, options)
        : chat.processUninstalled(uninstalled, options);
    return { event, on, process };
  }

  it("runs registered handlers in order with the destination context", async () => {
    const { event, on, process } = setup();
    const order: number[] = [];
    on(async (received) => {
      await Promise.resolve();
      expect(received).toBe(event);
      expect(activeConversation()).toBe(event.channelId);
      order.push(1);
    });
    on(() => {
      order.push(2);
    });
    const tasks: Promise<unknown>[] = [];
    process({ waitUntil: (task) => tasks.push(task) });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(order).toEqual([1, 2]);
  });

  it("waits for asynchronous handlers, including events without a destination", async () => {
    const { on, process } = setup({});
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;
    on(async () => {
      expect(activeConversation()).toBeUndefined();
      await gate;
      completed = true;
    });
    const tasks: Promise<unknown>[] = [];
    process({ waitUntil: (task) => tasks.push(task) });
    expect(completed).toBe(false);
    release();
    await Promise.all(tasks);
    expect(completed).toBe(true);
  });

  it("logs handler errors and resolves the background task", async () => {
    const { event, on, process } = setup();
    const error = new Error("handler failed");
    on(() => {
      throw error;
    });
    const tasks: Promise<unknown>[] = [];
    process({ waitUntil: (task) => tasks.push(task) });
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
    expect(mockLogger.error).toHaveBeenCalledWith(`${kind} handler error`, {
      error,
      conversationId: event.conversationId,
      activityId: event.id,
    });
  });

  it("does nothing without handlers and runs without waitUntil", async () => {
    const { event, on, process } = setup();
    const tasks: Promise<unknown>[] = [];
    process({ waitUntil: (task) => tasks.push(task) });
    expect(tasks).toHaveLength(0);
    const handler = vi.fn();
    on(handler);
    process();
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledExactlyOnceWith(event)
    );
  });
});
