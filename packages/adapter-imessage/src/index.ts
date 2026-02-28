import type { MessageResponse } from "@photon-ai/advanced-imessage-kit";
import { AdvancedIMessageKit } from "@photon-ai/advanced-imessage-kit";
import type { Message as IMessageLocalMessage } from "@photon-ai/imessage-kit";
import { IMessageSDK } from "@photon-ai/imessage-kit";
import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { Message, NotImplementedError, parseMarkdown } from "chat";
import type {
  iMessageForwardedEvent,
  iMessageGatewayMessageData,
  iMessageThreadId,
  NativeWebhookPayload,
} from "./types";

export type { AdvancedIMessageKit } from "@photon-ai/advanced-imessage-kit";
export type { IMessageSDK } from "@photon-ai/imessage-kit";
export type {
  iMessageForwardedEvent,
  iMessageGatewayEventType,
  iMessageGatewayMessageData,
  iMessageThreadId,
  NativeWebhookPayload,
} from "./types";

export interface iMessageAdapterLocalConfig {
  apiKey?: string;
  local: true;
  serverUrl?: string;
}

export interface iMessageAdapterRemoteConfig {
  apiKey: string;
  local: false;
  serverUrl: string;
}

export type iMessageAdapterConfig =
  | iMessageAdapterLocalConfig
  | iMessageAdapterRemoteConfig;

export class iMessageAdapter implements Adapter {
  readonly name = "imessage";
  readonly userName: string = "";
  readonly local: boolean;
  readonly serverUrl?: string;
  readonly apiKey?: string;
  readonly sdk: IMessageSDK | AdvancedIMessageKit;

  private chat: ChatInstance | null = null;
  private logger: Logger | null = null;

