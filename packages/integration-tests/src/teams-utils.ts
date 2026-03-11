/**
 * Teams test utilities for creating mock adapters, activities, and webhook requests.
 */

import type { TeamsAdapter } from "@chat-adapter/teams";
import { vi } from "vitest";

export const TEAMS_APP_ID = "test-app-id";
export const TEAMS_APP_PASSWORD = "test-app-password";
// In Teams, bot from.id contains the app ID in format "28:appId"
export const TEAMS_BOT_ID = `28:${TEAMS_APP_ID}`;
export const TEAMS_BOT_NAME = "TestBot";

/**
 * Options for creating a Teams activity
 */
export interface TeamsActivityOptions {
  conversationId: string;
  fromId: string;
  fromName: string;
  isFromBot?: boolean;
  mentions?: Array<{ id: string; name: string; text: string }>;
  messageId: string;
  recipientId?: string;
  recipientName?: string;
  replyToId?: string;
  serviceUrl?: string;
  text: string;
  timestamp?: string;
  type?: string;
}

/**
 * Create a realistic Teams Bot Framework Activity payload
 */
export function createTeamsActivity(options: TeamsActivityOptions) {
  const {
    type = "message",
    text,
    messageId,
    conversationId,
    serviceUrl = "https://smba.trafficmanager.net/teams/",
    fromId,
    fromName,
    isFromBot = false,
    recipientId = TEAMS_BOT_ID,
    recipientName = TEAMS_BOT_NAME,
    mentions = [],
    timestamp = new Date().toISOString(),
    replyToId,
  } = options;

  // Build entities from mentions
  const entities = mentions.map((m) => ({
    type: "mention",
    mentioned: {
      id: m.id,
      name: m.name,
    },
    text: m.text,
  }));

  return {
    type,
    id: messageId,
    timestamp,
    localTimestamp: timestamp,
    channelId: "msteams",
    serviceUrl,
    from: {
      id: fromId,
      name: fromName,
      aadObjectId: `aad-${fromId}`,
      role: isFromBot ? "bot" : "user",
    },
    conversation: {
      id: conversationId,
      conversationType: "personal",
      tenantId: "tenant-123",
    },
    recipient: {
      id: recipientId,
      name: recipientName,
    },
    text,
    textFormat: "plain",
    locale: "en-US",
    entities: entities.length > 0 ? entities : undefined,
    channelData: {
      tenant: { id: "tenant-123" },
    },
    replyToId,
  };
}

/**
 * Create a Teams webhook request with Bot Framework format
 */
export function createTeamsWebhookRequest(
  activity: ReturnType<typeof createTeamsActivity>
): Request {
  const body = JSON.stringify(activity);

  return new Request("https://example.com/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body,
  });
}

/**
 * Create mock Bot Framework CloudAdapter
 */
export function createMockBotAdapter() {
  const sentActivities: unknown[] = [];
  const updatedActivities: unknown[] = [];
  const deletedActivities: string[] = [];
  const createdConversations: Array<{
    conversationId: string;
    userId: string;
  }> = [];

  // Counter for generated conversation IDs
  let conversationCounter = 0;

  // Mock createConversationAsync that calls the callback with a turn context
  // The conversation ID is captured from within the callback, not the return value
  const mockCreateConversationAsync = vi.fn(async (...args: unknown[]) => {
    conversationCounter++;
    const conversationId = `dm-conversation-${conversationCounter}`;

    // The callback is the last argument
    const callback = args.at(-1) as
      | ((context: unknown) => Promise<void>)
      | undefined;

    // The params (members) is the 5th argument (index 4)
    const params = args[4] as { members?: Array<{ id: string }> } | undefined;
    const userId = params?.members?.[0]?.id || "unknown";
    createdConversations.push({ conversationId, userId });

    // Call the callback with a mock turn context containing the conversation ID
    const mockTurnContext = {
      activity: {
        conversation: { id: conversationId },
        id: `activity-${conversationCounter}`,
      },
    };

    if (typeof callback === "function") {
      await callback(mockTurnContext);
    }
  });

  // Create reusable mock context factory
  const createMockContext = (activity: unknown) => ({
    activity,
    sendActivity: vi.fn((act: unknown) => {
      sentActivities.push(act);
      return { id: `response-${Date.now()}` };
    }),
    updateActivity: vi.fn((act: unknown) => {
      updatedActivities.push(act);
    }),
    deleteActivity: vi.fn((id: string) => {
      deletedActivities.push(id);
    }),
    // For openDM - provides access to adapter.createConversationAsync
    adapter: {
      createConversationAsync: mockCreateConversationAsync,
    },
  });

  return {
    sentActivities,
    updatedActivities,
    deletedActivities,
    createdConversations,
    // Mock the handleActivity method - called during webhook handling
    handleActivity: vi.fn(
      async (
        _authHeader: string,
        activity: unknown,
        handler: (context: unknown) => Promise<void>
      ) => {
        const mockContext = createMockContext(activity);
        await handler(mockContext);
      }
    ),
    // Mock continueConversationAsync - called for posting messages
    continueConversationAsync: vi.fn(
      async (
        _appId: string,
        _ref: unknown,
        handler: (context: unknown) => Promise<void>
      ) => {
        const mockContext = createMockContext({});
        await handler(mockContext);
      }
    ),
    // Direct access to createConversationAsync mock for assertions
    createConversationAsync: mockCreateConversationAsync,
    clearMocks: () => {
      sentActivities.length = 0;
      updatedActivities.length = 0;
      deletedActivities.length = 0;
      createdConversations.length = 0;
      conversationCounter = 0;
    },
  };
}

