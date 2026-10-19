import OpenAI from "openai";
import type {
  AgentOutputItem,
  AgentSession,
  AgentSessionEvent,
  AgentSessionItem,
  EnvironmentParam,
} from "openai/resources/beta/agents/agents";
import type { SessionCreateParams } from "openai/resources/beta/agents/sessions/sessions";
import type { ManagedAgentDriver, ManagedAgentEvent } from "../types";

// Types

/** Options for {@link createOpenAIDriver}. */
export interface OpenAIDriverOptions {
  /**
   * Inline agent configuration for new sessions. Use this instead of
   * `agentId` to configure the agent in code.
   */
  agent?: SessionCreateParams.Agent;
  /**
   * Reusable agent ID. Sessions created by other agents are never reused.
   * Defaults to the `OPENAI_AGENT_ID` environment variable.
   */
  agentId?: string;
  /** API key. Defaults to the `OPENAI_API_KEY` environment variable. Ignored when `client` is set. */
  apiKey?: string;
  /** Preconfigured OpenAI client. */
  client?: OpenAI;
  /**
   * Execution environment for new sessions. Defaults to the prewarmed
   * environment in `OPENAI_ENVIRONMENT_ID`, or `{ type: "none" }`.
   */
  environment?: EnvironmentParam;
  /** Extra metadata for new sessions. `chat_thread_id` is always set. */
  metadata?: Record<string, string>;
  /** Vault IDs attached to new sessions. */
  vaultIds?: string[];
}

type ItemLike = AgentSessionItem | AgentOutputItem;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const GONE_STATUSES = new Set([400, 404, 410]);

/** Tool-like items, shown as task progress. Messages and reasoning are not tools. */
function toolName(item: ItemLike): string | undefined {
  switch (item.type) {
    case "function_call":
    case "mcp_call":
      return item.name;
    case "web_search_call":
      return "web_search";
    case "command_execution":
      return "command";
    case "computer_use_call":
      return "computer";
    case "create_subagent_call":
    case "send_subagent_input_call":
    case "resume_subagent_call":
    case "wait_for_subagents_call":
    case "interrupt_subagent_call":
    case "close_subagent_call":
      return "subagent";
    default:
      return;
  }
}

function toolStatus(item: ItemLike): "complete" | "error" {
  return "status" in item && item.status === "failed" ? "error" : "complete";
}

function unsupportedAction(session: AgentSession): ManagedAgentEvent {
  const action = session.required_actions[0];
  return {
    detail: action ? `${action.type} is not supported` : "requires_action",
    reason: "stopped",
    type: "turn-end",
  };
}

/**
 * Streams one turn: opens the event stream, sends the message, and
 * translates events for the turn the message started.
 *
 * @remarks
 * Sending returns no event ID, so the turn is identified by the first
 * `turn.created` event after sending. Turn-scoped events for other turns are
 * skipped.
 */
