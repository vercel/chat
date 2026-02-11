/**
 * Replay tests for DM (Direct Message) functionality.
 *
 * These tests verify that the Chat SDK handles DM flows correctly:
 * 1. User mentions bot in channel, bot subscribes
 * 2. User requests DM in subscribed thread
 * 3. Bot opens DM and sends message
 * 4. User sends message in DM
 *
 * Fixtures are loaded from JSON files in fixtures/replay/dm/
 */

import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { Chat, type Logger, type Message } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/dm/gchat.json";
import slackFixtures from "../fixtures/replay/dm/slack.json";
import teamsFixtures from "../fixtures/replay/dm/teams.json";
import {
  createMockGoogleChatApi,
  GCHAT_TEST_CREDENTIALS,
  injectMockGoogleChatApi,
  type MockGoogleChatApi,
} from "./gchat-utils";
import {
  createGchatRequest,
  createSignedSlackRequest,
  createTeamsRequest,
  createWaitUntilTracker,
} from "./replay-test-utils";
import {
  createMockSlackClient,
  injectMockSlackClient,
  type MockSlackClient,
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
} from "./slack-utils";
import {
  createMockBotAdapter,
  injectMockBotAdapter,
  type MockBotAdapter,
  TEAMS_APP_PASSWORD,
} from "./teams-utils";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

/**
 * DM flow state tracker for tests.
 */
interface DMFlowState {
  mentionMessage: Message | null;
  dmRequestMessage: Message | null;
  dmMessage: Message | null;
  openDMCalled: boolean;
  dmThreadId: string | null;
}

function createDMFlowState(): DMFlowState {
  return {
    mentionMessage: null,
    dmRequestMessage: null,
    dmMessage: null,
    openDMCalled: false,
    dmThreadId: null,
  };
}

