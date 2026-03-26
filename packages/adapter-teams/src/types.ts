import type { AppOptions, IPlugin } from "@microsoft/teams.apps";
import type { Logger } from "chat";

export type TeamsAdapterConfig = Pick<
  AppOptions<IPlugin>,
  | "clientId"
  | "clientSecret"
  | "tenantId"
  | "token"
  | "managedIdentityClientId"
  | "serviceUrl"
> & {
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Override bot username (optional) */
  userName?: string;
};

/** Teams-specific thread ID data */
export interface TeamsThreadId {
  conversationId: string;
  replyToId?: string;
  serviceUrl: string;
}

/** Teams channel context extracted from activity.channelData */
export interface TeamsChannelContext {
  channelId: string;
  teamId: string;
  tenantId: string;
}
