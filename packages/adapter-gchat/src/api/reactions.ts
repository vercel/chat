import type { GoogleChatReaction } from "../webhook/types";
import { callGoogleChatApi, type GoogleChatApiOptions } from "./client";

export interface ListGoogleChatReactionsResponse {
  nextPageToken?: string;
  reactions?: GoogleChatReaction[];
}

export function createGoogleChatReaction(
  parent: string,
  emoji: string,
  options: GoogleChatApiOptions
): Promise<GoogleChatReaction> {
  return callGoogleChatApi(`/${parent}/reactions`, {
    ...options,
    body: { emoji: { unicode: emoji } },
  });
}

export function listGoogleChatReactions(
  options: GoogleChatApiOptions & {
    filter?: string;
    pageSize?: number;
    pageToken?: string;
    parent: string;
  }
): Promise<ListGoogleChatReactionsResponse> {
  return callGoogleChatApi(`/${options.parent}/reactions`, {
    ...options,
    query: {
      filter: options.filter,
      pageSize: options.pageSize,
      pageToken: options.pageToken,
    },
  });
}

export function deleteGoogleChatReaction(
  name: string,
  options: GoogleChatApiOptions
): Promise<void> {
  return callGoogleChatApi(`/${name}`, {
    ...options,
    method: "DELETE",
  });
}
