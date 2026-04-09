import { extractCard, ValidationError } from "@chat-adapter/shared";
import type { AdapterPostableMessage } from "chat";
import { convertEmojiPlaceholders } from "chat";
import { cardToLinearMarkdown } from "./cards";
import type { LinearFormatConverter } from "./markdown";
import type { LinearThreadId } from "./types";

export type LinearAgentPlanStatus =
  | "pending"
  | "inProgress"
  | "completed"
  | "canceled";

export type LinearAgentSessionThreadId = LinearThreadId & {
  agentSessionId: string;
};

export function renderMessageToLinearMarkdown(
  message: AdapterPostableMessage,
  formatConverter: LinearFormatConverter
): string {
  const card = extractCard(message);
  const rendered = card
    ? cardToLinearMarkdown(card)
    : formatConverter.renderPostable(message);

  return convertEmojiPlaceholders(rendered, "linear");
}

/**
 * Narrow a decoded thread to the agent-session case before session-only work.
 */
export function assertAgentSessionThread(
  thread: LinearThreadId
): asserts thread is LinearAgentSessionThreadId {
  if (!thread.agentSessionId) {
    throw new ValidationError(
      "linear",
      "Expected a Linear agent session thread"
    );
  }
}