  constructor(config: iMessageAdapterConfig) {
    if (config.local && process.platform !== "darwin") {
      throw new Error(
        "iMessage adapter local mode requires macOS. Current platform: " +
          process.platform
      );
    }

    this.local = config.local;
    this.serverUrl = config.serverUrl;
    this.apiKey = config.apiKey;

    if (config.local) {
      this.sdk = new IMessageSDK();
    } else {
      this.sdk = AdvancedIMessageKit.getInstance({
        serverUrl: config.serverUrl,
        apiKey: config.apiKey,
      });
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger("imessage");
    this.logger.info("iMessage adapter initialized", {
      local: this.local,
      serverUrl: this.serverUrl ? "configured" : "not configured",
    });

    if (!this.local) {
      const sdk = this.sdk as AdvancedIMessageKit;
      await sdk.connect();
      await new Promise<void>((resolve) => sdk.once("ready", resolve));
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const gatewayToken = request.headers.get("x-imessage-gateway-token");
    if (gatewayToken) {
      if (this.apiKey && gatewayToken !== this.apiKey) {
        this.logger?.warn("Invalid gateway token");
        return new Response("Invalid gateway token", { status: 401 });
      }

      const body = await request.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      // Check if this is a forwarded gateway event (has type/timestamp/data)
      // or a native SDK webhook message (has guid/chatId directly)
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.type === "string" && obj.type.startsWith("GATEWAY_")) {
        return this.handleForwardedGatewayEvent(
          parsed as iMessageForwardedEvent,
          options
        );
      }

      // Native imessage-kit webhook: the SDK POSTs the Message object directly
      if (typeof obj.guid === "string" && typeof obj.chatId === "string") {
        this.logger?.info("Native iMessage SDK webhook received", {
          guid: obj.guid as string,
        });
        const data = this.normalizeNativeWebhookMessage(
          obj as unknown as NativeWebhookPayload
        );
        await this.handleGatewayMessage(data);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      this.logger?.warn("Unrecognized gateway webhook payload");
      return new Response("Unrecognized payload", { status: 400 });
    }

    return new Response("Unknown request", { status: 400 });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage> {
    const { chatGuid } = this.decodeThreadId(threadId);
    const text = typeof message === "string" ? message : String(message);

    if (this.local) {
      const sdk = this.sdk as IMessageSDK;
      // sdk.send() expects the core identifier (phone/email/chatId), not the full GUID.
      // chatGuid format: "iMessage;-;+1234567890" or "iMessage;+;chat123..."
      // Extract last part after final semicolon.
      const recipient = chatGuid.split(";").pop() ?? chatGuid;
      const result = await sdk.send(recipient, text);
      return {
        id: result.message?.guid ?? `local-${Date.now()}`,
        threadId,
        raw: result,
      };
    }

    // Remote: sdk.messages.sendMessage() takes the full chatGuid directly
    const sdk = this.sdk as AdvancedIMessageKit;
    const result = await sdk.messages.sendMessage({
      chatGuid,
      message: text,
    });
    return {
      id: result.guid,
      threadId,
      raw: result,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage> {
    if (this.local) {
      throw new NotImplementedError(
        "editMessage is not supported in local mode",
        "editMessage"
      );
    }

    const text = typeof message === "string" ? message : String(message);
    const sdk = this.sdk as AdvancedIMessageKit;
    const result = await sdk.messages.editMessage({
      messageGuid: messageId,
      editedMessage: text,
      backwardsCompatibilityMessage: text,
    });
    return {
      id: result.guid,
      threadId,
      raw: result,
    };
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "deleteMessage is not implemented",
      "deleteMessage"
    );
  }

  parseMessage(raw: unknown): Message {
    const data = this.local
      ? this.normalizeLocalMessage(raw as IMessageLocalMessage)
      : this.normalizeRemoteMessage(raw as MessageResponse);
    return this.buildMessage(data);
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult> {
    throw new NotImplementedError(
      "fetchMessages is not implemented",
      "fetchMessages"
    );
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    if (this.local) {
      throw new NotImplementedError(
        "fetchThread is not supported in local mode",
        "fetchThread"
      );
    }

    const { chatGuid } = this.decodeThreadId(threadId);
    const sdk = this.sdk as AdvancedIMessageKit;
    const chat = await sdk.chats.getChat(chatGuid);
    const isGroupChat = chat.style > 43;

    return {
      id: threadId,
      channelId: chatGuid,
      channelName: chat.displayName || undefined,
      isDM: !isGroupChat,
      metadata: {
        chatIdentifier: chat.chatIdentifier,
        style: chat.style,
        participants: chat.participants,
        isArchived: chat.isArchived,
        raw: chat,
      },
    };
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "addReaction is not implemented",
      "addReaction"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "removeReaction is not implemented",
      "removeReaction"
    );
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    throw new NotImplementedError(
      "startTyping is not implemented",
      "startTyping"
    );
  }

  renderFormatted(_content: FormattedContent): string {
    throw new NotImplementedError(
      "renderFormatted is not implemented",
      "renderFormatted"
    );
  }

  encodeThreadId(platformData: iMessageThreadId): string {
    return `imessage:${platformData.chatGuid}`;
  }

  decodeThreadId(threadId: string): iMessageThreadId {
    const prefix = "imessage:";
    return { chatGuid: threadId.slice(prefix.length) };
  }

  /**
   * Start listening for incoming iMessage messages via the Gateway pattern.
   *
   * In local mode, uses IMessageSDK.startWatching() to poll for new messages.
   * In remote mode, uses AdvancedIMessageKit socket.io connection.
   *
   * If webhookUrl is provided, events are forwarded to that URL for processing.
   * Otherwise, events are processed directly (legacy/direct mode).
   */
  async startGatewayListener(
    options: WebhookOptions,
    durationMs = 180000,
    abortSignal?: AbortSignal,
    webhookUrl?: string
  ): Promise<Response> {
    if (!this.chat) {
      return new Response("Chat instance not initialized", { status: 500 });
    }

    if (!options.waitUntil) {
      return new Response("waitUntil not provided", { status: 500 });
    }

    this.logger?.info("Starting iMessage Gateway listener", {
      durationMs,
      mode: this.local ? "local" : "remote",
      webhookUrl: webhookUrl ? "configured" : "not configured",
    });

    const listenerPromise = this.runGatewayListener(
      durationMs,
      abortSignal,
      webhookUrl
    );

    options.waitUntil(listenerPromise);

    return new Response(
      JSON.stringify({
        status: "listening",
        durationMs,
        mode: this.local ? "local" : "remote",
        message: `Gateway listener started, will run for ${durationMs / 1000} seconds`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async runGatewayListener(
    durationMs: number,
    abortSignal?: AbortSignal,
    webhookUrl?: string
  ): Promise<void> {
    let isShuttingDown = false;

    const handleMessage = async (data: iMessageGatewayMessageData) => {
      if (isShuttingDown) {
        return;
      }

      if (webhookUrl) {
        await this.forwardGatewayEvent(webhookUrl, {
          type: "GATEWAY_NEW_MESSAGE",
          timestamp: Date.now(),
          data,
        });
      } else {
        await this.handleGatewayMessage(data);
      }
    };

    // For local mode with webhookUrl, create a dedicated SDK instance
    // with native webhook support so the SDK itself forwards messages.
    let localWebhookSdk: IMessageSDK | null = null;

    try {
      if (this.local) {
        let sdk: IMessageSDK;

        if (webhookUrl) {
          // Use imessage-kit's native webhook support: the SDK will
          // POST new messages to the webhookUrl automatically.
          localWebhookSdk = new IMessageSDK({
            webhook: {
              url: webhookUrl,
              headers: {
                "x-imessage-gateway-token": this.apiKey ?? "",
              },
              retries: 2,
              backoffMs: 500,
            },
            watcher: { excludeOwnMessages: true },
          });
          sdk = localWebhookSdk;
        } else {
          sdk = this.sdk as IMessageSDK;
        }

        await sdk.startWatching({
          onMessage: async (message: IMessageLocalMessage) => {
            if (isShuttingDown) {
              return;
            }
            if (message.isFromMe) {
              return;
            }

            // In non-webhook mode, process directly.
            // In webhook mode, the SDK's native webhook handles forwarding,
            // but we still process directly here for the legacy path.
            if (!webhookUrl) {
              const data = this.normalizeLocalMessage(message);
              await handleMessage(data);
            }
          },
          onError: (error: Error) => {
            this.logger?.error("iMessage local watcher error", {
              error: String(error),
            });
          },
        });
      } else {
        const sdk = this.sdk as AdvancedIMessageKit;
        await sdk.connect();

        sdk.on("new-message", async (messageResponse: MessageResponse) => {
          if (isShuttingDown) {
            return;
          }
          if (messageResponse.isFromMe) {
            return;
          }

          const data = this.normalizeRemoteMessage(messageResponse);
          await handleMessage(data);
        });
      }

      // Wait for duration or abort signal
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, durationMs);

        if (abortSignal) {
          if (abortSignal.aborted) {
            clearTimeout(timeout);
            resolve();
            return;
          }
          abortSignal.addEventListener(
            "abort",
            () => {
              this.logger?.info(
                "iMessage Gateway listener received abort signal"
              );
              clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );
        }
      });

      this.logger?.info(
        "iMessage Gateway listener duration elapsed, disconnecting"
      );
    } catch (error) {
      this.logger?.error("iMessage Gateway listener error", {
        error: String(error),
      });
    } finally {
      isShuttingDown = true;

      if (this.local) {
        if (localWebhookSdk) {
          localWebhookSdk.stopWatching();
          await localWebhookSdk.close();
        } else {
          (this.sdk as IMessageSDK).stopWatching();
        }
      } else {
        await (this.sdk as AdvancedIMessageKit).close();
      }

      this.logger?.info("iMessage Gateway listener stopped");
    }
  }

  private normalizeLocalMessage(
    message: IMessageLocalMessage
  ): iMessageGatewayMessageData {
    return {
      guid: message.guid,
      text: message.text,
      sender: message.sender,
      senderName: message.senderName,
      chatId: message.chatId,
      isGroupChat: message.isGroupChat,
      isFromMe: message.isFromMe,
      date: message.date.toISOString(),
      attachments: message.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
      source: "local",
      raw: message,
    };
  }

  private normalizeRemoteMessage(
    messageResponse: MessageResponse
  ): iMessageGatewayMessageData {
    const chatGuid = messageResponse.chats?.[0]?.guid ?? "";
    const chatStyle = messageResponse.chats?.[0]?.style ?? 0;
    // style 43 = DM (one-on-one), style 45+ = group chat
    const isGroupChat = chatStyle > 43;

    return {
      guid: messageResponse.guid,
      text: messageResponse.text,
      sender: messageResponse.handle?.address ?? "",
      senderName: null,
      chatId: chatGuid,
      isGroupChat,
      isFromMe: messageResponse.isFromMe,
      date: new Date(messageResponse.dateCreated).toISOString(),
      attachments: (messageResponse.attachments ?? []).map((a) => ({
        id: a.guid,
        filename: a.transferName,
        mimeType: a.mimeType ?? "application/octet-stream",
        size: a.totalBytes,
      })),
      source: "remote",
      raw: messageResponse,
    };
  }

  private normalizeNativeWebhookMessage(
    payload: NativeWebhookPayload
  ): iMessageGatewayMessageData {
    return {
      attachments: (payload.attachments ?? []).map((a) => ({
        filename: a.filename,
        id: a.id,
        mimeType: a.mimeType,
        size: a.size,
      })),
      chatId: payload.chatId,
      date: payload.date,
      guid: payload.guid,
      isFromMe: payload.isFromMe,
      isGroupChat: payload.isGroupChat,
      raw: payload,
      sender: payload.sender,
      senderName: payload.senderName,
      source: "local",
      text: payload.text,
    };
  }

  private async forwardGatewayEvent(
    webhookUrl: string,
    event: iMessageForwardedEvent
  ): Promise<void> {
    try {
      this.logger?.debug("Forwarding iMessage Gateway event to webhook", {
        type: event.type,
        webhookUrl,
      });

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-imessage-gateway-token": this.apiKey ?? "",
        },
        body: JSON.stringify(event),
      });

      if (response.ok) {
        this.logger?.debug("Gateway event forwarded successfully", {
          type: event.type,
        });
      } else {
        const errorText = await response.text();
        this.logger?.error("Failed to forward Gateway event", {
          type: event.type,
          status: response.status,
          error: errorText,
        });
      }
    } catch (error) {
      this.logger?.error("Error forwarding Gateway event", {
        type: event.type,
        error: String(error),
      });
    }
  }

  private async handleForwardedGatewayEvent(
    event: iMessageForwardedEvent,
    _options?: WebhookOptions
  ): Promise<Response> {
    this.logger?.info("Processing forwarded Gateway event", {
      type: event.type,
      timestamp: event.timestamp,
    });

    switch (event.type) {
      case "GATEWAY_NEW_MESSAGE":
        await this.handleGatewayMessage(
          event.data as iMessageGatewayMessageData
        );
        break;
      default:
        this.logger?.debug("Forwarded Gateway event (no handler)", {
          type: event.type,
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private buildMessage(data: iMessageGatewayMessageData): Message {
    const threadId = this.encodeThreadId({ chatGuid: data.chatId });
    return new Message({
      id: data.guid,
      threadId,
      text: data.text ?? "",
      formatted: parseMarkdown(data.text ?? ""),
      author: {
        userId: data.sender,
        userName: data.senderName ?? data.sender,
        fullName: data.senderName ?? data.sender,
        isBot: false,
        isMe: data.isFromMe,
      },
      metadata: {
        dateSent: new Date(data.date),
        edited: false,
      },
      attachments: data.attachments.map((a) => ({
        type: this.getAttachmentType(a.mimeType),
        name: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
      raw: data.raw ?? data,
      isMention: !data.isGroupChat,
    });
  }

  private async handleGatewayMessage(
    data: iMessageGatewayMessageData
  ): Promise<void> {
    if (!this.chat) {
      return;
    }

    const chatMessage = this.buildMessage(data);

    try {
      await this.chat.handleIncomingMessage(
        this,
        chatMessage.threadId,
        chatMessage
      );
    } catch (error) {
      this.logger?.error("Error handling iMessage gateway message", {
        error: String(error),
        messageGuid: data.guid,
      });
    }
  }

  private getAttachmentType(
    mimeType?: string
  ): "image" | "video" | "audio" | "file" {
    if (!mimeType) {
      return "file";
    }
    if (mimeType.startsWith("image/")) {
      return "image";
    }
    if (mimeType.startsWith("video/")) {
      return "video";
    }
    if (mimeType.startsWith("audio/")) {
      return "audio";
    }
    return "file";
  }
}

export function createiMessageAdapter(
  config?: Partial<iMessageAdapterConfig>
): iMessageAdapter {
  const local = config?.local ?? process.env.IMESSAGE_LOCAL !== "false";

  if (local) {
    return new iMessageAdapter({
      local: true,
      serverUrl: config?.serverUrl ?? process.env.IMESSAGE_SERVER_URL,
      apiKey: config?.apiKey ?? process.env.IMESSAGE_API_KEY,
    });
  }

  const serverUrl = config?.serverUrl ?? process.env.IMESSAGE_SERVER_URL;
  if (!serverUrl) {
    throw new Error(
      "serverUrl is required when local is false. Set IMESSAGE_SERVER_URL or provide it in config."
    );
  }

  const apiKey = config?.apiKey ?? process.env.IMESSAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "apiKey is required when local is false. Set IMESSAGE_API_KEY or provide it in config."
    );
  }

  return new iMessageAdapter({
    local: false,
    serverUrl,
    apiKey,
  });
}
