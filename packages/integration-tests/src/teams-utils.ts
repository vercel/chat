/**
 * Teams test utilities for creating mock adapters, activities, and webhook requests.
 * Updated for TeamsSDK (@microsoft/teams.apps) migration.
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
 * Create mock TeamsSDK App for testing.
 * Mocks the API client layer (conversations, reactions) and tracks sent activities.
 */
export function createMockTeamsApp() {
  const sentActivities: unknown[] = [];
  const updatedActivities: unknown[] = [];
  const deletedActivities: string[] = [];
  const createdConversations: Array<{
    conversationId: string;
    userId: string;
  }> = [];

  let conversationCounter = 0;

  const mockSend = vi.fn(async (_convId: string, activity: unknown) => {
    sentActivities.push(activity);
    return { id: `response-${Date.now()}`, type: "message" };
  });

  const mockActivitiesUpdate = vi.fn(async (_id: string, activity: unknown) => {
    updatedActivities.push(activity);
    return { id: _id };
  });

  const mockActivitiesDelete = vi.fn(async (id: string) => {
    deletedActivities.push(id);
  });

  const mockConversationCreate = vi.fn(
    async (params: { members?: Array<{ id: string }> }) => {
      conversationCounter++;
      const conversationId = `dm-conversation-${conversationCounter}`;
      const userId = params?.members?.[0]?.id || "unknown";
      createdConversations.push({ conversationId, userId });
      return { id: conversationId };
    }
  );

  const mockApi = {
    conversations: {
      activities: vi.fn(() => ({
        create: vi.fn(async (_convId: string, activity: unknown) => {
          sentActivities.push(activity);
          return { id: `response-${Date.now()}` };
        }),
        update: mockActivitiesUpdate,
        delete: mockActivitiesDelete,
      })),
      create: mockConversationCreate,
    },
    reactions: {
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
    teams: {
      getById: vi.fn(async () => ({})),
    },
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  };

  const mockGraph = {
    call: vi.fn(async () => ({ value: [] })),
  };

  return {
    sentActivities,
    updatedActivities,
    deletedActivities,
    createdConversations,
    send: mockSend,
    api: mockApi,
    graph: mockGraph,
    initialize: vi.fn(async () => undefined),
    /** Backwards-compat alias for api.conversations.create */
    createConversationAsync: mockConversationCreate,
    clearMocks: () => {
      sentActivities.length = 0;
      updatedActivities.length = 0;
      deletedActivities.length = 0;
      createdConversations.length = 0;
      conversationCounter = 0;
    },
  };
}

export type MockTeamsApp = ReturnType<typeof createMockTeamsApp>;

/**
 * Inject mock TeamsSDK App into Teams adapter.
 * Replaces the internal `app` and `bridgeAdapter` with mocks.
 */
export function injectMockTeamsApp(
  adapter: TeamsAdapter,
  mockApp: MockTeamsApp
): void {
  const adapterInternal = adapter as unknown as {
    app: unknown;
    bridgeAdapter: unknown;
  };

  // Replace the app with a mock that has the right API surface
  const config = (adapter as unknown as { config: { appId?: string } }).config;
  adapterInternal.app = {
    id: config.appId || TEAMS_APP_ID,
    send: mockApp.send,
    api: mockApp.api,
    graph: mockApp.graph,
    initialize: mockApp.initialize,
    on: vi.fn(),
    use: vi.fn(),
  };

  // Create a mock bridge adapter that dispatches activities through the handlers
  const webhookOptionsMap = new Map<string, unknown>();
  adapterInternal.bridgeAdapter = {
    getWebhookOptions: (activityId: string | undefined) =>
      activityId ? webhookOptionsMap.get(activityId) : undefined,
    dispatch: vi.fn(
      async (
        request: Request,
        options?: { waitUntil?: (promise: Promise<unknown>) => void }
      ) => {
        const body = await request.text();
        const parsed = JSON.parse(body);
        const activity = parsed as {
          id?: string;
          type: string;
          text?: string;
          from?: { id: string };
          value?: unknown;
        };

        if (activity.id && options) {
          webhookOptionsMap.set(activity.id, options);
        }

        // For message activities, simulate the TeamsSDK pipeline
        // by calling the adapter's internal methods
        if (
          activity.type === "message" ||
          activity.type === "messageReaction" ||
          activity.type === "invoke"
        ) {
          // The adapter's event handlers were registered on the real app,
          // but we replaced the app. Instead, we trigger the handler logic
          // by accessing the adapter's private methods directly.
          const adapterAny = adapter as unknown as {
            cacheUserContext: (activity: unknown) => void;
            handleMessageActivity: (ctx: unknown) => Promise<void>;
            handleReactionFromContext: (ctx: unknown) => void;
            handleAdaptiveCardAction: (ctx: unknown) => Promise<void>;
          };

          // Create a mock context matching IActivityContext shape
          const mockCtx = {
            activity,
            api: mockApp.api,
            stream: { emit: vi.fn(), close: vi.fn(async () => undefined) },
            send: vi.fn(async (act: unknown) => {
              mockApp.sentActivities.push(act);
              return { id: `ctx-response-${Date.now()}`, type: "message" };
            }),
            next: vi.fn(),
          };

          // Mirror the inline caching that registerEventHandlers does
          adapterAny.cacheUserContext(activity);

          if (activity.type === "message") {
            await adapterAny.handleMessageActivity(mockCtx);
          } else if (activity.type === "messageReaction") {
            adapterAny.handleReactionFromContext(mockCtx);
          } else if (activity.type === "invoke") {
            await adapterAny.handleAdaptiveCardAction(mockCtx);
          }
        }

        if (activity.id) {
          webhookOptionsMap.delete(activity.id);
        }

        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    ),
  };
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
  const apiCalls: Array<{ url: string }> = [];

  return {
    apiCalls,
    setResponses: (responses: MockGraphResponse[]) => {
      mockResponses = responses;
      callIndex = 0;
    },
    // Mock the graph.call() pattern — the adapter calls graph.call(endpointFn, params)
    call: vi.fn(
      async (
        endpointFn: (...args: unknown[]) => {
          method: string;
          path: string;
          params?: Record<string, unknown>;
          paramDefs?: Record<string, string[]>;
        },
        ...args: unknown[]
      ) => {
        const endpoint = endpointFn(...args);
        // Resolve path template params like {team-id} → actual values
        let resolvedPath = endpoint.path;
        if (endpoint.params && endpoint.paramDefs) {
          for (const param of endpoint.paramDefs.path || []) {
            const val = endpoint.params[param];
            if (val !== undefined) {
              resolvedPath = resolvedPath.replace(`{${param}}`, String(val));
            }
          }
        }
        apiCalls.push({ url: resolvedPath });
        const response = mockResponses[callIndex] || { value: [] };
        callIndex++;
        return response;
      }
    ),
    reset: () => {
      callIndex = 0;
      apiCalls.length = 0;
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
  const adapterInternal = adapter as unknown as {
    app: { graph: unknown };
    graphReader: { deps: { graph: unknown } };
  };
  adapterInternal.app.graph = mockClient;
  adapterInternal.graphReader.deps.graph = mockClient;
}
