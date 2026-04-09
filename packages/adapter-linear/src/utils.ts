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

interface LinearAgentSessionLike {
  commentId?: string | null;
  id: string;
  issue?: {
    id: string;
  } | null;
  issueId?: string | null;
}

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

export function getIssueIdFromSession(session: LinearAgentSessionLike): string {
  const issueId = session.issueId ?? session.issue?.id ?? undefined;
  if (!issueId) {
    throw new ValidationError(
      "linear",
      `Agent session ${session.id} is missing issueId`
    );
  }

  return issueId;
}

export function toAgentPlanStatus(
  status: "pending" | "in_progress" | "complete" | "error"
): LinearAgentPlanStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "inProgress";
    case "complete":
      return "completed";
    case "error":
      return "canceled";
    default: {
      throw new Error(`Unsupported Linear agent plan status: ${status}`);
    }
  }
}
