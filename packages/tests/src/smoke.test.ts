/**
 * End-to-end smoke tests that drive matchers against a real `Chat` instance.
 *
 * The kit's matchers inspect mock calls by index — they're easy to drift out
 * of sync with the real SDK call shape if the matcher's own tests use the
 * same wrong shape. These tests use a real `Chat` + real `Thread` so the
 * matcher's assumptions are validated against actual SDK behavior.
 */
import { Chat } from "chat";
import { describe, expect, it } from "vitest";
import { createMockAdapter, createMockState, mockLogger } from "./factories";
import { matchers } from "./matchers";

expect.extend(matchers);

const HELLO = /hello/;

function setup() {
  const slack = createMockAdapter("slack");
  const state = createMockState();
  const chat = new Chat({
    userName: "smokebot",
    adapters: { slack },
    state,
    logger: mockLogger,
  });
  return { slack, state, chat };
}

describe("smoke: matchers against a real Chat", () => {
  it("toHavePosted fires when Chat.thread().post() routes through adapter.postMessage", async () => {
    const { slack, chat } = setup();
    // Initialize via a webhook so the adapter is wired up the way real bots
    // hit it; thread() is then usable from outside the webhook context.
    await chat.webhooks.slack(
      new Request("https://example.com/webhook", { method: "POST" })
    );

    const thread = chat.thread("slack:C123:1234.5678");
    await thread.post("hello world");

    expect(slack).toHavePosted("slack:C123:1234.5678");
    expect(slack).toHavePosted("slack:C123:1234.5678", HELLO);
    expect(slack).not.toHavePosted("slack:C123:other");
  });

  it("toBeSubscribedTo fires when Chat.thread().subscribe() routes through state.subscribe", async () => {
    const { state, chat } = setup();
    await chat.webhooks.slack(
      new Request("https://example.com/webhook", { method: "POST" })
    );

    const thread = chat.thread("slack:C123:1234.5678");
    await thread.subscribe();

    await expect(state).toBeSubscribedTo("slack:C123:1234.5678");
    await expect(state).not.toBeSubscribedTo("slack:C123:other");

    await thread.unsubscribe();
    await expect(state).not.toBeSubscribedTo("slack:C123:1234.5678");
  });
});
