import {
  buildTeamsMessageActivity,
  buildTeamsTypingActivity,
  type TeamsAttachment,
} from "./activities";
import {
  callTeamsConnectorApi,
  type TeamsApiOptions,
  type TeamsApiResponse,
} from "./client";

export interface TeamsContinuationContext {
  activityId?: string;
  channelId?: string;
  conversationId: string;
  replyToId?: string;
  serviceUrl: string;
  teamId?: string;
  tenantId?: string;
}

export interface TeamsMessageOptions extends TeamsApiOptions {
  adaptiveCard?: unknown;
  attachments?: readonly TeamsAttachment[];
  channelData?: unknown;
  conversationId: string;
  markdownText?: string;
  replyToId?: string;
  serviceUrl: string;
  text?: string;
}

export interface TeamsUpdateMessageOptions extends TeamsMessageOptions {
  messageId: string;
}

export interface TeamsDeleteMessageOptions extends TeamsApiOptions {
  conversationId: string;
  messageId: string;
  serviceUrl: string;
}

export interface TeamsTypingOptions extends TeamsApiOptions {
  conversationId: string;
  serviceUrl: string;
}

export interface TeamsPostedMessage {
  id: string;
  raw: unknown;
}

export async function postTeamsMessage(
  options: TeamsMessageOptions
): Promise<TeamsPostedMessage> {
  const activity = buildTeamsMessageActivity(options);
  const path = options.replyToId
    ? `v3/conversations/${encodeURIComponent(
        options.conversationId
      )}/activities/${encodeURIComponent(options.replyToId)}`
    : `v3/conversations/${encodeURIComponent(options.conversationId)}/activities`;
  const response = await callTeamsConnectorApi<{ id?: string }>({
    ...options,
    body: activity,
    method: "POST",
    path,
  });

  return {
    id: response.body.id ?? "",
    raw: response.body,
  };
}

export async function updateTeamsMessage(
  options: TeamsUpdateMessageOptions
): Promise<TeamsApiResponse<unknown>> {
  return callTeamsConnectorApi({
    ...options,
    body: buildTeamsMessageActivity(options),
    method: "PUT",
    path: `v3/conversations/${encodeURIComponent(
      options.conversationId
    )}/activities/${encodeURIComponent(options.messageId)}`,
  });
}

export async function deleteTeamsMessage(
  options: TeamsDeleteMessageOptions
): Promise<void> {
  await callTeamsConnectorApi({
    ...options,
    method: "DELETE",
    path: `v3/conversations/${encodeURIComponent(
      options.conversationId
    )}/activities/${encodeURIComponent(options.messageId)}`,
  });
}

export async function sendTeamsTyping(
  options: TeamsTypingOptions
): Promise<TeamsApiResponse<unknown>> {
  return callTeamsConnectorApi({
    ...options,
    body: buildTeamsTypingActivity(),
    method: "POST",
    path: `v3/conversations/${encodeURIComponent(options.conversationId)}/activities`,
  });
}

export type { TeamsActivity, TeamsAttachment } from "./activities";
