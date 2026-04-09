import type { Logger } from "chat";
import type { PhrasingContent } from "mdast";

/** Configuration for createZoomAdapter factory. All fields fall back to env vars. */
export interface ZoomAdapterConfig {
  accountId?: string;
  clientId?: string;
  clientSecret?: string;
  logger?: Logger;
  robotJid?: string;
  userName?: string;
  webhookSecretToken?: string;
}

/** Internal config with all required fields resolved. */
export interface ZoomAdapterInternalConfig {
  /**
   * Account ID for the Zoom S2S OAuth app. Validated at startup but not sent
   * in the token request body — Zoom's client_credentials grant embeds the
   * account association in the Marketplace app registration, not the HTTP request.
   * Stored here for diagnostics and potential future use (e.g., account-scoped API calls).
   */
  accountId: string;
  clientId: string;
  clientSecret: string;
  logger: Logger;
  robotJid: string;
  userName: string;
  webhookSecretToken: string;
}

/** Zoom CRC URL validation challenge payload shape. */
export interface ZoomCrcPayload {
  event: "endpoint.url_validation";
  payload: {
    plainToken: string;
  };
}

/** bot_notification webhook event from Zoom. */
export interface ZoomBotNotificationPayload {
  event: "bot_notification";
  event_ts: number; // millisecond epoch — use as messageId for thread ID
  payload: {
    accountId: string;
    channelName?: string; // absent for DMs
    cmd: string; // user's text input
    name?: string;
    robotJid: string;
    timestamp: number;
    toJid: string; // ends in @conference.xmpp.zoom.us for channels
    userId: string; // sender's user ID (non-JID)
    userJid: string; // sender's JID
    userName: string;
  };
}

/** team_chat.app_mention webhook event from Zoom. */
export interface ZoomAppMentionPayload {
  event: "team_chat.app_mention";
  event_ts: number;
  payload: {
    account_id: string;
    operator: string; // sender's email
    operator_id: string; // sender's user ID
    operator_member_id: string;
    by_external_user: boolean;
    object: {
      message_id: string; // UUID
      type: "to_channel";
      channel_id: string;
      channel_name: string;
      message: string; // user's plain text
      rich_text?: unknown[];
      reply_main_message_id?: string;
      date_time: string;
      timestamp: number;
    };
  };
}

/** Platform-specific data for Zoom thread IDs. */
export interface ZoomThreadId {
  channelId: string; // JID: channel @conference.xmpp.zoom.us or user @xmpp.zoom.us (DM)
  messageId: string; // event_ts as string (bot_notification) or UUID (team_chat.app_mention)
}

/** Custom mdast node for Zoom's __underline__ syntax.
 * Lives in the Zoom adapter only — NOT exported to the core SDK.
 * fromAst() re-encodes this back to __underline__ for perfect round-trip.
 */
export interface UnderlineNode {
  children: PhrasingContent[];
  type: "underline";
}

/** Zoom-specific postable message extension for threaded replies (MSG-02).
 * Pass a message matching this shape to postMessage() to set reply_main_message_id.
 * The postMessage() signature remains AdapterPostableMessage (Adapter interface contract);
 * the cast to ZoomMessageWithReply happens inside the function body.
 */
export interface ZoomMessageWithReply {
  markdown?: string;
  /** Zoom threading: set to the parent message_id to create a threaded reply */
  metadata?: {
    replyTo?: string;
  };
  /** The postable message content */
  raw?: string;
}

/** Top-level Zoom webhook payload (discriminated union on `event`). */
export type ZoomWebhookPayload =
  | ZoomCrcPayload
  | ZoomBotNotificationPayload
  | ZoomAppMentionPayload
  | {
      event: string;
      event_ts?: number;
      payload: Record<string, unknown>;
    };
