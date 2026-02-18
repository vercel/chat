/**
 * Slack test utilities for creating mock clients, events, and webhook requests.
 */

import { createHmac } from "node:crypto";
import type { SlackAdapter } from "@chat-adapter/slack";
import { vi } from "vitest";

export const SLACK_SIGNING_SECRET = "test-signing-secret";
export const SLACK_BOT_TOKEN = "xoxb-test-token";
export const SLACK_BOT_USER_ID = "U_BOT_123";
export const SLACK_BOT_USERNAME = "testbot";

/**
 * Options for creating a Slack event
 */
export interface SlackEventOptions {
  type?: "app_mention" | "message";
  text: string;
  userId: string;
  userName?: string;
  messageTs: string;
  threadTs: string;
  channel: string;
  botId?: string;
  teamId?: string;
  apiAppId?: string;
  eventId?: string;
  eventTime?: number;
}

/**
 * Create a Slack event callback payload
 */
export function createSlackEvent(options: SlackEventOptions) {
  const {
    type = "message",
    text,
    userId,
    messageTs,
    threadTs,
    channel,
    botId,
    teamId = "T123456",
    apiAppId = "A123456",
    eventId = `Ev${Date.now()}`,
    eventTime = Math.floor(Date.now() / 1000),
  } = options;

  const event: Record<string, unknown> = {
    type,
    user: userId,
    text,
    ts: messageTs,
    thread_ts: threadTs,
    channel,
    event_ts: messageTs,
  };

  if (botId) {
    event.bot_id = botId;
  }

  return {
    type: "event_callback",
    team_id: teamId,
    api_app_id: apiAppId,
    event,
    event_id: eventId,
    event_time: eventTime,
  };
}

/**
 * Create a Slack webhook request with valid HMAC signature
 */
export function createSlackWebhookRequest(
  payload: Record<string, unknown>,
  signingSecret = SLACK_SIGNING_SECRET,
): Request {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature =
    "v0=" +
    createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  return new Request("https://example.com/webhook/slack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

/**
 * Create mock Slack Web API client
 */
export function createMockSlackClient() {
  const client = {
    auth: {
      test: vi.fn().mockResolvedValue({
        ok: true,
        user_id: SLACK_BOT_USER_ID,
        user: SLACK_BOT_USERNAME,
      }),
    },
    chat: {
      postMessage: vi.fn().mockResolvedValue({
        ok: true,
        ts: "1234567890.123456",
        channel: "C123456",
        message: { ts: "1234567890.123456" },
      }),
      postEphemeral: vi.fn().mockResolvedValue({
        ok: true,
        message_ts: "1234567890.123457",
      }),
      update: vi.fn().mockResolvedValue({
        ok: true,
        ts: "1234567890.123456",
        channel: "C123456",
      }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
    // Mock chatStream for streaming support - returns streamer object with append/stop
    chatStream: vi.fn().mockImplementation(() => ({
      append: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({
        ok: true,
        ts: "1234567890.123456",
        channel: "C123456",
        message: { ts: "1234567890.123456" },
      }),
    })),
    reactions: {
      add: vi.fn().mockResolvedValue({ ok: true }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    },
    conversations: {
      info: vi.fn().mockResolvedValue({
        ok: true,
        channel: { id: "C123456", name: "general" },
      }),
      history: vi.fn().mockResolvedValue({
        ok: true,
        messages: [],
      }),
      replies: vi.fn().mockResolvedValue({
        ok: true,
        messages: [],
      }),
      open: vi.fn().mockResolvedValue({
        ok: true,
        channel: { id: "D123456" },
      }),
    },
    users: {
      info: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: "U123", name: "testuser", real_name: "Test User" },
      }),
    },
    files: {
      uploadV2: vi.fn().mockResolvedValue({
        ok: true,
        files: [{ id: "F123456" }],
      }),
    },
    clearMocks: () => {
      client.auth.test.mockClear();
      client.chat.postMessage.mockClear();
      client.chat.postEphemeral.mockClear();
      client.chat.update.mockClear();
      client.chat.delete.mockClear();
      client.chatStream.mockClear();
      client.reactions.add.mockClear();
      client.reactions.remove.mockClear();
      client.conversations.info.mockClear();
      client.conversations.history.mockClear();
      client.conversations.replies.mockClear();
      client.conversations.open.mockClear();
      client.users.info.mockClear();
      client.files.uploadV2.mockClear();
    },
  };
  return client;
}

export type MockSlackClient = ReturnType<typeof createMockSlackClient>;

/**
 * Inject mock client into Slack adapter (replaces private field)
 */
export function injectMockSlackClient(
  adapter: SlackAdapter,
  mockClient: MockSlackClient,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private field for testing
  (adapter as any).client = mockClient;
}

/**
 * Get expected Slack thread ID format
 */
export function getSlackThreadId(channel: string, threadTs: string): string {
  return `slack:${channel}:${threadTs}`;
}

/**
 * Options for creating a Slack block_actions event
 */
export interface SlackBlockActionsOptions {
  actionId: string;
  actionValue?: string;
  userId: string;
  userName?: string;
  messageTs: string;
  threadTs?: string;
  channel: string;
  triggerId?: string;
}

/**
 * Create a Slack block_actions payload (form-urlencoded)
 */
function createSlackBlockActionsPayload(options: SlackBlockActionsOptions) {
  const {
    actionId,
    actionValue,
    userId,
    userName = "testuser",
    messageTs,
    threadTs,
    channel,
    triggerId = "trigger123",
  } = options;

  const payload = {
    type: "block_actions",
    user: {
      id: userId,
      username: userName,
      name: userName,
      team_id: "T123456",
    },
    api_app_id: "A123456",
    team: { id: "T123456", domain: "test" },
    channel: { id: channel, name: "general" },
    message: {
      ts: messageTs,
      thread_ts: threadTs || messageTs,
    },
    trigger_id: triggerId,
    actions: [
      {
        action_id: actionId,
        block_id: "block1",
        type: "button",
        value: actionValue,
        action_ts: String(Date.now() / 1000),
      },
    ],
  };

  return payload;
}

/**
 * Create a Slack block_actions webhook request (form-urlencoded)
 */
export function createSlackBlockActionsRequest(
  options: SlackBlockActionsOptions,
  signingSecret = SLACK_SIGNING_SECRET,
): Request {
  const payload = createSlackBlockActionsPayload(options);
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature =
    "v0=" +
    createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  return new Request("https://example.com/webhook/slack", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}
