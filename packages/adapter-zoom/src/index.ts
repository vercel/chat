import { ValidationError } from "@chat-adapter/shared";
import {
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  ConsoleLogger,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  NotImplementedError,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";
import type { ZoomAdapterConfig, ZoomAdapterInternalConfig } from "./types.js";

export type {
  ZoomAdapterConfig,
  ZoomCrcPayload,
  ZoomWebhookPayload,
} from "./types.js";

export class ZoomAdapter implements Adapter {
  readonly name = "zoom";
  readonly lockScope = "thread" as const;
  readonly userName: string;

  private readonly config: ZoomAdapterInternalConfig;

  constructor(config: ZoomAdapterInternalConfig) {
    this.config = config;
    this.userName = config.robotJid;
  }

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    throw new NotImplementedError(
      "ZoomAdapter: handleWebhook not yet implemented",
      "handleWebhook"
    );
  }

  async initialize(_chat: ChatInstance): Promise<void> {
    // Log initialization. Config is used in Plans 02+ for webhook verification
    // and token fetch. Referencing it here keeps the field accessible.
    this.config.logger.debug("ZoomAdapter initialized");
  }

  async postMessage(
    _threadId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    throw new NotImplementedError(
      "ZoomAdapter: postMessage not yet implemented",
      "postMessage"
    );
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    throw new NotImplementedError(
      "ZoomAdapter: editMessage not yet implemented",
      "editMessage"
    );
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "ZoomAdapter: deleteMessage not yet implemented",
      "deleteMessage"
    );
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<unknown>> {
    throw new NotImplementedError(
      "ZoomAdapter: fetchMessages not yet implemented",
      "fetchMessages"
    );
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError(
      "ZoomAdapter: fetchThread not yet implemented",
      "fetchThread"
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "ZoomAdapter: addReaction not yet implemented",
      "addReaction"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "ZoomAdapter: removeReaction not yet implemented",
      "removeReaction"
    );
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    throw new NotImplementedError(
      "ZoomAdapter: startTyping not yet implemented",
      "startTyping"
    );
  }

  channelIdFromThreadId(threadId: string): string {
    const parts = threadId.split(":");
    return `${parts[0]}:${parts[1]}`;
  }

  encodeThreadId(_platformData: unknown): string {
    throw new NotImplementedError(
      "ZoomAdapter: encodeThreadId not yet implemented",
      "encodeThreadId"
    );
  }

  decodeThreadId(_threadId: string): unknown {
    throw new NotImplementedError(
      "ZoomAdapter: decodeThreadId not yet implemented",
      "decodeThreadId"
    );
  }

  parseMessage(_raw: unknown): import("chat").Message<unknown> {
    throw new NotImplementedError(
      "ZoomAdapter: parseMessage not yet implemented",
      "parseMessage"
    );
  }

  renderFormatted(_content: FormattedContent): string {
    throw new NotImplementedError(
      "ZoomAdapter: renderFormatted not yet implemented",
      "renderFormatted"
    );
  }
}

export function createZoomAdapter(config?: ZoomAdapterConfig): ZoomAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("zoom");
  const clientId = config?.clientId ?? process.env.ZOOM_CLIENT_ID;
  if (!clientId) {
    throw new ValidationError(
      "zoom",
      "clientId is required. Set ZOOM_CLIENT_ID or provide it in config."
    );
  }
  const clientSecret = config?.clientSecret ?? process.env.ZOOM_CLIENT_SECRET;
  if (!clientSecret) {
    throw new ValidationError(
      "zoom",
      "clientSecret is required. Set ZOOM_CLIENT_SECRET or provide it in config."
    );
  }
  const robotJid = config?.robotJid ?? process.env.ZOOM_ROBOT_JID;
  if (!robotJid) {
    throw new ValidationError(
      "zoom",
      "robotJid is required. Set ZOOM_ROBOT_JID or provide it in config."
    );
  }
  const accountId = config?.accountId ?? process.env.ZOOM_ACCOUNT_ID;
  if (!accountId) {
    throw new ValidationError(
      "zoom",
      "accountId is required. Set ZOOM_ACCOUNT_ID or provide it in config."
    );
  }
  const webhookSecretToken =
    config?.webhookSecretToken ?? process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!webhookSecretToken) {
    throw new ValidationError(
      "zoom",
      "webhookSecretToken is required. Set ZOOM_WEBHOOK_SECRET_TOKEN or provide it in config."
    );
  }
  return new ZoomAdapter({
    clientId,
    clientSecret,
    robotJid,
    accountId,
    webhookSecretToken,
    logger,
  });
}
