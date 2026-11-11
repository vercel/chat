/**
 * Teams test utilities for creating mock adapters, activities, and webhook requests.
 * Updated for TeamsSDK (@microsoft/teams.apps) migration.
 */

import { EventEmitter } from "node:events";
import { encodeThreadId, TeamsAdapter } from "@chat-adapter/teams";
import { type Mock, vi } from "vitest";

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
  conversationType?: "channel" | "groupChat" | "personal";
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
    conversationType = "groupChat",
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
      conversationType,
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
export function createTeamsWebhookRequest(activity: unknown): Request {
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
 * The fields of an inbound activity the harness routes on.
 */
export interface MockTeamsActivity {
  id?: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Mock of the SDK's `IStreamer`, covering the members the adapter uses.
 */
export interface MockTeamsStreamer {
  canceled: boolean;
  clearText: Mock<() => void>;
  close: Mock<() => Promise<undefined>>;
  closed: boolean;
  emit: Mock<(activity: unknown) => void>;
  events: EventEmitter;
  update: Mock<(text: string) => void>;
}

/**
 * Mock `IActivityContext` the harness passes to the adapter for one request.
 */
export interface MockTeamsContext {
  activity: MockTeamsActivity;
  api: unknown;
  next: Mock<() => void>;
  send: Mock<(activity: unknown) => Promise<{ id: string; type: string }>>;
  stream: MockTeamsStreamer;
}

let mockStreamCounter = 0;

/**
 * Create a mock streamer. Like the SDK, it reports each sent chunk through
 * `events` after `emit()` returns, carrying the streamed message's id.
 */
function createMockTeamsStreamer(): MockTeamsStreamer {
  mockStreamCounter++;
  const messageId = `stream-message-${mockStreamCounter}`;
  const events = new EventEmitter();
  const streamer: MockTeamsStreamer = {
    canceled: false,
    closed: false,
    events,
    emit: vi.fn(() => {
      streamer.closed = false;
      queueMicrotask(() => {
        events.emit("chunk", { id: messageId, type: "typing" });
      });
    }),
    update: vi.fn(() => {
      streamer.closed = false;
    }),
    clearText: vi.fn(),
    close: vi.fn(async () => {
      streamer.closed = true;
      return undefined;
    }),
  };
  return streamer;
}

function createMockTeamsContext(
  activity: MockTeamsActivity,
  mockApp: MockTeamsApp
): MockTeamsContext {
  return {
    activity,
    api: mockApp.api,
    stream: createMockTeamsStreamer(),
    send: vi.fn(async (act: unknown) => {
      mockApp.sentActivities.push(act);
      return { id: `ctx-response-${Date.now()}`, type: "message" };
    }),
    next: vi.fn(),
  };
}

/**
 * Create mock TeamsSDK App for testing.
 * Mocks the API client layer (conversations, reactions) and tracks sent activities.
 */
export function createMockTeamsApp() {
  const sentActivities: unknown[] = [];
  const contexts = new Map<string, MockTeamsContext[]>();
  const updatedActivities: unknown[] = [];
  const deletedActivities: string[] = [];
  const createdConversations: Array<{
    conversationId: string;
    userId: string;
  }> = [];

  let conversationCounter = 0;

  const mockSendTo = vi.fn(async (_target: unknown, activity: unknown) => {
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
    /** Mock contexts passed to the adapter, by activity id, in dispatch order. */
    contexts,
    sentActivities,
    updatedActivities,
    deletedActivities,
    createdConversations,
    sendTo: mockSendTo,
    api: mockApi,
    /** The adapter resolves a per-thread connector client; serve the same mock. */
    apiFor: vi.fn(() => mockApi),
    graph: mockGraph,
    initialize: vi.fn(async () => undefined),
    /** Backwards-compat alias for api.conversations.create */
    createConversationAsync: mockConversationCreate,
    clearMocks: () => {
      contexts.clear();
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
 * Replaces the internal App instance with a mock and registers a route on the
 * adapter's own bridge, so `handleWebhook` runs the shipped `dispatch` and
 * per-request webhook options.
 */
export function injectMockTeamsApp(
  adapter: TeamsAdapter,
  mockApp: MockTeamsApp
): void {
  const adapterInternal = adapter as unknown as {
    appInstance: unknown;
    config: { appId?: string };
  };

  adapterInternal.appInstance = {
    id: adapterInternal.config.appId || TEAMS_APP_ID,
    sendTo: mockApp.sendTo,
    api: mockApp.api,
    apiFor: mockApp.apiFor,
    graph: mockApp.graph,
    initialize: mockApp.initialize,
    on: vi.fn(),
    use: vi.fn(),
  };

  TeamsAdapterHarness.registerRoute(adapter, mockApp);
}

function isInvokeResponse(value: unknown): value is MockTeamsRouteResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { status?: unknown }).status === "number"
  );
}

interface MockTeamsRouteResponse {
  body?: unknown;
  status: number;
}

/**
 * Never instantiated. Extending the adapter gives the harness typed access to
 * its protected bridge and handlers, so signature drift fails typecheck.
 */
class TeamsAdapterHarness extends TeamsAdapter {
  static registerRoute(adapter: TeamsAdapter, mockApp: MockTeamsApp): void {
    const internals = adapter as TeamsAdapterHarness;
    internals.bridgeAdapter.registerRoute(
      "POST",
      "/api/messages",
      async ({ body }) => {
        const activity = body as MockTeamsActivity;
        const ctx = createMockTeamsContext(activity, mockApp);
        if (activity.id) {
          const recorded = mockApp.contexts.get(activity.id) ?? [];
          recorded.push(ctx);
          mockApp.contexts.set(activity.id, recorded);
        }

        // Mirrors the SDK's App.process: run the handler, close the stream,
        // then wrap non-invoke results in a 200.
        const result = await TeamsAdapterHarness.route(internals, ctx);
        await ctx.stream.close();
        return isInvokeResponse(result)
          ? result
          : { status: 200, body: result };
      }
    );
  }

  /** Mirrors the routes `registerEventHandlers` adds to the SDK App. */
  private static async route(
    adapter: TeamsAdapterHarness,
    ctx: MockTeamsContext
  ): Promise<unknown> {
    // The mock ctx implements only the IActivityContext members the adapter reads.
    const sdkCtx = ctx as never;
    const activity = ctx.activity as never;
    switch (ctx.activity.type) {
      case "message":
        adapter.cacheUserContext(activity);
        await adapter.handleMessageActivity(sdkCtx);
        return;
      case "messageUpdate":
        adapter.cacheUserContext(activity);
        await adapter.handleMessageUpdateActivity(sdkCtx);
        return;
      case "messageReaction":
        adapter.cacheUserContext(activity);
        adapter.handleReactionFromContext(sdkCtx);
        return;
      case "invoke":
        adapter.cacheUserContext(activity);
        await adapter.handleAdaptiveCardAction(sdkCtx);
        return;
      default:
        return;
    }
  }
}

/**
 * Get expected Teams thread ID format
 */
export function getTeamsThreadId(
  conversationId: string,
  serviceUrl: string,
  conversationType: "channel" | "groupChat" | "personal" = "groupChat"
): string {
  return encodeThreadId({ conversationId, conversationType, serviceUrl });
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
