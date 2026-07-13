import type { Adapter, AppContextChangedEvent } from "chat";
import { describe, expect, it } from "vitest";
import { createMockChatInstance } from "./factories";
import { toHaveDispatched } from "./matchers";

expect.extend({ toHaveDispatched });

describe("toHaveDispatched with processAppContextChanged", () => {
  it("recognizes a dispatched app_context_changed", () => {
    const chat = createMockChatInstance();
    const event: AppContextChangedEvent = {
      adapter: {} as unknown as Adapter,
      channelId: "D1",
      userId: "U1",
      entities: [],
      raw: {},
    };
    chat.processAppContextChanged(event);
    expect(chat).toHaveDispatched("processAppContextChanged");
  });
});
