import { ValidationError } from "@chat-adapter/shared";
import type { App } from "@microsoft/teams.apps";
import type { Client as GraphClient } from "@microsoft/teams.graph";
import { chats, teams } from "@microsoft/teams.graph-endpoints";
import type {
  Attachment,
  ChannelInfo,
  FetchOptions,
  FetchResult,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  ThreadInfo,
  ThreadSummary,
} from "chat";
import { Message, NotImplementedError } from "chat";
import type { TeamsFormatConverter } from "./markdown";
import { decodeThreadId, encodeThreadId, isDM } from "./thread-id";
import type {
  TeamsChannelContext,
  TeamsGraphContext,
  TeamsThreadId,
} from "./types";

const MESSAGEID_STRIP_PATTERN = /;messageid=\d+/;
const SEMICOLON_MESSAGEID_CAPTURE_PATTERN = /;messageid=(\d+)/;

/**
 * Graph API chat message — uses the shape returned by @microsoft/teams.graph-endpoints.
 * Nullable fields are accessed via `??` / `||` at usage sites.
 */
/** Infer the chat message type from the graph-endpoints list response */
type ChatMessageListResponse = Awaited<
  ReturnType<typeof App.prototype.graph.call<typeof chats.messages.list>>
>;
type GraphMessage = NonNullable<ChatMessageListResponse["value"]>[number];

interface GraphMessagePage {
  "@odata.nextLink"?: string | null;
  value?: GraphMessage[] | null;
}

const TRUSTED_GRAPH_HOSTS = new Set([
  "dod-graph.microsoft.us",
  "graph.microsoft.com",
  "graph.microsoft.de",
  "graph.microsoft.us",
  "microsoftgraph.chinacloudapi.cn",
]);

export interface TeamsGraphReaderDeps {
  botId: string;
  formatConverter: TeamsFormatConverter;
  getGraphContext: (
    baseConversationId: string
  ) => Promise<TeamsGraphContext | null>;
  graph: GraphClient;
  logger: Logger;
}

export class TeamsGraphReader {
  private readonly deps: TeamsGraphReaderDeps;

  constructor(deps: TeamsGraphReaderDeps) {
    this.deps = deps;
  }

  /**
   * Resolve the Graph API chat ID for a non-channel conversation.
   * Uses the DM context's graphChatId if available, otherwise falls back to
   * the raw conversation ID (works for group chats).
   */
  private chatIdFromContext(
    context: TeamsGraphContext | null,
    baseConversationId: string
  ): string {
    if (context?.type === "dm") {
      return context.graphChatId;
    }
    return baseConversationId;
  }

