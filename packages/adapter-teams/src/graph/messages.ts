import { callTeamsGraphApi } from "./client";
import type {
  TeamsGraphListOptions,
  TeamsGraphListResult,
  TeamsGraphMessage,
  TeamsGraphOptions,
} from "./types";

interface GraphCollection<T> extends Record<string, unknown> {
  "@odata.nextLink"?: string;
  value?: T[];
}

interface GraphChatMessage extends Record<string, unknown> {
  body?: {
    content?: string;
    contentType?: string;
  };
  createdDateTime?: string;
  from?: {
    user?: {
      displayName?: string;
      id?: string;
      userIdentityType?: string;
    };
  };
  id?: string;
  replyToId?: string;
}

export interface ListTeamsChatMessagesOptions extends TeamsGraphListOptions {
  chatId: string;
}

export interface ListTeamsChannelMessagesOptions extends TeamsGraphListOptions {
  channelId: string;
  teamId: string;
}

export interface ListTeamsMessageRepliesOptions extends TeamsGraphListOptions {
  channelId: string;
  messageId: string;
  teamId: string;
}

export interface GetTeamsChannelMessageOptions extends TeamsGraphOptions {
  channelId: string;
  messageId: string;
  teamId: string;
}

export async function listTeamsChatMessages(
  options: ListTeamsChatMessagesOptions
): Promise<TeamsGraphListResult<TeamsGraphMessage>> {
  const result = await callTeamsGraphApi<GraphCollection<GraphChatMessage>>(
    withTop(
      `chats/${encodeURIComponent(options.chatId)}/messages`,
      options.limit
    ),
    options
  );
  return toListResult(result);
}

export async function listTeamsChannelMessages(
  options: ListTeamsChannelMessagesOptions
): Promise<TeamsGraphListResult<TeamsGraphMessage>> {
  const result = await callTeamsGraphApi<GraphCollection<GraphChatMessage>>(
    withTop(
      `teams/${encodeURIComponent(options.teamId)}/channels/${encodeURIComponent(
        options.channelId
      )}/messages`,
      options.limit
    ),
    options
  );
  return toListResult(result);
}

export async function listTeamsMessageReplies(
  options: ListTeamsMessageRepliesOptions
): Promise<TeamsGraphListResult<TeamsGraphMessage>> {
  const result = await callTeamsGraphApi<GraphCollection<GraphChatMessage>>(
    withTop(
      `teams/${encodeURIComponent(options.teamId)}/channels/${encodeURIComponent(
        options.channelId
      )}/messages/${encodeURIComponent(options.messageId)}/replies`,
      options.limit
    ),
    options
  );
  return toListResult(result);
}

export async function getTeamsChannelMessage(
  options: GetTeamsChannelMessageOptions
): Promise<TeamsGraphMessage> {
  const result = await callTeamsGraphApi<GraphChatMessage>(
    `teams/${encodeURIComponent(options.teamId)}/channels/${encodeURIComponent(
      options.channelId
    )}/messages/${encodeURIComponent(options.messageId)}`,
    options
  );
  return toGraphMessage(result);
}

export function toGraphMessage(message: GraphChatMessage): TeamsGraphMessage {
  const raw = { ...message };
  return {
    ...(message.createdDateTime ? { createdAt: message.createdDateTime } : {}),
    ...(message.from?.user ? { from: message.from.user } : {}),
    id: message.id ?? "",
    raw,
    ...(message.replyToId ? { replyToId: message.replyToId } : {}),
    text: extractTextFromGraphMessage(message),
  };
}

export function extractTextFromGraphMessage(message: GraphChatMessage): string {
  const content = message.body?.content ?? "";
  if (!content) {
    return "";
  }
  return content
    .replace(/<at\b[^>]*>(.*?)<\/at>/gis, "@$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function toListResult(
  result: GraphCollection<GraphChatMessage>
): TeamsGraphListResult<TeamsGraphMessage> {
  return {
    ...(result["@odata.nextLink"] ? { cursor: result["@odata.nextLink"] } : {}),
    items: (result.value ?? []).map(toGraphMessage),
    raw: { ...result },
  };
}

function withTop(path: string, limit?: number): string {
  if (!limit) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}$top=${limit}`;
}
