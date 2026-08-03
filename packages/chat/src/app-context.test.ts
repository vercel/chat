import { describe, expect, it, vi } from "vitest";
import { Chat } from "./chat";
import { createMockAdapter, createMockState } from "./mock-adapter";
import type { AppContextChangedEvent } from "./types";

describe("onAppContextChanged", () => {
  it("dispatches app_context_changed events to registered handlers", async () => {
    const adapter = createMockAdapter("mock");
    const chat = new Chat({
      userName: "bot",
      adapters: { mock: adapter },
      state: createMockState(),
      logger: "error",
    });
    const handler = vi.fn();
    chat.onAppContextChanged(handler);

    const event: AppContextChangedEvent = {
      adapter,
      channelId: "D1",
      userId: "U1",
      entities: [{ kind: "channel", channelId: "C2" }],
      raw: {},
    };

    let task: Promise<unknown> | undefined;
    chat.processAppContextChanged(event, {
      waitUntil: (p) => {
        task = p;
      },
    });
    await task;

    expect(handler).toHaveBeenCalledWith(event);
  });
});
