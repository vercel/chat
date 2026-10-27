import "./setup";
import type { Adapter, ChatInstance } from "chat";
import { describe, expect, it } from "vitest";
import { collectContractTests, getCase } from "./contract-harness";
import {
  createMockAdapter,
  createMockChatInstance,
  createTestMessage,
} from "./factories";

const BOT_ID = "bot";
const THREAD_ID = "fake:C1:T1";

/** How the fake adapter routes an inbound message, given its author. */
type Route = (chat: ChatInstance, adapter: Adapter, authorId: string) => void;

const dispatchMessage = (chat: ChatInstance, adapter: Adapter) =>
  chat.processMessage(adapter, THREAD_ID, createTestMessage("m1", "hi"));

const compliant: Route = (chat, adapter, authorId) => {
  if (authorId !== BOT_ID) {
    dispatchMessage(chat, adapter);
  }
};

function collect(route: Route) {
  const setup = (): { adapter: Adapter; chat: ChatInstance } => {
    const chat = createMockChatInstance();
    const adapter: Adapter = createMockAdapter("fake", {
      handleWebhook: async (request: Request) => {
        const { authorId } = (await request.json()) as { authorId: string };
        route(chat, adapter, authorId);
        return new Response(null, { status: 200 });
      },
    });
    return { adapter, chat };
  };
  const makeRequest = (authorId: string): Request =>
    new Request("https://example.com/api/webhooks/fake", {
      method: "POST",
      body: JSON.stringify({ authorId }),
    });

  return collectContractTests(
    () => import("./self-message-contract"),
    ({ selfMessageContract }) =>
      selfMessageContract({
        name: "fake",
        setup,
        makeOtherMessageRequest: () => makeRequest("alice"),
        makeSelfMessageRequest: () => makeRequest(BOT_ID),
      })
  );
}

const DISPATCHES = "dispatches processMessage for messages from other users";
const IGNORES = "ignores the bot's own messages";

describe("selfMessageContract", () => {
  it("passes every case for a compliant adapter", async () => {
    const tests = await collect(compliant);
    expect([...tests.keys()]).toEqual([DISPATCHES, IGNORES]);
    for (const run of tests.values()) {
      await run();
    }
  });

  it("fails when the adapter never dispatches", async () => {
    const tests = await collect(() => undefined);
    await expect(getCase(tests, DISPATCHES)()).rejects.toThrow();
  });

  it("fails when the adapter dispatches its own messages", async () => {
    const tests = await collect((chat, adapter) =>
      dispatchMessage(chat, adapter)
    );
    await expect(getCase(tests, IGNORES)()).rejects.toThrow();
  });

  it("fails when a self message is routed through a different handler", async () => {
    const tests = await collect((chat, adapter, authorId) => {
      if (authorId === BOT_ID) {
        chat.processMessageUpdated({
          adapter,
          threadId: THREAD_ID,
          message: createTestMessage("m1", "hi"),
        });
        return;
      }
      dispatchMessage(chat, adapter);
    });
    await expect(getCase(tests, IGNORES)()).rejects.toThrow(
      "processMessageUpdated"
    );
  });
});
