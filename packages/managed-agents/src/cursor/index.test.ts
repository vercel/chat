import {
  Agent,
  AgentNotFoundError,
  type RunResult,
  type SDKAgentInfo,
  type SDKMessage,
} from "@cursor/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collect } from "../test-utils";
import { createCursorDriver } from "./index";

// Only the network-facing Agent methods are mocked. Error classes and types
// come from the real SDK, so fixtures fail type-checking if the SDK changes.
vi.mock("@cursor/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cursor/sdk")>();
  return {
    ...actual,
    Agent: { create: vi.fn(), get: vi.fn(), resume: vi.fn() },
  };
});

const create = vi.mocked(Agent.create);
const get = vi.mocked(Agent.get);
const resume = vi.mocked(Agent.resume);

const IDS = { agent_id: "bc-123", run_id: "run_1" } as const;

const msg = {
  system: (): SDKMessage => ({ ...IDS, type: "system" }),
  text: (value: string): SDKMessage => ({
    ...IDS,
    message: { content: [{ text: value, type: "text" }], role: "assistant" },
    type: "assistant",
  }),
  tool: (
    callId: string,
    name: string,
    status: "running" | "completed" | "error"
  ): SDKMessage => ({
    ...IDS,
    call_id: callId,
    name,
    status,
    type: "tool_call",
  }),
  request: (requestId: string): SDKMessage => ({
    ...IDS,
    request_id: requestId,
    type: "request",
  }),
};

function fakeRun(
  messages: SDKMessage[],
  result: Omit<RunResult, "id"> = { status: "finished" }
) {
  return {
    cancel: vi.fn(() => Promise.resolve()),
    id: "run_1",
    async *stream(): AsyncGenerator<SDKMessage> {
      for (const message of messages) {
        yield message;
      }
    },
    wait: vi.fn(
      (): Promise<RunResult> => Promise.resolve({ id: "run_1", ...result })
    ),
  };
}

// The driver uses agentId, send(), and close() from SDKAgent.
function fakeAgent(run: ReturnType<typeof fakeRun>) {
  const agent = {
    agentId: "bc-123",
    close: vi.fn(),
    send: vi.fn(() => Promise.resolve(run)),
  };
  return agent as typeof agent & Awaited<ReturnType<typeof Agent.create>>;
}

function info(overrides: { archived?: boolean } = {}): SDKAgentInfo {
  return {
    agentId: "bc-123",
    lastModified: 0,
    name: "agent",
    summary: "",
    ...overrides,
  };
}

const options = {
  agent: { apiKey: "key", cloud: { repos: [] } },
  send: { mode: "agent" as const },
};

function turn(signal = new AbortController().signal) {
  return collect(
    createCursorDriver(options).runTurn({
      sessionId: "bc-123",
      signal,
      text: "Hi",
    })
  );
}

