import type { GoogleChatSpace } from "../webhook/types";
import { callGoogleChatApi, type GoogleChatApiOptions } from "./client";

export interface GoogleChatMembership {
  member?: {
    displayName?: string;
    name?: string;
    type?: string;
  };
  name?: string;
  state?: string;
}

export interface ListGoogleChatMembersResponse {
  memberships?: GoogleChatMembership[];
  nextPageToken?: string;
}

export function getGoogleChatSpace(
  options: GoogleChatApiOptions & { name: string }
): Promise<GoogleChatSpace> {
  return callGoogleChatApi(`/${options.name}`, options);
}

export function listGoogleChatMembers(
  options: GoogleChatApiOptions & {
    filter?: string;
    pageSize?: number;
    pageToken?: string;
    parent: string;
    showGroups?: boolean;
    showInvited?: boolean;
  }
): Promise<ListGoogleChatMembersResponse> {
  return callGoogleChatApi(`/${options.parent}/members`, {
    ...options,
    query: {
      filter: options.filter,
      pageSize: options.pageSize,
      pageToken: options.pageToken,
      showGroups: options.showGroups,
      showInvited: options.showInvited,
    },
  });
}

export function findGoogleChatDirectMessage(
  options: GoogleChatApiOptions & { name: string }
): Promise<GoogleChatSpace> {
  return callGoogleChatApi("/spaces:findDirectMessage", {
    ...options,
    query: { name: options.name },
  });
}

export function setupGoogleChatDirectMessage(
  userName: string,
  options: GoogleChatApiOptions
): Promise<GoogleChatSpace> {
  return callGoogleChatApi("/spaces:setup", {
    ...options,
    body: {
      memberships: [
        {
          member: {
            name: userName,
            type: "HUMAN",
          },
        },
      ],
      space: {
        spaceType: "DIRECT_MESSAGE",
      },
    },
  });
}
