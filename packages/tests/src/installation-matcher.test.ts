import type { Adapter } from "chat";
import { describe, expect, it } from "vitest";
import { createMockChatInstance } from "./factories";
import { toHaveDispatched } from "./matchers";

expect.extend({ toHaveDispatched });

const base = {
  adapter: {} as Adapter,
  conversationId: "conversation",
  id: "activity",
  raw: {},
};

describe("installation dispatch matchers", () => {
  it("includes processInstalled", () => {
    const chat = createMockChatInstance();
    chat.processInstalled?.({ ...base, action: "add" });
    expect(chat).toHaveDispatched("processInstalled");
  });

  it("includes processUninstalled", () => {
    const chat = createMockChatInstance();
    chat.processUninstalled?.({ ...base, action: "remove" });
    expect(chat).toHaveDispatched("processUninstalled");
  });
});
