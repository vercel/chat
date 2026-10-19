import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsAgentMessageEvent,
  BetaManagedAgentsSendSessionEvents,
  BetaManagedAgentsSessionStatusIdleEvent,
  BetaManagedAgentsStreamSessionEvents,
  BetaManagedAgentsUserMessageEvent,
  BetaManagedAgentsUserToolConfirmationEvent,
  EventSendParams,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type {
  BetaManagedAgentsSession,
  SessionCreateParams,
} from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collect } from "../test-utils";
import type { ManagedAgentEvent } from "../types";
import { createClaudeDriver } from "./index";

// Fixtures are typed against the SDK so a change in the event shapes fails
// type-checking instead of silently passing.

type StreamEvent = BetaManagedAgentsStreamSessionEvents;
type SentEvent = NonNullable<
  BetaManagedAgentsSendSessionEvents["data"]
>[number];
type SessionFixture = Pick<
  BetaManagedAgentsSession,
  "archived_at" | "status"
> & {
  agent: Pick<BetaManagedAgentsSession["agent"], "id">;
};

const AT = "2026-01-01T00:00:00Z";
const text = (value: string) => ({ text: value, type: "text" as const });

const ev = {
  user: (id = "evt_user"): BetaManagedAgentsUserMessageEvent => ({
    content: [text("Hi")],
    id,
    type: "user.message",
  }),
  confirmation: (
    id: string,
    toolUseId: string
  ): BetaManagedAgentsUserToolConfirmationEvent => ({
    id,
    result: "allow",
    tool_use_id: toolUseId,
    type: "user.tool_confirmation",
  }),
  message: (
    id: string,
    ...parts: string[]
  ): BetaManagedAgentsAgentMessageEvent => ({
    content: parts.map(text),
    id,
    processed_at: AT,
    type: "agent.message",
  }),
  start: (id: string): StreamEvent => ({
    event: { id, type: "agent.message" },
    type: "event_start",
  }),
  delta: (eventId: string, value: string): StreamEvent => ({
    delta: { content: text(value), index: 0, type: "content_delta" },
    event_id: eventId,
    type: "event_delta",
  }),
  toolUse: (
    id: string,
    name: string,
    input: Record<string, unknown> = {}
  ): StreamEvent => ({
    id,
    input,
    name,
    processed_at: AT,
    type: "agent.tool_use",
  }),
  toolResult: (toolUseId: string, isError = false): StreamEvent => ({
    id: `${toolUseId}_result`,
    is_error: isError,
    processed_at: AT,
    tool_use_id: toolUseId,
    type: "agent.tool_result",
  }),
  mcpToolUse: (id: string, name: string): StreamEvent => ({
    id,
    input: {},
    mcp_server_name: "linear",
    name,
    processed_at: AT,
    type: "agent.mcp_tool_use",
  }),
  mcpToolResult: (mcpToolUseId: string, isError = false): StreamEvent => ({
    id: `${mcpToolUseId}_result`,
    is_error: isError,
    mcp_tool_use_id: mcpToolUseId,
    processed_at: AT,
    type: "agent.mcp_tool_result",
  }),
  customToolUse: (id: string, name: string): StreamEvent => ({
    id,
    input: {},
    name,
    processed_at: AT,
    type: "agent.custom_tool_use",
  }),
  idle: (
    stopReason: BetaManagedAgentsSessionStatusIdleEvent["stop_reason"]
  ): StreamEvent => ({
    id: "evt_idle",
    processed_at: AT,
    stop_details: null,
    stop_reason: stopReason,
    type: "session.status_idle",
  }),
  terminated: (): StreamEvent => ({
    id: "evt_terminated",
    processed_at: AT,
    type: "session.status_terminated",
  }),
};

function session(overrides: Partial<SessionFixture> = {}): SessionFixture {
  return {
    agent: { id: "agent_1" },
    archived_at: null,
    status: "idle",
    ...overrides,
  };
}

