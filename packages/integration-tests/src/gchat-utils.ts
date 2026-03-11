/**
 * Google Chat test utilities for creating mock APIs, events, and webhook requests.
 */

import type { GoogleChatAdapter } from "@chat-adapter/gchat";
import { vi } from "vitest";

export const GCHAT_TEST_CREDENTIALS = {
  client_email: "bot@project.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  project_id: "test-project",
};

export const GCHAT_BOT_NAME = "TestBot";

/**
 * Options for creating a Google Chat event
 */
export interface GoogleChatEventOptions {
  eventTime?: string;
  hasBotMention?: boolean;
  messageName: string;
  senderId: string;
  senderName: string;
  senderType?: string;
  spaceName: string;
  text: string;
  threadName?: string;
}

/**
 * Create a realistic Google Chat event payload in the modern Add-ons format.
 * This matches the format used when configuring apps via Google Cloud Console.
 */
export function createGoogleChatEvent(options: GoogleChatEventOptions) {
  const {
    text,
    messageName,
    spaceName,
    threadName,
    senderId,
    senderName,
    senderType = "HUMAN",
    hasBotMention = false,
    eventTime = new Date().toISOString(),
  } = options;

  // Calculate the actual length of the @mention (including @ symbol)
  const mentionLength = `@${GCHAT_BOT_NAME}`.length;

  const annotations = hasBotMention
    ? [
        {
          type: "USER_MENTION",
          startIndex: 0,
          length: mentionLength,
          userMention: {
            user: {
              name: "users/bot-user-id",
              displayName: GCHAT_BOT_NAME,
              type: "BOT",
            },
            type: "BOT",
          },
        },
      ]
    : [];

  // Modern Add-ons event format with chat.messagePayload
  return {
    commonEventObject: {
      userLocale: "en",
      hostApp: "CHAT",
      platform: "WEB",
    },
    chat: {
      user: {
        name: senderId,
        displayName: senderName,
        type: senderType,
      },
      eventTime,
      messagePayload: {
        space: {
          name: spaceName,
          type: "ROOM",
          displayName: "Test Space",
          spaceThreadingState: "THREADED_MESSAGES",
        },
        message: {
          name: messageName,
          sender: {
            name: senderId,
            displayName: senderName,
            type: senderType,
          },
          text,
          thread: threadName ? { name: threadName } : undefined,
          createTime: eventTime,
          annotations: annotations.length > 0 ? annotations : undefined,
          argumentText: hasBotMention
            ? text.replace(`@${GCHAT_BOT_NAME}`, "").trim()
            : text,
          space: {
            name: spaceName,
            type: "ROOM",
          },
        },
      },
    },
  };
}

/**
 * Create a Google Chat webhook request
 */
export function createGoogleChatWebhookRequest(
  event: ReturnType<typeof createGoogleChatEvent>
): Request {
  const body = JSON.stringify(event);

  return new Request("https://example.com/webhook/gchat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer google-id-token",
    },
    body,
  });
}

/**
 * Create mock Google Chat API
 */
export function createMockGoogleChatApi() {
  const sentMessages: Array<{
    parent: string;
    text: string;
    thread?: { name: string };
  }> = [];
  const updatedMessages: Array<{ name: string; text: string }> = [];
  const deletedMessages: string[] = [];
  const addedReactions: Array<{ parent: string; emoji: string }> = [];

  let messageCounter = 0;

  return {
    sentMessages,
    updatedMessages,
    deletedMessages,
    addedReactions,
    spaces: {
      messages: {
        create: vi.fn(
          (params: {
            parent: string;
            requestBody: { text: string; thread?: { name: string } };
          }) => {
            messageCounter++;
            const messageName = `${params.parent}/messages/msg-${messageCounter}`;
            sentMessages.push({
              parent: params.parent,
              text: params.requestBody.text,
              thread: params.requestBody.thread,
            });
            return {
              data: {
                name: messageName,
                text: params.requestBody.text,
                thread: params.requestBody.thread || {
                  name: `${params.parent}/threads/thread-${messageCounter}`,
                },
                createTime: new Date().toISOString(),
              },
            };
          }
        ),
        update: vi.fn(
          (params: {
            name: string;
            updateMask: string;
            requestBody: { text: string };
          }) => {
            updatedMessages.push({
              name: params.name,
              text: params.requestBody.text,
            });
            return {
              data: {
                name: params.name,
                text: params.requestBody.text,
              },
            };
          }
        ),
        delete: vi.fn((params: { name: string }) => {
          deletedMessages.push(params.name);
          return { data: {} };
        }),
        list: vi.fn(() => ({ data: { messages: [] } })),
        reactions: {
          create: vi.fn(
            (params: {
              parent: string;
              requestBody: { emoji: { unicode: string } };
            }) => {
              addedReactions.push({
                parent: params.parent,
                emoji: params.requestBody.emoji.unicode,
              });
              return {
                data: { name: `${params.parent}/reactions/reaction-1` },
              };
            }
          ),
        },
      },
      get: vi.fn((params: { name: string }) => ({
        data: {
          name: params.name,
          displayName: "Test Space",
          type: "ROOM",
        },
      })),
      findDirectMessage: vi.fn(() => ({
        data: { name: null as string | null },
      })),
      setup: vi.fn((_params: { requestBody: { spaceType: string } }) => ({
        data: { name: `spaces/dm-${Date.now()}` },
      })),
    },
    clearMocks: () => {
      sentMessages.length = 0;
      updatedMessages.length = 0;
      deletedMessages.length = 0;
      addedReactions.length = 0;
      messageCounter = 0;
    },
  };
}

export type MockGoogleChatApi = ReturnType<typeof createMockGoogleChatApi>;

/**
 * Inject mock Google Chat API into adapter
 */
export function injectMockGoogleChatApi(
  adapter: GoogleChatAdapter,
  mockApi: MockGoogleChatApi
): void {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private field for testing
  (adapter as any).chatApi = mockApi;
}

/**
 * Get expected Google Chat thread ID format
 */
export function getGoogleChatThreadId(
  spaceName: string,
  threadName?: string
): string {
  if (threadName) {
    const encodedThread = Buffer.from(threadName).toString("base64url");
    return `gchat:${spaceName}:${encodedThread}`;
  }
  return `gchat:${spaceName}`;
}
