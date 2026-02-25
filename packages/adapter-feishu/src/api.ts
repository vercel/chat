/**
 * Feishu API client with automatic token management.
 *
 * Handles tenant_access_token acquisition, caching, and auto-refresh.
 * All Feishu Open API HTTP calls are centralized here (SSOT).
 */

import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
} from "@chat-adapter/shared";
import type { Logger } from "chat";

import type {
  FeishuApiResponse,
  FeishuBotInfo,
  FeishuChatInfo,
  FeishuMessageListResponse,
  FeishuMessageResponse,
  FeishuReactionListResponse,
  FeishuReactionResponse,
  FeishuTokenResponse,
} from "./types";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

export class FeishuApiClient {
  private readonly apiBaseUrl: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly logger: Logger;

  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRefreshPromise: Promise<void> | null = null;

  constructor(config: {
    apiBaseUrl: string;
    appId: string;
    appSecret: string;
    logger: Logger;
  }) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.apiBaseUrl = config.apiBaseUrl;
    this.logger = config.logger;
  }

  // ===========================================================================
  // Token Management
  // ===========================================================================

  private async ensureToken(): Promise<string> {
    if (
      this.tenantAccessToken &&
      Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.tenantAccessToken;
    }

    // Prevent concurrent token refreshes
    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = this.refreshToken();
    }

    try {
      await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
    }

    return this.tenantAccessToken as string;
  }

  private async refreshToken(): Promise<void> {
    const url = `${this.apiBaseUrl}/auth/v3/tenant_access_token/internal`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    if (!response.ok) {
      throw new AuthenticationError(
        "feishu",
        `Token request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as FeishuTokenResponse;
    if (data.code !== 0) {
      throw new AuthenticationError(
        "feishu",
        `Token request error: ${data.msg} (code: ${data.code})`
      );
    }

    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + data.expire * 1000;
    this.logger.debug("Feishu token refreshed", {
      expiresIn: data.expire,
    });
  }

  // ===========================================================================
  // Generic Request
  // ===========================================================================

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retried = false
  ): Promise<T> {
    const token = await this.ensureToken();
    const url = `${this.apiBaseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new NetworkError(
        "feishu",
        `Request to ${method} ${path} failed`,
        error instanceof Error ? error : undefined
      );
    }

    // Rate limited
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new AdapterRateLimitError(
        "feishu",
        retryAfter ? Number.parseInt(retryAfter, 10) : undefined
      );
    }

    // Auth expired — retry once with fresh token
    if (response.status === 401 && !retried) {
      this.tenantAccessToken = null;
      this.tokenExpiresAt = 0;
      return this.request<T>(method, path, body, true);
    }

    const data = (await response.json()) as FeishuApiResponse<T>;

    // Feishu returns 200 with error codes in body
    if (data.code !== 0) {
      // Rate limit error code
      if (data.code === 99991400) {
        throw new AdapterRateLimitError("feishu");
      }
      // Auth error codes
      if (data.code === 99991661 || data.code === 99991663) {
        if (!retried) {
          this.tenantAccessToken = null;
          this.tokenExpiresAt = 0;
          return this.request<T>(method, path, body, true);
        }
        throw new AuthenticationError(
          "feishu",
          `${data.msg} (code: ${data.code})`
        );
      }
      throw new NetworkError(
        "feishu",
        `Feishu API error: ${data.msg} (code: ${data.code})`
      );
    }

    return data.data as T;
  }

  // ===========================================================================
  // Message APIs
  // ===========================================================================

  async sendMessage(
    receiveId: string,
    msgType: string,
    content: string,
    receiveIdType = "chat_id"
  ): Promise<FeishuMessageResponse> {
    return this.request<FeishuMessageResponse>(
      "POST",
      `/im/v1/messages?receive_id_type=${receiveIdType}`,
      { receive_id: receiveId, msg_type: msgType, content }
    );
  }

  async replyMessage(
    messageId: string,
    msgType: string,
    content: string
  ): Promise<FeishuMessageResponse> {
    return this.request<FeishuMessageResponse>(
      "POST",
      `/im/v1/messages/${messageId}/reply`,
      { msg_type: msgType, content }
    );
  }

  async editMessage(
    messageId: string,
    msgType: string,
    content: string
  ): Promise<FeishuMessageResponse> {
    return this.request<FeishuMessageResponse>(
      "PUT",
      `/im/v1/messages/${messageId}`,
      { msg_type: msgType, content }
    );
  }

  async patchMessageCard(
    messageId: string,
    content: string
  ): Promise<FeishuMessageResponse> {
    return this.request<FeishuMessageResponse>(
      "PATCH",
      `/im/v1/messages/${messageId}`,
      { content }
    );
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.request<void>("DELETE", `/im/v1/messages/${messageId}`);
  }

  async getMessage(messageId: string): Promise<FeishuMessageResponse> {
    return this.request<FeishuMessageResponse>(
      "GET",
      `/im/v1/messages/${messageId}`
    );
  }

  async listMessages(
    containerId: string,
    options?: {
      containerIdType?: string;
      pageSize?: number;
      pageToken?: string;
      startTime?: string;
      endTime?: string;
      sortType?: "ByCreateTimeAsc" | "ByCreateTimeDesc";
    }
  ): Promise<FeishuMessageListResponse> {
    const params = new URLSearchParams({
      container_id_type: options?.containerIdType ?? "chat",
      container_id: containerId,
    });
    if (options?.pageSize) {
      params.set("page_size", String(options.pageSize));
    }
    if (options?.pageToken) {
      params.set("page_token", options.pageToken);
    }
    if (options?.startTime) {
      params.set("start_time", options.startTime);
    }
    if (options?.endTime) {
      params.set("end_time", options.endTime);
    }
    if (options?.sortType) {
      params.set("sort_type", options.sortType);
    }
    return this.request<FeishuMessageListResponse>(
      "GET",
      `/im/v1/messages?${params.toString()}`
    );
  }

  // ===========================================================================
  // Bot APIs
  // ===========================================================================

  async getBotInfo(): Promise<FeishuBotInfo> {
    const data = await this.request<{ bot: FeishuBotInfo }>(
      "GET",
      "/bot/v3/info"
    );
    return data.bot;
  }

  // ===========================================================================
  // Chat APIs
  // ===========================================================================

  async getChatInfo(chatId: string): Promise<FeishuChatInfo> {
    return this.request<FeishuChatInfo>("GET", `/im/v1/chats/${chatId}`);
  }

  // ===========================================================================
  // Reaction APIs
  // ===========================================================================

  async addReaction(
    messageId: string,
    emojiType: string
  ): Promise<FeishuReactionResponse> {
    return this.request<FeishuReactionResponse>(
      "POST",
      `/im/v1/messages/${messageId}/reactions`,
      { reaction_type: { emoji_type: emojiType } }
    );
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/im/v1/messages/${messageId}/reactions/${reactionId}`
    );
  }

  async listReactions(
    messageId: string,
    emojiType?: string
  ): Promise<FeishuReactionListResponse> {
    const params = new URLSearchParams();
    if (emojiType) {
      params.set("reaction_type", emojiType);
    }
    const query = params.toString();
    const path = `/im/v1/messages/${messageId}/reactions${query ? `?${query}` : ""}`;
    return this.request<FeishuReactionListResponse>("GET", path);
  }
}
