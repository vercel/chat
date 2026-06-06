import { callTeamsGraphApi } from "./client";
import type { TeamsChannelInfo, TeamsGraphOptions } from "./types";

export interface GetTeamsChannelOptions extends TeamsGraphOptions {
  channelId: string;
  teamId: string;
}

interface GraphChannel extends Record<string, unknown> {
  displayName?: string;
  id?: string;
}

export async function getTeamsChannel(
  options: GetTeamsChannelOptions
): Promise<TeamsChannelInfo> {
  const channel = await callTeamsGraphApi<GraphChannel>(
    `teams/${encodeURIComponent(options.teamId)}/channels/${encodeURIComponent(
      options.channelId
    )}`,
    options
  );

  return {
    ...(channel.displayName ? { displayName: channel.displayName } : {}),
    id: channel.id ?? options.channelId,
    raw: { ...channel },
  };
}
