/**
 * End-to-end smoke tests that drive matchers against a real `Chat` instance.
 *
 * The kit's matchers inspect mock calls by index — they're easy to drift out
 * of sync with the real SDK call shape if the matcher's own tests use the
 * same wrong shape. These tests use a real `Chat` + real `Thread` so the
 * matcher's assumptions are validated against actual SDK behavior.
 */
import { Chat } from "chat";
import { describe, expect, it, type vi } from "vitest";
import { createMockAdapter, createMockState, mockLogger } from "./factories";
import { matchers } from "./matchers";

expect.extend(matchers);

const HELLO = /hello/;
const CHANNEL = /channel/;

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

  it("toHaveStartedTyping fires when Chat.thread().startTyping() routes through adapter.startTyping", async () => {
    const { slack, chat } = setup();
    await chat.webhooks.slack(
      new Request("https://example.com/webhook", { method: "POST" })
    );

    const thread = chat.thread("slack:C123:1234.5678");
    await thread.startTyping();

    expect(slack).toHaveStartedTyping("slack:C123:1234.5678");
    expect(slack).not.toHaveStartedTyping("slack:C123:other");
  });

  it("toHaveEdited / toHaveDeleted / toHaveReactedWith fire after Chat.thread().post().edit()/.delete()/.addReaction()", async () => {
    const { slack, chat } = setup();
    // Make postMessage return a stable id so the SentMessage handle reuses it.
    (slack.postMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg-1",
      threadId: "slack:C123:1234.5678",
      raw: {},
    });
    await chat.webhooks.slack(
      new Request("https://example.com/webhook", { method: "POST" })
    );

    const thread = chat.thread("slack:C123:1234.5678");
    const sent = await thread.post("hello");
    await sent.edit("updated");
    await sent.addReaction("thumbsup");
    await sent.delete();

    expect(slack).toHaveEdited("slack:C123:1234.5678", "msg-1", "updated");
    expect(slack).toHaveReactedWith(
      "slack:C123:1234.5678",
      "msg-1",
      "thumbsup"
    );
    expect(slack).toHaveDeleted("slack:C123:1234.5678", "msg-1");
  });

  it("toHavePostedToChannel fires when Chat.channel().post() routes through adapter.postChannelMessage", async () => {
    const { slack, chat } = setup();
    await chat.webhooks.slack(
      new Request("https://example.com/webhook", { method: "POST" })
    );

    const channel = chat.channel("slack:C123");
    await channel.post("channel hello");

    expect(slack).toHavePostedToChannel("slack:C123");
    expect(slack).toHavePostedToChannel("slack:C123", CHANNEL);
  });
});
