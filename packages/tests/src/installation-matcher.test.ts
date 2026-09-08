import type { Adapter, InstallationEvent } from "chat";
import { describe, expect, it } from "vitest";
import { createMockChatInstance } from "./factories";
import { toHaveDispatched } from "./matchers";

expect.extend({ toHaveDispatched });

describe.each([
  "processInstalled",
  "processUninstalled",
] as const)("%s", (name) => {
  it("is included in dispatch matchers", () => {
    const chat = createMockChatInstance();
    const event: InstallationEvent = {
      adapter: {} as Adapter,
      action: "add",
      conversationId: "conversation",
      id: "activity",
      raw: {},
    };
    chat[name]?.(event);
    expect(chat).toHaveDispatched(name);
  });
});
