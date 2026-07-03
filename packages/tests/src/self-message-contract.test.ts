import "./setup";
import type { Adapter, ChatInstance } from "chat";
import { createMockAdapter, createMockChatInstance } from "./factories";
import { selfMessageContract } from "./self-message-contract";

const BOT_ID = "bot";

/**
 * Minimal adapter that dispatches inbound messages to chat unless the author is
 * the bot itself. Used to self-test the contract runner without a real adapter.
 */
function setup(): { adapter: Adapter; chat: ChatInstance } {
  const chat = createMockChatInstance();
  const adapter = createMockAdapter("fake", {
    handleWebhook: async (request: Request) => {
      const { authorId } = JSON.parse(await request.text()) as {
        authorId: string;
      };
      if (authorId !== BOT_ID) {
        (
          chat as unknown as { processMessage: (...args: unknown[]) => void }
        ).processMessage();
      }
      return new Response("ok", { status: 200 });
    },
  });
  return { adapter, chat };
}

const makeRequest = (authorId: string): Request =>
  new Request("https://example.com/api/webhooks/fake", {
    method: "POST",
    body: JSON.stringify({ authorId }),
  });

selfMessageContract({
  name: "fake",
  setup,
  makeOtherMessageRequest: () => makeRequest("alice"),
  makeSelfMessageRequest: () => makeRequest(BOT_ID),
});