export type MockBotAdapter = ReturnType<typeof createMockBotAdapter>;

/**
 * Inject mock bot adapter into Teams adapter
 */
export function injectMockBotAdapter(
  adapter: TeamsAdapter,
  mockAdapter: MockBotAdapter
): void {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private field for testing
  (adapter as any).botAdapter = mockAdapter;
}

/**
 * Get expected Teams thread ID format
 */
export function getTeamsThreadId(
  conversationId: string,
  serviceUrl: string
): string {
  const encodedConversationId =
    Buffer.from(conversationId).toString("base64url");
  const encodedServiceUrl = Buffer.from(serviceUrl).toString("base64url");
  return `teams:${encodedConversationId}:${encodedServiceUrl}`;
}

/**
 * Default Teams service URL for testing
 */
export const DEFAULT_TEAMS_SERVICE_URL =
  "https://smba.trafficmanager.net/teams/";

/**
 * Response type for mock Graph client
 * Can be either a paginated response with `value` array, or a single object
 */
export type MockGraphResponse =
  | { value: unknown[]; "@odata.nextLink"?: string }
  | Record<string, unknown>;

/**
 * Create a mock Microsoft Graph client for testing fetchMessages
 */
export function createMockGraphClient() {
  let mockResponses: MockGraphResponse[] = [];
  let callIndex = 0;
  let currentTop: number | undefined;
  const apiCalls: Array<{ url: string; top?: number }> = [];

  const mockRequest = {
    top: vi.fn((n: number) => {
      const lastCall = apiCalls.at(-1);
      if (lastCall) {
        lastCall.top = n;
      }
      currentTop = n;
      return mockRequest;
    }),
    orderby: vi.fn(() => mockRequest),
    filter: vi.fn(() => mockRequest),
    get: vi.fn(() => {
      const response = mockResponses[callIndex] || { value: [] };
      callIndex++;
      // Respect the top() limit if set (only for paginated responses with value array)
      if (currentTop && "value" in response && Array.isArray(response.value)) {
        return {
          ...response,
          value: response.value.slice(0, currentTop),
        };
      }
      return response;
    }),
  };

  const mockClient = {
    api: vi.fn((url: string) => {
      apiCalls.push({ url });
      currentTop = undefined; // Reset for each new request chain
      return mockRequest;
    }),
  };

  return {
    client: mockClient,
    apiCalls,
    mockRequest,
    setResponses: (responses: MockGraphResponse[]) => {
      mockResponses = responses;
      callIndex = 0;
    },
    reset: () => {
      callIndex = 0;
      currentTop = undefined;
      apiCalls.length = 0;
      mockClient.api.mockClear();
      mockRequest.get.mockClear();
      mockRequest.top.mockClear();
    },
  };
}

export type MockGraphClient = ReturnType<typeof createMockGraphClient>;

/**
 * Inject mock Graph client into Teams adapter
 */
export function injectMockGraphClient(
  adapter: TeamsAdapter,
  mockClient: MockGraphClient
): void {
  // biome-ignore lint/suspicious/noExplicitAny: accessing private field for testing
  (adapter as any).graphClient = mockClient.client;
}