async function* streamTurn(
  client: OpenAI,
  sessionId: string,
  text: string,
  signal: AbortSignal
): AsyncGenerator<ManagedAgentEvent> {
  if (signal.aborted) {
    return;
  }
  const events = client.beta.agents.sessions.events;
  const stream = await events.stream(sessionId);

  try {
    await events.create(sessionId, {
      events: [
        {
          input: [{ content: [{ text, type: "input_text" }], role: "user" }],
          type: "agent.session.input.message",
        },
      ],
    });
  } catch (error) {
    stream.controller.abort();
    throw error;
  }

  const onAbort = () => {
    events
      .create(sessionId, { events: [{ type: "agent.session.input.cancel" }] })
      .catch(() => undefined);
    stream.controller.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  // A signal aborted while the stream opened or the message was sent never
  // fires "abort" again, so cancel the turn that was just started now.
  if (signal.aborted) {
    onAbort();
  }

  let turnId: string | undefined;
  const ownTurn = (id: string | null) => id === null || id === turnId;

  try {
    for await (const event of stream as AsyncIterable<AgentSessionEvent>) {
      switch (event.type) {
        case "agent.session.turn.created":
          turnId ??= event.turn_id;
          break;
        case "agent.session.turn.output_text.delta":
          if (turnId && ownTurn(event.turn_id)) {
            yield {
              messageId: `${event.item_id}:${event.content_index}`,
              text: event.delta,
              type: "text-delta",
            };
          }
          break;
        case "agent.session.turn.output_text.done":
          if (turnId && ownTurn(event.turn_id)) {
            yield {
              messageId: `${event.item_id}:${event.content_index}`,
              text: event.text,
              type: "message",
            };
          }
          break;
        case "agent.session.turn.item.added": {
          const name = toolName(event.item);
          if (turnId && ownTurn(event.turn_id) && name && event.item.id) {
            yield {
              id: event.item.id,
              name,
              status: "running",
              type: "tool-call",
            };
          }
          break;
        }
        case "agent.session.turn.item.done":
          if (turnId && ownTurn(event.turn_id) && toolName(event.item)) {
            yield {
              id: event.item.id,
              status: toolStatus(event.item),
              type: "tool-call",
            };
          }
          break;
        case "agent.session.turn.completed":
          if (event.turn_id === turnId) {
            yield { reason: "complete", type: "turn-end" };
            return;
          }
          break;
        case "agent.session.turn.failed":
          if (event.turn_id === turnId) {
            yield {
              detail: event.turn.error?.code ?? "failed",
              reason: "stopped",
              type: "turn-end",
            };
            return;
          }
          break;
        case "agent.session.turn.cancelled":
          if (event.turn_id === turnId) {
            yield { reason: "cancelled", type: "turn-end" };
            return;
          }
          break;
        case "agent.session.requires_action":
          yield unsupportedAction(event.session);
          return;
        case "agent.session.idle":
          // The message joined a turn that was already running, so no turn of
          // its own was created. The session is done either way.
          yield { reason: "complete", type: "turn-end" };
          return;
        case "agent.session.failed":
          yield { type: "session-ended" };
          return;
        case "error":
          yield {
            detail: event.error.code ?? "error",
            reason: "stopped",
            type: "turn-end",
          };
          return;
        default:
          break;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    stream.controller.abort();
  }
}

/**
 * Create a driver for the [OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview).
 *
 * Each chat thread gets one Agents API session. Use a reusable agent
 * (`agentId` or `OPENAI_AGENT_ID`) or configure one inline with `agent`.
 *
 * The Agents API asks for client input through `required_actions`
 * (computer-use approvals, client function calls, environment connections).
 * None of these map to an Approve/Deny button, so turns that need one stop
 * with a notice.
 *
 * @example
 * ```ts
 * // Reads OPENAI_API_KEY, OPENAI_AGENT_ID, and OPENAI_ENVIRONMENT_ID.
 * const agent = createManagedAgent({ driver: createOpenAIDriver() });
 * ```
 *
 * @throws Error when neither `agent` nor an agent ID is configured.
 */
export function createOpenAIDriver(
  options: OpenAIDriverOptions = {}
): ManagedAgentDriver {
  const agentId = options.agent
    ? undefined
    : (options.agentId ?? process.env.OPENAI_AGENT_ID);
  if (!(options.agent || agentId)) {
    throw new Error(
      "OpenAI agent is required. Pass agentId or agent, or set OPENAI_AGENT_ID."
    );
  }
  const environmentId = process.env.OPENAI_ENVIRONMENT_ID;
  const environment: EnvironmentParam =
    options.environment ??
    (environmentId
      ? { environment_id: environmentId, type: "openai_hosted" }
      : { type: "none" });
  const client =
    options.client ??
    new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {});

  return {
    name: "openai",

    async createSession({ threadId }) {
      const session = await client.beta.agents.sessions.create({
        ...(agentId ? { agent_id: agentId } : { agent: options.agent }),
        environment,
        metadata: { ...options.metadata, chat_thread_id: threadId },
        ...(options.vaultIds ? { vault_ids: options.vaultIds } : {}),
      });
      return session.id;
    },

    async resumeSession(sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return false;
      }
      try {
        const session = await client.beta.agents.sessions.retrieve(sessionId);
        if (session.status === "failed") {
          return false;
        }
        return agentId ? session.agent.id === agentId : true;
      } catch (error) {
        if (
          error instanceof OpenAI.APIError &&
          GONE_STATUSES.has(error.status ?? 0)
        ) {
          return false;
        }
        throw error;
      }
    },

    runTurn({ sessionId, signal, text }) {
      return streamTurn(client, sessionId, text, signal);
    },
  };
}
