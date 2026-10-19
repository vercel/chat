import type { StreamChunk, TaskUpdateChunk } from "chat";
import type {
  AgentApprovalRequestEvent,
  AgentTurnEndEvent,
  ManagedAgentEvent,
} from "./types";

const MESSAGE_SEPARATOR = "\n\n";
const DEFAULT_TOOL_TITLE = "Tool";

/** What happened during one rendered turn. */
export interface TurnOutcome {
  approval?: AgentApprovalRequestEvent;
  ended?: AgentTurnEndEvent;
  /** Complete text per message, in order. Falls back to streamed text. */
  finalText(): string;
  /** `true` when a complete message did not extend its streamed preview. */
  mismatch: boolean;
  sessionEnded: boolean;
  /** `true` once a tool call was streamed as a `task_update` chunk. */
  streamedTasks: boolean;
}

const TOOL_STATUS: Record<
  "running" | "complete" | "error",
  TaskUpdateChunk["status"]
> = {
  running: "in_progress",
  complete: "complete",
  error: "error",
};

/**
 * Turns driver events into a Chat SDK stream and records how the turn ended.
 *
 * @remarks
 * Each agent message is streamed in order, separated by a blank line. A
 * complete `message` event only appends the part its preview has not sent
 * yet; if it diverges, the outcome is flagged so the caller can replace the
 * posted text.
 */
export function toChatStream(events: AsyncIterable<ManagedAgentEvent>): {
  outcome: TurnOutcome;
  stream: AsyncGenerator<string | StreamChunk>;
} {
  const order: string[] = [];
  const streamed = new Map<string, string>();
  const complete = new Map<string, string>();
  const toolNames = new Map<string, string>();

  const outcome: TurnOutcome = {
    finalText() {
      return order
        .map((id) => complete.get(id) ?? streamed.get(id) ?? "")
        .filter((text) => text !== "")
        .join(MESSAGE_SEPARATOR);
    },
    mismatch: false,
    sessionEnded: false,
    streamedTasks: false,
  };

  let emittedText = false;

  function track(messageId: string): void {
    if (!streamed.has(messageId)) {
      order.push(messageId);
      streamed.set(messageId, "");
    }
  }

  /** Text to yield for `text` appended to `messageId`, including any separator. */
  function append(messageId: string, text: string): string {
    if (!text) {
      return "";
    }
    const previous = streamed.get(messageId) ?? "";
    const separator = emittedText && previous === "" ? MESSAGE_SEPARATOR : "";
    streamed.set(messageId, previous + text);
    emittedText = true;
    return separator + text;
  }

  async function* stream(): AsyncGenerator<string | StreamChunk> {
    for await (const event of events) {
      switch (event.type) {
        case "text-delta": {
          track(event.messageId);
          const text = append(event.messageId, event.text);
          if (text) {
            yield text;
          }
          break;
        }
        case "message": {
          track(event.messageId);
          complete.set(event.messageId, event.text);
          const sent = streamed.get(event.messageId) ?? "";
          if (!event.text.startsWith(sent)) {
            outcome.mismatch = true;
            break;
          }
          const text = append(event.messageId, event.text.slice(sent.length));
          if (text) {
            yield text;
          }
          break;
        }
        case "tool-call": {
          if (event.name) {
            toolNames.set(event.id, event.name);
          }
          outcome.streamedTasks = true;
          yield {
            id: event.id,
            status: TOOL_STATUS[event.status],
            title: event.name ?? toolNames.get(event.id) ?? DEFAULT_TOOL_TITLE,
            type: "task_update",
          };
          break;
        }
        case "approval-request":
          outcome.approval = event;
          return;
        case "turn-end":
          outcome.ended = event;
          return;
        case "session-ended":
          outcome.sessionEnded = true;
          return;
        default:
          break;
      }
    }
  }

  return { outcome, stream: stream() };
}
