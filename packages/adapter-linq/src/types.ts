import type { Logger } from "chat";
import type { components } from "./schema";

export interface LinqAdapterConfig {
  apiToken?: string;
  logger?: Logger;
  phoneNumber?: string;
  signingSecret?: string;
  userName?: string;
}

export interface LinqThreadId {
  chatId: string;
}

export type LinqWebhookEventType =
  | "message.received"
  | "message.sent"
  | "message.delivered"
  | "message.read"
  | "message.failed"
  | "message.edited"
  | "reaction.added"
  | "reaction.removed"
  | "chat.created"
  | "chat.typing_indicator.started"
  | "chat.typing_indicator.stopped"
  | "participant.added"
  | "participant.removed";

export interface LinqWebhookPayload {
  api_version: string;
  created_at: string;
  data: unknown;
  event_id: string;
  event_type: LinqWebhookEventType;
  partner_id: string;
  trace_id: string;
  webhook_version: string;
}

export type LinqMessage = components["schemas"]["Message"];

export type LinqChat = components["schemas"]["Chat"];

export type LinqChatHandle = components["schemas"]["ChatHandle"];

export type LinqReactionType = components["schemas"]["ReactionType"];

export type LinqMessageEventV2 = components["schemas"]["MessageEventV2"];

export type LinqReactionEventBase = components["schemas"]["ReactionEventBase"];

export type LinqMessageFailedEvent =
  components["schemas"]["MessageFailedEvent"];

export type LinqRawMessage = LinqMessage;
