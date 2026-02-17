/**
 * Discord adapter for chat-sdk.
 *
 * Uses Discord's HTTP Interactions API (not Gateway WebSocket) for
 * serverless compatibility. Webhook signature verification uses Ed25519.
 */

import {
  extractCard,
  extractFiles,
  NetworkError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  ActionEvent,
  Adapter,
  AdapterPostableMessage,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  RawMessage,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";
import {
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  getEmoji,
  Message,
} from "chat";
import {
  Client,
  type Message as DiscordJsMessage,
  Events,
  GatewayIntentBits,
} from "discord.js";
import {
  type APIEmbed,
  type APIMessage,
  ChannelType,
  InteractionType,
} from "discord-api-types/v10";
import {
  InteractionResponseType as DiscordInteractionResponseType,
  verifyKey,
} from "discord-interactions";
import { cardToDiscordPayload, cardToFallbackText } from "./cards";
import { DiscordFormatConverter } from "./markdown";
import {
  type DiscordActionRow,
  type DiscordAdapterConfig,
  type DiscordForwardedEvent,
  type DiscordGatewayEventType,
  type DiscordGatewayMessageData,
  type DiscordGatewayReactionData,
  type DiscordInteraction,
  type DiscordInteractionResponse,
  type DiscordMessagePayload,
  type DiscordThreadId,
  InteractionResponseType,
} from "./types";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_MAX_CONTENT_LENGTH = 2000;

export class DiscordAdapter implements Adapter<DiscordThreadId, unknown> {
  readonly name = "discord";
  readonly userName: string;
  readonly botUserId?: string;

  private botToken: string;
  private publicKey: string;
  private applicationId: string;
  private mentionRoleIds: string[];
  private chat: ChatInstance | null = null;
  private logger: Logger;
  private formatConverter = new DiscordFormatConverter();

  constructor(
    config: DiscordAdapterConfig & { logger: Logger; userName?: string },
  ) {
    this.botToken = config.botToken;
    this.publicKey = config.publicKey.trim().toLowerCase();
    this.applicationId = config.applicationId;
    this.mentionRoleIds = config.mentionRoleIds ?? [];
    this.botUserId = config.applicationId; // Discord app ID is the bot's user ID
    this.logger = config.logger;
    this.userName = config.userName ?? "bot";

    // Validate public key format
    if (!/^[0-9a-f]{64}$/.test(this.publicKey)) {
      this.logger.error("Invalid Discord public key format", {
        length: this.publicKey.length,
        isHex: /^[0-9a-f]+$/.test(this.publicKey),
      });
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Discord adapter initialized", {
      applicationId: this.applicationId,
      // Log full public key for debugging - it's public, not secret
      publicKey: this.publicKey,
    });
  }

  /**
   * Handle incoming Discord webhook (HTTP Interactions or forwarded Gateway events).
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    // Get raw body bytes for signature verification
    const bodyBuffer = await request.arrayBuffer();
    const bodyBytes = new Uint8Array(bodyBuffer);
    const body = new TextDecoder().decode(bodyBytes);

    // Check if this is a forwarded Gateway event (uses bot token for auth)
    const gatewayToken = request.headers.get("x-discord-gateway-token");
    if (gatewayToken) {
      if (gatewayToken !== this.botToken) {
        this.logger.warn("Invalid gateway token");
        return new Response("Invalid gateway token", { status: 401 });
      }
      this.logger.info("Discord forwarded Gateway event received");
      try {
        const event = JSON.parse(body) as DiscordForwardedEvent;
        return this.handleForwardedGatewayEvent(event, options);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
    }

    this.logger.info("Discord webhook received", {
      bodyLength: body.length,
      bodyBytesLength: bodyBytes.length,
      hasSignature: !!request.headers.get("x-signature-ed25519"),
      hasTimestamp: !!request.headers.get("x-signature-timestamp"),
    });

    // Verify Ed25519 signature using raw bytes
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");

    const signatureValid = await this.verifySignature(
      bodyBytes,
      signature,
      timestamp,
    );
    if (!signatureValid) {
      this.logger.warn("Discord signature verification failed, returning 401");
      return new Response("Invalid signature", { status: 401 });
    }
    this.logger.info("Discord signature verification passed");

    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    this.logger.info("Discord interaction parsed", {
      type: interaction.type,
      typeIsPing: interaction.type === InteractionType.Ping,
      expectedPingType: InteractionType.Ping,
      id: interaction.id,
    });

    // Handle PING (Discord verification)
    if (interaction.type === InteractionType.Ping) {
      // Use official discord-interactions response type
      const responseBody = JSON.stringify({
        type: DiscordInteractionResponseType.PONG,
      });
      this.logger.info("Discord PING received, responding with PONG", {
        responseBody,
        responseType: DiscordInteractionResponseType.PONG,
      });
      return new Response(responseBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle MESSAGE_COMPONENT (button clicks)
    if (interaction.type === InteractionType.MessageComponent) {
      this.handleComponentInteraction(interaction, options);
      // ACK the interaction immediately
      return this.respondToInteraction({
        type: InteractionResponseType.DeferredUpdateMessage,
      });
    }

    // Handle APPLICATION_COMMAND (slash commands - not implemented yet)
    if (interaction.type === InteractionType.ApplicationCommand) {
      // For now, just ACK
      return this.respondToInteraction({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });
    }

    return new Response("Unknown interaction type", { status: 400 });
  }

  /**
   * Verify Discord's Ed25519 signature using official discord-interactions library.
   */
  private async verifySignature(
    bodyBytes: Uint8Array,
    signature: string | null,
    timestamp: string | null,
  ): Promise<boolean> {
    if (!signature || !timestamp) {
      this.logger.warn(
        "Discord signature verification failed: missing headers",
        {
          hasSignature: !!signature,
          hasTimestamp: !!timestamp,
        },
      );
      return false;
    }

    try {
      // Log exactly what we're verifying
      this.logger.info("Discord signature verification attempt", {
        bodyBytesLength: bodyBytes.length,
        signatureLength: signature.length,
        timestampLength: timestamp.length,
        publicKeyLength: this.publicKey.length,
        timestamp,
        signaturePrefix: signature.slice(0, 16),
        publicKey: this.publicKey,
      });

      // Use the official discord-interactions library for verification with raw bytes
      const isValid = await verifyKey(
        bodyBytes,
        signature,
        timestamp,
        this.publicKey,
      );

      if (!isValid) {
        const bodyString = new TextDecoder().decode(bodyBytes);
        this.logger.warn(
          "Discord signature verification failed: invalid signature",
          {
            publicKeyLength: this.publicKey.length,
            signatureLength: signature.length,
            publicKeyPrefix: this.publicKey.slice(0, 8),
            publicKeySuffix: this.publicKey.slice(-8),
            timestamp,
            bodyLength: bodyBytes.length,
            bodyPrefix: bodyString.slice(0, 50),
          },
        );
      }

      return isValid;
    } catch (error) {
      this.logger.warn("Discord signature verification failed: exception", {
        error,
      });
      return false;
    }
  }

  /**
   * Create a JSON response for Discord interactions.
   */
  private respondToInteraction(response: DiscordInteractionResponse): Response {
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle MESSAGE_COMPONENT interactions (button clicks).
   */
  private handleComponentInteraction(
    interaction: DiscordInteraction,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring interaction");
      return;
    }

    const customId = interaction.data?.custom_id;
    if (!customId) {
      this.logger.warn("No custom_id in component interaction");
      return;
    }

    const user = interaction.member?.user || interaction.user;
    if (!user) {
      this.logger.warn("No user in component interaction");
      return;
    }

    const interactionChannelId = interaction.channel_id;
    const guildId = interaction.guild_id || "@me";
    const messageId = interaction.message?.id;

    if (!interactionChannelId || !messageId) {
      this.logger.warn("Missing channel_id or message_id in interaction");
      return;
    }

    // Detect if the interaction is inside a thread channel
    // Discord channel types: 11 = public thread, 12 = private thread
    const channel = interaction.channel;
    const isThread = channel?.type === 11 || channel?.type === 12;
    const parentChannelId =
      isThread && channel?.parent_id ? channel.parent_id : interactionChannelId;

    const threadId = isThread
      ? this.encodeThreadId({
          guildId,
          channelId: parentChannelId,
          threadId: interactionChannelId,
        })
      : this.encodeThreadId({
          guildId,
          channelId: interactionChannelId,
        });

    const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
      adapter: DiscordAdapter;
    } = {
      actionId: customId,
      value: customId, // Discord custom_id often contains the value
      user: {
        userId: user.id,
        userName: user.username,
        fullName: user.global_name || user.username,
        isBot: user.bot ?? false,
        isMe: false,
      },
      messageId,
      threadId,
      adapter: this,
      raw: interaction,
    };

    this.logger.debug("Processing Discord button action", {
      actionId: customId,
      messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);
  }

  /**
   * Handle a forwarded Gateway event received via webhook.
   */
  private async handleForwardedGatewayEvent(
    event: DiscordForwardedEvent,
    options?: WebhookOptions,
  ): Promise<Response> {
    this.logger.info("Processing forwarded Gateway event", {
      type: event.type,
      timestamp: event.timestamp,
    });

    switch (event.type) {
      case "GATEWAY_MESSAGE_CREATE":
        await this.handleForwardedMessage(
          event.data as DiscordGatewayMessageData,
          options,
        );
        break;
      case "GATEWAY_MESSAGE_REACTION_ADD":
        await this.handleForwardedReaction(
          event.data as DiscordGatewayReactionData,
          true,
          options,
        );
        break;
      case "GATEWAY_MESSAGE_REACTION_REMOVE":
        await this.handleForwardedReaction(
          event.data as DiscordGatewayReactionData,
          false,
          options,
        );
        break;
      default:
        // Other Gateway events are forwarded but not processed - this is expected
        this.logger.debug("Forwarded Gateway event (no handler)", {
          type: event.type,
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle a forwarded MESSAGE_CREATE event.
   */
  private async handleForwardedMessage(
    data: DiscordGatewayMessageData,
    _options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) return;

    const guildId = data.guild_id || "@me";
    const channelId = data.channel_id;

    // Use thread info if provided, otherwise use channel
    let discordThreadId: string | undefined;
    let parentChannelId = channelId;

    if (data.thread) {
      discordThreadId = data.thread.id;
      parentChannelId = data.thread.parent_id;
    } else if (data.channel_type === 11 || data.channel_type === 12) {
      // Message is in a thread (11 = public, 12 = private) but we don't have parent info
      // Fetch the channel to get parent_id
      try {
        const response = await this.discordFetch(
          `/channels/${channelId}`,
          "GET",
        );
        const channel = (await response.json()) as { parent_id?: string };
        if (channel.parent_id) {
          discordThreadId = channelId;
          parentChannelId = channel.parent_id;
          this.logger.debug("Fetched thread parent for forwarded message", {
            threadId: channelId,
            parentId: channel.parent_id,
          });
        }
      } catch (error) {
        this.logger.error("Failed to fetch thread parent", {
          error: String(error),
          channelId,
        });
      }
    }

    // Check if bot is mentioned (by user ID or configured role IDs)
    const isUserMentioned =
      data.is_mention || data.mentions.some((m) => m.id === this.applicationId);
    const isRoleMentioned =
      this.mentionRoleIds.length > 0 &&
      data.mention_roles?.some((roleId) =>
        this.mentionRoleIds.includes(roleId),
      );
    const isMentioned = isUserMentioned || isRoleMentioned;

    // If mentioned and not in a thread, create one
    if (!discordThreadId && isMentioned) {
      try {
        const newThread = await this.createDiscordThread(channelId, data.id);
        discordThreadId = newThread.id;
        this.logger.debug("Created Discord thread for forwarded mention", {
          channelId,
          messageId: data.id,
          threadId: newThread.id,
        });
      } catch (error) {
        this.logger.error("Failed to create Discord thread for mention", {
          error: String(error),
          messageId: data.id,
        });
      }
    }

    const threadId = this.encodeThreadId({
      guildId,
      channelId: parentChannelId,
      threadId: discordThreadId,
    });

    // Convert to SDK Message format
    const chatMessage = new Message({
      id: data.id,
      threadId,
      text: data.content,
      formatted: this.formatConverter.toAst(data.content),
      author: {
        userId: data.author.id,
        userName: data.author.username,
        fullName: data.author.global_name || data.author.username,
        isBot: data.author.bot === true, // Discord returns null for non-bots
        isMe: data.author.id === this.applicationId,
      },
      metadata: {
        dateSent: new Date(data.timestamp),
        edited: false,
      },
      attachments: data.attachments.map((a) => ({
        type: this.getAttachmentType(a.content_type),
        url: a.url,
        name: a.filename,
        mimeType: a.content_type,
        size: a.size,
      })),
      raw: data,
      isMention: isMentioned,
    });

    try {
      await this.chat.handleIncomingMessage(this, threadId, chatMessage);
    } catch (error) {
      this.logger.error("Error handling forwarded message", {
        error: String(error),
        messageId: data.id,
      });
    }
  }

  /**
   * Handle a forwarded REACTION_ADD or REACTION_REMOVE event.
   */
  private async handleForwardedReaction(
    data: DiscordGatewayReactionData,
    added: boolean,
    _options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) return;

    const guildId = data.guild_id || "@me";
    const channelId = data.channel_id;

    const threadId = this.encodeThreadId({
      guildId,
      channelId,
    });

    // Normalize emoji
    const emojiName = data.emoji.name || "unknown";
    const normalizedEmoji = this.normalizeDiscordEmoji(emojiName);

    // Get user info from either data.user (DMs) or data.member.user (guilds)
    const userInfo = data.user ?? data.member?.user;
    if (!userInfo) {
      this.logger.warn("Reaction event missing user info", { data });
      return;
    }

    const reactionEvent = {
      adapter: this as Adapter,
      threadId,
      messageId: data.message_id,
      emoji: normalizedEmoji,
      rawEmoji: data.emoji.id ? `<:${emojiName}:${data.emoji.id}>` : emojiName,
      added,
      user: {
        userId: userInfo.id,
        userName: userInfo.username,
        fullName: userInfo.username,
        isBot: userInfo.bot === true, // Discord returns null for non-bots
        isMe: userInfo.id === this.applicationId,
      },
      raw: data,
    };

    this.chat.processReaction(reactionEvent);
  }

  /**
   * Post a message to a Discord channel or thread.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    let { channelId, threadId: discordThreadId } =
      this.decodeThreadId(threadId);
    const actualThreadId = threadId;

    // If in a thread, post to the thread channel
    if (discordThreadId) {
      channelId = discordThreadId;
    }

    // Build message payload
    const payload: DiscordMessagePayload = {};
    const embeds: APIEmbed[] = [];
    const components: DiscordActionRow[] = [];

    // Check for card
    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToDiscordPayload(card);
      embeds.push(...cardPayload.embeds);
      components.push(...cardPayload.components);
      // Fallback text (truncated to Discord's limit)
      payload.content = this.truncateContent(cardToFallbackText(card));
    } else {
      // Regular text message (truncated to Discord's limit)
      payload.content = this.truncateContent(
        convertEmojiPlaceholders(
          this.formatConverter.renderPostable(message),
          "discord",
        ),
      );
    }

    if (embeds.length > 0) {
      payload.embeds = embeds;
    }
    if (components.length > 0) {
      payload.components = components;
    }

    // Handle file uploads
    const files = extractFiles(message);
    if (files.length > 0) {
      return this.postMessageWithFiles(
        channelId,
        actualThreadId,
        payload,
        files,
      );
    }

    this.logger.debug("Discord API: POST message", {
      channelId,
      contentLength: payload.content?.length || 0,
      embedCount: embeds.length,
      componentCount: components.length,
    });

    const response = await this.discordFetch(
      `/channels/${channelId}/messages`,
      "POST",
      payload,
    );

    const result = (await response.json()) as APIMessage;

    this.logger.debug("Discord API: POST message response", {
      messageId: result.id,
    });

    return {
      id: result.id,
      threadId: actualThreadId,
      raw: result,
    };
  }

  /**
   * Create a Discord thread from a message.
   */
  private async createDiscordThread(
    channelId: string,
    messageId: string,
  ): Promise<{ id: string; name: string }> {
    const threadName = `Thread ${new Date().toLocaleString()}`;

    this.logger.debug("Discord API: POST thread", {
      channelId,
      messageId,
      threadName,
    });

    const response = await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}/threads`,
      "POST",
      {
        name: threadName,
        auto_archive_duration: 1440, // 24 hours
      },
    );

    const result = (await response.json()) as { id: string; name: string };

    this.logger.debug("Discord API: POST thread response", {
      threadId: result.id,
      threadName: result.name,
    });

    return result;
  }

  /**
   * Truncate content to Discord's maximum length.
   */
  private truncateContent(content: string): string {
    if (content.length <= DISCORD_MAX_CONTENT_LENGTH) {
      return content;
    }
    // Truncate and add ellipsis
    return `${content.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3)}...`;
  }

  /**
   * Post a message with file attachments.
   */
  private async postMessageWithFiles(
    channelId: string,
    threadId: string,
    payload: DiscordMessagePayload,
    files: Array<{
      filename: string;
      data: Buffer | Blob | ArrayBuffer;
      mimeType?: string;
    }>,
  ): Promise<RawMessage<unknown>> {
    const formData = new FormData();

    // Add JSON payload
    formData.append("payload_json", JSON.stringify(payload));

    // Add files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      const buffer = await toBuffer(file.data, {
        platform: "discord" as "slack",
      });
      if (!buffer) continue;
      const blob = new Blob([new Uint8Array(buffer)], {
        type: file.mimeType || "application/octet-stream",
      });
      formData.append(`files[${i}]`, blob, file.filename);
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.botToken}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new NetworkError(
        "discord",
        `Failed to post message: ${response.status} ${error}`,
      );
    }

    const result = (await response.json()) as APIMessage;

    return {
      id: result.id,
      threadId,
      raw: result,
    };
  }

  /**
   * Edit an existing Discord message.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { channelId, threadId: discordThreadId } =
      this.decodeThreadId(threadId);
    // Use thread channel ID if in a thread, otherwise use channel ID
    const targetChannelId = discordThreadId || channelId;

    // Build message payload
    const payload: DiscordMessagePayload = {};
    const embeds: APIEmbed[] = [];
    const components: DiscordActionRow[] = [];

    // Check for card
    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToDiscordPayload(card);
      embeds.push(...cardPayload.embeds);
      components.push(...cardPayload.components);
      // Fallback text (truncated to Discord's limit)
      payload.content = this.truncateContent(cardToFallbackText(card));
    } else {
      // Regular text message (truncated to Discord's limit)
      payload.content = this.truncateContent(
        convertEmojiPlaceholders(
          this.formatConverter.renderPostable(message),
          "discord",
        ),
      );
    }

    if (embeds.length > 0) {
      payload.embeds = embeds;
    }
    if (components.length > 0) {
      payload.components = components;
    }

    this.logger.debug("Discord API: PATCH message", {
      channelId: targetChannelId,
      messageId,
      contentLength: payload.content?.length || 0,
    });

    const response = await this.discordFetch(
      `/channels/${targetChannelId}/messages/${messageId}`,
      "PATCH",
      payload,
    );

    const result = (await response.json()) as APIMessage;

    this.logger.debug("Discord API: PATCH message response", {
      messageId: result.id,
    });

    return {
      id: result.id,
      threadId,
      raw: result,
    };
  }

  /**
   * Delete a Discord message.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);

    this.logger.debug("Discord API: DELETE message", {
      channelId,
      messageId,
    });

    await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}`,
      "DELETE",
    );

    this.logger.debug("Discord API: DELETE message response", { ok: true });
  }

  /**
   * Add a reaction to a Discord message.
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);
    const emojiEncoded = this.encodeEmoji(emoji);

    this.logger.debug("Discord API: PUT reaction", {
      channelId,
      messageId,
      emoji: emojiEncoded,
    });

    await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`,
      "PUT",
    );

    this.logger.debug("Discord API: PUT reaction response", { ok: true });
  }

  /**
   * Remove a reaction from a Discord message.
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { channelId } = this.decodeThreadId(threadId);
    const emojiEncoded = this.encodeEmoji(emoji);

    this.logger.debug("Discord API: DELETE reaction", {
      channelId,
      messageId,
      emoji: emojiEncoded,
    });

    await this.discordFetch(
      `/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`,
      "DELETE",
    );

    this.logger.debug("Discord API: DELETE reaction response", { ok: true });
  }

  /**
   * Encode an emoji for use in Discord API URLs.
   */
  private encodeEmoji(emoji: EmojiValue | string): string {
    const emojiStr = defaultEmojiResolver.toDiscord
      ? defaultEmojiResolver.toDiscord(emoji)
      : String(emoji);
    // URL-encode the emoji for the API path
    return encodeURIComponent(emojiStr);
  }

  /**
   * Start typing indicator in a Discord channel or thread.
   */
  async startTyping(threadId: string): Promise<void> {
    const { channelId, threadId: discordThreadId } =
      this.decodeThreadId(threadId);
    // Use thread channel ID if in a thread, otherwise use channel ID
    const targetChannelId = discordThreadId || channelId;

    this.logger.debug("Discord API: POST typing", {
      channelId: targetChannelId,
    });

    await this.discordFetch(`/channels/${targetChannelId}/typing`, "POST");
  }

  /**
   * Fetch messages from a Discord channel or thread.
   * If threadId includes a Discord thread ID, fetches from that thread channel.
   */
  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    const { channelId, threadId: discordThreadId } =
      this.decodeThreadId(threadId);
    // Use thread channel ID if in a thread, otherwise use channel ID
    const targetChannelId = discordThreadId || channelId;

    const limit = options.limit || 50;
    const direction = options.direction ?? "backward";

    const params = new URLSearchParams();
    params.set("limit", String(limit));

    // Handle pagination cursor
    if (options.cursor) {
      if (direction === "backward") {
        params.set("before", options.cursor);
      } else {
        params.set("after", options.cursor);
      }
    }

    this.logger.debug("Discord API: GET messages", {
      channelId: targetChannelId,
      limit,
      direction,
      cursor: options.cursor,
    });

    const response = await this.discordFetch(
      `/channels/${targetChannelId}/messages?${params.toString()}`,
      "GET",
    );

    const rawMessages = (await response.json()) as APIMessage[];

    this.logger.debug("Discord API: GET messages response", {
      messageCount: rawMessages.length,
    });

    // Discord returns messages in reverse chronological order (newest first)
    // For consistency, reverse to chronological order (oldest first)
    const sortedMessages = [...rawMessages].reverse();

    const messages = sortedMessages.map((msg) =>
      this.parseDiscordMessage(msg, threadId),
    );

    // Determine next cursor
    let nextCursor: string | undefined;
    if (rawMessages.length === limit) {
      if (direction === "backward") {
        // For backward, cursor is the oldest message ID in the batch
        const oldest = rawMessages[rawMessages.length - 1];
        nextCursor = oldest?.id;
      } else {
        // For forward, cursor is the newest message ID in the batch
        const newest = rawMessages[0];
        nextCursor = newest?.id;
      }
    }

    return {
      messages,
      nextCursor,
    };
  }

  /**
   * Fetch thread/channel information.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { channelId, guildId } = this.decodeThreadId(threadId);

    this.logger.debug("Discord API: GET channel", { channelId });

    const response = await this.discordFetch(`/channels/${channelId}`, "GET");
    const channel = (await response.json()) as {
      id: string;
      name?: string;
      type: ChannelType;
    };

    return {
      id: threadId,
      channelId,
      channelName: channel.name,
      isDM:
        channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM,
      metadata: {
        guildId,
        channelType: channel.type,
        raw: channel,
      },
    };
  }

  /**
   * Open a DM with a user.
   */
  async openDM(userId: string): Promise<string> {
    this.logger.debug("Discord API: POST DM channel", { userId });

    const response = await this.discordFetch(`/users/@me/channels`, "POST", {
      recipient_id: userId,
    });

    const dmChannel = (await response.json()) as {
      id: string;
      type: ChannelType;
    };

    this.logger.debug("Discord API: POST DM channel response", {
      channelId: dmChannel.id,
    });

    return this.encodeThreadId({
      guildId: "@me",
      channelId: dmChannel.id,
    });
  }

  /**
   * Check if a thread is a DM.
   */
  isDM(threadId: string): boolean {
    const { guildId } = this.decodeThreadId(threadId);
    return guildId === "@me";
  }

  /**
   * Encode platform data into a thread ID string.
   */
  encodeThreadId(platformData: DiscordThreadId): string {
    const threadPart = platformData.threadId ? `:${platformData.threadId}` : "";
    return `discord:${platformData.guildId}:${platformData.channelId}${threadPart}`;
  }

  /**
   * Decode thread ID string back to platform data.
   */
  decodeThreadId(threadId: string): DiscordThreadId {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== "discord") {
      throw new ValidationError(
        "discord",
        `Invalid Discord thread ID: ${threadId}`,
      );
    }

    return {
      guildId: parts[1] as string,
      channelId: parts[2] as string,
      threadId: parts[3],
    };
  }

  /**
   * Parse a Discord message into normalized format.
   */
  parseMessage(raw: unknown): Message<unknown> {
    const msg = raw as APIMessage & { guild_id?: string };
    const guildId = msg.guild_id || "@me";
    const threadId = this.encodeThreadId({
      guildId,
      channelId: msg.channel_id,
    });
    return this.parseDiscordMessage(msg, threadId);
  }

  /**
   * Parse a Discord API message into normalized format.
   */
  private parseDiscordMessage(
    msg: APIMessage,
    threadId: string,
  ): Message<unknown> {
    const author = msg.author;
    const isBot = author.bot ?? false;
    const isMe = author.id === this.botUserId;

    return new Message({
      id: msg.id,
      threadId,
      text: this.formatConverter.extractPlainText(msg.content),
      formatted: this.formatConverter.toAst(msg.content),
      raw: msg,
      author: {
        userId: author.id,
        userName: author.username,
        fullName: author.global_name || author.username,
        isBot,
        isMe,
      },
      metadata: {
        dateSent: new Date(msg.timestamp),
        edited: msg.edited_timestamp !== null,
        editedAt: msg.edited_timestamp
          ? new Date(msg.edited_timestamp)
          : undefined,
      },
      attachments: (msg.attachments || []).map((att) => ({
        type: this.getAttachmentType(att.content_type),
        url: att.url,
        name: att.filename,
        mimeType: att.content_type,
        size: att.size,
        width: att.width ?? undefined,
        height: att.height ?? undefined,
      })),
    });
  }

  /**
   * Determine attachment type from MIME type.
   */
  private getAttachmentType(
    mimeType?: string | null,
  ): "image" | "video" | "audio" | "file" {
    if (!mimeType) return "file";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "file";
  }

  /**
   * Render formatted content to Discord markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Make a request to the Discord API.
   */
  private async discordFetch(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${DISCORD_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.botToken}`,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error("Discord API error", {
        path,
        method,
        status: response.status,
        error: errorText,
      });
      throw new NetworkError(
        "discord",
        `Discord API error: ${response.status} ${errorText}`,
      );
    }

    return response;
  }

  /**
   * Start Gateway WebSocket listener for receiving messages/mentions.
   * Uses waitUntil to keep the connection alive for the specified duration.
   *
   * This is a workaround for serverless environments - the Gateway connection
   * will stay alive for the duration, listening for messages.
   *
   * @param options - Webhook options with waitUntil function
   * @param durationMs - How long to keep listening (default: 180000ms = 3 minutes)
   * @param abortSignal - Optional AbortSignal to stop the listener early (e.g., when a new listener starts)
   * @param webhookUrl - URL to forward Gateway events to (required for webhook forwarding mode)
   * @returns Response indicating the listener was started
   */
  async startGatewayListener(
    options: WebhookOptions,
    durationMs = 180000,
    abortSignal?: AbortSignal,
    webhookUrl?: string,
  ): Promise<Response> {
    if (!this.chat) {
      return new Response("Chat instance not initialized", { status: 500 });
    }

    if (!options.waitUntil) {
      return new Response("waitUntil not provided", { status: 500 });
    }

    this.logger.info("Starting Discord Gateway listener", {
      durationMs,
      webhookUrl: webhookUrl ? "configured" : "not configured",
    });

    // Create a promise that resolves after the duration
    const listenerPromise = this.runGatewayListener(
      durationMs,
      abortSignal,
      webhookUrl,
    );

    // Use waitUntil to keep the function alive
    options.waitUntil(listenerPromise);

    return new Response(
      JSON.stringify({
        status: "listening",
        durationMs,
        message: `Gateway listener started, will run for ${durationMs / 1000} seconds`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Run the Gateway listener for a specified duration.
   */
  private async runGatewayListener(
    durationMs: number,
    abortSignal?: AbortSignal,
    webhookUrl?: string,
  ): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessageReactions,
      ],
    });

    let isShuttingDown = false;

    // When webhookUrl is provided, use raw forwarding for ALL events
    // This keeps the Gateway simple - all processing happens in the webhook
    if (webhookUrl) {
      client.on("raw", async (packet: { t: string | null; d: unknown }) => {
        if (isShuttingDown) return;
        if (!packet.t) return; // Skip heartbeats and other non-dispatch events

        this.logger.info("Discord Gateway forwarding event", {
          type: packet.t,
        });

        // Forward to webhook
        await this.forwardGatewayEvent(webhookUrl, {
          type: `GATEWAY_${packet.t}` as DiscordGatewayEventType,
          timestamp: Date.now(),
          data: packet.d,
        });
      });
    } else {
      // Legacy mode: handle events directly without webhook forwarding
      this.setupLegacyGatewayHandlers(client, () => isShuttingDown);
    }

    client.on(Events.ClientReady, () => {
      this.logger.info("Discord Gateway connected", {
        username: client.user?.username,
        id: client.user?.id,
      });
    });

    client.on(Events.Error, (error) => {
      this.logger.error("Discord Gateway error", { error: String(error) });
    });

    try {
      // Login to Discord
      await client.login(this.botToken);

      // Wait for either: duration timeout OR abort signal
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, durationMs);

        // Listen for abort signal (e.g., when a new listener starts)
        if (abortSignal) {
          if (abortSignal.aborted) {
            clearTimeout(timeout);
            resolve();
            return;
          }
          abortSignal.addEventListener(
            "abort",
            () => {
              this.logger.info(
                "Discord Gateway listener received abort signal (new listener started)",
              );
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        }
      });

      this.logger.info(
        "Discord Gateway listener duration elapsed, disconnecting",
      );
    } catch (error) {
      this.logger.error("Discord Gateway listener error", {
        error: String(error),
      });
    } finally {
      isShuttingDown = true;
      client.destroy();
      this.logger.info("Discord Gateway listener stopped");
    }
  }

  /**
   * Set up legacy Gateway handlers for direct processing (when webhookUrl is not provided).
   */
  private setupLegacyGatewayHandlers(
    client: Client,
    isShuttingDown: () => boolean,
  ): void {
    // Message handler
    client.on(Events.MessageCreate, async (message: DiscordJsMessage) => {
      if (isShuttingDown()) {
        this.logger.debug("Ignoring message - Gateway is shutting down");
        return;
      }

      // Ignore messages from bots (including ourselves)
      if (message.author.bot) {
        this.logger.debug("Ignoring message from bot", {
          authorId: message.author.id,
          authorName: message.author.username,
          isMe: message.author.id === client.user?.id,
        });
        return;
      }

      // Check if we're mentioned (by user ID or configured role IDs)
      const isUserMentioned = message.mentions.has(client.user?.id ?? "");
      const isRoleMentioned =
        this.mentionRoleIds.length > 0 &&
        message.mentions.roles.some((role) =>
          this.mentionRoleIds.includes(role.id),
        );
      const isMentioned = isUserMentioned || isRoleMentioned;

      this.logger.info("Discord Gateway message received", {
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.author.id,
        isMentioned,
        isUserMentioned,
        isRoleMentioned,
        content: message.content.slice(0, 100),
      });

      // Process the message directly
      await this.handleGatewayMessage(message, isMentioned);
    });

    // Reaction add handler
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (isShuttingDown()) {
        this.logger.debug("Ignoring reaction - Gateway is shutting down");
        return;
      }

      // Ignore reactions from bots (including ourselves)
      if (user.bot) {
        this.logger.debug("Ignoring reaction from bot", {
          userId: user.id,
          isMe: user.id === client.user?.id,
        });
        return;
      }

      this.logger.info("Discord Gateway reaction added", {
        emoji: reaction.emoji.name,
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        userId: user.id,
      });

      // Process the reaction (skip partial users without username)
      if (user.username) {
        await this.handleGatewayReaction(
          reaction,
          user as { id: string; username: string; bot: boolean },
          true,
        );
      }
    });

    // Reaction remove handler
    client.on(Events.MessageReactionRemove, async (reaction, user) => {
      if (isShuttingDown()) {
        this.logger.debug(
          "Ignoring reaction removal - Gateway is shutting down",
        );
        return;
      }

      // Ignore reactions from bots (including ourselves)
      if (user.bot) {
        this.logger.debug("Ignoring reaction removal from bot", {
          userId: user.id,
          isMe: user.id === client.user?.id,
        });
        return;
      }

      this.logger.info("Discord Gateway reaction removed", {
        emoji: reaction.emoji.name,
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        userId: user.id,
      });

      // Process the reaction (skip partial users without username)
      if (user.username) {
        await this.handleGatewayReaction(
          reaction,
          user as { id: string; username: string; bot: boolean },
          false,
        );
      }
    });
  }

  /**
   * Forward a Gateway event to the webhook endpoint.
   */
  private async forwardGatewayEvent(
    webhookUrl: string,
    event: DiscordForwardedEvent,
  ): Promise<void> {
    try {
      this.logger.debug("Forwarding Gateway event to webhook", {
        type: event.type,
        webhookUrl,
      });

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-discord-gateway-token": this.botToken,
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error("Failed to forward Gateway event", {
          type: event.type,
          status: response.status,
          error: errorText,
        });
      } else {
        this.logger.debug("Gateway event forwarded successfully", {
          type: event.type,
        });
      }
    } catch (error) {
      this.logger.error("Error forwarding Gateway event", {
        type: event.type,
        error: String(error),
      });
    }
  }

  /**
   * Handle a message received via the Gateway WebSocket.
   */
  private async handleGatewayMessage(
    message: DiscordJsMessage,
    isMentioned: boolean,
  ): Promise<void> {
    if (!this.chat) return;

    const guildId = message.guildId || "@me";
    const channelId = message.channelId;

    // Check if this message is in a Discord Thread channel
    const isInThread = message.channel.isThread();
    let discordThreadId: string | undefined;
    let parentChannelId = channelId;

    if (
      isInThread &&
      "parentId" in message.channel &&
      message.channel.parentId
    ) {
      // Message is in a thread - use the thread channel ID
      discordThreadId = channelId;
      parentChannelId = message.channel.parentId;
    }

    // If not in a thread and bot is mentioned, create a thread immediately
    // This ensures the Thread object has the correct ID from the start
    if (!discordThreadId && isMentioned) {
      try {
        const newThread = await this.createDiscordThread(channelId, message.id);
        discordThreadId = newThread.id;
        this.logger.debug("Created Discord thread for incoming mention", {
          channelId,
          messageId: message.id,
          threadId: newThread.id,
        });
      } catch (error) {
        this.logger.error("Failed to create Discord thread for mention", {
          error: String(error),
          messageId: message.id,
        });
        // Continue without thread - will use channel
      }
    }

    const threadId = this.encodeThreadId({
      guildId,
      channelId: parentChannelId,
      threadId: discordThreadId,
    });

    // Convert discord.js message to our Message format
    const chatMessage = new Message({
      id: message.id,
      threadId,
      text: message.content,
      formatted: this.formatConverter.toAst(message.content),
      author: {
        userId: message.author.id,
        userName: message.author.username,
        fullName: message.author.displayName || message.author.username,
        isBot: message.author.bot,
        isMe: false, // Gateway messages are never from ourselves (we filter those)
      },
      metadata: {
        dateSent: message.createdAt,
        edited: message.editedAt !== null,
        editedAt: message.editedAt ?? undefined,
      },
      attachments: message.attachments.map((a) => ({
        type: this.getAttachmentType(a.contentType),
        url: a.url,
        name: a.name,
        mimeType: a.contentType ?? undefined,
        size: a.size,
      })),
      raw: {
        id: message.id,
        channel_id: channelId,
        guild_id: guildId,
        content: message.content,
        author: {
          id: message.author.id,
          username: message.author.username,
        },
        timestamp: message.createdAt.toISOString(),
      },
      // Add isMention flag for the chat handlers
      isMention: isMentioned,
    });

    try {
      await this.chat.handleIncomingMessage(this, threadId, chatMessage);
    } catch (error) {
      this.logger.error("Error handling Gateway message", {
        error: String(error),
        messageId: message.id,
      });
    }
  }

  /**
   * Handle a reaction received via the Gateway WebSocket.
   */
  private async handleGatewayReaction(
    reaction: {
      emoji: { name: string | null; id: string | null };
      message: { id: string; channelId: string; guildId: string | null };
    },
    user: { id: string; username: string; bot: boolean },
    added: boolean,
  ): Promise<void> {
    if (!this.chat) return;

    const guildId = reaction.message.guildId || "@me";
    const channelId = reaction.message.channelId;

    // For reactions, we don't know if the message is in a thread without fetching it
    // Use the channel ID directly for now
    const threadId = this.encodeThreadId({
      guildId,
      channelId,
      threadId: undefined,
    });

    // Normalize emoji
    const emojiName = reaction.emoji.name || "unknown";
    const normalizedEmoji = this.normalizeDiscordEmoji(emojiName);

    // Build reaction event
    const reactionEvent = {
      adapter: this as Adapter,
      threadId,
      messageId: reaction.message.id,
      emoji: normalizedEmoji,
      rawEmoji: reaction.emoji.id
        ? `<:${emojiName}:${reaction.emoji.id}>`
        : emojiName,
      added,
      user: {
        userId: user.id,
        userName: user.username,
        fullName: user.username,
        isBot: user.bot === true, // Match pattern from handleForwardedReaction
        isMe: user.id === this.applicationId,
      },
      raw: {
        emoji: reaction.emoji,
        message_id: reaction.message.id,
        channel_id: reaction.message.channelId,
        guild_id: reaction.message.guildId,
        user_id: user.id,
      },
    };

    this.chat.processReaction(reactionEvent);
  }

  /**
   * Derive channel ID from a Discord thread ID.
   * Discord: discord:{guildId}:{channelId}:{threadId} -> discord:{guildId}:{channelId}
   * If already a channel ID (3 parts), returns as-is.
   */
  channelIdFromThreadId(threadId: string): string {
    const parts = threadId.split(":");
    // discord:{guildId}:{channelId} or discord:{guildId}:{channelId}:{threadId}
    return parts.slice(0, 3).join(":");
  }

  /**
   * Fetch channel-level messages (not thread replies).
   * Uses the parent channel ID to fetch top-level messages.
   */
  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    const parts = channelId.split(":");
    const discordChannelId = parts[2];
    if (!discordChannelId) {
      throw new ValidationError(
        "discord",
        `Invalid Discord channel ID: ${channelId}`,
      );
    }

    const limit = options.limit || 50;
    const direction = options.direction ?? "backward";

    const params = new URLSearchParams();
    params.set("limit", String(limit));

    if (options.cursor) {
      if (direction === "backward") {
        params.set("before", options.cursor);
      } else {
        params.set("after", options.cursor);
      }
    }

    this.logger.debug("Discord API: GET channel messages", {
      channelId: discordChannelId,
      limit,
      direction,
      cursor: options.cursor,
    });

    const response = await this.discordFetch(
      `/channels/${discordChannelId}/messages?${params.toString()}`,
      "GET",
    );

    const rawMessages = (await response.json()) as APIMessage[];

    this.logger.debug("Discord API: GET channel messages response", {
      messageCount: rawMessages.length,
    });

    // Discord returns newest first, reverse for chronological order
    const sortedMessages = [...rawMessages].reverse();

    const messages = sortedMessages.map((msg) =>
      this.parseDiscordMessage(msg, channelId),
    );

    let nextCursor: string | undefined;
    if (rawMessages.length === limit) {
      if (direction === "backward") {
        const oldest = rawMessages[rawMessages.length - 1];
        nextCursor = oldest?.id;
      } else {
        const newest = rawMessages[0];
        nextCursor = newest?.id;
      }
    }

    return { messages, nextCursor };
  }

  /**
   * List threads in a Discord channel.
   * Fetches active threads from the guild and archived threads from the channel.
   */
  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {},
  ): Promise<ListThreadsResult<unknown>> {
    const parts = channelId.split(":");
    const guildId = parts[1];
    const discordChannelId = parts[2];
    if (!guildId || !discordChannelId) {
      throw new ValidationError(
        "discord",
        `Invalid Discord channel ID: ${channelId}`,
      );
    }

    this.logger.debug("Discord API: GET threads", {
      guildId,
      channelId: discordChannelId,
    });

    // Fetch active threads from the guild
    const activeResponse = await this.discordFetch(
      `/guilds/${guildId}/threads/active`,
      "GET",
    );
    const activeData = (await activeResponse.json()) as {
      threads: Array<{
        id: string;
        name: string;
        parent_id: string;
        message_count?: number;
        total_message_sent?: number;
        thread_metadata?: { archive_timestamp?: string };
      }>;
    };

    // Filter threads that belong to our channel
    const channelThreads = (activeData.threads || []).filter(
      (t) => t.parent_id === discordChannelId,
    );

    // Also fetch archived public threads
    let archivedThreads: typeof channelThreads = [];
    try {
      const archivedResponse = await this.discordFetch(
        `/channels/${discordChannelId}/threads/archived/public?limit=${options.limit || 50}`,
        "GET",
      );
      const archivedData = (await archivedResponse.json()) as {
        threads: typeof channelThreads;
      };
      archivedThreads = archivedData.threads || [];
    } catch {
      // Archived threads may not be available (permissions)
      this.logger.debug(
        "Could not fetch archived threads (may lack permissions)",
      );
    }

    // Merge and deduplicate
    const allThreads = [...channelThreads, ...archivedThreads];
    const seen = new Set<string>();
    const uniqueThreads = allThreads.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    // Apply limit
    const limit = options.limit || 50;
    const limitedThreads = uniqueThreads.slice(0, limit);

    // Convert to ThreadSummary - fetch the first message of each thread
    const threads: ThreadSummary[] = [];
    for (const thread of limitedThreads) {
      const threadId = this.encodeThreadId({
        guildId,
        channelId: discordChannelId,
        threadId: thread.id,
      });

      // Fetch the first message of the thread (which is the root/starter message)
      try {
        const msgsResponse = await this.discordFetch(
          `/channels/${thread.id}/messages?limit=1&after=0`,
          "GET",
        );
        const msgs = (await msgsResponse.json()) as APIMessage[];
        const rootMsg = msgs[0];

        if (rootMsg) {
          threads.push({
            id: threadId,
            rootMessage: this.parseDiscordMessage(rootMsg, threadId),
            replyCount: thread.total_message_sent ?? thread.message_count,
            lastReplyAt: thread.thread_metadata?.archive_timestamp
              ? new Date(thread.thread_metadata.archive_timestamp)
              : undefined,
          });
        }
      } catch {
        // If we can't fetch the root message, create a placeholder
        threads.push({
          id: threadId,
          rootMessage: new Message({
            id: thread.id,
            threadId,
            text: thread.name,
            formatted: this.formatConverter.toAst(thread.name),
            raw: thread,
            author: {
              userId: "unknown",
              userName: "unknown",
              fullName: "unknown",
              isBot: false,
              isMe: false,
            },
            metadata: { dateSent: new Date(), edited: false },
            attachments: [],
          }),
          replyCount: thread.total_message_sent ?? thread.message_count,
        });
      }
    }

    this.logger.debug("Discord API: listThreads result", {
      threadCount: threads.length,
    });

    return {
      threads,
      nextCursor: uniqueThreads.length > limit ? String(limit) : undefined,
    };
  }

  /**
   * Fetch Discord channel info/metadata.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const parts = channelId.split(":");
    const discordChannelId = parts[2];
    if (!discordChannelId) {
      throw new ValidationError(
        "discord",
        `Invalid Discord channel ID: ${channelId}`,
      );
    }

    this.logger.debug("Discord API: GET channel info", {
      channelId: discordChannelId,
    });

    const response = await this.discordFetch(
      `/channels/${discordChannelId}`,
      "GET",
    );
    const channel = (await response.json()) as {
      id: string;
      name?: string;
      type: ChannelType;
      member_count?: number;
    };

    return {
      id: channelId,
      name: channel.name,
      isDM:
        channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM,
      memberCount: channel.member_count,
      metadata: {
        channelType: channel.type,
        raw: channel,
      },
    };
  }

  /**
   * Post a message to channel top-level (not in a thread).
   * Posts directly to the parent channel without a thread reference.
   */
  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const parts = channelId.split(":");
    const discordChannelId = parts[2];
    if (!discordChannelId) {
      throw new ValidationError(
        "discord",
        `Invalid Discord channel ID: ${channelId}`,
      );
    }

    // Build message payload
    const payload: DiscordMessagePayload = {};
    const embeds: APIEmbed[] = [];
    const components: DiscordActionRow[] = [];

    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToDiscordPayload(card);
      embeds.push(...cardPayload.embeds);
      components.push(...cardPayload.components);
      payload.content = this.truncateContent(cardToFallbackText(card));
    } else {
      payload.content = this.truncateContent(
        convertEmojiPlaceholders(
          this.formatConverter.renderPostable(message),
          "discord",
        ),
      );
    }

    if (embeds.length > 0) payload.embeds = embeds;
    if (components.length > 0) payload.components = components;

    const files = extractFiles(message);
    if (files.length > 0) {
      return this.postMessageWithFiles(
        discordChannelId,
        channelId,
        payload,
        files,
      );
    }

    this.logger.debug("Discord API: POST channel message", {
      channelId: discordChannelId,
      contentLength: payload.content?.length || 0,
    });

    const response = await this.discordFetch(
      `/channels/${discordChannelId}/messages`,
      "POST",
      payload,
    );

    const result = (await response.json()) as APIMessage;

    return {
      id: result.id,
      threadId: channelId,
      raw: result,
    };
  }

  /**
   * Normalize a Discord emoji to our standard EmojiValue format.
   */
  private normalizeDiscordEmoji(emojiName: string): EmojiValue {
    // Map common Discord unicode emoji to our standard names
    const unicodeToName: Record<string, string> = {
      "👍": "thumbs_up",
      "👎": "thumbs_down",
      "❤️": "heart",
      "❤": "heart",
      "🔥": "fire",
      "🚀": "rocket",
      "🙌": "raised_hands",
      "✅": "check",
      "❌": "x",
      "👋": "wave",
      "🤔": "thinking",
      "😊": "smile",
      "😂": "laugh",
      "🎉": "party",
      "⭐": "star",
      "✨": "sparkles",
      "👀": "eyes",
      "💯": "100",
    };

    // Check if it's a unicode emoji we recognize
    const normalizedName = unicodeToName[emojiName] || emojiName;
    return getEmoji(normalizedName);
  }
}

/**
 * Create a Discord adapter instance.
 */
export function createDiscordAdapter(
  config: DiscordAdapterConfig & { logger: Logger; userName?: string },
): DiscordAdapter {
  return new DiscordAdapter(config);
}

// Re-export card converter for advanced use
export { cardToDiscordPayload, cardToFallbackText } from "./cards";

// Re-export format converter for advanced use
export {
  DiscordFormatConverter,
  DiscordFormatConverter as DiscordMarkdownConverter,
} from "./markdown";
// Re-export types
export type { DiscordAdapterConfig, DiscordThreadId } from "./types";
