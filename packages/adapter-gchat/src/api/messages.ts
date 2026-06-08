import type { GoogleChatMessage } from "../webhook/types";
import { callGoogleChatApi, type GoogleChatApiOptions } from "./client";

export interface CreateGoogleChatMessageOptions extends GoogleChatApiOptions {
  messageReplyOption?:
    | "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
    | "REPLY_MESSAGE_OR_FAIL";
  parent: string;
  threadKey?: string;
}

export interface UpdateGoogleChatMessageOptions extends GoogleChatApiOptions {
  name: string;
  updateMask?: string;
}

export interface DeleteGoogleChatMessageOptions extends GoogleChatApiOptions {
  force?: boolean;
  name: string;
}

export interface ListGoogleChatMessagesOptions extends GoogleChatApiOptions {
  filter?: string;
  orderBy?: string;
  pageSize?: number;
  pageToken?: string;
  parent: string;
  showDeleted?: boolean;
}

export interface ListGoogleChatMessagesResponse {
  messages?: GoogleChatMessage[];
  nextPageToken?: string;
}

export function createGoogleChatMessage(
  requestBody: Record<string, unknown>,
  options: CreateGoogleChatMessageOptions
): Promise<GoogleChatMessage> {
  return callGoogleChatApi(`/${options.parent}/messages`, {
    ...options,
    body: requestBody,
    query: {
      messageReplyOption: options.messageReplyOption,
      threadKey: options.threadKey,
    },
  });
}

export function updateGoogleChatMessage(
  requestBody: Record<string, unknown>,
  options: UpdateGoogleChatMessageOptions
): Promise<GoogleChatMessage> {
  return callGoogleChatApi(`/${options.name}`, {
    ...options,
    body: requestBody,
    method: "PATCH",
    query: { updateMask: options.updateMask },
  });
}

export function deleteGoogleChatMessage(
  options: DeleteGoogleChatMessageOptions
): Promise<void> {
  return callGoogleChatApi(`/${options.name}`, {
    ...options,
    method: "DELETE",
    query: { force: options.force },
  });
}

export function getGoogleChatMessage(
  options: GoogleChatApiOptions & { name: string }
): Promise<GoogleChatMessage> {
  return callGoogleChatApi(`/${options.name}`, options);
}

export function listGoogleChatMessages(
  options: ListGoogleChatMessagesOptions
): Promise<ListGoogleChatMessagesResponse> {
  return callGoogleChatApi(`/${options.parent}/messages`, {
    ...options,
    query: {
      filter: options.filter,
      orderBy: options.orderBy,
      pageSize: options.pageSize,
      pageToken: options.pageToken,
      showDeleted: options.showDeleted,
    },
  });
}
