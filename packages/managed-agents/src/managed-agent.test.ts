import type { ActionEvent } from "chat";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVE_ACTION_ID,
  createManagedAgent,
  DENY_ACTION_ID,
} from "./managed-agent";
import { createFakeThread, fakeMessage, fromEvents } from "./test-utils";
import type { ManagedAgentDriver, ManagedAgentEvent } from "./types";

const silentLogger = { error: vi.fn(), warn: vi.fn() };

function createDriver(
  turns: ManagedAgentEvent[][],
  overrides: Partial<ManagedAgentDriver> = {}
): ManagedAgentDriver {
  let turn = 0;
  return {
    createSession: vi.fn(() => Promise.resolve("sess_new")),
    name: "fake",
    resumeSession: vi.fn(() => Promise.resolve(true)),
    runTurn: vi.fn(() => fromEvents(turns[turn++] ?? [])),
    ...overrides,
  };
}

const complete: ManagedAgentEvent = { reason: "complete", type: "turn-end" };

describe("createManagedAgent", () => {
  it("creates a session on first reply and streams the answer", async () => {
    const driver = createDriver([
      [{ messageId: "m1", text: "Hi there", type: "message" }, complete],
    ]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hello"));

    expect(driver.createSession).toHaveBeenCalledWith({
      threadId: "slack:C1:1.2",
      title: "Hello",
    });
    expect(fake.state).toEqual({
      managedAgent: { driver: "fake", sessionId: "sess_new" },
    });
    expect(driver.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess_new", text: "Hello" })
    );
    expect(fake.posted).toEqual([
      { chunks: ["Hi there"], kind: "stream", text: "Hi there" },
    ]);
  });

  it("reuses a valid stored session", async () => {
    const driver = createDriver([[complete]]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread({
      managedAgent: { driver: "fake", sessionId: "sess_old" },
    });

    await agent.reply(fake.thread, fakeMessage("Again"));

    expect(driver.resumeSession).toHaveBeenCalledWith("sess_old");
    expect(driver.createSession).not.toHaveBeenCalled();
    expect(driver.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess_old" })
    );
    expect(fake.posted).toEqual([]);
  });

  it("replaces an unusable session and says context was lost", async () => {
    const driver = createDriver([[complete]], {
      resumeSession: vi.fn(() => Promise.resolve(false)),
    });
    const agent = createManagedAgent({
      driver,
      logger: silentLogger,
      messages: { sessionLost: "fresh start" },
      stateKey: "session",
    });
    const fake = createFakeThread({
      session: { driver: "fake", sessionId: "sess_old" },
    });

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(driver.createSession).toHaveBeenCalled();
    expect(fake.state?.session).toEqual({
      driver: "fake",
      sessionId: "sess_new",
    });
    expect(fake.posted).toEqual([{ kind: "message", value: "fresh start" }]);
  });

  it("does not reuse a session created by another driver", async () => {
    const driver = createDriver([[complete]]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread({
      managedAgent: { driver: "other", sessionId: "sess_old" },
    });

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(driver.resumeSession).not.toHaveBeenCalled();
    expect(driver.createSession).toHaveBeenCalled();
  });

  it("sends skipped messages with the latest one and ignores its own", async () => {
    const driver = createDriver([[complete]]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("third"), {
      skipped: [
        fakeMessage("first"),
        fakeMessage("bot reply", true),
        fakeMessage("second"),
      ],
      totalSinceLastHandler: 4,
    });

    expect(driver.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({ text: "first\n\nsecond\n\nthird" })
    );
  });

  it("ignores empty messages", async () => {
    const driver = createDriver([]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("   "));

    expect(driver.createSession).not.toHaveBeenCalled();
  });

  it("replaces streamed text when the complete message diverges", async () => {
    const driver = createDriver([
      [
        { messageId: "m1", text: "Draft", type: "text-delta" },
        { messageId: "m1", text: "Final", type: "message" },
        complete,
      ],
    ]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.edits).toEqual([{ markdown: "Final" }]);
  });

  it("keeps a preview that shows tool progress instead of editing it", async () => {
    const driver = createDriver([
      [
        { messageId: "m1", text: "Draft", type: "text-delta" },
        { id: "t1", name: "web_search", status: "running", type: "tool-call" },
        { messageId: "m1", text: "Final", type: "message" },
        complete,
      ],
    ]);
    const logger = { error: vi.fn(), warn: vi.fn() };
    const agent = createManagedAgent({ driver, logger });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.edits).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "fake final message differs from its streamed preview; kept the preview"
    );
  });

  it("passes the task display mode to the stream", async () => {
    const driver = createDriver([
      [
        { id: "t1", name: "web_search", status: "running", type: "tool-call" },
        { messageId: "m1", text: "Done", type: "message" },
        complete,
      ],
    ]);
    const agent = createManagedAgent({
      driver,
      logger: silentLogger,
      taskDisplay: "plan",
    });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.posted).toEqual([
      {
        chunks: [
          {
            id: "t1",
            status: "in_progress",
            title: "web_search",
            type: "task_update",
          },
          "Done",
        ],
        kind: "stream",
        options: { groupTasks: "plan" },
        text: "Done",
      },
    ]);
  });

  it("does not post an empty stream when the turn has no output", async () => {
    const driver = createDriver([[]]);
    const agent = createManagedAgent({
      driver,
      logger: silentLogger,
      messages: { connectionLost: "lost" },
    });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.posted).toEqual([{ kind: "message", value: "lost" }]);
  });

  it("posts the stop reason when the provider stops early", async () => {
    const driver = createDriver([
      [{ detail: "budget_reached", reason: "stopped", type: "turn-end" }],
    ]);
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.posted).toEqual([
      {
        kind: "message",
        value: "The agent stopped early (budget_reached). Please try again.",
      },
    ]);
  });

  it("clears the session when the provider ends it", async () => {
    const driver = createDriver([[{ type: "session-ended" }]]);
    const agent = createManagedAgent({
      driver,
      logger: silentLogger,
      messages: { sessionEnded: "gone" },
    });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.state?.managedAgent).toBeUndefined();
    expect(fake.posted).toEqual([{ kind: "message", value: "gone" }]);
  });

  it("reports driver failures without throwing", async () => {
    const driver = createDriver([], {
      runTurn: () => {
        throw new Error("boom");
      },
    });
    const agent = createManagedAgent({
      driver,
      logger: silentLogger,
      messages: { turnFailed: "failed" },
    });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.posted).toEqual([{ kind: "message", value: "failed" }]);
    expect(silentLogger.error).toHaveBeenCalledWith("fake turn failed (Error)");
  });

  it("stays quiet after the turn is stopped", async () => {
    let fakeRef: ReturnType<typeof createFakeThread> | undefined;
    const driver = createDriver([], {
      async *runTurn() {
        yield { messageId: "m1", text: "partial", type: "text-delta" } as const;
        fakeRef?.abort();
        yield { messageId: "m1", text: " more", type: "text-delta" } as const;
      },
    });
    const agent = createManagedAgent({ driver, logger: silentLogger });
    const fake = createFakeThread();
    fakeRef = fake;

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.posted).toEqual([
      { chunks: ["partial"], kind: "stream", text: "partial" },
    ]);
  });

  it("says approvals are unsupported when the driver cannot respond", async () => {
    const driver = createDriver([
      [{ requestId: "r1", tools: [], type: "approval-request" }],
    ]);
    const agent = createManagedAgent({
      driver,
      logger: silentLogger,
      messages: { approvalUnsupported: "no approvals" },
    });
    const fake = createFakeThread();

    await agent.reply(fake.thread, fakeMessage("Hi"));

    expect(fake.posted).toEqual([{ kind: "message", value: "no approvals" }]);
  });

  describe("approvals", () => {
    function setup() {
      const respondToApproval = vi.fn(() =>
        fromEvents([
          { messageId: "m2", text: "Done", type: "message" },
          complete,
        ])
      );
      const driver = createDriver(
        [
          [
            {
              requestId: "tool_1,tool_2",
              tools: [
                { id: "tool_1", input: { command: "ls" }, name: "bash" },
                { id: "tool_2", name: "web_fetch" },
              ],
              type: "approval-request",
            },
          ],
        ],
        { respondToApproval }
      );
      const agent = createManagedAgent({ driver, logger: silentLogger });
      return { agent, respondToApproval };
    }

    function actionEvent(
      fake: ReturnType<typeof createFakeThread>,
      actionId: string,
      value = "tool_1,tool_2"
    ) {
      const editMessage = vi.fn(() => Promise.resolve({}));
      const event = {
        actionId,
        adapter: { editMessage },
        messageId: "card_1",
        thread: fake.thread,
        threadId: fake.thread.id,
        user: { fullName: "Ada", userName: "ada" },
        value,
      } as unknown as ActionEvent;
      return { editMessage, event };
    }

    it("posts an approval card with the pending tools", async () => {
      const { agent } = setup();
      const fake = createFakeThread();

      await agent.reply(fake.thread, fakeMessage("Hi"));

      expect(fake.posted).toHaveLength(1);
      const card = (fake.posted[0] as { value: unknown }).value;
      expect(card).toMatchObject({
        title: "Approval needed",
        type: "card",
      });
      const json = JSON.stringify(card);
      expect(json).toContain("**bash**");
      expect(json).toContain('\\"command\\": \\"ls\\"');
      expect(json).toContain(APPROVE_ACTION_ID);
      expect(json).toContain(DENY_ACTION_ID);
      expect(json).toContain("tool_1,tool_2");
    });

    it("sends the decision and streams the rest of the turn", async () => {
      const { agent, respondToApproval } = setup();
      const fake = createFakeThread({
        managedAgent: {
          driver: "fake",
          pendingApproval: "tool_1,tool_2",
          sessionId: "sess_1",
        },
      });
      const { editMessage, event } = actionEvent(fake, APPROVE_ACTION_ID);

      await agent.handleAction(event);

      expect(respondToApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          requestId: "tool_1,tool_2",
          sessionId: "sess_1",
        })
      );
      expect(editMessage).toHaveBeenCalledWith(
        fake.thread.id,
        "card_1",
        expect.objectContaining({ type: "card" })
      );
      expect(JSON.stringify(editMessage.mock.calls[0])).toContain(
        "Approved by Ada."
      );
      expect(fake.posted).toEqual([
        { chunks: ["Done"], kind: "stream", text: "Done" },
      ]);
    });

    it("sends denials", async () => {
      const { agent, respondToApproval } = setup();
      const fake = createFakeThread({
        managedAgent: {
          driver: "fake",
          pendingApproval: "tool_1,tool_2",
          sessionId: "sess_1",
        },
      });

      await agent.handleAction(actionEvent(fake, DENY_ACTION_ID).event);

      expect(respondToApproval).toHaveBeenCalledWith(
        expect.objectContaining({ approved: false })
      );
    });

    it("remembers the pending approval with the session", async () => {
      const { agent } = setup();
      const fake = createFakeThread();

      await agent.reply(fake.thread, fakeMessage("Hi"));

      expect(fake.state?.managedAgent).toEqual({
        driver: "fake",
        pendingApproval: "tool_1,tool_2",
        sessionId: "sess_new",
      });
    });

    it("answers each approval once", async () => {
      const { agent, respondToApproval } = setup();
      const fake = createFakeThread({
        managedAgent: {
          driver: "fake",
          pendingApproval: "tool_1,tool_2",
          sessionId: "sess_1",
        },
      });

      await agent.handleAction(actionEvent(fake, APPROVE_ACTION_ID).event);
      const second = actionEvent(fake, DENY_ACTION_ID);
      await agent.handleAction(second.event);

      expect(respondToApproval).toHaveBeenCalledTimes(1);
      expect(second.editMessage).not.toHaveBeenCalled();
      expect(fake.state?.managedAgent).toEqual({
        driver: "fake",
        sessionId: "sess_1",
      });
    });

    it("ignores approvals a later turn superseded", async () => {
      const { agent, respondToApproval } = setup();
      const fake = createFakeThread({
        managedAgent: {
          driver: "fake",
          pendingApproval: "tool_3",
          sessionId: "sess_1",
        },
      });

      await agent.handleAction(actionEvent(fake, APPROVE_ACTION_ID).event);

      expect(respondToApproval).not.toHaveBeenCalled();
      expect(fake.posted).toEqual([]);
    });

    it("clears the pending approval when a new turn starts", async () => {
      const agent = createManagedAgent({
        driver: createDriver([
          [{ messageId: "m1", text: "Sure", type: "message" }, complete],
        ]),
        logger: silentLogger,
      });
      const fake = createFakeThread({
        managedAgent: {
          driver: "fake",
          pendingApproval: "tool_1",
          sessionId: "sess_1",
        },
      });

      await agent.reply(fake.thread, fakeMessage("Never mind"));

      expect(fake.state?.managedAgent).toEqual({
        driver: "fake",
        sessionId: "sess_1",
      });
    });

    it("ignores other actions", async () => {
      const { agent, respondToApproval } = setup();
      const fake = createFakeThread();

      await agent.handleAction(actionEvent(fake, "other").event);

      expect(respondToApproval).not.toHaveBeenCalled();
      expect(fake.posted).toEqual([]);
    });

    it("reports a missing session instead of responding", async () => {
      const { agent, respondToApproval } = setup();
      const fake = createFakeThread();

      await agent.handleAction(actionEvent(fake, APPROVE_ACTION_ID).event);

      expect(respondToApproval).not.toHaveBeenCalled();
      expect(fake.posted).toEqual([
        {
          kind: "message",
          value:
            "This agent session is no longer available. Start a new thread to continue.",
        },
      ]);
    });
  });

  it("forgets the session on reset", async () => {
    const agent = createManagedAgent({
      driver: createDriver([]),
      logger: silentLogger,
    });
    const fake = createFakeThread({
      managedAgent: { driver: "fake", sessionId: "sess_1" },
    });

    await agent.resetSession(fake.thread);

    expect(fake.state?.managedAgent).toBeUndefined();
  });
});
