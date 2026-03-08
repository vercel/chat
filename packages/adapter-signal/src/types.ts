/**
 * Signal adapter types.
 */

export type SignalTextMode = "normal" | "styled";

/**
 * Signal adapter configuration.
 */
export interface SignalAdapterConfig {
  /**
   * Base URL of signal-cli-rest-api.
   * @default "http://localhost:8080"
   */
  baseUrl?: string;

  /**
   * Signal number registered with signal-cli-rest-api.
   * Example: "+491234567890"
   */
  phoneNumber: string;

  /**
   * Optional text mode override for outgoing messages.
   * If omitted, plain/raw messages use default server behavior and
   * markdown/ast/card messages default to `styled`.
   */
  textMode?: SignalTextMode;

  /**
   * Optional secret used to validate incoming webhook requests.
   */
  webhookSecret?: string;

  /**
   * Optional header name for webhook secret validation.
   * @default "x-signal-webhook-secret"
   */
  webhookSecretHeader?: string;
}

/**
 * Signal thread ID components.
 */
export interface SignalThreadId {
  /**
   * Signal chat identifier.
   * - Direct messages: phone number/UUID/username
   * - Group messages: `group.<base64-id>`
   */
  chatId: string;
}

export interface SignalMessageMention {
  author?: string;
  length: number;
  name?: string;
  number?: string;
  start: number;
  uuid?: string;
}

export interface SignalAttachment {
  caption?: string;
  contentType?: string;
  filename?: string | null;
  height?: number;
  id: string;
  size?: number;
  width?: number;
}

export interface SignalGroupInfo {
  groupId: string;
  groupName?: string;
  revision?: number;
  type?: string;
}

export interface SignalReaction {
  emoji: string;
  isRemove?: boolean;
  targetAuthor?: string;
  targetAuthorNumber?: string | null;
  targetAuthorUuid?: string;
  targetSentTimestamp: number;
}

export interface SignalDataMessage {
  attachments?: SignalAttachment[];
  expiresInSeconds?: number;
  groupInfo?: SignalGroupInfo;
  isExpirationUpdate?: boolean;
  mentions?: SignalMessageMention[];
  message?: string | null;
  quote?: {
    author?: string;
    id?: number;
    text?: string | null;
  };
  reaction?: SignalReaction;
  remoteDelete?: {
    timestamp: number;
  };
  timestamp: number;
  viewOnce?: boolean;
}

export interface SignalSyncSentMessage {
  attachments?: SignalAttachment[];
  destination?: string | null;
  destinationUuid?: string | null;
  groupInfo?: SignalGroupInfo;
  mentions?: SignalMessageMention[];
  message?: string | null;
  quote?: {
    author?: string;
    id?: number;
    text?: string | null;
  };
  timestamp: number;
}

export interface SignalSyncMessage {
  contacts?: Record<string, unknown>;
  readMessages?: Record<string, unknown>[];
  sentMessage?: SignalSyncSentMessage;
  viewedMessages?: Record<string, unknown>[];
}

export interface SignalEditMessage {
  dataMessage: SignalDataMessage;
  targetSentTimestamp: number;
}

export interface SignalDeleteMessage {
  targetSentTimestamp: number;
}

export interface SignalTypingMessage {
  action: "STARTED" | "STOPPED";
  groupId?: string;
  timestamp: number;
}

export interface SignalReceiptMessage {
  isDelivery?: boolean;
  isRead?: boolean;
  isViewed?: boolean;
  timestamps?: number[];
  when?: number;
}

export interface SignalEnvelope {
  callMessage?: Record<string, unknown>;
  dataMessage?: SignalDataMessage;
  deleteMessage?: SignalDeleteMessage;
  editMessage?: SignalEditMessage;
  receiptMessage?: SignalReceiptMessage;
  serverDeliveredTimestamp?: number;
  serverReceivedTimestamp?: number;
  source?: string;
  sourceDevice?: number;
  sourceName?: string;
  sourceNumber?: string | null;
  sourceUuid?: string;
  syncMessage?: SignalSyncMessage;
  timestamp?: number;
  typingMessage?: SignalTypingMessage;
}

/**
 * Raw receive payload emitted by signal-cli-rest-api receive endpoints.
 */
export interface SignalUpdate {
  account?: string;
  envelope: SignalEnvelope;
}

/**
 * JSON-RPC receive wrapper used by RECEIVE_WEBHOOK_URL.
 */
export interface SignalJsonRpcReceivePayload {
  error?: {
    code: number;
    message: string;
  };
  jsonrpc?: string;
  method?: string;
  params?: SignalUpdate;
}

/**
 * Raw payload synthesized for outgoing adapter responses.
 */
export interface SignalOutgoingRawMessage {
  author: string;
  edited?: boolean;
  kind: "outgoing";
  recipient: string;
  text: string;
  timestamp: number;
}

export type SignalRawMessage = SignalUpdate | SignalOutgoingRawMessage;

export interface SignalSendMessageRequest {
  base64_attachments?: string[];
  edit_timestamp?: number;
  message: string;
  number: string;
  recipients: string[];
  text_mode?: SignalTextMode;
  view_once?: boolean;
}

export interface SignalSendMessageResponse {
  results?: Array<{
    networkFailure?: boolean;
    recipientAddress?: {
      number?: string;
      uuid?: string;
    };
    status?: string;
    unregisteredFailure?: boolean;
  }>;
  timestamp: number | string;
}

export interface SignalReactionRequest {
  reaction: string;
  recipient: string;
  target_author: string;
  timestamp: number;
}

export interface SignalRemoteDeleteRequest {
  recipient: string;
  timestamp: number;
}

export interface SignalTypingIndicatorRequest {
  recipient: string;
}

export interface SignalGroup {
  admins?: Array<string | { number?: string; uuid?: string }>;
  blocked?: boolean;
  description?: string;
  id: string;
  internal_id?: string;
  invite_link?: string;
  isBlocked?: boolean;
  isMember?: boolean;
  members?: Array<string | { number?: string; uuid?: string }>;
  name?: string;
  pending_invites?: string[];
  pending_requests?: string[];
  revision?: number;
}

export interface SignalApiErrorResponse {
  account?: string;
  challenge_tokens?: string[];
  error?: string;
  message?: string;
}
