import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthenticationError, ValidationError } from "@chat-adapter/shared";
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
import type {
  ZoomAdapterConfig,
  ZoomAdapterInternalConfig,
  ZoomCrcPayload,
  ZoomWebhookPayload,
} from "./types.js";

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
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(config: ZoomAdapterInternalConfig) {
    this.config = config;
    this.userName = config.robotJid;
  }

  /** Fetches and caches a chatbot token via S2S OAuth client_credentials grant.
   * Uses raw fetch — @zoom/rivet's ChatbotClient does not expose a public token-fetch API
   * (its ClientCredentialsAuth is internal-only). @zoom/rivet is used in Phase 3 for
   * message sending via endpoints.sendChatbotMessage().
   * Reuses the cached token within the 1-hour TTL (with 60-second early-expiry buffer).
   * On failure, throws AuthenticationError — caller should let the SDK return 500.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.value;
    }

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const response = await fetch(
      "https://zoom.us/oauth/token?grant_type=client_credentials",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    if (!response.ok) {
      throw new AuthenticationError(
        "zoom",
        `Token fetch failed with HTTP ${response.status}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.cachedToken.value;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // WBHK-03: Capture raw body FIRST — Web Request body can only be consumed once.
    // The raw string is passed unchanged to HMAC verification.
    const body = await request.text();

    let parsed: ZoomWebhookPayload;
    try {
      parsed = JSON.parse(body) as ZoomWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // WBHK-01: Handle CRC URL validation challenge BEFORE signature check.
    // CRC requests do NOT include x-zm-signature — checking signature first
    // would return 401 and prevent Zoom Marketplace from validating the endpoint.
    if (parsed.event === "endpoint.url_validation") {
      const { plainToken } = (parsed as ZoomCrcPayload).payload;
      const encryptedToken = createHmac(
        "sha256",
        this.config.webhookSecretToken
      )
        .update(plainToken)
        .digest("hex");
      return Response.json({ plainToken, encryptedToken });
    }

    // WBHK-02: Verify signature for all other events
    if (!this.verifySignature(body, request)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Process event asynchronously if waitUntil is available (edge runtime pattern)
    const handlePromise = this.processEvent(parsed, options);
    if (options?.waitUntil) {
      options.waitUntil(handlePromise);
    } else {
      await handlePromise;
    }
    return new Response("ok", { status: 200 });
  }

  private verifySignature(body: string, request: Request): boolean {
    const timestamp = request.headers.get("x-zm-request-timestamp");
    const signature = request.headers.get("x-zm-signature");

    if (!(timestamp && signature)) {
      return false;
    }

    // Reject stale requests — fixed 5-minute window per Zoom spec
    const fiveMinutesMs = 5 * 60 * 1000;
    if (Date.now() - Number(timestamp) * 1000 > fiveMinutesMs) {
      return false;
    }

    const message = `v0:${timestamp}:${body}`;
    const expected =
      "v0=" +
      createHmac("sha256", this.config.webhookSecretToken)
        .update(message)
        .digest("hex");

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      // Buffer length mismatch throws — treat as invalid signature.
      // ZOOM-506645: Unicode normalization bug — emoji/non-ASCII payloads may fail
      // HMAC verification due to normalization differences between Zoom signing and receipt.
      // Log raw body hex for diagnosis without exposing full payload.
      this.config.logger.debug(
        "Signature comparison failed (possible ZOOM-506645 Unicode normalization issue)",
        { bodyHex: Buffer.from(body).toString("hex").substring(0, 200) }
      );
      return false;
    }
  }

  private async processEvent(
    _payload: ZoomWebhookPayload,
    _options?: WebhookOptions
  ): Promise<void> {
    // Phase 2 will implement event routing (bot_notification, team_chat.app_mention)
    // Phase 1 scope ends at signature verification
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
