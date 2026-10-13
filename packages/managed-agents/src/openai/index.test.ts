import OpenAI from "openai";
import type {
  AgentOutputItem,
  AgentSession,
  AgentSessionEvent,
  SessionTurnError,
} from "openai/resources/beta/agents/agents";
import type { EventCreateParams } from "openai/resources/beta/agents/sessions/events";
import type { SessionCreateParams } from "openai/resources/beta/agents/sessions/sessions";
import type { Turn } from "openai/resources/beta/agents/sessions/turns/turns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collect } from "../test-utils";
import type { ManagedAgentEvent } from "../types";
import { createOpenAIDriver } from "./index";

// Fixtures are full SDK types so a change in the event shapes fails
// type-checking instead of silently passing.

const SESSION = "sess_123";
const TURN = "turn_1";

const base = { event_id: "evt", session_id: SESSION };

function turnObject(
  status: Turn["status"],
  error: SessionTurnError | null = null,
  id = TURN
): Turn {
  return {
    agent_id: "agent_1",
    completed_at: null,
    created_at: 0,
    error,
    id,
    object: "agent.session.turn",
    session_id: SESSION,
    started_at: null,
    status,
    subagent_id: null,
    usage: null,
  };
}

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    agent: {
      id: "agent_1",
      instructions: null,
      model: "gpt-6-astra",
      multi_agent: { enabled: false, max_concurrent_subagents: null },
      name: null,
      reasoning: { effort: null, summary: null },
      service_tier: "auto",
      text: { format: { type: "text" }, verbosity: "medium" },
      tools: [],
    },
    created_at: 0,
    environment: { type: "none" },
    error: null,
    id: SESSION,
    last_active_at: 0,
    metadata: {},
    object: "agent.session",
    required_actions: [],
    status: "idle",
    usage: null,
    vault_ids: [],
    ...overrides,
  };
}

const webSearch = (
  id: string,
  status: "in_progress" | "completed"
): AgentOutputItem => ({
  action: null,
  id,
  status,
  turn_id: TURN,
  type: "web_search_call",
});

const functionCall = (
  id: string,
  status: "in_progress" | "completed" | "failed"
): AgentOutputItem => ({
  arguments: {},
  call_id: `call_${id}`,
  id,
  name: "lookup",
  status,
  turn_id: TURN,
  type: "function_call",
});

const ev = {
  turnCreated: (turnId = TURN): AgentSessionEvent => ({
    ...base,
    turn: turnObject("queued", null, turnId),
    turn_id: turnId,
    type: "agent.session.turn.created",
  }),
  delta: (itemId: string, delta: string, turnId = TURN): AgentSessionEvent => ({
    ...base,
    content_index: 0,
    delta,
    item_id: itemId,
    output_index: 0,
    turn_id: turnId,
    type: "agent.session.turn.output_text.delta",
  }),
  textDone: (itemId: string, text: string): AgentSessionEvent => ({
    ...base,
    content_index: 0,
    item_id: itemId,
    output_index: 0,
    text,
    turn_id: TURN,
    type: "agent.session.turn.output_text.done",
  }),
  itemAdded: (item: AgentOutputItem): AgentSessionEvent => ({
    ...base,
    item,
    output_index: 0,
    turn_id: TURN,
    type: "agent.session.turn.item.added",
  }),
  itemDone: (item: AgentOutputItem): AgentSessionEvent => ({
    ...base,
    item,
    output_index: 0,
    turn_id: TURN,
    type: "agent.session.turn.item.done",
  }),
  completed: (turnId = TURN): AgentSessionEvent => ({
    ...base,
    turn: turnObject("completed", null, turnId),
    turn_id: turnId,
    type: "agent.session.turn.completed",
    usage: null,
  }),
  failed: (error: SessionTurnError): AgentSessionEvent => ({
    ...base,
    turn: turnObject("failed", error),
    turn_id: TURN,
    type: "agent.session.turn.failed",
    usage: null,
  }),
  cancelled: (): AgentSessionEvent => ({
    ...base,
    turn: turnObject("cancelled"),
    turn_id: TURN,
    type: "agent.session.turn.cancelled",
    usage: null,
  }),
  idle: (): AgentSessionEvent => ({
    event_id: "evt",
    session: session(),
    type: "agent.session.idle",
  }),
  requiresAction: (
    actions: AgentSession["required_actions"]
  ): AgentSessionEvent => ({
    event_id: "evt",
    session: session({ required_actions: actions, status: "requires_action" }),
    type: "agent.session.requires_action",
  }),
  sessionFailed: (): AgentSessionEvent => ({
    event_id: "evt",
    session: session({ status: "failed" }),
    type: "agent.session.failed",
  }),
  error: (code: string | null): AgentSessionEvent => ({
    ...base,
    error: { code, message: "boom", param: null, type: "server_error" },
    type: "error",
  }),
};

