import {
  Agent,
  AgentNotFoundError,
  type AgentOptions,
  type SDKAgent,
  type SendOptions,
} from "@cursor/sdk";
import type { ManagedAgentDriver, ManagedAgentEvent } from "../types";

// Types

/** Options for {@link createCursorDriver}. */
export interface CursorDriverOptions {
  /**
   * Options for new agents, such as `cloud`, `local`, `model`, and `apiKey`.
   * Also passed to `Agent.resume()` so per-process settings like inline MCP
   * servers survive across turns.
   */
  agent: AgentOptions;
  /** Options for every `agent.send()`, such as `model` or `mode`. */
  send?: Omit<SendOptions, "onDelta" | "onStep">;
}

type TextContent = ReadonlyArray<{ type: string; text?: string }>;

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const CLOUD_AGENT_PREFIX = "bc-";

const TOOL_STATUS = {
  completed: "complete",
  error: "error",
  running: "running",
} as const;

function textOf(content: TextContent): string {
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("");
}

/**
 * Create a driver for [Cursor agents](https://cursor.com/docs/sdk/typescript).
 *
 * Each chat thread gets one Cursor agent; each message is one run. Use the
 * `cloud` runtime on serverless platforms: local agents keep their
 * conversation on the machine that created them.
 *
 * Cursor's SDK has no approval API, so runs that ask for approval are
 * cancelled with a notice. Gate tools with Cursor hooks or sandboxing instead.
 *
 * @example
 * ```ts
 * const agent = createManagedAgent({
 *   driver: createCursorDriver({
 *     agent: {
 *       apiKey: process.env.CURSOR_API_KEY!,
 *       model: { id: "composer-2.5" },
 *       cloud: { repos: [{ url: "https://github.com/acme/app" }] },
 *     },
 *   }),
 * });
 * ```
 */
export function createCursorDriver(
  options: CursorDriverOptions
): ManagedAgentDriver {
  // Agents created in this process, kept until their first run so a new
  // agent does not need a round trip through `Agent.resume()`.
  const created = new Map<string, SDKAgent>();

  async function open(agentId: string): Promise<SDKAgent> {
    const agent = created.get(agentId);
    if (agent) {
      created.delete(agentId);
      return agent;
    }
    return await Agent.resume(agentId, options.agent);
  }

  async function* runTurn(
    agentId: string,
    text: string,
    signal: AbortSignal
  ): AsyncGenerator<ManagedAgentEvent> {
    if (signal.aborted) {
      return;
    }

    let agent: SDKAgent | undefined;
    try {
      agent = await open(agentId);
      const run = await agent.send(text, options.send);
      const onAbort = () => {
        run.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        let segment = 0;
        let afterTool = false;
        let streamedText = false;

        for await (const message of run.stream()) {
          switch (message.type) {
            case "assistant": {
              const delta = textOf(message.message.content);
              if (!delta) {
                break;
              }
              if (afterTool) {
                segment += 1;
                afterTool = false;
              }
              streamedText = true;
              yield {
                messageId: `${run.id}:${segment}`,
                text: delta,
                type: "text-delta",
              };
              break;
            }
            case "tool_call":
              afterTool = true;
              yield {
                id: message.call_id,
                name: message.name,
                status: TOOL_STATUS[message.status],
                type: "tool-call",
              };
              break;
            case "request":
              await run.cancel().catch(() => undefined);
              yield {
                requestId: message.request_id,
                tools: [],
                type: "approval-request",
              };
              return;
            default:
              break;
          }
        }

        if (signal.aborted) {
          return;
        }
        const result = await run.wait();
        if (result.status === "finished") {
          if (!streamedText && result.result) {
            yield {
              messageId: `${run.id}:0`,
              text: result.result,
              type: "message",
            };
          }
          yield { reason: "complete", type: "turn-end" };
        } else if (result.status === "cancelled") {
          yield { reason: "cancelled", type: "turn-end" };
        } else {
          yield {
            detail: result.error?.code ?? "error",
            reason: "stopped",
            type: "turn-end",
          };
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      if (error instanceof AgentNotFoundError) {
        yield { type: "session-ended" };
        return;
      }
      if (signal.aborted) {
        return;
      }
      throw error;
    } finally {
      agent?.close();
    }
  }

  return {
    name: "cursor",

    async createSession() {
      const agent = await Agent.create(options.agent);
      created.set(agent.agentId, agent);
      return agent.agentId;
    },

    async resumeSession(agentId) {
      if (!AGENT_ID_PATTERN.test(agentId)) {
        return false;
      }
      // `Agent.get()` is cloud-only. Missing local agents surface as
      // `session-ended` on the next run instead.
      if (!agentId.startsWith(CLOUD_AGENT_PREFIX)) {
        return true;
      }
      try {
        const info = await Agent.get(agentId, { apiKey: options.agent.apiKey });
        return info.archived !== true;
      } catch (error) {
        if (error instanceof AgentNotFoundError) {
          return false;
        }
        throw error;
      }
    },

    runTurn({ sessionId, signal, text }) {
      return runTurn(sessionId, text, signal);
    },
  };
}
