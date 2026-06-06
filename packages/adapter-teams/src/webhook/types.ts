export interface TeamsActivity extends Record<string, unknown> {
  channelData?: {
    channel?: { id?: string };
    team?: { id?: string };
    teamsChannelId?: string;
    teamsTeamId?: string;
    tenant?: { id?: string };
    [key: string]: unknown;
  };
  conversation?: {
    id?: string;
    tenantId?: string;
    [key: string]: unknown;
  };
  entities?: Array<{
    mentioned?: { id?: string; name?: string };
    text?: string;
    type?: string;
    [key: string]: unknown;
  }>;
  from?: {
    aadObjectId?: string;
    id?: string;
    name?: string;
    [key: string]: unknown;
  };
  id?: string;
  name?: string;
  replyToId?: string;
  serviceUrl?: string;
  text?: string;
  type?: string;
  value?: Record<string, unknown>;
}

export interface TeamsContinuation {
  activityId?: string;
  channelId?: string;
  conversationId: string;
  replyToId?: string;
  serviceUrl: string;
  teamId?: string;
  tenantId?: string;
}

export interface TeamsWebhookUser {
  aadObjectId?: string;
  id: string;
  name?: string;
}

export interface TeamsWebhookAttachment {
  content?: unknown;
  contentType?: string;
  contentUrl?: string;
  name?: string;
  raw: Record<string, unknown>;
}

export interface TeamsParseOptions {
  botAppId?: string;
}

export type TeamsWebhookPayload =
  | TeamsCardActionPayload
  | TeamsConversationUpdatePayload
  | TeamsDialogOpenPayload
  | TeamsDialogSubmitPayload
  | TeamsInstallationUpdatePayload
  | TeamsMessagePayload
  | TeamsMessageReactionPayload
  | TeamsUnsupportedPayload;

export interface TeamsPayloadBase {
  continuation?: TeamsContinuation;
  raw: TeamsActivity;
}

export interface TeamsMessagePayload extends TeamsPayloadBase {
  attachments: TeamsWebhookAttachment[];
  isMention: boolean;
  kind: "message";
  text: string;
  user?: TeamsWebhookUser;
}

export interface TeamsMessageReactionPayload extends TeamsPayloadBase {
  action?: string;
  kind: "message_reaction";
  messageId?: string;
  user?: TeamsWebhookUser;
}

export interface TeamsCardActionPayload extends TeamsPayloadBase {
  actionId?: string;
  kind: "card_action";
  user?: TeamsWebhookUser;
  value?: unknown;
}

export interface TeamsDialogOpenPayload extends TeamsPayloadBase {
  kind: "dialog_open";
  user?: TeamsWebhookUser;
  value?: unknown;
}

export interface TeamsDialogSubmitPayload extends TeamsPayloadBase {
  kind: "dialog_submit";
  user?: TeamsWebhookUser;
  value?: unknown;
}

export interface TeamsConversationUpdatePayload extends TeamsPayloadBase {
  kind: "conversation_update";
}

export interface TeamsInstallationUpdatePayload extends TeamsPayloadBase {
  action?: string;
  kind: "installation_update";
}

export interface TeamsUnsupportedPayload extends TeamsPayloadBase {
  kind: "unsupported";
  reason: string;
}
