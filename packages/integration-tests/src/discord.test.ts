import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger } from "chat";
import { InteractionType } from "discord-api-types/v10";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDiscordButtonRequest,
  createDiscordInteraction,
  createDiscordPingRequest,
  createDiscordWebhookRequest,
  createMockDiscordApi,
  DISCORD_APPLICATION_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_USERNAME,
  DISCORD_PUBLIC_KEY,
  getDiscordThreadId,
  type MockDiscordApi,
  restoreDiscordFetchMock,
  setupDiscordFetchMock,
} from "./discord-utils";
import { createWaitUntilTracker } from "./test-scenarios";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

describe("Discord Integration", () => {
  let chat: Chat<{ discord: DiscordAdapter }>;
  let state: ReturnType<typeof createMemoryState>;
  let discordAdapter: DiscordAdapter;
  let mockApi: MockDiscordApi;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

  const TEST_GUILD = "GUILD123";
  const TEST_CHANNEL = "CHANNEL456";
  const TEST_THREAD_ID = getDiscordThreadId(TEST_GUILD, TEST_CHANNEL);

  beforeEach(() => {
    vi.clearAllMocks();

    state = createMemoryState();
    discordAdapter = createDiscordAdapter({
      botToken: DISCORD_BOT_TOKEN,
      publicKey: DISCORD_PUBLIC_KEY,
      applicationId: DISCORD_APPLICATION_ID,
      userName: DISCORD_BOT_USERNAME,
      logger: mockLogger,
    });

    mockApi = createMockDiscordApi();
    setupDiscordFetchMock(mockApi);

    chat = new Chat({
      userName: DISCORD_BOT_USERNAME,
      adapters: { discord: discordAdapter },
      state,
      logger: "error",
    });

    tracker = createWaitUntilTracker();
  });

  afterEach(async () => {
    await chat.shutdown();
    restoreDiscordFetchMock();
  });

  describe("PING verification", () => {
    it("should respond to Discord PING with PONG", async () => {
      const request = createDiscordPingRequest();

      const response = await chat.webhooks.discord(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(1); // PONG
    });
  });

  describe("signature verification", () => {
    it("should reject requests with missing signature headers", async () => {
      const request = new Request("https://example.com/webhook/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: 1 }),
      });

      const response = await chat.webhooks.discord(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with invalid signature", async () => {
      const body = JSON.stringify({ type: 1 });
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const request = new Request("https://example.com/webhook/discord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature-ed25519": "invalid_signature_hex",
          "x-signature-timestamp": timestamp,
        },
        body,
      });

      const response = await chat.webhooks.discord(request);
      expect(response.status).toBe(401);
    });
  });

  describe("action handling", () => {
    it("should handle MESSAGE_COMPONENT interactions (button clicks)", async () => {
      const handlerMock = vi.fn();
      chat.onAction("approve", async (event) => {
        handlerMock(event.actionId, event.user.userId);
        await event.thread.post("Action received!");
      });

      const request = createDiscordButtonRequest({
        customId: "approve",
        userId: "USER789",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
        messageId: "msg_123",
      });

      const response = await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      expect(response.status).toBe(200);

      // Response should be deferred update
      const body = await response.json();
      expect(body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE

      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith("approve", "USER789");
      expect(mockApi.messages.create).toHaveBeenCalled();
    });

    it("should not call handler for non-matching action IDs", async () => {
      const handlerMock = vi.fn();
      chat.onAction("approve", () => {
        handlerMock();
      });

      const request = createDiscordButtonRequest({
        customId: "reject",
        userId: "USER789",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).not.toHaveBeenCalled();
    });

    it("should call catch-all action handler", async () => {
      const handlerMock = vi.fn();
      chat.onAction((event) => {
        handlerMock(event.actionId);
      });

      const request = createDiscordButtonRequest({
        customId: "any-action",
        userId: "USER789",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith("any-action");
    });
  });

  describe("APPLICATION_COMMAND interactions", () => {
    it("should respond with deferred message for slash commands", async () => {
      const payload = createDiscordInteraction({
        type: InteractionType.ApplicationCommand,
        commandName: "help",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      const request = createDiscordWebhookRequest(payload);
      const response = await chat.webhooks.discord(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(5); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    });
  });

  describe("unknown interaction types", () => {
    it("should return 400 for unknown interaction types", async () => {
      const payload = {
        id: "test_123",
        type: 999, // Unknown type
        application_id: DISCORD_APPLICATION_ID,
        token: "token_123",
        version: 1,
      };

      const request = createDiscordWebhookRequest(payload);
      const response = await chat.webhooks.discord(request);

      expect(response.status).toBe(400);
    });
  });

  describe("message posting", () => {
    it("should post messages to Discord channels", async () => {
      chat.onAction("test", async (event) => {
        await event.thread.post("Hello Discord!");
      });

      const request = createDiscordButtonRequest({
        customId: "test",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Hello Discord!",
        })
      );
    });

    it("should edit messages", async () => {
      chat.onAction("edit", async (event) => {
        const msg = await event.thread.post("Original message");
        await msg.edit("Edited message");
      });

      const request = createDiscordButtonRequest({
        customId: "edit",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockApi.messages.create).toHaveBeenCalled();
      expect(mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Edited message",
        })
      );
    });

    it("should add reactions to messages", async () => {
      chat.onAction("react", async (event) => {
        const msg = await event.thread.post("React to this!");
        await msg.addReaction("thumbsup");
      });

      const request = createDiscordButtonRequest({
        customId: "react",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockApi.reactions.add).toHaveBeenCalled();
    });
  });

  describe("markdown formatting", () => {
    it("should convert markdown to Discord format in posted messages", async () => {
      chat.onAction("markdown", async (event) => {
        await event.thread.post({
          markdown: "**Bold** and *italic* and `code`",
        });
      });

      const request = createDiscordButtonRequest({
        customId: "markdown",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("**Bold**"),
        })
      );
    });

    it("should convert @mentions to Discord format in posted messages", async () => {
      chat.onAction("mention", async (event) => {
        await event.thread.post("Hey @john, check this out!");
      });

      const request = createDiscordButtonRequest({
        customId: "mention",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // @mentions should be converted to Discord's <@mention> format
      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Hey <@john>, check this out!",
        })
      );
    });
  });

  describe("thread operations", () => {
    it("should handle typing indicator", async () => {
      chat.onAction("typing", async (event) => {
        await event.thread.startTyping();
        await event.thread.post("Done typing!");
      });

      const request = createDiscordButtonRequest({
        customId: "typing",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockApi.channels.typing).toHaveBeenCalled();
      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Done typing!" })
      );
    });

    it("should include thread info in action events", async () => {
      let capturedEvent: unknown;
      chat.onAction("info", (event) => {
        capturedEvent = {
          actionId: event.actionId,
          threadId: event.threadId,
          userId: event.user.userId,
          userName: event.user.userName,
        };
      });

      const request = createDiscordButtonRequest({
        customId: "info",
        userId: "USER789",
        userName: "testuser",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedEvent).toBeDefined();
      const event = capturedEvent as {
        actionId: string;
        threadId: string;
        userId: string;
        userName: string;
      };
      expect(event.actionId).toBe("info");
      expect(event.threadId).toBe(TEST_THREAD_ID);
      expect(event.userId).toBe("USER789");
      expect(event.userName).toBe("testuser");
    });
  });

  describe("DM interactions", () => {
    it("should handle button clicks in DMs", async () => {
      const handlerMock = vi.fn();
      chat.onAction("dm-action", async (event) => {
        handlerMock(event.threadId);
        await event.thread.post("DM response!");
      });

      const request = createDiscordButtonRequest({
        customId: "dm-action",
        userId: "USER789",
        guildId: "@me", // DM
        channelId: "DM_CHANNEL_123",
      });

      await chat.webhooks.discord(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith("discord:@me:DM_CHANNEL_123");
      expect(mockApi.messages.create).toHaveBeenCalled();
    });
  });

  describe("multi-action conversation flow", () => {
    it("should handle multiple actions in sequence", async () => {
      const actionLog: string[] = [];

      chat.onAction("step1", async (event) => {
        actionLog.push("step1");
        await event.thread.post("Step 1 complete");
      });

      chat.onAction("step2", async (event) => {
        actionLog.push("step2");
        await event.thread.post("Step 2 complete");
      });

      chat.onAction("step3", async (event) => {
        actionLog.push("step3");
        const msg = await event.thread.post("All steps complete!");
        await msg.addReaction("checkmark");
      });

      // Action 1
      const request1 = createDiscordButtonRequest({
        customId: "step1",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request1, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(actionLog).toContain("step1");
      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Step 1 complete" })
      );

      mockApi.clearMocks();

      // Action 2
      const request2 = createDiscordButtonRequest({
        customId: "step2",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request2, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(actionLog).toContain("step2");
      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Step 2 complete" })
      );

      mockApi.clearMocks();

      // Action 3
      const request3 = createDiscordButtonRequest({
        customId: "step3",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(request3, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(actionLog).toContain("step3");
      expect(mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ content: "All steps complete!" })
      );
      expect(mockApi.reactions.add).toHaveBeenCalled();
    });

    it("should handle actions from different users independently", async () => {
      const userActions: Record<string, string[]> = {};

      chat.onAction(async (event) => {
        const userId = event.user.userId;
        if (!userActions[userId]) {
          userActions[userId] = [];
        }
        userActions[userId].push(event.actionId);
        await event.thread.post(`${userId}: ${event.actionId}`);
      });

      // User A clicks button
      const requestA = createDiscordButtonRequest({
        customId: "action-a",
        userId: "USER_A",
        userName: "user_a",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(requestA, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // User B clicks button
      const requestB = createDiscordButtonRequest({
        customId: "action-b",
        userId: "USER_B",
        userName: "user_b",
        guildId: TEST_GUILD,
        channelId: TEST_CHANNEL,
      });

      await chat.webhooks.discord(requestB, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(userActions.USER_A).toEqual(["action-a"]);
      expect(userActions.USER_B).toEqual(["action-b"]);
    });
  });

  describe("error handling", () => {
    it("should return 401 for invalid signature before checking JSON", async () => {
      const body = "not valid json";
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Create a request with invalid JSON body - signature check happens first
      const request = new Request("https://example.com/webhook/discord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature-ed25519": "0".repeat(128),
          "x-signature-timestamp": timestamp,
        },
        body,
      });

      const response = await chat.webhooks.discord(request);
      // Should fail at signature verification first
      expect(response.status).toBe(401);
    });
  });
});
