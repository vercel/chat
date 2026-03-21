import type { Logger } from "chat";
import type LinqAPIV3 from "@linqapp/sdk";

export type LinqServiceType = LinqAPIV3.ServiceType;

export interface LinqAdapterConfig {
  apiToken?: string;
  logger?: Logger;
  phoneNumber?: string;
  preferredService?: LinqServiceType;
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

export type LinqMessage = LinqAPIV3.Message;

export type LinqChat = LinqAPIV3.Chat;

export type LinqChatHandle = LinqAPIV3.ChatHandle;

export type LinqReactionType = LinqAPIV3.ReactionType;

export type LinqMessageEventV2 = LinqAPIV3.MessageEventV2;

export type LinqReactionEventBase = LinqAPIV3.ReactionEventBase;

export interface LinqMessageFailedEvent {
  code: number;
  failed_at: string;
  chat_id?: string;
  message_id?: string;
  reason?: string;
}

export type LinqRawMessage = LinqMessage;