function fakeClient(options: {
  events: StreamEvent[];
  retrieve?: () => Promise<SessionFixture>;
  sent?: SentEvent[];
}) {
  const controller = new AbortController();
  const send = vi.fn(
    (
      _sessionId: string,
      _params: EventSendParams
    ): Promise<BetaManagedAgentsSendSessionEvents> =>
      Promise.resolve({ data: options.sent ?? [ev.user()] })
  );
  const stream = vi.fn(() =>
    Promise.resolve({
      controller,
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
        for (const event of options.events) {
          if (controller.signal.aborted) {
            throw new Error("aborted");
          }
          yield event;
        }
      },
    })
  );
  const create = vi.fn((_params: SessionCreateParams) =>
    Promise.resolve({ id: "sesn_123" })
  );
  const retrieve = vi.fn(
    options.retrieve ?? (() => Promise.resolve(session()))
  );
  // Only the methods the driver calls are implemented.
  const client = {
    beta: { sessions: { create, events: { send, stream }, retrieve } },
  } as unknown as Anthropic;
  return { client, controller, create, retrieve, send, stream };
}

function driverFor(client: Anthropic) {
  return createClaudeDriver({
    agentId: "agent_1",
    client,
    environmentId: "env_1",
  });
}

function turn(client: Anthropic, signal = new AbortController().signal) {
  return collect(
    driverFor(client).runTurn({ sessionId: "sesn_123", signal, text: "Hi" })
  );
}

