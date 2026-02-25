/**
 * Shared utilities for replay tests.
 *
 * Consolidates request factories, test setup helpers, and common assertions
 * that were previously duplicated across replay test files.
 */

import { createHmac } from "node:crypto";
import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import {
  type ActionEvent,
  type AppHomeOpenedEvent,
  type AssistantContextChangedEvent,
  type AssistantThreadStartedEvent,
  Chat,
  type Logger,
  type Message,
  type ModalSubmitEvent,
  type ReactionEvent,
  type SlashCommandEvent,
  type StateAdapter,
  type Thread,
} from "chat";
import type { Mock } from "vitest";
import {
  createMockDiscordApi,
  DISCORD_APPLICATION_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_USERNAME,
  DISCORD_PUBLIC_KEY,
  type MockDiscordApi,
  restoreDiscordFetchMock,
  setupDiscordFetchMock,
} from "./discord-utils";
import {
  createMockGoogleChatApi,
  GCHAT_TEST_CREDENTIALS,
  injectMockGoogleChatApi,
  type MockGoogleChatApi,
} from "./gchat-utils";
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
import { createWaitUntilTracker } from "./test-scenarios";

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

export { createWaitUntilTracker } from "./test-scenarios";

// ============================================================================
// Request Factory Functions
// ============================================================================

/**
 * Create a signed Slack webhook request.
 * Handles both JSON payloads and form-urlencoded payloads (for block_actions).
 */