describe("DM Replay Tests", () => {
  describe("Slack", () => {
    let chat: Chat<{ slack: SlackAdapter }>;
    let mockSlackClient: MockSlackClient;
    let tracker: ReturnType<typeof createWaitUntilTracker>;
    let state: DMFlowState;

    beforeEach(() => {
      vi.clearAllMocks();
      state = createDMFlowState();

      const slackAdapter = createSlackAdapter({
        botToken: SLACK_BOT_TOKEN,
        signingSecret: SLACK_SIGNING_SECRET,
        logger: mockLogger,
      });
      mockSlackClient = createMockSlackClient();
      mockSlackClient.auth.test.mockResolvedValue({
        ok: true,
        user_id: slackFixtures.botUserId,
        user: slackFixtures.botName,
      });
      mockSlackClient.conversations.open.mockResolvedValue({
        ok: true,
        channel: { id: slackFixtures.dmChannelId },
      });
      injectMockSlackClient(slackAdapter, mockSlackClient);

      chat = new Chat({
        userName: slackFixtures.botName,
        adapters: { slack: slackAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        state.mentionMessage = message;
        await thread.subscribe();
        await thread.post("Welcome!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        if (message.text.toLowerCase().includes("dm me")) {
          state.dmRequestMessage = message;
          try {
            const dmThread = await chat.openDM(message.author);
            state.openDMCalled = true;
            state.dmThreadId = dmThread.id;
            await dmThread.subscribe();
            await dmThread.post("Hello via DM!");
            await thread.post("I've sent you a DM!");
          } catch {
            await thread.post("Sorry, couldn't send DM");
          }
        } else if (thread.isDM) {
          state.dmMessage = message;
          await thread.post(`Got your DM: ${message.text}`);
        }
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    const sendWebhook = async (fixture: unknown) => {
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(fixture)),
        { waitUntil: tracker.waitUntil },
      );
      await tracker.waitForAll();
    };

    it("should handle DM request flow", async () => {
      // Step 1: Initial mention to subscribe
      await sendWebhook(slackFixtures.mention);

      expect(state.mentionMessage).not.toBeNull();
      expect(state.mentionMessage?.text).toContain("Hey");

      // Step 2: User requests DM in subscribed thread
      await sendWebhook(slackFixtures.dmRequest);

      expect(state.dmRequestMessage).not.toBeNull();
      expect(state.dmRequestMessage?.text).toBe("DM me");
      expect(state.openDMCalled).toBe(true);
      expect(state.dmThreadId).toContain("slack:");
      expect(state.dmThreadId).toContain(slackFixtures.dmChannelId);

      // Verify DM was opened
      expect(mockSlackClient.conversations.open).toHaveBeenCalledWith(
        expect.objectContaining({
          users: state.dmRequestMessage?.author.userId,
        }),
      );

      // Verify DM message was sent
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: slackFixtures.dmChannelId,
          text: expect.stringContaining("Hello via DM!"),
        }),
      );
    });

    it("should detect DM channel type from webhook", async () => {
      const dmEvent = slackFixtures.dmMessage;
      expect(dmEvent.event.channel_type).toBe("im");
    });

    it("should receive DM messages when subscribed to DM thread", async () => {
      // Create a DM message as the mention (user @mentions bot in DM)
      const dmMention = {
        ...slackFixtures.dmMessage,
        event: {
          ...slackFixtures.dmMessage.event,
          type: "app_mention" as const,
          text: `<@${slackFixtures.botUserId}> Hey!`,
        },
      };

      await sendWebhook(dmMention);

      expect(state.mentionMessage).not.toBeNull();
    });

    it("should receive user reply in DM when subscribed", async () => {
      // Step 1: Initial mention to subscribe
      await sendWebhook(slackFixtures.mention);
      expect(state.mentionMessage).not.toBeNull();

      // Step 2: User requests DM - bot opens DM and subscribes
      await sendWebhook(slackFixtures.dmRequest);
      expect(state.openDMCalled).toBe(true);
      expect(state.dmThreadId).not.toBeNull();

      // Step 3: User sends message in DM
      await sendWebhook(slackFixtures.dmMessage);

      // Verify the DM reply was captured
      expect(state.dmMessage).not.toBeNull();
      expect(state.dmMessage?.text).toBe("Hey!");

      // Verify the DM message is identified as im channel type
      expect(slackFixtures.dmMessage.event.channel_type).toBe("im");

      // Verify bot responded to the DM
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: slackFixtures.dmChannelId,
          text: expect.stringContaining("Got your DM: Hey!"),
        }),
      );
    });
  });

  describe("Google Chat", () => {
    let chat: Chat<{ gchat: GoogleChatAdapter }>;
    let gchatAdapter: GoogleChatAdapter;
    let mockChatApi: MockGoogleChatApi;
    let tracker: ReturnType<typeof createWaitUntilTracker>;
    let state: DMFlowState;

    beforeEach(() => {
      vi.clearAllMocks();
      state = createDMFlowState();

      gchatAdapter = createGoogleChatAdapter({
        credentials: GCHAT_TEST_CREDENTIALS,
        userName: gchatFixtures.botName,
        logger: mockLogger,
      });
      gchatAdapter.botUserId = gchatFixtures.botUserId;

      mockChatApi = createMockGoogleChatApi();
      mockChatApi.spaces.findDirectMessage.mockResolvedValue({
        data: { name: gchatFixtures.dmSpaceName },
      });
      injectMockGoogleChatApi(gchatAdapter, mockChatApi);

      chat = new Chat({
        userName: gchatFixtures.botName,
        adapters: { gchat: gchatAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        state.mentionMessage = message;
        await thread.subscribe();
        await thread.post("Welcome!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        if (message.text.toLowerCase().includes("dm me")) {
          state.dmRequestMessage = message;
          try {
            const dmThread = await chat.openDM(message.author);
            state.openDMCalled = true;
            await dmThread.subscribe();
            await dmThread.post("Hello via DM!");
            await thread.post("I've sent you a DM!");
          } catch {
            await thread.post("Sorry, couldn't send DM");
          }
        } else if (thread.isDM) {
          state.dmMessage = message;
          await thread.post(`Got your DM: ${message.text}`);
        }
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    const sendWebhook = async (fixture: unknown) => {
      await chat.webhooks.gchat(createGchatRequest(fixture), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    };

    it("should handle DM request flow", async () => {
      // Step 1: Initial mention to subscribe
      await sendWebhook(gchatFixtures.mention);

      expect(state.mentionMessage).not.toBeNull();
      expect(state.mentionMessage?.text).toContain("hey");

      // Step 2: User requests DM via Pub/Sub
      await sendWebhook(gchatFixtures.dmRequest);

      expect(state.dmRequestMessage).not.toBeNull();
      expect(state.dmRequestMessage?.text).toBe("DM me");
      expect(state.openDMCalled).toBe(true);

      // Verify findDirectMessage was called
      expect(mockChatApi.spaces.findDirectMessage).toHaveBeenCalledWith({
        name: state.dmRequestMessage?.author.userId,
      });
    });

    it("should detect DM space type from webhook", async () => {
      const dmPayload = gchatFixtures.dmMessage.chat.messagePayload;
      expect(dmPayload.space.type).toBe("DM");
      expect(dmPayload.space.spaceType).toBe("DIRECT_MESSAGE");
    });

    it("should correctly identify sender in DM space", async () => {
      const sender = gchatFixtures.dmMessage.chat.messagePayload.message.sender;
      expect(sender.name).toBe("users/117994873354375860089");
      expect(sender.displayName).toBe("Malte Ubl");
      expect(sender.type).toBe("HUMAN");
    });

    it("should receive user reply in DM when subscribed", async () => {
      // Step 1: Initial mention to subscribe
      await sendWebhook(gchatFixtures.mention);
      expect(state.mentionMessage).not.toBeNull();

      // Step 2: User requests DM via Pub/Sub - bot opens DM and subscribes
      await sendWebhook(gchatFixtures.dmRequest);
      expect(state.openDMCalled).toBe(true);

      // Step 3: User sends message in DM
      await sendWebhook(gchatFixtures.dmMessage);

      // Verify the DM reply was captured
      expect(state.dmMessage).not.toBeNull();
      expect(state.dmMessage?.text).toBe("Thanks!");

      // Verify the DM space is identified as DM
      expect(gchatFixtures.dmMessage.chat.messagePayload.space.type).toBe("DM");
      expect(gchatFixtures.dmMessage.chat.messagePayload.space.spaceType).toBe(
        "DIRECT_MESSAGE",
      );

      // Verify bot responded to the DM
      expect(mockChatApi.spaces.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            text: expect.stringContaining("Got your DM: Thanks!"),
          }),
        }),
      );
    });
  });

  describe("Teams", () => {
    let chat: Chat<{ teams: TeamsAdapter }>;
    let mockBotAdapter: MockBotAdapter;
    let tracker: ReturnType<typeof createWaitUntilTracker>;
    let state: DMFlowState;

    beforeEach(() => {
      vi.clearAllMocks();
      state = createDMFlowState();

      const teamsAdapter = createTeamsAdapter({
        appId: teamsFixtures.botUserId.split(":")[1] || "test-app-id",
        appPassword: TEAMS_APP_PASSWORD,
        userName: teamsFixtures.botName,
        logger: mockLogger,
      });
      mockBotAdapter = createMockBotAdapter();
      injectMockBotAdapter(teamsAdapter, mockBotAdapter);

      chat = new Chat({
        userName: teamsFixtures.botName,
        adapters: { teams: teamsAdapter },
        state: createMemoryState(),
        logger: "error",
      });

      chat.onNewMention(async (thread, message) => {
        state.mentionMessage = message;
        await thread.subscribe();
        await thread.post("Welcome!");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        if (message.text.toLowerCase().includes("dm me")) {
          state.dmRequestMessage = message;
          try {
            const dmThread = await chat.openDM(message.author);
            state.openDMCalled = true;
            state.dmThreadId = dmThread.id;
            await dmThread.subscribe();
            await dmThread.post("Hello via DM!");
            await thread.post("I've sent you a DM!");
          } catch (e) {
            await thread.post(
              `Sorry, couldn't send DM: ${(e as Error).message}`,
            );
          }
        } else if (thread.isDM) {
          state.dmMessage = message;
          await thread.post(`Got your DM: ${message.text}`);
        }
      });

      tracker = createWaitUntilTracker();
    });

    afterEach(async () => {
      await chat.shutdown();
    });

    const sendWebhook = async (fixture: unknown) => {
      await chat.webhooks.teams(createTeamsRequest(fixture), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    };

    it("should handle mention in channel", async () => {
      await sendWebhook(teamsFixtures.mention);

      expect(state.mentionMessage).not.toBeNull();
      expect(state.mentionMessage?.text).toContain("Hey");
    });

    it("should handle DM request flow", async () => {
      // Step 1: Initial mention to subscribe (also caches serviceUrl and tenantId)
      await sendWebhook(teamsFixtures.mention);

      expect(state.mentionMessage).not.toBeNull();
      expect(state.mentionMessage?.text).toContain("Hey");

      // Step 2: User requests DM in subscribed thread
      await sendWebhook(teamsFixtures.dmRequest);

      expect(state.dmRequestMessage).not.toBeNull();
      expect(state.dmRequestMessage?.text).toContain("dm me");
      expect(state.openDMCalled).toBe(true);
      expect(state.dmThreadId).toContain("teams:");

      // Verify createConversationAsync was called to create the DM
      expect(mockBotAdapter.createdConversations).toHaveLength(1);
      expect(mockBotAdapter.createdConversations[0]?.userId).toBe(
        state.dmRequestMessage?.author.userId,
      );

      // Verify DM message was sent
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Hello via DM!"),
        }),
      );

      // Verify confirmation in original thread
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("I've sent you a DM!"),
        }),
      );
    });

    it("should detect DM conversation type", async () => {
      const mentionPayload = teamsFixtures.mention;
      expect(mentionPayload.conversation.conversationType).toBe("channel");
      expect(mentionPayload.conversation.id).toContain("19:");
    });

    it("should receive user reply in DM when subscribed", async () => {
      // Configure mock to return the actual DM conversation ID from fixtures
      mockBotAdapter.createConversationAsync.mockImplementation(
        async (...args: unknown[]) => {
          const callback = args[args.length - 1] as
            | ((context: unknown) => Promise<void>)
            | undefined;
          const mockTurnContext = {
            activity: {
              conversation: { id: teamsFixtures.dmConversationId },
              id: "activity-dm",
            },
          };
          if (typeof callback === "function") {
            await callback(mockTurnContext);
          }
        },
      );

      // Step 1: Initial mention to subscribe (also caches serviceUrl and tenantId)
      await sendWebhook(teamsFixtures.mention);
      expect(state.mentionMessage).not.toBeNull();

      // Step 2: User requests DM in subscribed thread - bot opens DM and subscribes
      await sendWebhook(teamsFixtures.dmRequest);
      expect(state.openDMCalled).toBe(true);
      expect(state.dmThreadId).not.toBeNull();

      // Step 3: User sends message in DM
      await sendWebhook(teamsFixtures.dmMessage);

      // Verify the DM reply was captured
      expect(state.dmMessage).not.toBeNull();
      expect(state.dmMessage?.text).toBe("Hey");

      // Verify the DM message payload identifies as personal conversation
      expect(teamsFixtures.dmMessage.conversation.conversationType).toBe(
        "personal",
      );

      // Verify bot responded to the DM
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining("Got your DM: Hey"),
        }),
      );
    });
  });
});
