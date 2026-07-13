import {
  callTeamsConnectorApi,
  type TeamsApiOptions,
  type TeamsApiResponse,
} from "./client";

export interface TeamsConversationMember {
  id: string;
  name?: string;
}

export interface CreateTeamsConversationOptions extends TeamsApiOptions {
  bot?: TeamsConversationMember;
  conversationType?: "channel" | "groupChat" | "personal";
  isGroup?: boolean;
  members: readonly TeamsConversationMember[];
  serviceUrl: string;
  tenantId?: string;
}

export interface TeamsCreatedConversation {
  activityId?: string;
  id?: string;
  serviceUrl?: string;
}

export async function createTeamsConversation(
  options: CreateTeamsConversationOptions
): Promise<TeamsApiResponse<TeamsCreatedConversation>> {
  return callTeamsConnectorApi<TeamsCreatedConversation>({
    ...options,
    body: {
      ...(options.bot ? { bot: options.bot } : {}),
      ...(options.conversationType
        ? { conversationType: options.conversationType }
        : {}),
      isGroup: options.isGroup ?? false,
      members: options.members,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    },
    method: "POST",
    path: "v3/conversations",
  });
}