function fakeClient(options: {
  events: AgentSessionEvent[];
  retrieve?: () => Promise<AgentSession>;
}) {
  const controller = new AbortController();
  const create = vi.fn(
    (_sessionId: string, _params: EventCreateParams): Promise<void> =>
      Promise.resolve()
  );
  const stream = vi.fn(() =>
    Promise.resolve({
      controller,
      async *[Symbol.asyncIterator](): AsyncGenerator<AgentSessionEvent> {
        for (const event of options.events) {
          if (controller.signal.aborted) {
            throw new Error("aborted");
          }
          yield event;
        }
      },
    })
  );
  const createSession = vi.fn((_params: SessionCreateParams) =>
    Promise.resolve(session())
  );
  const retrieve = vi.fn(
    options.retrieve ?? (() => Promise.resolve(session()))
  );
  // Only the methods the driver calls are implemented.
  const client = {
    beta: {
      agents: {
        sessions: {
          create: createSession,
          events: { create, stream },
          retrieve,
        },
      },
    },
  } as unknown as OpenAI;
  return { client, controller, create, createSession, retrieve, stream };
}

function driverFor(client: OpenAI) {
  return createOpenAIDriver({ agentId: "agent_1", client });
}

function turn(client: OpenAI, signal = new AbortController().signal) {
  return collect(
    driverFor(client).runTurn({ sessionId: SESSION, signal, text: "Hi" })
  );
}

