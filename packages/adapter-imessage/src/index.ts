import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { type Message, NotImplementedError } from "chat";

export type { AdvancedIMessageKit } from "@photon-ai/advanced-imessage-kit";
export type { IMessageSDK } from "@photon-ai/imessage-kit";

export interface iMessageAdapterLocalConfig {
  apiKey?: string;
  local: true;
  serverUrl?: string;
  userName?: string;
}

export interface iMessageAdapterRemoteConfig {
  apiKey: string;
  local: false;
  serverUrl: string;
  userName?: string;
}

export type iMessageAdapterConfig =
  | iMessageAdapterLocalConfig
  | iMessageAdapterRemoteConfig;

export class iMessageAdapter implements Adapter {
  readonly name = "imessage";
  readonly userName: string;
  readonly local: boolean;
  readonly serverUrl?: string;
  readonly apiKey?: string;

  constructor(config: iMessageAdapterConfig) {
    this.userName = config.userName ?? "iMessage Bot";
    this.local = config.local;

    this.serverUrl = config.serverUrl;
    this.apiKey = config.apiKey;
  }

  async initialize(_chat: ChatInstance): Promise<void> {
    throw new NotImplementedError(
      "initialize is not implemented",
      "initialize"
    );
  }

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    throw new NotImplementedError(
      "handleWebhook is not implemented",
      "handleWebhook"
    );
  }

  async postMessage(
    _threadId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage> {
    throw new NotImplementedError(
      "postMessage is not implemented",
      "postMessage"
    );
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage> {
    throw new NotImplementedError(
      "editMessage is not implemented",
      "editMessage"
    );
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "deleteMessage is not implemented",
      "deleteMessage"
    );
  }

  parseMessage(_raw: unknown): Message {
    throw new NotImplementedError(
      "parseMessage is not implemented",
      "parseMessage"
    );
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

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError(
      "fetchThread is not implemented",
      "fetchThread"
    );
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

  encodeThreadId(_platformData: unknown): string {
    throw new NotImplementedError(
      "encodeThreadId is not implemented",
      "encodeThreadId"
    );
  }

  decodeThreadId(_threadId: string): unknown {
    throw new NotImplementedError(
      "decodeThreadId is not implemented",
      "decodeThreadId"
    );
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
      userName: config?.userName,
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
    userName: config?.userName,
  });
}