describe("createClaudeDriver", () => {
  describe("configuration", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("reads the agent and environment IDs from the environment", async () => {
      vi.stubEnv("CLAUDE_AGENT_ID", "agent_env");
      vi.stubEnv("CLAUDE_ENVIRONMENT_ID", "env_env");
      const { client, create } = fakeClient({ events: [] });

      await createClaudeDriver({ client }).createSession({
        threadId: "slack:C1:1.2",
        title: "Hi",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "agent_env",
          environment_id: "env_env",
        })
      );
    });

    it("prefers explicit options over the environment", async () => {
      vi.stubEnv("CLAUDE_AGENT_ID", "agent_env");
      vi.stubEnv("CLAUDE_ENVIRONMENT_ID", "env_env");
      const { client, create } = fakeClient({ events: [] });

      await driverFor(client).createSession({ threadId: "t", title: "Hi" });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "agent_1", environment_id: "env_1" })
      );
    });

    it("names the missing variable", () => {
      vi.stubEnv("CLAUDE_AGENT_ID", "");
      vi.stubEnv("CLAUDE_ENVIRONMENT_ID", "");
      const { client } = fakeClient({ events: [] });

      expect(() => createClaudeDriver({ client })).toThrow("CLAUDE_AGENT_ID");
      expect(() => createClaudeDriver({ agentId: "agent_1", client })).toThrow(
        "CLAUDE_ENVIRONMENT_ID"
      );
    });
  });

  it("creates sessions tagged with the chat thread", async () => {
    const { client, create } = fakeClient({ events: [] });
    const driver = createClaudeDriver({
      agentId: "agent_1",
      client,
      environmentId: "env_1",
      sessionParams: { metadata: { team: "support" }, vault_ids: ["vlt_1"] },
    });

    await expect(
      driver.createSession({ threadId: "slack:C1:1.2", title: "Question" })
    ).resolves.toBe("sesn_123");
    expect(create).toHaveBeenCalledWith({
      agent: "agent_1",
      environment_id: "env_1",
      metadata: { chat_thread_id: "slack:C1:1.2", team: "support" },
      title: "Question",
      vault_ids: ["vlt_1"],
    });
  });

  it("opens the stream before sending the user message", async () => {
    const { client, send, stream } = fakeClient({
      events: [ev.user(), ev.idle({ type: "end_turn" })],
    });

    await turn(client);

    expect(stream.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] ?? 0
    );
    expect(send).toHaveBeenCalledWith("sesn_123", {
      events: [{ content: [text("Hi")], type: "user.message" }],
    });
  });

  it("skips events from earlier turns and streams previews and messages", async () => {
    const { client } = fakeClient({
      events: [
        ev.message("evt_old", "stale"),
        ev.user(),
        ev.start("msg_1"),
        ev.delta("msg_1", "Hel"),
        ev.delta("msg_1", "lo"),
        ev.message("msg_1", "Hello, ", "world"),
        ev.idle({ type: "end_turn" }),
      ],
    });

    expect(await turn(client)).toEqual([
      { messageId: "msg_1", text: "Hel", type: "text-delta" },
      { messageId: "msg_1", text: "lo", type: "text-delta" },
      { messageId: "msg_1", text: "Hello, world", type: "message" },
      { reason: "complete", type: "turn-end" },
    ]);
  });

  it("maps tool calls and results", async () => {
    const { client } = fakeClient({
      events: [
        ev.user(),
        ev.toolUse("tu_1", "web_search", { query: "q" }),
        ev.toolResult("tu_1"),
        ev.mcpToolUse("mcp_1", "list_issues"),
        ev.mcpToolResult("mcp_1", true),
        ev.idle({ type: "end_turn" }),
      ],
    });

    expect(await turn(client)).toEqual([
      { id: "tu_1", name: "web_search", status: "running", type: "tool-call" },
      { id: "tu_1", status: "complete", type: "tool-call" },
      {
        id: "mcp_1",
        name: "list_issues",
        status: "running",
        type: "tool-call",
      },
      { id: "mcp_1", status: "error", type: "tool-call" },
      { reason: "complete", type: "turn-end" },
    ]);
  });

  it("turns requires_action into an approval request", async () => {
    const { client } = fakeClient({
      events: [
        ev.user(),
        ev.toolUse("tu_1", "bash", { command: "ls" }),
        ev.idle({ event_ids: ["tu_1", "tu_missing"], type: "requires_action" }),
      ],
    });

    const events = await turn(client);

    expect(events.at(-1)).toEqual({
      requestId: "tu_1,tu_missing",
      tools: [
        { id: "tu_1", input: { command: "ls" }, name: "bash" },
        { id: "tu_missing", name: "Tool" },
      ],
      type: "approval-request",
    });
  });

  it("reports approvals an earlier turn is still waiting on", async () => {
    const { client } = fakeClient({
      events: [
        ev.idle({ event_ids: ["tu_old"], type: "requires_action" }),
        ev.user(),
      ],
    });

    expect(await turn(client)).toEqual([
      {
        requestId: "tu_old",
        tools: [{ id: "tu_old", name: "Tool" }],
        type: "approval-request",
      },
    ]);
  });

  it("stops instead of asking for approval for custom tools", async () => {
    const { client } = fakeClient({
      events: [
        ev.user(),
        ev.customToolUse("ct_1", "lookup"),
        ev.idle({ event_ids: ["ct_1"], type: "requires_action" }),
      ],
    });

    expect(await turn(client)).toEqual([
      {
        detail: "custom tool results are not supported",
        reason: "stopped",
        type: "turn-end",
      },
    ]);
  });

  it("reports early stops, ended sessions, and dropped streams", async () => {
    const stopped = fakeClient({
      events: [ev.user(), ev.idle({ type: "budget_reached" })],
    });
    expect(await turn(stopped.client)).toEqual([
      { detail: "budget_reached", reason: "stopped", type: "turn-end" },
    ]);

    const terminated = fakeClient({ events: [ev.terminated()] });
    expect(await turn(terminated.client)).toEqual([{ type: "session-ended" }]);

    const dropped = fakeClient({ events: [ev.user()] });
    expect(await turn(dropped.client)).toEqual([]);
  });

  it("sends tool confirmations for every pending tool", async () => {
    const { client, send } = fakeClient({
      events: [
        ev.confirmation("evt_confirm_2", "tu_2"),
        ev.message("msg_2", "Done"),
        ev.idle({ type: "end_turn" }),
      ],
      sent: [
        ev.confirmation("evt_confirm_1", "tu_1"),
        ev.confirmation("evt_confirm_2", "tu_2"),
      ],
    });
    const respond = driverFor(client).respondToApproval;
    if (!respond) {
      throw new Error("Claude driver must support approvals");
    }

    const events = await collect(
      respond({
        approved: false,
        requestId: "tu_1,tu_2",
        sessionId: "sesn_123",
        signal: new AbortController().signal,
      })
    );

    expect(send).toHaveBeenCalledWith("sesn_123", {
      events: [
        { result: "deny", tool_use_id: "tu_1", type: "user.tool_confirmation" },
        { result: "deny", tool_use_id: "tu_2", type: "user.tool_confirmation" },
      ],
    });
    expect(events).toEqual([
      { messageId: "msg_2", text: "Done", type: "message" },
      { reason: "complete", type: "turn-end" },
    ]);
  });

  it("interrupts the session when the turn is aborted", async () => {
    const abort = new AbortController();
    const { client, controller, send } = fakeClient({
      events: [
        ev.user(),
        ev.message("msg_1", "Working"),
        ev.idle({ type: "end_turn" }),
      ],
    });
    const events = driverFor(client).runTurn({
      sessionId: "sesn_123",
      signal: abort.signal,
      text: "Hi",
    });

    const seen: ManagedAgentEvent[] = [];
    for await (const event of events) {
      seen.push(event);
      abort.abort();
    }

    expect(seen).toEqual([
      { messageId: "msg_1", text: "Working", type: "message" },
    ]);
    expect(send).toHaveBeenLastCalledWith("sesn_123", {
      events: [{ type: "user.interrupt" }],
    });
    expect(controller.signal.aborted).toBe(true);
  });

  it("interrupts a turn aborted while the message was being sent", async () => {
    const abort = new AbortController();
    const { client, controller, send } = fakeClient({
      events: [ev.user(), ev.message("msg_1", "Working")],
    });
    send.mockImplementationOnce(() => {
      abort.abort();
      return Promise.resolve({ data: [ev.user()] });
    });

    expect(await turn(client, abort.signal)).toEqual([]);
    expect(send).toHaveBeenLastCalledWith("sesn_123", {
      events: [{ type: "user.interrupt" }],
    });
    expect(controller.signal.aborted).toBe(true);
  });

  describe("resumeSession", () => {
    it("accepts active sessions owned by the agent", async () => {
      const { client } = fakeClient({ events: [] });
      await expect(driverFor(client).resumeSession("sesn_123")).resolves.toBe(
        true
      );
    });

    it("rejects foreign, archived, terminated, missing, and malformed sessions", async () => {
      const cases = [
        session({ agent: { id: "agent_other" } }),
        session({ archived_at: AT }),
        session({ status: "terminated" }),
      ];
      for (const value of cases) {
        const { client } = fakeClient({
          events: [],
          retrieve: () => Promise.resolve(value),
        });
        await expect(driverFor(client).resumeSession("sesn_123")).resolves.toBe(
          false
        );
      }

      const notFound = new Anthropic.NotFoundError(
        404,
        undefined,
        "missing",
        new Headers()
      );
      const missing = fakeClient({
        events: [],
        retrieve: () => Promise.reject(notFound),
      });
      await expect(
        driverFor(missing.client).resumeSession("sesn_123")
      ).resolves.toBe(false);

      const malformed = fakeClient({ events: [] });
      await expect(
        driverFor(malformed.client).resumeSession("../etc")
      ).resolves.toBe(false);
      expect(malformed.retrieve).not.toHaveBeenCalled();
    });

    it("rethrows transient failures", async () => {
      const { client } = fakeClient({
        events: [],
        retrieve: () => Promise.reject(new Error("network")),
      });
      await expect(driverFor(client).resumeSession("sesn_123")).rejects.toThrow(
        "network"
      );
    });
  });
});