describe("createOpenAIDriver", () => {
  describe("configuration", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("reads the agent and environment from the environment", async () => {
      vi.stubEnv("OPENAI_AGENT_ID", "agent_env");
      vi.stubEnv("OPENAI_ENVIRONMENT_ID", "env_1");
      const { client, createSession } = fakeClient({ events: [] });

      await createOpenAIDriver({ client }).createSession({
        threadId: "slack:C1:1.2",
        title: "Hi",
      });

      expect(createSession).toHaveBeenCalledWith({
        agent_id: "agent_env",
        environment: { environment_id: "env_1", type: "openai_hosted" },
        metadata: { chat_thread_id: "slack:C1:1.2" },
      });
    });

    it("supports inline agents, explicit environments, and vaults", async () => {
      vi.stubEnv("OPENAI_AGENT_ID", "agent_env");
      const { client, createSession } = fakeClient({ events: [] });

      await createOpenAIDriver({
        agent: { instructions: "Be brief.", model: "gpt-6-astra" },
        client,
        environment: { type: "openai_hosted" },
        metadata: { team: "support" },
        vaultIds: ["vlt_1"],
      }).createSession({ threadId: "t", title: "Hi" });

      expect(createSession).toHaveBeenCalledWith({
        agent: { instructions: "Be brief.", model: "gpt-6-astra" },
        environment: { type: "openai_hosted" },
        metadata: { chat_thread_id: "t", team: "support" },
        vault_ids: ["vlt_1"],
      });
    });

    it("defaults to no environment", async () => {
      vi.stubEnv("OPENAI_ENVIRONMENT_ID", "");
      const { client, createSession } = fakeClient({ events: [] });

      await driverFor(client).createSession({ threadId: "t", title: "Hi" });

      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({ environment: { type: "none" } })
      );
    });

    it("requires an agent", () => {
      vi.stubEnv("OPENAI_AGENT_ID", "");
      const { client } = fakeClient({ events: [] });

      expect(() => createOpenAIDriver({ client })).toThrow("OPENAI_AGENT_ID");
    });
  });

  it("opens the stream before sending the message", async () => {
    const { client, create, stream } = fakeClient({
      events: [ev.turnCreated(), ev.completed()],
    });

    await turn(client);

    expect(stream.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0] ?? 0
    );
    expect(create).toHaveBeenCalledWith(SESSION, {
      events: [
        {
          input: [
            { content: [{ text: "Hi", type: "input_text" }], role: "user" },
          ],
          type: "agent.session.input.message",
        },
      ],
    });
  });

  it("streams text and tool calls for its own turn only", async () => {
    const { client } = fakeClient({
      events: [
        ev.delta("old_msg", "stale", "turn_old"),
        ev.completed("turn_old"),
        ev.turnCreated(),
        ev.itemAdded(webSearch("ws_1", "in_progress")),
        ev.itemDone(webSearch("ws_1", "completed")),
        ev.itemAdded(functionCall("fc_1", "in_progress")),
        ev.itemDone(functionCall("fc_1", "failed")),
        ev.delta("msg_1", "Hel"),
        ev.delta("msg_1", "lo"),
        ev.textDone("msg_1", "Hello."),
        ev.completed(),
      ],
    });

    expect(await turn(client)).toEqual([
      { id: "ws_1", name: "web_search", status: "running", type: "tool-call" },
      { id: "ws_1", status: "complete", type: "tool-call" },
      { id: "fc_1", name: "lookup", status: "running", type: "tool-call" },
      { id: "fc_1", status: "error", type: "tool-call" },
      { messageId: "msg_1:0", text: "Hel", type: "text-delta" },
      { messageId: "msg_1:0", text: "lo", type: "text-delta" },
      { messageId: "msg_1:0", text: "Hello.", type: "message" },
      { reason: "complete", type: "turn-end" },
    ]);
  });

  it("reports failed and cancelled turns", async () => {
    const failed = fakeClient({
      events: [
        ev.turnCreated(),
        ev.failed({ code: "rate_limit_exceeded", message: "slow down" }),
      ],
    });
    expect(await turn(failed.client)).toEqual([
      { detail: "rate_limit_exceeded", reason: "stopped", type: "turn-end" },
    ]);

    const cancelled = fakeClient({
      events: [ev.turnCreated(), ev.cancelled()],
    });
    expect(await turn(cancelled.client)).toEqual([
      { reason: "cancelled", type: "turn-end" },
    ]);
  });

  it("stops on required actions it cannot answer", async () => {
    const { client } = fakeClient({
      events: [
        ev.turnCreated(),
        ev.requiresAction([
          {
            arguments: {},
            call_id: "call_1",
            name: "lookup",
            turn_id: TURN,
            type: "function_call",
          },
        ]),
      ],
    });

    expect(await turn(client)).toEqual([
      {
        detail: "function_call is not supported",
        reason: "stopped",
        type: "turn-end",
      },
    ]);
  });

  it("ends on idle, session failure, errors, and dropped streams", async () => {
    const idle = fakeClient({ events: [ev.idle()] });
    expect(await turn(idle.client)).toEqual([
      { reason: "complete", type: "turn-end" },
    ]);

    const failed = fakeClient({ events: [ev.sessionFailed()] });
    expect(await turn(failed.client)).toEqual([{ type: "session-ended" }]);

    const errored = fakeClient({ events: [ev.error("server_error")] });
    expect(await turn(errored.client)).toEqual([
      { detail: "server_error", reason: "stopped", type: "turn-end" },
    ]);

    const dropped = fakeClient({ events: [ev.turnCreated()] });
    expect(await turn(dropped.client)).toEqual([]);
  });

  it("cancels the turn when it is aborted", async () => {
    const abort = new AbortController();
    const { client, controller, create } = fakeClient({
      events: [ev.turnCreated(), ev.delta("msg_1", "Working"), ev.completed()],
    });

    const seen: ManagedAgentEvent[] = [];
    for await (const event of driverFor(client).runTurn({
      sessionId: SESSION,
      signal: abort.signal,
      text: "Hi",
    })) {
      seen.push(event);
      abort.abort();
    }

    expect(seen).toEqual([
      { messageId: "msg_1:0", text: "Working", type: "text-delta" },
    ]);
    expect(create).toHaveBeenLastCalledWith(SESSION, {
      events: [{ type: "agent.session.input.cancel" }],
    });
    expect(controller.signal.aborted).toBe(true);
  });

  describe("resumeSession", () => {
    it("accepts sessions owned by the agent", async () => {
      const { client } = fakeClient({ events: [] });
      await expect(driverFor(client).resumeSession(SESSION)).resolves.toBe(
        true
      );
    });

    it("rejects foreign, failed, missing, and malformed sessions", async () => {
      const foreign = session();
      foreign.agent.id = "agent_other";
      for (const value of [foreign, session({ status: "failed" })]) {
        const { client } = fakeClient({
          events: [],
          retrieve: () => Promise.resolve(value),
        });
        await expect(driverFor(client).resumeSession(SESSION)).resolves.toBe(
          false
        );
      }

      const notFound = new OpenAI.NotFoundError(
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
        driverFor(missing.client).resumeSession(SESSION)
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
      await expect(driverFor(client).resumeSession(SESSION)).rejects.toThrow(
        "network"
      );
    });
  });
});
