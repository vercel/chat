import { extractCard, ValidationError } from "@chat-adapter/shared";
import { AgentActivityType } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload } from "@linear/sdk/webhooks";
import type { AdapterPostableMessage } from "chat";
import { convertEmojiPlaceholders } from "chat";
import { cardToLinearMarkdown } from "./cards";
import type { LinearFormatConverter } from "./markdown";
import type {
  LinearAgentActivityRawMessage,
  LinearAgentSessionData,
  LinearAgentSessionEventRawMessage,
  LinearCommentData,
  LinearCommentRawMessage,
  LinearRawAgentActivityData,
  LinearRawAgentSessionData,
  LinearThreadId,
} from "./types";

export type LinearAgentPlanStatus =
  | "pending"
  | "inProgress"
  | "completed"
  | "canceled";

export type LinearAgentSessionThreadId = LinearThreadId & {
  agentSessionId: string;
};

interface LinearAgentActivityLike {
  body?: string | null;
  content?: unknown;
}

interface AgentActivityContentLike {
  __typename?: string | null;
  action?: string | null;
  body?: string | null;
  parameter?: string | null;
  result?: string | null;
  type?: AgentActivityType | string | null;
}

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

export function normalizeAgentActivityType(
  content?: AgentActivityContentLike | null
): AgentActivityType | null {
  if (!content) {
    return null;
  }

  if (content.type) {
    switch (content.type) {
      case AgentActivityType.Action:
      case AgentActivityType.Elicitation:
      case AgentActivityType.Error:
      case AgentActivityType.Prompt:
      case AgentActivityType.Response:
      case AgentActivityType.Thought:
      case "action":
        return AgentActivityType.Action;
      case "elicitation":
        return AgentActivityType.Elicitation;
      case "error":
        return AgentActivityType.Error;
      case "prompt":
        return AgentActivityType.Prompt;
      case "response":
        return AgentActivityType.Response;
      case "thought":
        return AgentActivityType.Thought;
      default:
        return null;
    }
  }

  switch (content.__typename) {
    case "AgentActivityActionContent":
      return AgentActivityType.Action;
    case "AgentActivityElicitationContent":
      return AgentActivityType.Elicitation;
    case "AgentActivityErrorContent":
      return AgentActivityType.Error;
    case "AgentActivityPromptContent":
      return AgentActivityType.Prompt;
    case "AgentActivityResponseContent":
      return AgentActivityType.Response;
    case "AgentActivityThoughtContent":
      return AgentActivityType.Thought;
    default:
      return null;
  }
}

function formatActionActivityText(content: AgentActivityContentLike): string {
  const action = content.action?.trim() || "Action";
  const parameter = content.parameter?.trim();
  const result = content.result?.trim();

  let text = parameter ? `${action}: ${parameter}` : action;
  if (result) {
    text += `\n${result}`;
  }

  return text;
}

export function getAgentActivityText(
  activity?: LinearAgentActivityLike | LinearRawAgentActivityData | null
): string {
  if (!activity) {
    return "";
  }

  if (typeof activity.body === "string") {
    return activity.body;
  }

  const content = activity.content as AgentActivityContentLike | undefined;
  if (!content) {
    return "";
  }

  return normalizeAgentActivityType(content) === AgentActivityType.Action
    ? formatActionActivityText(content)
    : (content.body ?? "");
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

export function getSessionThreadId(
  session: LinearAgentSessionLike,
  encodeThreadId: (thread: LinearThreadId) => string
): string {
  return encodeThreadId({
    issueId: getIssueIdFromSession(session),
    commentId: session.commentId ?? undefined,
    agentSessionId: session.id,
  });
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

export function buildCommentRawMessage(
  comment: LinearCommentData,
  organizationId: string
): LinearCommentRawMessage {
  return {
    kind: "comment",
    comment,
    organizationId,
  };
}

export function buildAgentActivityRawMessage(
  agentSession: LinearAgentSessionData,
  agentActivity: LinearRawAgentActivityData,
  organizationId: string
): LinearAgentActivityRawMessage {
  const rawAgentSession: LinearRawAgentSessionData = {
    ...agentSession,
    issueId: getIssueIdFromSession(agentSession),
  };

  return {
    kind: "agent_activity",
    agentActivity,
    agentSession: rawAgentSession,
    organizationId,
  };
}

export function buildAgentSessionEventRawMessage(
  payload: AgentSessionEventWebhookPayload
): LinearAgentSessionEventRawMessage {
  return {
    kind: "agent_session_event",
    organizationId: payload.organizationId,
    payload,
  };
}