  private async getGraphContext(
    baseConversationId: string,
    conversationType: TeamsThreadId["conversationType"]
  ): Promise<TeamsGraphContext | null> {
    if (conversationType === "groupChat") {
      return null;
    }
    return this.deps.getGraphContext(baseConversationId);
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    const { conversationId, conversationType } = decodeThreadId(threadId);
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    const messageIdMatch = conversationId.match(
      SEMICOLON_MESSAGEID_CAPTURE_PATTERN
    );
    const threadMessageId = messageIdMatch?.[1];
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

    const graphContext = await this.getGraphContext(
      baseConversationId,
      conversationType
    );

    try {
      this.deps.logger.debug("Teams Graph API: fetching messages", {
        conversationId: baseConversationId,
        threadMessageId,
        contextType: graphContext?.type ?? "none",
        limit,
        cursor,
        direction,
      });

      if (graphContext && graphContext.type !== "dm" && threadMessageId) {
        return this.fetchChannelThreadMessages(
          graphContext,
          threadMessageId,
          threadId,
          options
        );
      }

      const chatId = this.chatIdFromContext(graphContext, baseConversationId);
      let graphMessages: GraphMessage[];
      let hasMoreMessages = false;

      if (direction === "forward") {
        const response = await this.deps.graph.call(chats.messages.list, {
          "chat-id": chatId,
          $top: limit,
          $orderby: ["createdDateTime asc"],
          $filter: cursor ? `createdDateTime gt ${cursor}` : undefined,
        });
        graphMessages = (response.value || []) as GraphMessage[];
        hasMoreMessages = graphMessages.length >= limit;
      } else {
        const response = await this.deps.graph.call(chats.messages.list, {
          "chat-id": chatId,
          $top: limit,
          $orderby: ["createdDateTime desc"],
          $filter: cursor ? `createdDateTime lt ${cursor}` : undefined,
        });
        graphMessages = (response.value || []) as GraphMessage[];
        graphMessages.reverse();
        hasMoreMessages = graphMessages.length >= limit;
      }

      if (threadMessageId && !graphContext) {
        graphMessages = graphMessages.filter((msg) => {
          return msg.id && msg.id >= threadMessageId;
        });
        this.deps.logger.debug("Filtered group chat messages to thread", {
          threadMessageId,
          filteredCount: graphMessages.length,
        });
      }

      this.deps.logger.debug("Teams Graph API: fetched messages", {
        count: graphMessages.length,
        direction,
        hasMoreMessages,
      });

      const messages = this.mapGraphMessages(graphMessages, threadId);

      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          const lastMsg = graphMessages.at(-1);
          if (lastMsg?.createdDateTime) {
            nextCursor = lastMsg.createdDateTime;
          }
        } else {
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime) {
            nextCursor = oldestMsg.createdDateTime;
          }
        }
      }

      return { messages, nextCursor };
    } catch (error) {
      this.deps.logger.error("Teams Graph API: fetchMessages error", {
        error,
      });

      if (error instanceof Error && error.message?.includes("403")) {
        throw new NotImplementedError(
          "Teams fetchMessages requires one of these Azure AD app permissions: ChatMessage.Read.Chat, Chat.Read.All, or Chat.Read.WhereInstalled",
          "fetchMessages"
        );
      }

      throw error;
    }
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    const { conversationId, conversationType } = decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );
    const limit = options.limit || 50;
    const direction = options.direction ?? "backward";

    try {
      const graphContext = await this.getGraphContext(
        baseConversationId,
        conversationType
      );

      this.deps.logger.debug("Teams Graph API: fetchChannelMessages", {
        conversationId: baseConversationId,
        contextType: graphContext?.type ?? "none",
        limit,
        direction,
      });

      let graphMessages: GraphMessage[];
      let hasMoreMessages = false;

      if (graphContext && graphContext.type !== "dm") {
        const allMessages = await this.fetchAllChannelRoots(graphContext);
        return this.pageChannelMessages(allMessages, channelId, options);
      }
      const chatId = this.chatIdFromContext(graphContext, baseConversationId);
      if (direction === "forward") {
        const response = await this.deps.graph.call(chats.messages.list, {
          "chat-id": chatId,
          $top: limit,
          $orderby: ["createdDateTime asc"],
          $filter: options.cursor
            ? `createdDateTime gt ${options.cursor}`
            : undefined,
        });
        graphMessages = (response.value || []) as GraphMessage[];
        hasMoreMessages = graphMessages.length >= limit;
      } else {
        const response = await this.deps.graph.call(chats.messages.list, {
          "chat-id": chatId,
          $top: limit,
          $orderby: ["createdDateTime desc"],
          $filter: options.cursor
            ? `createdDateTime lt ${options.cursor}`
            : undefined,
        });
        graphMessages = (response.value || []) as GraphMessage[];
        graphMessages.reverse();
        hasMoreMessages = graphMessages.length >= limit;
      }

      const messages = this.mapGraphMessages(graphMessages, channelId);

      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          const lastMsg = graphMessages.at(-1);
          if (lastMsg?.createdDateTime) {
            nextCursor = lastMsg.createdDateTime;
          }
        } else {
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime) {
            nextCursor = oldestMsg.createdDateTime;
          }
        }
      }

      return { messages, nextCursor };
    } catch (error) {
      this.deps.logger.error("Teams Graph API: fetchChannelMessages error", {
        error,
      });
      throw error;
    }
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const { conversationId, conversationType } = decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

    const graphContext = await this.getGraphContext(
      baseConversationId,
      conversationType
    );

    if (graphContext && graphContext.type !== "dm") {
      try {
        this.deps.logger.debug("Teams Graph API: GET channel info", {
          teamId: graphContext.teamId,
          channelId: graphContext.channelId,
        });

        const response = await this.deps.graph.call(teams.channels.get, {
          "team-id": graphContext.teamId,
          "channel-id": graphContext.channelId,
        });

        return {
          id: channelId,
          name: response.displayName,
          isDM: false,
          memberCount: (response as { memberCount?: number }).memberCount,
          metadata: {
            membershipType: response.membershipType,
            description: response.description,
            raw: response,
          },
        };
      } catch (error) {
        this.deps.logger.warn("Teams Graph API: channel info failed", {
          error,
        });
      }
    }

    return {
      id: channelId,
      isDM: isDM(channelId),
      metadata: {
        conversationId: baseConversationId,
      },
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: conversationId,
      metadata: {},
    };
  }

  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<unknown>> {
    const { conversationId, conversationType, serviceUrl } =
      decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );
    const limit = options.limit || 50;

    try {
      const graphContext = await this.getGraphContext(
        baseConversationId,
        conversationType
      );

      this.deps.logger.debug("Teams Graph API: listThreads", {
        conversationId: baseConversationId,
        contextType: graphContext?.type ?? "none",
        limit,
      });

      const threads: ThreadSummary[] = [];
      let nextCursor: string | undefined;

      if (graphContext && graphContext.type !== "dm") {
        let response: GraphMessagePage = options.cursor
          ? await this.fetchChannelRootContinuation(
              options.cursor,
              graphContext
            )
          : await this.deps.graph.call(teams.channels.messages.list, {
              "team-id": graphContext.teamId,
              "channel-id": graphContext.channelId,
              $top: Math.min(limit, 50),
            });
        while (
          !(response.value ?? []).some((msg) => !!msg.id) &&
          response["@odata.nextLink"]
        ) {
          response = await this.fetchChannelRootContinuation(
            response["@odata.nextLink"],
            graphContext
          );
        }
        nextCursor = response["@odata.nextLink"] ?? undefined;
        const messages = response.value || [];

        for (const msg of messages) {
          if (!msg.id) {
            continue;
          }
          const threadId = encodeThreadId({
            conversationId: `${baseConversationId};messageid=${msg.id}`,
            conversationType: "channel",
            serviceUrl,
          });

          const isFromBot =
            msg.from?.application?.id === this.deps.botId ||
            msg.from?.user?.id === this.deps.botId;

          threads.push({
            id: threadId,
            rootMessage: new Message({
              id: msg.id as string,
              threadId,
              text: this.extractTextFromGraphMessage(msg),
              formatted: this.deps.formatConverter.toAst(
                this.extractTextFromGraphMessage(msg)
              ),
              raw: msg,
              author: {
                userId:
                  msg.from?.user?.id || msg.from?.application?.id || "unknown",
                userName:
                  msg.from?.user?.displayName ||
                  msg.from?.application?.displayName ||
                  "unknown",
                fullName:
                  msg.from?.user?.displayName ||
                  msg.from?.application?.displayName ||
                  "unknown",
                isBot: !!msg.from?.application,
                isMe: isFromBot,
              },
              metadata: {
                dateSent: msg.createdDateTime
                  ? new Date(msg.createdDateTime)
                  : new Date(),
                edited: !!msg.lastEditedDateTime,
              },
              attachments: this.extractAttachmentsFromGraphMessage(msg),
            }),
            lastReplyAt: msg.lastModifiedDateTime
              ? new Date(msg.lastModifiedDateTime)
              : undefined,
          });
        }
      } else {
        const chatId = this.chatIdFromContext(graphContext, baseConversationId);
        const response = await this.deps.graph.call(chats.messages.list, {
          "chat-id": chatId,
          $top: limit,
          $orderby: ["createdDateTime desc"],
        });
        const messages = response.value || [];
        const threadConversationType =
          conversationType ??
          (graphContext?.type === "dm" ? "personal" : undefined);

        for (const msg of messages) {
          if (!msg.id) {
            continue;
          }
          const threadId = encodeThreadId({
            conversationId: `${baseConversationId};messageid=${msg.id}`,
            conversationType: threadConversationType,
            serviceUrl,
          });

          const isFromBot =
            msg.from?.application?.id === this.deps.botId ||
            msg.from?.user?.id === this.deps.botId;

          threads.push({
            id: threadId,
            rootMessage: new Message({
              id: msg.id as string,
              threadId,
              text: this.extractTextFromGraphMessage(msg),
              formatted: this.deps.formatConverter.toAst(
                this.extractTextFromGraphMessage(msg)
              ),
              raw: msg,
              author: {
                userId:
                  msg.from?.user?.id || msg.from?.application?.id || "unknown",
                userName:
                  msg.from?.user?.displayName ||
                  msg.from?.application?.displayName ||
                  "unknown",
                fullName:
                  msg.from?.user?.displayName ||
                  msg.from?.application?.displayName ||
                  "unknown",
                isBot: !!msg.from?.application,
                isMe: isFromBot,
              },
              metadata: {
                dateSent: msg.createdDateTime
                  ? new Date(msg.createdDateTime)
                  : new Date(),
                edited: !!msg.lastEditedDateTime,
              },
              attachments: this.extractAttachmentsFromGraphMessage(msg),
            }),
          });
        }
      }

      this.deps.logger.debug("Teams Graph API: listThreads result", {
        threadCount: threads.length,
      });

      return { threads, nextCursor };
    } catch (error) {
      this.deps.logger.error("Teams Graph API: listThreads error", { error });
      throw error;
    }
  }

  private async fetchChannelThreadMessages(
    context: TeamsChannelContext,
    threadMessageId: string,
    threadId: string,
    options: FetchOptions
  ): Promise<FetchResult<unknown>> {
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    this.deps.logger.debug(
      "Teams Graph API: fetching channel thread messages",
      {
        teamId: context.teamId,
        channelId: context.channelId,
        threadMessageId,
        limit,
        cursor,
        direction,
      }
    );

    const channelMsgParams = {
      "team-id": context.teamId,
      "channel-id": context.channelId,
      "chatMessage-id": threadMessageId,
    };

    let parentMessage: GraphMessage | null = null;
    try {
      parentMessage = await this.deps.graph.call(
        teams.channels.messages.get,
        channelMsgParams
      );
    } catch (err) {
      this.deps.logger.warn("Failed to fetch parent message", {
        threadMessageId,
        err,
      });
    }

    const allReplies = await this.fetchAllChannelReplies(channelMsgParams);
    const allMessages = parentMessage
      ? [parentMessage, ...allReplies]
      : allReplies;
    return this.pageChannelMessages(allMessages, threadId, options);
  }

  private channelMessagePosition(msg: GraphMessage): {
    timestamp: number;
    id: string;
  } {
    return {
      timestamp: Date.parse(msg.createdDateTime ?? "") || 0,
      id: msg.id ?? "",
    };
  }

  private compareChannelMessagePositions(
    left: { timestamp: number; id: string },
    right: { timestamp: number; id?: string }
  ): number {
    const timestampDifference = left.timestamp - right.timestamp;
    if (timestampDifference || right.id === undefined) {
      return timestampDifference;
    }
    if (left.id === right.id) {
      return 0;
    }
    return left.id < right.id ? -1 : 1;
  }

  private parseChannelHistoryCursor(cursor: string): {
    timestamp: number;
    id?: string;
  } {
    if (!cursor.startsWith("teams-channel-history:")) {
      const timestamp = Date.parse(cursor);
      if (Number.isFinite(timestamp)) {
        return { timestamp };
      }
      throw new ValidationError("teams", "Invalid channel history cursor");
    }
    try {
      const value: unknown = JSON.parse(
        Buffer.from(
          cursor.slice("teams-channel-history:".length),
          "base64url"
        ).toString("utf8")
      );
      if (
        typeof value === "object" &&
        value !== null &&
        "timestamp" in value &&
        typeof value.timestamp === "number" &&
        Number.isFinite(value.timestamp) &&
        "id" in value &&
        typeof value.id === "string" &&
        value.id.length > 0
      ) {
        return { timestamp: value.timestamp, id: value.id };
      }
    } catch {
      // Fall through to the adapter's cursor error.
    }
    throw new ValidationError("teams", "Invalid channel history cursor");
  }

  private pageChannelMessages(
    graphMessages: GraphMessage[],
    channelId: string,
    options: FetchOptions
  ): FetchResult<unknown> {
    const direction = options.direction ?? "backward";
    const limit = options.limit || 50;
    const boundary = options.cursor
      ? this.parseChannelHistoryCursor(options.cursor)
      : undefined;
    const sorted = graphMessages
      .filter((msg) => !!msg.id)
      .sort((left, right) =>
        this.compareChannelMessagePositions(
          this.channelMessagePosition(left),
          this.channelMessagePosition(right)
        )
      );
    const remaining = boundary
      ? sorted.filter((msg) => {
          const comparison = this.compareChannelMessagePositions(
            this.channelMessagePosition(msg),
            boundary
          );
          return direction === "forward" ? comparison > 0 : comparison < 0;
        })
      : sorted;
    const page =
      direction === "forward"
        ? remaining.slice(0, limit)
        : remaining.slice(-limit);
    const edge = direction === "forward" ? page.at(-1) : page[0];
    const nextCursor =
      remaining.length > limit && edge
        ? `teams-channel-history:${Buffer.from(JSON.stringify(this.channelMessagePosition(edge))).toString("base64url")}`
        : undefined;
    return { messages: this.mapGraphMessages(page, channelId), nextCursor };
  }

  private async fetchAllChannelRoots(
    context: TeamsChannelContext
  ): Promise<GraphMessage[]> {
    let page: GraphMessagePage = await this.deps.graph.call(
      teams.channels.messages.list,
      {
        "team-id": context.teamId,
        "channel-id": context.channelId,
        $top: 50,
      }
    );
    const messages = [...(page.value ?? [])];
    while (page["@odata.nextLink"]) {
      page = await this.fetchChannelRootContinuation(
        page["@odata.nextLink"],
        context
      );
      messages.push(...(page.value ?? []));
    }
    return messages;
  }

  private async fetchChannelRootContinuation(
    cursor: string,
    context: TeamsChannelContext
  ): Promise<GraphMessagePage> {
    const url = new URL(cursor);
    const expectedPath = `/v1.0/teams/${context.teamId}/channels/${context.channelId}/messages`;
    if (
      url.protocol !== "https:" ||
      !TRUSTED_GRAPH_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port ||
      decodeURIComponent(url.pathname) !== expectedPath
    ) {
      throw new ValidationError(
        "teams",
        "Invalid channel thread continuation cursor"
      );
    }
    return this.graphGetNextLink<GraphMessagePage>(cursor);
  }

  /**
   * Fetch all replies for a channel message, following pagination.
   */
  private async fetchAllChannelReplies(params: {
    "team-id": string;
    "channel-id": string;
    "chatMessage-id": string;
  }): Promise<GraphMessage[]> {
    const allReplies: GraphMessage[] = [];

    const firstPage = await this.deps.graph.call(
      teams.channels.messages.replies.list,
      { ...params, $top: 50 }
    );
    allReplies.push(...(firstPage.value || []));

    let nextLink = firstPage["@odata.nextLink"] ?? undefined;
    while (nextLink) {
      const page = await this.graphGetNextLink<typeof firstPage>(nextLink);
      allReplies.push(...(page.value || []));
      nextLink = page["@odata.nextLink"] ?? undefined;
    }

    return allReplies;
  }

  /**
   * Follow a Graph API @odata.nextLink URL for pagination.
   * Uses the graph client's HTTP client directly to avoid URL re-encoding issues.
   */
  private async graphGetNextLink<T>(nextLinkUrl: string): Promise<T> {
    const res = await this.deps.graph.http.get<T>(nextLinkUrl);
    return res.data;
  }

  extractTextFromGraphMessage(msg: GraphMessage): string {
    if (msg.body?.contentType === "text") {
      return msg.body.content || "";
    }

    let text = "";
    if (msg.body?.content) {
      let stripped = "";
      let inTag = false;
      for (const ch of msg.body.content) {
        if (ch === "<") {
          inTag = true;
        } else if (ch === ">") {
          inTag = false;
        } else if (!inTag) {
          stripped += ch;
        }
      }
      text = stripped.trim();
    }

    if (!text && msg.attachments?.length) {
      for (const att of msg.attachments) {
        if (att.contentType === "application/vnd.microsoft.card.adaptive") {
          try {
            const card = JSON.parse(att.content || "{}");
            const title = this.extractCardTitle(card);
            if (title) {
              return title;
            }
            return "[Card]";
          } catch {
            return "[Card]";
          }
        }
      }
    }

    return text;
  }

  extractCardTitle(card: unknown): string | null {
    if (!card || typeof card !== "object") {
      return null;
    }

    const cardObj = card as Record<string, unknown>;

    if (Array.isArray(cardObj.body)) {
      for (const element of cardObj.body) {
        if (
          element &&
          typeof element === "object" &&
          (element as Record<string, unknown>).type === "TextBlock"
        ) {
          const textBlock = element as Record<string, unknown>;
          if (
            textBlock.weight === "bolder" ||
            textBlock.size === "large" ||
            textBlock.size === "extraLarge"
          ) {
            const text = textBlock.text;
            if (typeof text === "string") {
              return text;
            }
          }
        }
      }
      for (const element of cardObj.body) {
        if (
          element &&
          typeof element === "object" &&
          (element as Record<string, unknown>).type === "TextBlock"
        ) {
          const text = (element as Record<string, unknown>).text;
          if (typeof text === "string") {
            return text;
          }
        }
      }
    }

    return null;
  }

  private extractAttachmentsFromGraphMessage(msg: GraphMessage): Attachment[] {
    if (!msg.attachments?.length) {
      return [];
    }

    return msg.attachments.map(
      (att: {
        contentType?: string | null;
        contentUrl?: string | null;
        name?: string | null;
      }) => ({
        type: att.contentType?.includes("image") ? "image" : "file",
        name: att.name ?? undefined,
        url: att.contentUrl ?? undefined,
        mimeType: att.contentType ?? undefined,
      })
    );
  }

  private mapGraphMessages(
    graphMessages: GraphMessage[],
    threadId: string
  ): Message<unknown>[] {
    return graphMessages
      .filter((msg) => msg.id)
      .map((msg) => {
        const isFromBot =
          msg.from?.application?.id === this.deps.botId ||
          msg.from?.user?.id === this.deps.botId;

        return new Message({
          id: msg.id as string,
          threadId,
          text: this.extractTextFromGraphMessage(msg),
          formatted: this.deps.formatConverter.toAst(
            this.extractTextFromGraphMessage(msg)
          ),
          raw: msg,
          author: {
            userId:
              msg.from?.user?.id || msg.from?.application?.id || "unknown",
            userName:
              msg.from?.user?.displayName ||
              msg.from?.application?.displayName ||
              "unknown",
            fullName:
              msg.from?.user?.displayName ||
              msg.from?.application?.displayName ||
              "unknown",
            isBot: !!msg.from?.application,
            isMe: isFromBot,
          },
          metadata: {
            dateSent: msg.createdDateTime
              ? new Date(msg.createdDateTime)
              : new Date(),
            edited: !!msg.lastEditedDateTime,
          },
          attachments: this.extractAttachmentsFromGraphMessage(msg),
        });
      });
  }
}