describe("createCursorDriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an agent and reuses its handle for the first run", async () => {
    const agent = fakeAgent(fakeRun([msg.text("Hello")]));
    create.mockResolvedValue(agent);
    const driver = createCursorDriver(options);

    const sessionId = await driver.createSession({
      threadId: "t",
      title: "Hi",
    });
    await collect(
      driver.runTurn({
        sessionId,
        signal: new AbortController().signal,
        text: "Hi",
      })
    );

    expect(sessionId).toBe("bc-123");
    expect(create).toHaveBeenCalledWith(options.agent);
    expect(resume).not.toHaveBeenCalled();
    expect(agent.send).toHaveBeenCalledWith("Hi", options.send);
    expect(agent.close).toHaveBeenCalled();
  });

  it("resumes existing agents and streams text and tool calls", async () => {
    resume.mockResolvedValue(
      fakeAgent(
        fakeRun([
          msg.system(),
          msg.text("Looking"),
          msg.text(" now."),
          msg.tool("c1", "grep", "running"),
          msg.tool("c1", "grep", "completed"),
          msg.text("Found it."),
        ])
      )
    );

    expect(await turn()).toEqual([
      { messageId: "run_1:0", text: "Looking", type: "text-delta" },
      { messageId: "run_1:0", text: " now.", type: "text-delta" },
      { id: "c1", name: "grep", status: "running", type: "tool-call" },
      { id: "c1", name: "grep", status: "complete", type: "tool-call" },
      { messageId: "run_1:1", text: "Found it.", type: "text-delta" },
      { reason: "complete", type: "turn-end" },
    ]);
    expect(resume).toHaveBeenCalledWith("bc-123", options.agent);
  });

  it("falls back to the run result when nothing streamed", async () => {
    resume.mockResolvedValue(
      fakeAgent(fakeRun([], { result: "Summary", status: "finished" }))
    );

    expect(await turn()).toEqual([
      { messageId: "run_1:0", text: "Summary", type: "message" },
      { reason: "complete", type: "turn-end" },
    ]);
  });

  it("reports failed and cancelled runs", async () => {
    resume.mockResolvedValue(
      fakeAgent(
        fakeRun([], {
          error: { code: "rate_limited", message: "x" },
          status: "error",
        })
      )
    );
    expect(await turn()).toEqual([
      { detail: "rate_limited", reason: "stopped", type: "turn-end" },
    ]);

    resume.mockResolvedValue(fakeAgent(fakeRun([], { status: "cancelled" })));
    expect(await turn()).toEqual([{ reason: "cancelled", type: "turn-end" }]);
  });

  it("cancels runs that ask for approval", async () => {
    const run = fakeRun([msg.request("req_1")]);
    resume.mockResolvedValue(fakeAgent(run));

    expect(await turn()).toEqual([
      { requestId: "req_1", tools: [], type: "approval-request" },
    ]);
    expect(run.cancel).toHaveBeenCalled();
  });

  it("ends the session when the agent no longer exists", async () => {
    resume.mockRejectedValue(new AgentNotFoundError("gone"));

    expect(await turn()).toEqual([{ type: "session-ended" }]);
  });

  it("cancels the run when the turn is aborted", async () => {
    const abort = new AbortController();
    const run = fakeRun([msg.text("one"), msg.text("two")]);
    resume.mockResolvedValue(fakeAgent(run));

    const events = createCursorDriver(options).runTurn({
      sessionId: "bc-123",
      signal: abort.signal,
      text: "Hi",
    });
    for await (const _event of events) {
      abort.abort();
    }

    expect(run.cancel).toHaveBeenCalled();
    expect(run.wait).not.toHaveBeenCalled();
  });

  it("cancels a run aborted while the message was being sent", async () => {
    const abort = new AbortController();
    const run = fakeRun([]);
    const agent = fakeAgent(run);
    agent.send.mockImplementationOnce(() => {
      abort.abort();
      return Promise.resolve(run);
    });
    resume.mockResolvedValue(agent);

    expect(await turn(abort.signal)).toEqual([]);
    expect(run.cancel).toHaveBeenCalled();
    expect(run.wait).not.toHaveBeenCalled();
  });

  describe("resumeSession", () => {
    it("checks cloud agents and rejects archived or missing ones", async () => {
      const driver = createCursorDriver(options);

      get.mockResolvedValue(info());
      await expect(driver.resumeSession("bc-123")).resolves.toBe(true);
      expect(get).toHaveBeenCalledWith("bc-123", { apiKey: "key" });

      get.mockResolvedValue(info({ archived: true }));
      await expect(driver.resumeSession("bc-123")).resolves.toBe(false);

      get.mockRejectedValue(new AgentNotFoundError("gone"));
      await expect(driver.resumeSession("bc-123")).resolves.toBe(false);

      get.mockRejectedValue(new Error("network"));
      await expect(driver.resumeSession("bc-123")).rejects.toThrow("network");
    });

    it("accepts local agents without a lookup and rejects malformed IDs", async () => {
      const driver = createCursorDriver(options);

      await expect(driver.resumeSession("agent-123")).resolves.toBe(true);
      await expect(driver.resumeSession("../x")).resolves.toBe(false);
      expect(get).not.toHaveBeenCalled();
    });
  });
});
