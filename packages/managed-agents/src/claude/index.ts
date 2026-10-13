import Anthropic from "@anthropic-ai/sdk";
import {
  type AccumulatedEvent,
  accumulateManagedAgentsEvent,
} from "@anthropic-ai/sdk/lib/sessions/accumulate";
import type {
  BetaManagedAgentsEventParams,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import type {
  ManagedAgentDriver,
  ManagedAgentEvent,
  PendingToolApproval,
} from "../types";

// Types

/** Options for {@link createClaudeDriver}. */
export interface ClaudeDriverOptions {
  /**
   * Persistent Managed Agents agent ID. Sessions owned by other agents are
   * never reused. Defaults to the `CLAUDE_AGENT_ID` environment variable.
   */
  agentId?: string;
  /** API key. Defaults to the `ANTHROPIC_API_KEY` environment variable. Ignored when `client` is set. */
  apiKey?: string;
  /** Preconfigured Anthropic client. */
  client?: Anthropic;
  /**
   * Managed Agents environment ID used for new sessions. Defaults to the
   * `CLAUDE_ENVIRONMENT_ID` environment variable.
   */
  environmentId?: string;
  /**
   * Extra parameters for new sessions, such as `vault_ids` or `resources`.
   * `metadata.chat_thread_id` is always set to the Chat SDK thread ID.
   */
  sessionParams?: Omit<
    SessionCreateParams,
    "agent" | "environment_id" | "title"
  >;
}

type AnchorType = "user.message" | "user.tool_confirmation";

interface TurnRequest {
  anchorType: AnchorType;
  events: BetaManagedAgentsEventParams[];
  sessionId: string;
  signal: AbortSignal;
}

interface Preview {
  acc: AccumulatedEvent | undefined;
  sent: string;
}

type TextContent =
  | ReadonlyArray<{ type: string; text?: string }>
  | null
  | undefined;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const GONE_STATUSES = new Set([400, 404, 410]);
const UNKNOWN_TOOL = "Tool";

function textOf(content: TextContent): string {
  // Citation metadata can split one sentence across adjacent text blocks.
  // Each block already carries its own spacing, so join without separators.
  return (content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("");
}

function isSessionEnd(event: BetaManagedAgentsStreamSessionEvents): boolean {
  return (
    event.type === "session.status_terminated" ||
    event.type === "session.deleted"
  );
}

/**
 * Streams one turn: opens the event stream, sends the user events, and
 * translates provider events until the session goes idle.
 *
 * @remarks
 * The stream must open before the events are sent because it only emits
 * events produced after it attaches. Events that arrive before the server
 * echoes the sent event belong to an earlier turn and are skipped.
 */
async function* streamTurn(
  client: Anthropic,
  request: TurnRequest
): AsyncGenerator<ManagedAgentEvent> {
  const { anchorType, sessionId, signal } = request;
  if (signal.aborted) {
    return;
  }

  const stream = await client.beta.sessions.events.stream(sessionId, {
    event_deltas: ["agent.message"],
  });

  let anchorId: string | undefined;
  try {
    const sent = await client.beta.sessions.events.send(sessionId, {
      events: request.events,
    });
    anchorId = sent.data
      ?.filter((event) => event.type === anchorType)
      .at(-1)?.id;
  } catch (error) {
    stream.controller.abort();
    throw error;
  }

  const onAbort = () => {
    client.beta.sessions.events
      .send(sessionId, { events: [{ type: "user.interrupt" }] })
      .catch(() => undefined);
    stream.controller.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let anchored = anchorId === undefined;
  const previews = new Map<string, Preview>();
  const tools = new Map<string, PendingToolApproval>();
  const customTools = new Set<string>();

  const pending = (eventIds: string[]): ManagedAgentEvent => {
    if (eventIds.some((id) => customTools.has(id))) {
      return {
        detail: "custom tool results are not supported",
        reason: "stopped",
        type: "turn-end",
      };
    }
    return {
      requestId: eventIds.join(","),
      tools: eventIds.map((id) => tools.get(id) ?? { id, name: UNKNOWN_TOOL }),
      type: "approval-request",
    };
  };

  const advance = (
    preview: Preview,
    messageId: string,
    event: BetaManagedAgentsStreamSessionEvents
  ): ManagedAgentEvent | undefined => {
    try {
      preview.acc = accumulateManagedAgentsEvent(preview.acc, event);
    } catch {
      return;
    }
    const text = textOf(preview.acc?.content);
    if (!text.startsWith(preview.sent) || text === preview.sent) {
      return;
    }
    const delta = text.slice(preview.sent.length);
    preview.sent = text;
    return { messageId, text: delta, type: "text-delta" };
  };

  try {
    for await (const event of stream) {
      if (!anchored) {
        if (event.type === anchorType && event.id === anchorId) {
          anchored = true;
        } else if (isSessionEnd(event)) {
          yield { type: "session-ended" };
          return;
        } else if (
          event.type === "session.status_idle" &&
          event.stop_reason?.type === "requires_action"
        ) {
          // An earlier turn is still waiting for approval.
          yield pending(event.stop_reason.event_ids);
          return;
        }
        continue;
      }

      switch (event.type) {
        case "event_start": {
          if (event.event.type === "agent.message") {
            const preview: Preview = { acc: undefined, sent: "" };
            previews.set(event.event.id, preview);
            const delta = advance(preview, event.event.id, event);
            if (delta) {
              yield delta;
            }
          }
          break;
        }
        case "event_delta": {
          const preview = previews.get(event.event_id);
          const delta = preview && advance(preview, event.event_id, event);
          if (delta) {
            yield delta;
          }
          break;
        }
        case "agent.message":
          previews.delete(event.id);
          yield {
            messageId: event.id,
            text: textOf(event.content),
            type: "message",
          };
          break;
        case "agent.tool_use":
        case "agent.mcp_tool_use":
          tools.set(event.id, {
            id: event.id,
            input: event.input,
            name: event.name,
          });
          yield {
            id: event.id,
            name: event.name,
            status: "running",
            type: "tool-call",
          };
          break;
        case "agent.custom_tool_use":
          customTools.add(event.id);
          break;
        case "agent.tool_result":
          yield {
            id: event.tool_use_id,
            status: event.is_error ? "error" : "complete",
            type: "tool-call",
          };
          break;
        case "agent.mcp_tool_result":
          yield {
            id: event.mcp_tool_use_id,
            status: event.is_error ? "error" : "complete",
            type: "tool-call",
          };
          break;
        case "session.status_idle": {
          const stop = event.stop_reason;
          if (!stop) {
            break;
          }
          if (stop.type === "end_turn") {
            yield { reason: "complete", type: "turn-end" };
          } else if (stop.type === "requires_action") {
            yield pending(stop.event_ids);
          } else {
            yield { detail: stop.type, reason: "stopped", type: "turn-end" };
          }
          return;
        }
        case "session.status_terminated":
        case "session.deleted":
          yield { type: "session-ended" };
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
 * Create a driver for [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview).
 *
 * Each chat thread gets one Managed Agents session. Agent and environment
 * resources are persistent: create them once, outside the request path.
 *
 * Tool calls that need confirmation are posted as approval cards; the
 * decision is sent back as `user.tool_confirmation` events. Custom tools that
 * need client-side results are not supported.
 *
 * @example
 * ```ts
 * // Reads ANTHROPIC_API_KEY, CLAUDE_AGENT_ID, and CLAUDE_ENVIRONMENT_ID.
 * const agent = createManagedAgent({ driver: createClaudeDriver() });
 * ```
 *
 * @throws Error when no agent ID or environment ID is passed or set in the
 * environment.
 */
export function createClaudeDriver(
  options: ClaudeDriverOptions = {}
): ManagedAgentDriver {
  const agentId = options.agentId ?? process.env.CLAUDE_AGENT_ID;
  const environmentId =
    options.environmentId ?? process.env.CLAUDE_ENVIRONMENT_ID;
  if (!agentId) {
    throw new Error(
      "Claude agent ID is required. Pass agentId or set CLAUDE_AGENT_ID."
    );
  }
  if (!environmentId) {
    throw new Error(
      "Claude environment ID is required. Pass environmentId or set CLAUDE_ENVIRONMENT_ID."
    );
  }
  const client =
    options.client ??
    new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});

  return {
    name: "claude",

    async createSession({ threadId, title }) {
      const { metadata, ...params } = options.sessionParams ?? {};
      const session = await client.beta.sessions.create({
        ...params,
        agent: agentId,
        environment_id: environmentId,
        metadata: { ...metadata, chat_thread_id: threadId },
        title,
      });
      return session.id;
    },

    async resumeSession(sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return false;
      }
      try {
        const session = await client.beta.sessions.retrieve(sessionId);
        return (
          session.agent.id === agentId &&
          typeof session.archived_at !== "string" &&
          session.status !== "terminated"
        );
      } catch (error) {
        if (
          error instanceof Anthropic.APIError &&
          GONE_STATUSES.has(error.status ?? 0)
        ) {
          return false;
        }
        throw error;
      }
    },

    runTurn({ sessionId, signal, text }) {
      return streamTurn(client, {
        anchorType: "user.message",
        events: [{ content: [{ text, type: "text" }], type: "user.message" }],
        sessionId,
        signal,
      });
    },

    respondToApproval({ approved, requestId, sessionId, signal }) {
      const result = approved ? "allow" : "deny";
      return streamTurn(client, {
        anchorType: "user.tool_confirmation",
        events: requestId
          .split(",")
          .filter((id) => id !== "")
          .map((id) => ({
            result,
            tool_use_id: id,
            type: "user.tool_confirmation",
          })),
        sessionId,
        signal,
      });
    },
  };
}
