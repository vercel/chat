import type { Adapter, ChatInstance } from "chat";
import { describe, expect, it } from "vitest";
import type { ChatHandler } from "./matchers";

/**
 * Per-adapter hooks the {@link selfMessageContract} runner needs.
 *
 * The contract also covers the webhook-dispatch happy path: a message from
 * another user must route to the adapter's dispatch handler, while a message
 * the bot itself authored must be ignored (no dispatch) so the bot never
 * replies to itself.
 */
export interface SelfMessageContractDescriptor {
  /** Handler a non-self message should reach. Defaults to `"processMessage"`. */
  dispatchHandler?: ChatHandler;
  /** Build an inbound webhook authored by another user (should dispatch). */
  makeOtherMessageRequest: () => Promise<Request> | Request;
  /** Build an inbound webhook authored by the bot itself (should be ignored). */
  makeSelfMessageRequest: () => Promise<Request> | Request;
  /** Label for the describe block, typically the adapter name. */
  name: string;
  /**
   * Build the adapter (initialized, with a known bot identity so self-detection
   * works) and the mock chat it dispatches into. Return both so the contract
   * can assert on dispatch. Use a fresh mock chat per call.
   */
  setup: () =>
    | Promise<{ adapter: Adapter; chat: ChatInstance }>
    | { adapter: Adapter; chat: ChatInstance };
}

/**
 * Shared Vitest suite asserting an adapter ignores its own messages.
 *
 * Requires the `@chat-adapter/tests` matchers to be registered (via
 * `setupFiles: ["@chat-adapter/tests/setup"]`). A message from another user
 * dispatches through `dispatchHandler` (default `processMessage`) and returns
 * `200`; a message authored by the bot returns `200` but does NOT dispatch.
 */
export function selfMessageContract(
  descriptor: SelfMessageContractDescriptor
): void {
  const handler = descriptor.dispatchHandler ?? "processMessage";
  describe(`self-message contract (${descriptor.name})`, () => {
    it(`dispatches ${handler} for messages from other users`, async () => {
      const { adapter, chat } = await descriptor.setup();
      const response = await adapter.handleWebhook(
        await descriptor.makeOtherMessageRequest()
      );
      expect(response.status).toBe(200);
      expect(chat).toHaveDispatched(handler);
    });

    it("ignores the bot's own messages", async () => {
      const { adapter, chat } = await descriptor.setup();
      const response = await adapter.handleWebhook(
        await descriptor.makeSelfMessageRequest()
      );
      expect(response.status).toBe(200);
      expect(chat).not.toHaveDispatched(handler);
    });
  });
}
