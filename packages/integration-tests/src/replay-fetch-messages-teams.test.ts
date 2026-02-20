/**
 * Replay tests for Teams fetchMessages functionality.
 *
 * These tests use actual recorded API responses to verify message fetching
 * works correctly. Messages are numbered 1-13 to verify correct chronological ordering.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { ThreadImpl } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEAMS_BOT_APP_ID,
  TEAMS_CHANNEL_ID,
  TEAMS_HUMAN_USER_ID,
  TEAMS_PARENT_MESSAGE,
  TEAMS_PARENT_MESSAGE_ID,
  TEAMS_RAW_MESSAGES,
  TEAMS_SERVICE_URL,
  TEAMS_TEAM_ID,
} from "./fixtures/replay/fetch-messages";
import {
  createTeamsTestContext,
  type TeamsTestContext,
} from "./replay-test-utils";
import {
  createMockGraphClient,
  injectMockGraphClient,
  type MockGraphClient,
} from "./teams-utils";

describe("fetchMessages Replay Tests - Teams", () => {
  let ctx: TeamsTestContext;
  let mockGraphClient: MockGraphClient;

  // Build Teams thread ID in the expected format
  const conversationId = `${TEAMS_CHANNEL_ID};messageid=${TEAMS_PARENT_MESSAGE_ID}`;
  const encodedConversationId =
    Buffer.from(conversationId).toString("base64url");
  const encodedServiceUrl =
    Buffer.from(TEAMS_SERVICE_URL).toString("base64url");
  const TEAMS_THREAD_ID = `teams:${encodedConversationId}:${encodedServiceUrl}`;

  beforeEach(async () => {
    vi.clearAllMocks();

    ctx = createTeamsTestContext(
      { botName: "Chat SDK Demo", appId: TEAMS_BOT_APP_ID },
      {},
    );

    mockGraphClient = createMockGraphClient();
    injectMockGraphClient(ctx.adapter, mockGraphClient);

    // Connect the state adapter before using it
    await ctx.chat.getState().connect();

    // Initialize the adapter so it has access to the chat instance
    // (required for channel context lookup in fetchMessages)
    await ctx.adapter.initialize(ctx.chat);

    // Set up channel context in state so fetchMessages can find team/channel info
    const channelContext = {
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
      tenantId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };
    await ctx.chat
      .getState()
      .set(
        `teams:channelContext:${TEAMS_CHANNEL_ID}`,
        JSON.stringify(channelContext),
      );

    // Mock Graph API to return actual recorded messages
    // First response: parent message (single object, not paginated)
    // Second response: replies (Graph API returns newest first, so we reverse)
    mockGraphClient.setResponses([
      TEAMS_PARENT_MESSAGE as unknown as Record<string, unknown>,
      { value: [...(TEAMS_RAW_MESSAGES as unknown[])].reverse() },
    ]);
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should call Graph API with correct endpoints for parent and replies", async () => {
    await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 25,
      direction: "backward",
    });

    // Verify TWO API calls were made: one for parent, one for replies
    expect(mockGraphClient.apiCalls.length).toBe(2);

    // First call: fetch parent message
    expect(mockGraphClient.apiCalls[0].url).toContain("/teams/");
    expect(mockGraphClient.apiCalls[0].url).toContain("/channels/");
    expect(mockGraphClient.apiCalls[0].url).toContain(
      `/messages/${TEAMS_PARENT_MESSAGE_ID}`,
    );
    // Should NOT end with /replies (that's the second call)
    expect(mockGraphClient.apiCalls[0].url).not.toMatch(/\/replies$/);

    // Second call: fetch replies
    expect(mockGraphClient.apiCalls[1].url).toContain("/teams/");
    expect(mockGraphClient.apiCalls[1].url).toContain("/channels/");
    expect(mockGraphClient.apiCalls[1].url).toMatch(/\/replies$/);
  });

  it("should return all messages in chronological order", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
      direction: "backward",
    });

    // Should have all 21 messages: 1 parent + 20 replies
    expect(result.messages).toHaveLength(21);

    // First message should be the parent (the @mention that started the thread)
    expect(result.messages[0].text).toContain("Hey");
    expect(result.messages[0].author.isBot).toBe(false);

    // Extract just the numbered messages (filter out bot card messages)
    // Note: Recording has numbers 1-13 (no "14" in this recording)
    const expectedNumbers = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
    ];
    const numberedMessages = result.messages.filter(
      (m) => !m.author.isBot && expectedNumbers.includes(m.text || ""),
    );

    // Should have exactly 13 numbered messages (1-13)
    expect(numberedMessages).toHaveLength(13);

    // Verify they are in correct chronological order
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(expectedNumbers);
  });

  it("should return messages in chronological order with forward direction", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
      direction: "forward",
    });

    // Should have all 21 messages: 1 parent + 20 replies
    expect(result.messages).toHaveLength(21);

    // First message should be the parent (forward = oldest first)
    expect(result.messages[0].text).toContain("Hey");
    expect(result.messages[0].author.isBot).toBe(false);

    // Extract numbered messages and verify order
    const expectedNumbers = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
    ];
    const numberedMessages = result.messages.filter(
      (m) => !m.author.isBot && expectedNumbers.includes(m.text || ""),
    );
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(expectedNumbers);
  });

  it("should correctly identify bot vs human messages", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
    });

    const botMessages = result.messages.filter((m) => m.author.isBot);
    const humanMessages = result.messages.filter((m) => !m.author.isBot);

    // 6 bot messages (2 welcome/fetch cards, 4 "Thanks")
    expect(botMessages).toHaveLength(6);
    // 15 human messages (parent "Hey" + numbered 1-13 + "Proper text")
    expect(humanMessages).toHaveLength(15);

    // All bot messages should have isMe: true
    for (const msg of botMessages) {
      expect(msg.author.isMe).toBe(true);
      expect(msg.author.userId).toBe(TEAMS_BOT_APP_ID);
    }

    // All human messages should have isMe: false
    for (const msg of humanMessages) {
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.userId).toBe(TEAMS_HUMAN_USER_ID);
    }
  });

  it("should have author.userName for ALL messages (BUG CHECK)", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
    });

    // Every message MUST have a non-empty author.userName
    for (const msg of result.messages) {
      expect(msg.author.userName).toBeTruthy();
      expect(msg.author.userName).not.toBe("");
      expect(msg.author.userName).not.toBe("unknown");
    }

    // Human messages should have "Test User" as userName
    const humanMessages = result.messages.filter((m) => !m.author.isBot);
    for (const msg of humanMessages) {
      expect(msg.author.userName).toBe("Test User");
    }

    // Bot messages should have "Chat SDK Demo" as userName
    const botMessages = result.messages.filter((m) => m.author.isBot);
    for (const msg of botMessages) {
      expect(msg.author.userName).toBe("Chat SDK Demo");
    }
  });

  it("should have non-empty text for human messages (BUG CHECK)", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
    });

    // Human messages should have non-empty text (numbered 1-13)
    const humanMessages = result.messages.filter((m) => !m.author.isBot);
    for (const msg of humanMessages) {
      expect(msg.text).toBeTruthy();
      expect(msg.text).not.toBe("");
    }
  });

  it("should handle adaptive card messages", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
    });

    // Find messages that have adaptive card attachments
    const cardMessages = result.messages.filter((m) => {
      const raw = m.raw as {
        attachments?: Array<{ contentType?: string }>;
      };
      return raw.attachments?.some(
        (a) => a.contentType === "application/vnd.microsoft.card.adaptive",
      );
    });

    // Should have 2 card messages in this recording (Welcome and Message Fetch Results)
    expect(cardMessages).toHaveLength(2);

    // All should be from the bot
    for (const msg of cardMessages) {
      expect(msg.author.isBot).toBe(true);
      expect(msg.author.isMe).toBe(true);
    }
  });

  it("should extract card titles for bot messages (BUG CHECK)", async () => {
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 100,
    });

    // Find the Welcome card message (first bot message with card)
    const cardMessages = result.messages.filter((m) => {
      const raw = m.raw as {
        attachments?: Array<{ contentType?: string; content?: string }>;
      };
      return raw.attachments?.some(
        (a) =>
          a.contentType === "application/vnd.microsoft.card.adaptive" &&
          a.content?.includes("Welcome"),
      );
    });

    expect(cardMessages.length).toBeGreaterThan(0);

    // The bug: card messages should have text extracted from the card title
    // Before fix: text would be empty string ""
    // After fix: text should be "👋 Welcome!" or similar
    const welcomeCard = cardMessages[0];
    expect(welcomeCard.text).not.toBe("");
    expect(welcomeCard.text).toContain("Welcome");
  });

  it("should respect limit parameter with backward direction", async () => {
    // For backward direction, we're getting the last N messages
    const result = await ctx.adapter.fetchMessages(TEAMS_THREAD_ID, {
      limit: 5,
      direction: "backward",
    });

    // Backward gets last 5 from 19 messages
    expect(result.messages).toHaveLength(5);
  });
});

describe("allMessages Replay Tests - Teams", () => {
  let ctx: TeamsTestContext;
  let mockGraphClient: MockGraphClient;

  // Build Teams thread ID in the expected format
  const conversationId = `${TEAMS_CHANNEL_ID};messageid=${TEAMS_PARENT_MESSAGE_ID}`;
  const encodedConversationId =
    Buffer.from(conversationId).toString("base64url");
  const encodedServiceUrl =
    Buffer.from(TEAMS_SERVICE_URL).toString("base64url");
  const TEAMS_THREAD_ID = `teams:${encodedConversationId}:${encodedServiceUrl}`;

  beforeEach(async () => {
    vi.clearAllMocks();

    ctx = createTeamsTestContext(
      { botName: "Chat SDK Demo", appId: TEAMS_BOT_APP_ID },
      {},
    );

    mockGraphClient = createMockGraphClient();
    injectMockGraphClient(ctx.adapter, mockGraphClient);

    // Connect the state adapter before using it
    await ctx.chat.getState().connect();

    // Initialize the adapter so it has access to the chat instance
    // (required for channel context lookup in fetchMessages)
    await ctx.adapter.initialize(ctx.chat);

    // Set up channel context in state
    const channelContext = {
      teamId: TEAMS_TEAM_ID,
      channelId: TEAMS_CHANNEL_ID,
      tenantId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };
    await ctx.chat
      .getState()
      .set(
        `teams:channelContext:${TEAMS_CHANNEL_ID}`,
        JSON.stringify(channelContext),
      );

    // Mock Graph API to return actual recorded messages
    // First response: parent message (single object, not paginated)
    // Second response: replies (Graph API returns newest first, so we reverse)
    mockGraphClient.setResponses([
      TEAMS_PARENT_MESSAGE as unknown as Record<string, unknown>,
      { value: [...(TEAMS_RAW_MESSAGES as unknown[])].reverse() },
    ]);
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should iterate all messages in chronological order via thread.allMessages", async () => {
    const stateAdapter = createMemoryState();
    const thread = new ThreadImpl({
      id: TEAMS_THREAD_ID,
      adapter: ctx.adapter,
      channelId: TEAMS_CHANNEL_ID,
      stateAdapter,
    });

    // Collect all messages from the async iterator
    const messages = [];
    for await (const msg of thread.allMessages) {
      messages.push(msg);
    }

    // Should have all 21 messages: 1 parent + 20 replies
    expect(messages).toHaveLength(21);

    // First message should be the parent (the @mention that started the thread)
    expect(messages[0].text).toContain("Hey");
    expect(messages[0].author.isBot).toBe(false);

    // Extract numbered messages and verify chronological order (1-13 in this recording)
    const expectedNumbers = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
    ];
    const numberedMessages = messages.filter((m) =>
      expectedNumbers.includes(m.text || ""),
    );
    expect(numberedMessages).toHaveLength(13);

    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(expectedNumbers);
  });
});