export function createSignedSlackRequest(
  body: string,
  contentType = "application/json"
): Request {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(sigBasestring).digest("hex")}`;
  return new Request("https://example.com/webhook/slack", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

/**
 * Create a Google Chat webhook request from a fixture payload.
 */
export function createGchatRequest(body: unknown): Request {
  return new Request("https://example.com/webhook/gchat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Create a Teams webhook request from a fixture payload.
 */
export function createTeamsRequest(body: unknown): Request {
  return new Request("https://example.com/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Test Context Types
// ============================================================================

/**
 * Captured data from message handlers during tests.
 */
export interface CapturedMessages {
  followUpMessage: Message | null;
  followUpThread: Thread | null;
  mentionMessage: Message | null;
  mentionThread: Thread | null;
}

// ============================================================================
// Slack Test Context
// ============================================================================

export interface SlackTestContext {
  adapter: SlackAdapter;
  captured: CapturedMessages;
  chat: Chat<{ slack: SlackAdapter }>;
  mockClient: MockSlackClient;
  sendSlackAction: (fixture: unknown) => Promise<void>;
  sendSlackSlashCommand: (fixture: Record<string, string>) => Promise<Response>;
  sendSlackViewSubmission: (fixture: unknown) => Promise<Response>;
  sendWebhook: (fixture: unknown) => Promise<void>;
  state: StateAdapter;
  tracker: ReturnType<typeof createWaitUntilTracker>;
}

/**
 * Create a Slack test context with standard setup.
 */
export function createSlackTestContext(
  fixtures: { botName: string; botUserId: string },
  handlers: {
    onMention?: (thread: Thread, message: Message) => void | Promise<void>;
    onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
    onAction?: (event: ActionEvent) => void | Promise<void>;
    onReaction?: (event: ReactionEvent) => void | Promise<void>;
    onModalSubmit?: (event: ModalSubmitEvent) => void | Promise<void>;
    onSlashCommand?: (event: SlashCommandEvent) => void | Promise<void>;
    onAssistantThreadStarted?: (
      event: AssistantThreadStartedEvent
    ) => void | Promise<void>;
    onAssistantContextChanged?: (
      event: AssistantContextChangedEvent
    ) => void | Promise<void>;
    onAppHomeOpened?: (event: AppHomeOpenedEvent) => void | Promise<void>;
  }
): SlackTestContext {
  const adapter = createSlackAdapter({
    botToken: SLACK_BOT_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET,
    botUserId: fixtures.botUserId,
    logger: mockLogger,
  });

  const mockClient = createMockSlackClient();
  mockClient.auth.test.mockResolvedValue({
    ok: true,
    user_id: fixtures.botUserId,
    user: fixtures.botName,
  });
  injectMockSlackClient(adapter, mockClient);

  const stateAdapter = createMemoryState();
  const chat = new Chat({
    userName: fixtures.botName,
    adapters: { slack: adapter },
    state: stateAdapter,
    logger: "error",
  });

  const captured: CapturedMessages = {
    mentionMessage: null,
    mentionThread: null,
    followUpMessage: null,
    followUpThread: null,
  };

  if (handlers.onMention) {
    const handler = handlers.onMention;
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      captured.mentionThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onSubscribed) {
    const handler = handlers.onSubscribed;
    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      captured.followUpThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onAction) {
    chat.onAction(handlers.onAction);
  }

  if (handlers.onReaction) {
    chat.onReaction(handlers.onReaction);
  }

  if (handlers.onModalSubmit) {
    const handler = handlers.onModalSubmit;
    chat.onModalSubmit(async (event) => {
      await handler(event);
      return undefined;
    });
  }

  if (handlers.onSlashCommand) {
    chat.onSlashCommand(handlers.onSlashCommand);
  }

  if (handlers.onAssistantThreadStarted) {
    chat.onAssistantThreadStarted(handlers.onAssistantThreadStarted);
  }

  if (handlers.onAssistantContextChanged) {
    chat.onAssistantContextChanged(handlers.onAssistantContextChanged);
  }

  if (handlers.onAppHomeOpened) {
    chat.onAppHomeOpened(handlers.onAppHomeOpened);
  }

  const tracker = createWaitUntilTracker();

  return {
    chat,
    adapter,
    mockClient,
    tracker,
    captured,
    state: stateAdapter,
    sendWebhook: async (fixture: unknown) => {
      await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(fixture)),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
    },
    sendSlackAction: async (fixture: unknown) => {
      const body = `payload=${encodeURIComponent(JSON.stringify(fixture))}`;
      await chat.webhooks.slack(
        createSignedSlackRequest(body, "application/x-www-form-urlencoded"),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
    },
    sendSlackViewSubmission: async (fixture: unknown) => {
      const body = `payload=${encodeURIComponent(JSON.stringify(fixture))}`;
      const response = await chat.webhooks.slack(
        createSignedSlackRequest(body, "application/x-www-form-urlencoded"),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
      return response;
    },
    sendSlackSlashCommand: async (fixture: Record<string, string>) => {
      const body = new URLSearchParams(fixture).toString();
      const response = await chat.webhooks.slack(
        createSignedSlackRequest(body, "application/x-www-form-urlencoded"),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
      return response;
    },
  };
}

// ============================================================================
// Teams Test Context
// ============================================================================

export interface TeamsTestContext {
  adapter: TeamsAdapter;
  captured: CapturedMessages;
  chat: Chat<{ teams: TeamsAdapter }>;
  mockBotAdapter: MockBotAdapter;
  sendWebhook: (fixture: unknown) => Promise<void>;
  tracker: ReturnType<typeof createWaitUntilTracker>;
}

/**
 * Create a Teams test context with standard setup.
 */
export function createTeamsTestContext(
  fixtures: { botName: string; appId?: string },
  handlers: {
    onMention?: (thread: Thread, message: Message) => void | Promise<void>;
    onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
    onAction?: (event: ActionEvent) => void | Promise<void>;
    onReaction?: (event: ReactionEvent) => void | Promise<void>;
  }
): TeamsTestContext {
  const appId = fixtures.appId || "test-app-id";
  const adapter = createTeamsAdapter({
    appId,
    appPassword: TEAMS_APP_PASSWORD,
    userName: fixtures.botName,
    logger: mockLogger,
  });

  const mockBotAdapter = createMockBotAdapter();
  injectMockBotAdapter(adapter, mockBotAdapter);

  const chat = new Chat({
    userName: fixtures.botName,
    adapters: { teams: adapter },
    state: createMemoryState(),
    logger: "error",
  });

  const captured: CapturedMessages = {
    mentionMessage: null,
    mentionThread: null,
    followUpMessage: null,
    followUpThread: null,
  };

  if (handlers.onMention) {
    const handler = handlers.onMention;
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      captured.mentionThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onSubscribed) {
    const handler = handlers.onSubscribed;
    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      captured.followUpThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onAction) {
    chat.onAction(handlers.onAction);
  }

  if (handlers.onReaction) {
    chat.onReaction(handlers.onReaction);
  }

  const tracker = createWaitUntilTracker();

  return {
    chat,
    adapter,
    mockBotAdapter,
    tracker,
    captured,
    sendWebhook: async (fixture: unknown) => {
      await chat.webhooks.teams(createTeamsRequest(fixture), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    },
  };
}

// ============================================================================
// Google Chat Test Context
// ============================================================================

export interface GchatTestContext {
  adapter: GoogleChatAdapter;
  captured: CapturedMessages;
  chat: Chat<{ gchat: GoogleChatAdapter }>;
  mockChatApi: MockGoogleChatApi;
  sendWebhook: (fixture: unknown) => Promise<void>;
  tracker: ReturnType<typeof createWaitUntilTracker>;
}

/**
 * Create a Google Chat test context with standard setup.
 */
export function createGchatTestContext(
  fixtures: { botName: string; botUserId: string },
  handlers: {
    onMention?: (thread: Thread, message: Message) => void | Promise<void>;
    onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
    onAction?: (event: ActionEvent) => void | Promise<void>;
    onReaction?: (event: ReactionEvent) => void | Promise<void>;
  }
): GchatTestContext {
  const adapter = createGoogleChatAdapter({
    credentials: GCHAT_TEST_CREDENTIALS,
    userName: fixtures.botName,
    logger: mockLogger,
  });
  adapter.botUserId = fixtures.botUserId;

  const mockChatApi = createMockGoogleChatApi();
  injectMockGoogleChatApi(adapter, mockChatApi);

  const chat = new Chat({
    userName: fixtures.botName,
    adapters: { gchat: adapter },
    state: createMemoryState(),
    logger: "error",
  });

  const captured: CapturedMessages = {
    mentionMessage: null,
    mentionThread: null,
    followUpMessage: null,
    followUpThread: null,
  };

  if (handlers.onMention) {
    const handler = handlers.onMention;
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      captured.mentionThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onSubscribed) {
    const handler = handlers.onSubscribed;
    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      captured.followUpThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onAction) {
    chat.onAction(handlers.onAction);
  }

  if (handlers.onReaction) {
    chat.onReaction(handlers.onReaction);
  }

  const tracker = createWaitUntilTracker();

  return {
    chat,
    adapter,
    mockChatApi,
    tracker,
    captured,
    sendWebhook: async (fixture: unknown) => {
      await chat.webhooks.gchat(createGchatRequest(fixture), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    },
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

import { expect } from "vitest";

/**
 * Assert that a mention was captured correctly.
 */
export function expectValidMention(
  captured: CapturedMessages,
  options: {
    textContains?: string;
    authorUserId?: string;
    authorIsBot?: boolean;
    adapterName: string;
    threadIdContains?: string;
  }
): void {
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionMessage).not.toBeNull();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionThread).not.toBeNull();

  if (options.textContains) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(captured.mentionMessage?.text).toContain(options.textContains);
  }

  if (options.authorUserId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(captured.mentionMessage?.author.userId).toBe(options.authorUserId);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionMessage?.author.isBot).toBe(
    options.authorIsBot ?? false
  );
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionMessage?.author.isMe).toBe(false);

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionThread?.id).toContain(`${options.adapterName}:`);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionThread?.adapter.name).toBe(options.adapterName);

  if (options.threadIdContains) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(captured.mentionThread?.id).toContain(options.threadIdContains);
  }

  // Verify recent messages includes the mention
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionThread?.recentMessages).toHaveLength(1);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.mentionThread?.recentMessages[0]).toBe(
    captured.mentionMessage
  );
}

/**
 * Assert that a follow-up message was captured correctly.
 */
export function expectValidFollowUp(
  captured: CapturedMessages,
  options: {
    text?: string;
    textContains?: string;
    authorIsBot?: boolean;
    adapterName: string;
  }
): void {
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.followUpMessage).not.toBeNull();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.followUpThread).not.toBeNull();

  if (options.text) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(captured.followUpMessage?.text).toBe(options.text);
  }

  if (options.textContains) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(captured.followUpMessage?.text).toContain(options.textContains);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.followUpMessage?.author.isBot).toBe(
    options.authorIsBot ?? false
  );
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.followUpMessage?.author.isMe).toBe(false);

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(captured.followUpThread?.recentMessages.length).toBeGreaterThan(0);
}

/**
 * Assert that an action event was captured correctly.
 */
export function expectValidAction(
  action: ActionEvent | null,
  options: {
    actionId: string;
    userId?: string;
    userName?: string;
    adapterName: string;
    channelId?: string;
    isDM?: boolean;
  }
): void {
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action).not.toBeNull();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.actionId).toBe(options.actionId);

  if (options.userId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(action?.user.userId).toBe(options.userId);
  }

  if (options.userName) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(action?.user.userName).toBe(options.userName);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.user.isBot).toBe(false);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.user.isMe).toBe(false);

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.thread).toBeDefined();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.thread.id).toContain(`${options.adapterName}:`);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.thread.adapter.name).toBe(options.adapterName);

  if (options.channelId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(action?.thread.channelId).toBe(options.channelId);
  }

  if (options.isDM !== undefined) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(action?.thread.isDM).toBe(options.isDM);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.threadId).toBe(action?.thread.id);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.messageId).toBeDefined();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(action?.raw).toBeDefined();
}

/**
 * Assert that a reaction event was captured correctly.
 */
export function expectValidReaction(
  reaction: ReactionEvent | null,
  options: {
    emojiName: string;
    rawEmoji: string;
    added?: boolean;
    userId?: string;
    adapterName: string;
    channelId?: string;
    messageId?: string;
    isDM?: boolean;
  }
): void {
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction).not.toBeNull();

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.emoji.name).toBe(options.emojiName);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.emoji.toString()).toBe(`{{emoji:${options.emojiName}}}`);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.rawEmoji).toBe(options.rawEmoji);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.added).toBe(options.added ?? true);

  if (options.userId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(reaction?.user.userId).toBe(options.userId);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.user.isBot).toBe(false);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.user.isMe).toBe(false);

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.thread).toBeDefined();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.thread.id).toContain(`${options.adapterName}:`);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.thread.adapter.name).toBe(options.adapterName);

  if (options.channelId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(reaction?.thread.channelId).toBe(options.channelId);
  }

  if (options.isDM !== undefined) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(reaction?.thread.isDM).toBe(options.isDM);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.threadId).toBe(reaction?.thread.id);

  if (options.messageId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(reaction?.messageId).toBe(options.messageId);
  } else {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(reaction?.messageId).toBeDefined();
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(reaction?.raw).toBeDefined();
}

/**
 * Assert that a slash command event was captured correctly.
 */
export function expectValidSlashCommand(
  event: SlashCommandEvent | null,
  options: {
    command: string;
    text?: string;
    userId?: string;
    userName?: string;
    adapterName: string;
    channelId?: string;
  }
): void {
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(event).not.toBeNull();
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(event?.command).toBe(options.command);

  if (options.text !== undefined) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(event?.text).toBe(options.text);
  }

  if (options.userId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(event?.user.userId).toBe(options.userId);
  }

  if (options.userName) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(event?.user.userName).toBe(options.userName);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(event?.user.isBot).toBe(false);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(event?.user.isMe).toBe(false);

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(event?.adapter.name).toBe(options.adapterName);

  if (options.channelId) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(event?.channel.id).toContain(options.channelId);
  }

  // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
  expect(event?.raw).toBeDefined();
}

/**
 * Assert that the mock sent a response message.
 */
export function expectSentMessage(
  mock:
    | MockSlackClient
    | MockBotAdapter
    | MockGoogleChatApi
    | Mock<(...args: unknown[]) => unknown>,
  textContains: string
): void {
  if ("chat" in mock && "postMessage" in mock.chat) {
    // Slack mock client
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(mock.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(textContains),
      })
    );
  } else if ("sentActivities" in mock) {
    // Teams mock adapter
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(mock.sentActivities).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining(textContains),
      })
    );
  } else if ("sentMessages" in mock) {
    // GChat mock API
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(mock.sentMessages).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining(textContains),
      })
    );
  }
}

/**
 * Assert that the mock updated a message.
 */
export function expectUpdatedMessage(
  mock: MockSlackClient | MockBotAdapter | MockGoogleChatApi,
  textContains: string
): void {
  if ("chat" in mock && "update" in mock.chat) {
    // Slack mock client
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(mock.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(textContains),
      })
    );
  } else if ("updatedActivities" in mock) {
    // Teams mock adapter
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(mock.updatedActivities).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining(textContains),
      })
    );
  } else if ("updatedMessages" in mock) {
    // GChat mock API
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper function used in tests
    expect(mock.updatedMessages).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining(textContains),
      })
    );
  }
}

// ============================================================================
// Discord Test Context
// ============================================================================

export interface DiscordTestContext {
  adapter: DiscordAdapter;
  captured: CapturedMessages;
  chat: Chat<{ discord: DiscordAdapter }>;
  cleanup: () => void;
  mockApi: MockDiscordApi;
  sendGatewayEvent: (fixture: unknown) => Promise<Response>;
  sendWebhook: (fixture: unknown) => Promise<Response>;
  state: StateAdapter;
  tracker: ReturnType<typeof createWaitUntilTracker>;
}

/**
 * Create a Discord test context with standard setup.
 */
export async function createDiscordTestContext(
  fixtures: {
    botName?: string;
    applicationId?: string;
    mentionRoleIds?: string[];
  },
  handlers: {
    onMention?: (thread: Thread, message: Message) => void | Promise<void>;
    onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
    onAction?: (event: ActionEvent) => void | Promise<void>;
    onReaction?: (event: ReactionEvent) => void | Promise<void>;
  }
): Promise<DiscordTestContext> {
  const applicationId = fixtures.applicationId || DISCORD_APPLICATION_ID;
  const botName = fixtures.botName || DISCORD_BOT_USERNAME;

  const adapter = createDiscordAdapter({
    botToken: DISCORD_BOT_TOKEN,
    publicKey: DISCORD_PUBLIC_KEY,
    applicationId,
    mentionRoleIds: fixtures.mentionRoleIds,
    userName: botName,
    logger: mockLogger,
  });

  const mockApi = createMockDiscordApi();
  setupDiscordFetchMock(mockApi);

  const stateAdapter = createMemoryState();
  // Connect state adapter so it's ready for direct access via ctx.state
  await stateAdapter.connect();
  const chat = new Chat({
    userName: botName,
    adapters: { discord: adapter },
    state: stateAdapter,
    logger: "error",
  });

  const captured: CapturedMessages = {
    mentionMessage: null,
    mentionThread: null,
    followUpMessage: null,
    followUpThread: null,
  };

  if (handlers.onMention) {
    const handler = handlers.onMention;
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      captured.mentionThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onSubscribed) {
    const handler = handlers.onSubscribed;
    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      captured.followUpThread = thread;
      await handler(thread, message);
    });
  }

  if (handlers.onAction) {
    chat.onAction(handlers.onAction);
  }

  if (handlers.onReaction) {
    chat.onReaction(handlers.onReaction);
  }

  const tracker = createWaitUntilTracker();

  return {
    chat,
    adapter,
    mockApi,
    tracker,
    captured,
    state: stateAdapter,
    sendWebhook: async (fixture: unknown) => {
      const { createDiscordWebhookRequest } = await import("./discord-utils");
      const response = await chat.webhooks.discord(
        createDiscordWebhookRequest(fixture as Record<string, unknown>),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
      return response;
    },
    sendGatewayEvent: async (fixture: unknown) => {
      const { createDiscordGatewayRequest } = await import("./discord-utils");
      const response = await chat.webhooks.discord(
        createDiscordGatewayRequest(fixture as Record<string, unknown>),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
      return response;
    },
    cleanup: () => {
      restoreDiscordFetchMock();
    },
  };
}
