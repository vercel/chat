import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "@chat-adapter/tests";
import { type Adapter, Chat, type StreamChunk } from "chat";
import { describe, expect, it, vi } from "vitest";
import { APPROVE_ACTION_ID, createManagedAgent } from "./managed-agent";
import type { ManagedAgentDriver, ManagedAgentEvent } from "./types";

// End-to-end through a real Chat instance and ThreadImpl: message routing,
// thread state, Chat SDK streaming, cards, and action dispatch. Only the
// platform adapter and the provider driver are fakes.

const THREAD_ID = "slack:C1:1.2";

async function* events(
  list: ManagedAgentEvent[]
): AsyncGenerator<ManagedAgentEvent> {
  for (const event of list) {
    yield event;
  }
}

function setup(driver: ManagedAgentDriver) {
  const streamed: Array<Array<string | StreamChunk>> = [];
  // A native `stream` lets structured task_update chunks reach the adapter,
  // the way the Slack adapter receives them.
  const adapter: Adapter = createMockAdapter("slack", {
    stream: vi.fn(async (threadId, chunks) => {
      const received: Array<string | StreamChunk> = [];
      for await (const chunk of chunks) {
        received.push(chunk);
      }
      streamed.push(received);
      return { id: `stream-${streamed.length}`, raw: {}, threadId };
    }),
  });
  const state = createMockState();
  const chat = new Chat({
    adapters: { slack: adapter },
    concurrency: "queue",
    logger: "error",
    state,
    userName: "bot",
  });
  const agent = createManagedAgent({
    driver,
    logger: { error: vi.fn(), warn: vi.fn() },
  });

  chat.onNewMention(async (thread, message, context) => {
    await thread.subscribe();
    await agent.reply(thread, message, context);
  });
  chat.onSubscribedMessage((thread, message, context) =>
    agent.reply(thread, message, context)
  );
  chat.onAction([...agent.actionIds], (event) => agent.handleAction(event));

  const send = (id: string, text: string, isMention = false) =>
    chat.handleIncomingMessage(
      adapter,
      THREAD_ID,
      createTestMessage(id, text, { isMention, threadId: THREAD_ID })
    );

  return { adapter, chat, send, state, streamed };
}

describe("managed agent with a real Chat instance", () => {
  it("streams replies with task updates and keeps one session per thread", async () => {
    const driver: ManagedAgentDriver = {
      createSession: vi.fn(() => Promise.resolve("sess_1")),
      name: "fake",
      resumeSession: vi.fn(() => Promise.resolve(true)),
      runTurn: vi
        .fn()
        .mockImplementationOnce(() =>
          events([
            {
              id: "t1",
              name: "web_search",
              status: "running",
              type: "tool-call",
            },
            { id: "t1", status: "complete", type: "tool-call" },
            { messageId: "m1", text: "Found it", type: "text-delta" },
            { messageId: "m1", text: "Found it.", type: "message" },
            { reason: "complete", type: "turn-end" },
          ])
        )
        .mockImplementationOnce(() =>
          events([
            { messageId: "m2", text: "Sure.", type: "message" },
            { reason: "complete", type: "turn-end" },
          ])
        ),
    };
    const { send, state, streamed } = setup(driver);

    await send("u1", "@bot find it", true);
    await send("u2", "thanks");

    expect(streamed[0]).toEqual([
      {
        id: "t1",
        status: "in_progress",
        title: "web_search",
        type: "task_update",
      },
      {
        id: "t1",
        status: "complete",
        title: "web_search",
        type: "task_update",
      },
      "Found it",
      ".",
    ]);
    expect(streamed[1]).toEqual(["Sure."]);
    expect(driver.createSession).toHaveBeenCalledTimes(1);
    expect(driver.runTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: "sess_1", text: "thanks" })
    );
    expect(await state.get(`thread-state:${THREAD_ID}`)).toEqual({
      managedAgent: { driver: "fake", sessionId: "sess_1" },
    });
  });

  it("posts an approval card and continues the turn when it is approved", async () => {
    const respondToApproval = vi.fn(() =>
      events([
        { messageId: "m2", text: "Ran it.", type: "message" },
        { reason: "complete", type: "turn-end" },
      ])
    );
    const driver: ManagedAgentDriver = {
      createSession: () => Promise.resolve("sess_1"),
      name: "fake",
      respondToApproval,
      resumeSession: () => Promise.resolve(true),
      runTurn: () =>
        events([
          {
            requestId: "tool_1",
            tools: [{ id: "tool_1", input: { command: "ls" }, name: "bash" }],
            type: "approval-request",
          },
        ]),
    };
    const { adapter, chat, send, streamed } = setup(driver);

    await send("u1", "@bot list files", true);

    const [, card] = vi.mocked(adapter.postMessage).mock.calls[0] ?? [];
    expect(card).toMatchObject({ title: "Approval needed", type: "card" });
    expect(JSON.stringify(card)).toContain(APPROVE_ACTION_ID);

    await chat.processAction(
      {
        actionId: APPROVE_ACTION_ID,
        adapter,
        messageId: "msg-1",
        raw: {},
        threadId: THREAD_ID,
        user: {
          fullName: "Ada",
          isBot: false,
          isMe: false,
          userId: "U2",
          userName: "ada",
        },
        value: "tool_1",
      },
      undefined
    );

    expect(respondToApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: true,
        requestId: "tool_1",
        sessionId: "sess_1",
      })
    );
    expect(JSON.stringify(vi.mocked(adapter.editMessage).mock.calls)).toContain(
      "Approved by Ada."
    );
    expect(streamed.at(-1)).toEqual(["Ran it."]);
  });
});
