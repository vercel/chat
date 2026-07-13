import type { TeamsCredentials, TeamsFetch } from "../api";

export interface TeamsGraphOptions {
  credentials: TeamsCredentials;
  fetch?: TeamsFetch;
  graphUrl?: string;
}

export interface TeamsGraphListOptions extends TeamsGraphOptions {
  limit?: number;
}

export interface TeamsGraphUser {
  displayName?: string;
  id?: string;
  userIdentityType?: string;
}

export interface TeamsGraphMessage {
  createdAt?: string;
  from?: TeamsGraphUser;
  id: string;
  raw: Record<string, unknown>;
  replyToId?: string;
  text: string;
}

export interface TeamsGraphListResult<T> {
  cursor?: string;
  items: T[];
  raw: Record<string, unknown>;
}

export interface TeamsChannelInfo {
  displayName?: string;
  id: string;
  raw: Record<string, unknown>;
}
