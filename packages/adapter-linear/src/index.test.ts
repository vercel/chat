import { createHmac } from "node:crypto";
import type { ChatInstance, StateAdapter } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LinearAgentSessionCommentRawMessage,
  LinearCommentRawMessage,
  LinearInstallation,
} from "./index";
import { createLinearAdapter, LinearAdapter } from "./index";

const WEBHOOK_SECRET = "test-webhook-secret";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mock logger that captures calls */
function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createRawCommentMessage(
  overrides?: Partial<LinearCommentRawMessage["comment"]> & {
    user?: Partial<LinearCommentRawMessage["comment"]["user"]>;
  }
): LinearCommentRawMessage {
  const user = overrides?.user ?? {};
  return {
    kind: "comment",
    organizationId: "org-123",
    comment: {
      id: overrides?.id ?? "comment-abc123",
      body: overrides?.body ?? "Hello from Linear!",
      issueId: overrides?.issueId ?? "issue-123",
      user: {
        id: user.id ?? "user-456",
        displayName: user.displayName ?? "Test User",
        fullName: user.fullName ?? "Test User",
        email: user.email,
        avatarUrl: user.avatarUrl,
        type: user.type ?? "user",
      },
      parentId: overrides?.parentId,
      createdAt: overrides?.createdAt ?? "2025-01-29T12:00:00.000Z",
      updatedAt: overrides?.updatedAt ?? "2025-01-29T12:00:00.000Z",
      url: overrides?.url,
    },
  };
}

function attachLegacyClientAlias(adapter: LinearAdapter): LinearAdapter {
  Object.defineProperty(adapter, "linearClient", {
    configurable: true,
    get() {
      return (adapter as unknown as { defaultClient: unknown }).defaultClient;
    },
    set(value: unknown) {
      (adapter as unknown as { defaultClient: unknown }).defaultClient = value;
    },
  });

  return adapter;
}

function setDefaultClient(adapter: LinearAdapter, client: unknown): void {
  (adapter as unknown as { defaultClient: unknown }).defaultClient = client;
}

function setBotUserId(adapter: LinearAdapter, botUserId: string): void {
  (adapter as unknown as { defaultBotUserId: string }).defaultBotUserId =
    botUserId;
}

function setDefaultOrganizationId(
  adapter: LinearAdapter,
  organizationId: string
): void {
  (
    adapter as unknown as {
      defaultOrganizationId: string;
    }
  ).defaultOrganizationId = organizationId;
}

function setClientCredentialsState(
  adapter: LinearAdapter,
  clientCredentials: {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
  },
  accessTokenExpiry?: number | null
): void {
  (
    adapter as unknown as {
      clientCredentials: {
        clientId: string;
        clientSecret: string;
        scopes: string[];
      };
      accessTokenExpiry: number | null;
    }
  ).clientCredentials = {
    clientId: clientCredentials.clientId,
    clientSecret: clientCredentials.clientSecret,
    scopes: clientCredentials.scopes ?? [
      "read",
      "write",
      "comments:create",
      "issues:create",
    ],
  };

  if (accessTokenExpiry !== undefined) {
    (
      adapter as unknown as {
        accessTokenExpiry: number | null;
      }
    ).accessTokenExpiry = accessTokenExpiry;
  }
}

function expectCommentRawMessage(raw: {
  kind: string;
}): LinearCommentRawMessage {
  if (raw.kind !== "comment") {
    throw new Error(`Expected a comment raw message, got ${raw.kind}`);
  }

  return raw as LinearCommentRawMessage;
}

function expectAgentSessionCommentRawMessage(raw: {
  kind: string;
}): LinearAgentSessionCommentRawMessage {
  if (raw.kind !== "agent_session_comment") {
    throw new Error(
      `Expected an agent session comment raw message, got ${raw.kind}`
    );
  }

  return raw as LinearAgentSessionCommentRawMessage;
}

function createMockState(): StateAdapter & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>();
  return {
    cache,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi.fn().mockResolvedValue(null),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(cache.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      cache.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      cache.delete(key);
      return Promise.resolve();
    }),
    appendToList: vi.fn().mockResolvedValue(undefined),
    getList: vi.fn().mockResolvedValue([]),
  };
}

function createMockChatInstance(
  state: StateAdapter,
  logger = createMockLogger(),
  userName = "test-bot"
): ChatInstance {
  return {
    processMessage: vi.fn(),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processOptionsLoad: vi.fn().mockResolvedValue(undefined),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
    processSlashCommand: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
    getState: () => state,
    getUserName: () => userName,
    getLogger: () => logger,
  };
}

/**
 * Create a minimal LinearAdapter for testing thread ID methods.
 * We pass a dummy apiKey - it won't be used for encoding/decoding.
 */
function createTestAdapter(
  mode?: "agent-sessions" | "comments"
): LinearAdapter {
  const adapter = attachLegacyClientAlias(
    new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: "test-secret",
      userName: "test-bot",
      ...(mode ? { mode } : {}),
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    })
  );

  setBotUserId(adapter, "bot-user-id");
  return adapter;
}

function createMultiTenantAdapter(
  logger = createMockLogger(),
  mode?: "agent-sessions" | "comments"
): LinearAdapter {
  const adapter = attachLegacyClientAlias(
    new LinearAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      ...(mode ? { mode } : {}),
      logger,
    })
  );

  setBotUserId(adapter, "bot-user-id");
  return adapter;
}

function createClientCredentialsAdapter(
  logger = createMockLogger(),
  scopes?: string[]
): LinearAdapter {
  const adapter = attachLegacyClientAlias(
    new LinearAdapter({
      clientCredentials: {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes,
      },
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      logger,
    })
  );

  setBotUserId(adapter, "bot-user-id");
  return adapter;
}

function createInstallation(
  overrides?: Partial<LinearInstallation>
): LinearInstallation {
  return {
    organizationId: "org-123",
    accessToken: "org-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 600_000,
    botUserId: "bot-user-id",
    ...overrides,
  };
}

function createMockAgentActivityPayload(
  id: string,
  content: Record<string, unknown>,
  createdAt = "2025-06-01T12:00:01.000Z"
) {
  return {
    success: true,
    agentActivity: Promise.resolve({
      id,
      agentSessionId: "session-789",
      createdAt,
      updatedAt: createdAt,
      content,
      sourceComment: Promise.resolve({
        id: `comment-${id}`,
        body: typeof content.body === "string" ? content.body : "",
        parentId: "comment-root",
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
        url: `https://linear.app/comment/${id}`,
        user: Promise.resolve(undefined),
        botActor: Promise.resolve({
          id: "bot-user-id",
          name: "Test Bot",
          userDisplayName: "Test Bot",
        }),
      }),
    }),
  };
}

function buildOAuthCallbackRequest(
  params: Record<string, string | undefined>
): Request {
  const url = new URL("https://example.com/api/linear/install/callback");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return new Request(url, { method: "GET" });
}

/**
 * Create an adapter with the known webhook secret and a mock logger.
 */
function createWebhookAdapter(
  logger = createMockLogger(),
  mode?: "agent-sessions" | "comments"
): LinearAdapter {
  const adapter = attachLegacyClientAlias(
    new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      ...(mode ? { mode } : {}),
      logger,
    })
  );

  setBotUserId(adapter, "bot-user-id");
  return adapter;
}

/**
 * Generate a valid HMAC-SHA256 signature for a body.
 */
function signPayload(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Build a mock Request for webhook testing.
 */
function buildWebhookRequest(body: string, signature?: string | null): Request {
  const headers = new Headers({
    "content-type": "application/json",
  });
  if (signature !== null && signature !== undefined) {
    headers.set("linear-signature", signature);
  }
  return new Request("https://example.com/webhook/linear", {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Create a valid comment webhook payload.
 */
function createCommentPayload(overrides?: {
  action?: string;
  userId?: string;
  issueId?: string;
  commentId?: string;
  parentId?: string;
  body?: string;
  actorType?: "user" | "application" | "integration";
}) {
  return {
    type: "Comment",
    action: overrides?.action ?? "create",
    createdAt: "2025-06-01T12:00:00.000Z",
    organizationId: "org-123",
    url: "https://linear.app/test/issue/TEST-1#comment-abc",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    data: {
      id: overrides?.commentId ?? "comment-abc",
      body: overrides?.body ?? "Hello from webhook",
      issueId: overrides?.issueId ?? "issue-123",
      userId: overrides?.userId ?? "user-456",
      user: {
        id: overrides?.userId ?? "user-456",
        name: "Test User",
        email: undefined,
        avatarUrl: undefined,
        url: "https://linear.app/gitbook-x/profiles/Test User",
      },
      createdAt: "2025-06-01T12:00:00.000Z",
      updatedAt: "2025-06-01T12:00:00.000Z",
      parentId: overrides?.parentId,
    },
    actor: {
      id: overrides?.userId ?? "user-456",
      name: "Test User",
      type: overrides?.actorType ?? "user",
    },
  };
}

/**
 * Create a valid reaction webhook payload.
 */
function createReactionPayload(overrides?: {
  action?: string;
  emoji?: string;
  commentId?: string;
}) {
  return {
    type: "Reaction",
    action: overrides?.action ?? "create",
    createdAt: "2025-06-01T12:00:00.000Z",
    organizationId: "org-123",
    url: "https://linear.app/test/issue/TEST-1",
    webhookId: "webhook-2",
    webhookTimestamp: Date.now(),
    data: {
      id: "reaction-1",
      emoji: overrides?.emoji ?? "\u{1F44D}",
      commentId: overrides?.commentId ?? "comment-abc",
      userId: "user-456",
    },
    actor: {
      id: "user-456",
      name: "Test User",
      type: "user" as const,
    },
  };
}

function createAgentSessionPayload(overrides?: {
  action?: "created" | "prompted";
  activityBody?: string;
  activityId?: string;
  appUserId?: string;
  commentId?: string;
  creator?: {
    avatarUrl?: string;
    email?: string;
    id: string;
    name: string;
    url: string;
  } | null;
  creatorId?: string;
  creatorName?: string;
  issueId?: string;
  promptContext?: string;
  sessionId?: string;
  sourceCommentBody?: string;
  sourceCommentId?: string | null;
}) {
  const sourceCommentId =
    overrides && "sourceCommentId" in overrides
      ? overrides.sourceCommentId
      : "comment-source";
  const creator =
    overrides && "creator" in overrides
      ? overrides.creator
      : {
          id: overrides?.creatorId ?? "user-456",
          name: overrides?.creatorName ?? "Test User",
          email: undefined,
          avatarUrl: undefined,
          url: "https://linear.app/test/profiles/test-user",
        };

  return {
    type: "AgentSessionEvent",
    action: overrides?.action ?? "created",
    createdAt: "2025-06-01T12:00:00.000Z",
    appUserId: overrides?.appUserId ?? "bot-user-id",
    oauthClientId: "oauth-client-123",
    organizationId: "org-123",
    webhookId: "webhook-agent-1",
    webhookTimestamp: Date.now(),
    promptContext:
      overrides?.promptContext ?? "Issue TEST-1\n\n@get-bot Hello there",
    agentSession: {
      id: overrides?.sessionId ?? "agent-session-1",
      appUserId: overrides?.appUserId ?? "bot-user-id",
      issueId: overrides?.issueId ?? "issue-123",
      commentId: overrides?.commentId ?? "comment-root",
      sourceCommentId,
      comment: {
        id: overrides?.commentId ?? "comment-root",
        body: overrides?.sourceCommentBody ?? "@test-bot Hello there",
        userId: creator?.id,
      },
      creator,
      sourceMetadata: {
        type: "comment",
        agentSessionMetadata: {
          sourceCommentId:
            sourceCommentId ?? overrides?.commentId ?? "comment-source",
        },
      },
      status: "active",
      summary: "Help with the issue",
    },
    agentActivity: {
      id: overrides?.activityId ?? "agent-activity-1",
      body: overrides?.activityBody ?? "Hello from app actor",
      createdAt: "2025-06-01T12:00:00.000Z",
      updatedAt: "2025-06-01T12:00:00.000Z",
      content: {
        type: overrides?.action === "prompted" ? "prompt" : "prompt",
        body: overrides?.activityBody ?? "Hello from app actor",
      },
    },
    previousComments: [
      {
        id: "previous-comment-1",
        body: "Previous discussion",
      },
    ],
    guidance: [{ body: "Be concise" }],
    actor: {
      id: "user-456",
      name: "Test User",
      type: "user" as const,
    },
  };
}

describe("encodeThreadId", () => {
  it("should encode an issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "abc123-def456-789",
    });
    expect(result).toBe("linear:abc123-def456-789");
  });

  it("should encode a UUID issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    });
    expect(result).toBe("linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9");
  });

  it("should encode a comment-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "issue-123",
      commentId: "comment-456",
    });
    expect(result).toBe("linear:issue-123:c:comment-456");
  });

  it("should encode a comment-level thread with UUIDs", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result).toBe(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9:c:a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    );
  });

  it("should encode an agent-session issue thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "issue-123",
      agentSessionId: "session-789",
    });
    expect(result).toBe("linear:issue-123:s:session-789");
  });

  it("should encode an agent-session comment thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "issue-123",
      commentId: "comment-456",
      agentSessionId: "session-789",
    });
    expect(result).toBe("linear:issue-123:c:comment-456:s:session-789");
  });
});

describe("decodeThreadId", () => {
  it("should decode an issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("linear:abc123-def456-789");
    expect(result).toEqual({ issueId: "abc123-def456-789" });
  });

  it("should decode a UUID issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9"
    );
    expect(result).toEqual({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    });
  });

  it("should decode a comment-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("linear:issue-123:c:comment-456");
    expect(result).toEqual({
      issueId: "issue-123",
      commentId: "comment-456",
    });
  });

  it("should decode a comment-level thread with UUIDs", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9:c:a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    );
    expect(result).toEqual({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
  });

  it("should decode an agent-session issue thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("linear:issue-123:s:session-789");
    expect(result).toEqual({
      issueId: "issue-123",
      agentSessionId: "session-789",
    });
  });

  it("should decode an agent-session comment thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId(
      "linear:issue-123:c:comment-456:s:session-789"
    );
    expect(result).toEqual({
      issueId: "issue-123",
      commentId: "comment-456",
      agentSessionId: "session-789",
    });
  });

  it("should throw on invalid prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("slack:C123:ts123")).toThrow(
      "Invalid Linear thread ID"
    );
  });

  it("should throw on empty issue ID", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("linear:")).toThrow(
      "Invalid Linear thread ID format"
    );
  });

  it("should throw on completely wrong format", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("nonsense")).toThrow(
      "Invalid Linear thread ID"
    );
  });
});

describe("encodeThreadId / decodeThreadId roundtrip", () => {
  it("should round-trip issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const original = { issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9" };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("should round-trip comment-level thread ID", () => {
    const adapter = createTestAdapter();
    const original = {
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("should round-trip agent-session comment thread ID", () => {
    const adapter = createTestAdapter();
    const original = {
      issueId: "issue-123",
      commentId: "comment-456",
      agentSessionId: "session-789",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("renderFormatted", () => {
  it("should render markdown from AST", () => {
    const adapter = createTestAdapter();
    // Create a simple AST manually
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: "Hello world" }],
        },
      ],
    };
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("Hello world");
  });
});

describe("parseMessage", () => {
  it("should parse a raw Linear message", () => {
    const adapter = createTestAdapter();
    const raw = createRawCommentMessage();
    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("comment-abc123");
    expect(message.text).toBe("Hello from Linear!");
    expect(message.author.userId).toBe("user-456");
  });

  it("should detect edited messages", () => {
    const adapter = createTestAdapter();
    const raw = createRawCommentMessage({
      body: "Edited message",
      updatedAt: "2025-01-29T13:00:00.000Z",
    });
    const message = adapter.parseMessage(raw);
    expect(message.metadata.edited).toBe(true);
  });

  it("should handle empty body", () => {
    const adapter = createTestAdapter();
    const raw = createRawCommentMessage({
      id: "comment-empty",
      body: "",
      issueId: "issue-1",
      user: { id: "user-1" },
    });
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("");
    expect(message.metadata.edited).toBe(false);
  });

  it("should set editedAt when message is edited", () => {
    const adapter = createTestAdapter();
    const raw = createRawCommentMessage({
      id: "comment-edited",
      body: "Updated text",
      issueId: "issue-1",
      user: { id: "user-1" },
      updatedAt: "2025-01-29T14:30:00.000Z",
    });
    const message = adapter.parseMessage(raw);
    expect(message.metadata.edited).toBe(true);
    expect(message.metadata.editedAt).toEqual(
      new Date("2025-01-29T14:30:00.000Z")
    );
  });

  it("should not set editedAt when message is not edited", () => {
    const adapter = createTestAdapter();
    const raw = createRawCommentMessage({
      id: "comment-unedited",
      body: "Original text",
      issueId: "issue-1",
      user: { id: "user-1" },
    });
    const message = adapter.parseMessage(raw);
    expect(message.metadata.editedAt).toBeUndefined();
  });

  it("should set isBot to false and isMe to false for regular users", () => {
    const adapter = createTestAdapter();
    const raw = createRawCommentMessage({
      id: "comment-1",
      body: "test",
      issueId: "issue-1",
      user: { id: "user-1" },
    });
    const message = adapter.parseMessage(raw);
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("should parse an agent session comment raw message like a comment", () => {
    const adapter = createTestAdapter("agent-sessions");
    const raw = {
      kind: "agent_session_comment" as const,
      organizationId: "org-123",
      agentSessionId: "session-123",
      comment: {
        ...createRawCommentMessage({
          body: "Hello from an agent session",
        }).comment,
      },
    };

    const message = adapter.parseMessage(raw);

    expect(message.id).toBe("comment-abc123");
    expect(message.text).toBe("Hello from an agent session");
    expect(message.author.userId).toBe("user-456");
    expect(message.raw.kind).toBe("agent_session_comment");
  });
});

// =============================================================================
// Constructor / auth modes
// =============================================================================

describe("constructor", () => {
  it("should create adapter with apiKey auth", () => {
    const adapter = new LinearAdapter({
      apiKey: "lin_api_key_123",
      webhookSecret: "secret",
      userName: "my-bot",
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("linear");
    expect(adapter.userName).toBe("my-bot");
  });

  it("should create adapter with accessToken auth", () => {
    const adapter = new LinearAdapter({
      accessToken: "lin_oauth_token_123",
      webhookSecret: "secret",
      userName: "my-bot",
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("linear");
  });

  it("should create adapter with clientId/clientSecret auth", () => {
    const adapter = new LinearAdapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      webhookSecret: "secret",
      userName: "my-bot",
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("linear");
  });

  it("should throw when no auth method provided", () => {
    expect(
      () =>
        new LinearAdapter({
          webhookSecret: "secret",
          userName: "my-bot",
          logger: createMockLogger(),
        } as never)
    ).toThrow("Authentication is required");
  });

  it("should throw when botUserId is accessed before initialization", () => {
    const adapter = new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: "test-secret",
      userName: "test-bot",
      logger: createMockLogger(),
    });

    expect(() => adapter.botUserId).toThrow(
      "No bot user ID available in context"
    );
  });
});

// =============================================================================
// channelIdFromThreadId
// =============================================================================

describe("channelIdFromThreadId", () => {
  it("should return issue-level channel for issue-level thread", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId("linear:issue-123");
    expect(result).toBe("linear:issue-123");
  });

  it("should strip comment part for comment-level thread", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId(
      "linear:issue-123:c:comment-456"
    );
    expect(result).toBe("linear:issue-123");
  });

  it("should throw for invalid thread ID", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.channelIdFromThreadId("slack:C123:ts")).toThrow(
      "Invalid Linear thread ID"
    );
  });
});

// =============================================================================
// Webhook signature verification
// =============================================================================

describe("handleWebhook - signature verification", () => {
  it("should reject requests without a signature", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const request = buildWebhookRequest(body, null);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing webhook signature");
  });

  it("should reject requests with an invalid signature", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const request = buildWebhookRequest(body, "invalid-hex-signature");
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid webhook");
  });

  it("should reject requests with wrong signature (different secret)", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const wrongSig = signPayload(body, "wrong-secret");
    const request = buildWebhookRequest(body, wrongSig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid webhook");
  });

  it("should accept requests with a valid signature", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// =============================================================================
// Webhook - timestamp validation
// =============================================================================

describe("handleWebhook - timestamp validation", () => {
  it("should reject webhooks with timestamps older than 1 minute", async () => {
    const adapter = createWebhookAdapter();
    const payload = createCommentPayload();
    // Set timestamp to 10 minutes ago
    payload.webhookTimestamp = Date.now() - 10 * 60 * 1000;
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid webhook");
  });

  it("should accept webhooks within the SDK verification window", async () => {
    const adapter = createWebhookAdapter();
    const payload = createCommentPayload();
    payload.webhookTimestamp = Date.now() - 30 * 1000;
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("should accept webhooks without a timestamp", async () => {
    const adapter = createWebhookAdapter();
    const payload = createCommentPayload();
    // Remove timestamp
    const { webhookTimestamp: _, ...payloadWithoutTimestamp } = payload;
    const body = JSON.stringify(payloadWithoutTimestamp);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// =============================================================================
// Webhook - invalid JSON
// =============================================================================

describe("handleWebhook - invalid JSON", () => {
  it("should return 400 for invalid JSON body", async () => {
    const adapter = createWebhookAdapter();
    const body = "not-valid-json{{{";
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid webhook");
  });
});

// =============================================================================
// Webhook - comment created handling
// =============================================================================

describe("handleWebhook - comment created", () => {
  it("should process comment create events via chat.processMessage", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledWith(
      adapter,
      "linear:issue-123:c:comment-abc",
      expect.objectContaining({
        id: "comment-abc",
        text: "Hello from webhook",
      }),
      undefined
    );
  });

  it("should use parentId as root comment when present (threaded reply)", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({
      commentId: "reply-1",
      parentId: "root-comment-id",
    });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledWith(
      adapter,
      "linear:issue-123:c:root-comment-id",
      expect.objectContaining({ id: "reply-1" }),
      undefined
    );
  });

  it("should skip non-create comment actions", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ action: "update" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });

  it("should skip comments without issueId", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    // Remove issueId to simulate project update comment
    (payload.data as Record<string, unknown>).issueId = undefined;
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Ignoring non-issue comment",
      expect.any(Object)
    );
  });

  it("should mark bot-authored comments as self", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;
    setBotUserId(adapter, "bot-user-id");

    const payload = createCommentPayload({ userId: "bot-user-id" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.userId).toBe("bot-user-id");
    expect(message.author.isMe).toBe(true);
  });

  it("should ignore comments when chat is not initialized", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    // chat is null by default (not initialized)

    const payload = createCommentPayload();
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "Chat instance not initialized, ignoring comment"
    );
  });
});

describe("handleWebhook - agent session events", () => {
  it("ignores agent session events in comment mode", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "comments");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;

    const payload = createAgentSessionPayload();
    const body = JSON.stringify(payload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(body, signPayload(body))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Received AgentSessionEvent webhook but adapter is not in agent-sessions mode, ignoring"
    );
  });

  it("dispatches created events in agent-session mode when owned by this bot", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "agent-sessions");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;

    const payload = createAgentSessionPayload();
    const body = JSON.stringify(payload);
    const request = buildWebhookRequest(body, signPayload(body));
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const message = chat.processMessage.mock.calls[0][2];
    expect(message.threadId).toBe(
      "linear:issue-123:c:comment-root:s:agent-session-1"
    );
    expect(message.author.userId).toBe("user-456");
    expect(message.author.userName).toBe("test-user");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("routes prompted events to the same session thread without mention flag", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "agent-sessions");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;

    const payload = createAgentSessionPayload({
      action: "prompted",
      activityBody: "Can you elaborate?",
    });
    const body = JSON.stringify(payload);
    const request = buildWebhookRequest(body, signPayload(body));
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("falls back to the bot author when a created session has no creator", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "agent-sessions");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;

    const payload = createAgentSessionPayload({
      creator: null,
    });
    const body = JSON.stringify(payload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(body, signPayload(body))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const message = chat.processMessage.mock.calls[0][2];
    expect(message.author.userId).toBe("bot-user-id");
    expect(message.author.userName).toBe("test-bot");
    expect(message.author.isBot).toBe(true);
    expect(message.author.isMe).toBe(true);
  });

  it("ignores comment webhooks in agent-session mode", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "agent-sessions");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;

    const commentPayload = createCommentPayload({
      commentId: "comment-source",
      body: "@test-bot hello",
    });
    const commentBody = JSON.stringify(commentPayload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(commentBody, signPayload(commentBody))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("does not emit an automatic acknowledgement for created events", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "agent-sessions");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;
    setDefaultOrganizationId(adapter, "org-123");

    const mockRawRequest = vi.fn();
    setDefaultClient(adapter, {
      client: {
        rawRequest: mockRawRequest,
      },
    });

    const payload = createAgentSessionPayload();
    const body = JSON.stringify(payload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(body, signPayload(body))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    expect(mockRawRequest).not.toHaveBeenCalled();
  });

  it("ignores created events that belong to another bot", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger, "agent-sessions");
    const chat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof chat }).chat = chat;

    const payload = createAgentSessionPayload({
      appUserId: "other-bot-id",
    });
    const body = JSON.stringify(payload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(body, signPayload(body))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Ignoring agent session event from another bot",
      expect.objectContaining({
        agentSessionId: "agent-session-1",
        appUserId: "other-bot-id",
      })
    );
  });

  it("dispatches created events in multi-tenant agent-session mode", async () => {
    const logger = createMockLogger();
    const adapter = createMultiTenantAdapter(logger, "agent-sessions");
    const state = createMockState();
    const chat = createMockChatInstance(state, logger);
    await adapter.initialize(chat);
    await adapter.setInstallation("org-123", createInstallation());

    const sessionPayload = createAgentSessionPayload({
      commentId: "comment-abc",
      sourceCommentBody: "@test-bot hello",
      sourceCommentId: null,
    });
    const sessionBody = JSON.stringify(sessionPayload);
    const sessionResponse = await adapter.handleWebhook(
      buildWebhookRequest(sessionBody, signPayload(sessionBody))
    );

    expect(sessionResponse.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const message = chat.processMessage.mock.calls[0][2];
    expect(message.threadId).toBe(
      "linear:issue-123:c:comment-abc:s:agent-session-1"
    );
  });

  it("ignores comment webhooks in multi-tenant agent-session mode", async () => {
    const logger = createMockLogger();
    const adapter = createMultiTenantAdapter(logger, "agent-sessions");
    const state = createMockState();
    const chat = createMockChatInstance(state, logger);
    await adapter.initialize(chat);
    await adapter.setInstallation("org-123", createInstallation());

    const commentPayload = createCommentPayload({
      body: "@test-bot hello",
      commentId: "comment-abc",
    });
    const commentBody = JSON.stringify(commentPayload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(commentBody, signPayload(commentBody))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("ignores comment webhooks in agent-session mode even if they mention chat userName", async () => {
    const logger = createMockLogger();
    const adapter = attachLegacyClientAlias(
      new LinearAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        mode: "agent-sessions",
        webhookSecret: WEBHOOK_SECRET,
        logger,
      })
    );
    const state = createMockState();
    const chat = createMockChatInstance(state, logger, "getsquad-dev-samy");
    await adapter.initialize(chat);
    await adapter.setInstallation("org-123", createInstallation());

    const commentPayload = createCommentPayload({
      body: "@getsquad-dev-samy hello",
      commentId: "comment-abc",
    });
    const commentBody = JSON.stringify(commentPayload);
    const response = await adapter.handleWebhook(
      buildWebhookRequest(commentBody, signPayload(commentBody))
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Webhook - reaction handling
// =============================================================================

describe("handleWebhook - reaction events", () => {
  it("should log reaction events", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createReactionPayload({ emoji: "\u{1F525}" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(logger.debug).toHaveBeenCalledWith(
      "Received reaction webhook",
      expect.objectContaining({
        emoji: "\u{1F525}",
        action: "create",
      })
    );
  });

  it("should silently return when chat is not initialized for reactions", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    // chat is null

    const payload = createReactionPayload();
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    // Should not log debug since chat is null
    expect(logger.debug).not.toHaveBeenCalledWith(
      "Received reaction webhook",
      expect.any(Object)
    );
  });
});

// =============================================================================
// Webhook - unknown event types
// =============================================================================

describe("handleWebhook - unknown event types", () => {
  it("should return 200 for unhandled event types", async () => {
    const adapter = createWebhookAdapter();
    const payload = {
      type: "Issue",
      action: "create",
      webhookTimestamp: Date.now(),
      data: { id: "issue-1" },
      actor: { id: "user-1", name: "Test", type: "user" },
    };
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });
});

// =============================================================================
// buildMessage (tested indirectly through webhook handling)
// =============================================================================

describe("buildMessage via webhook", () => {
  it("should set author fields from webhook comment user", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ actorType: "user" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.userName).toBe("Test User");
    expect(message.author.fullName).toBe("Test User");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("should ignore application actor type for comment authors", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ actorType: "application" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.isBot).toBe(false);
  });

  it("should ignore integration actor type for comment authors", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ actorType: "integration" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.isBot).toBe(false);
  });

  it("should set dateSent from createdAt", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    payload.data.createdAt = "2025-03-15T10:30:00.000Z";
    payload.data.updatedAt = "2025-03-15T10:30:00.000Z";
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.metadata.dateSent).toEqual(
      new Date("2025-03-15T10:30:00.000Z")
    );
    expect(message.metadata.edited).toBe(false);
  });

  it("should detect edited messages from differing createdAt/updatedAt", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    payload.data.createdAt = "2025-03-15T10:30:00.000Z";
    payload.data.updatedAt = "2025-03-15T11:00:00.000Z";
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.metadata.edited).toBe(true);
    expect(message.metadata.editedAt).toEqual(
      new Date("2025-03-15T11:00:00.000Z")
    );
  });

  it("should include raw comment data in message", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = createMockChatInstance(createMockState(), logger);
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ body: "Some text" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    const raw = expectCommentRawMessage(message.raw);
    expect(raw.comment.body).toBe("Some text");
    expect(raw.comment.issueId).toBe("issue-123");
    expect(raw.organizationId).toBe("org-123");
  });
});

// =============================================================================
// postMessage
// =============================================================================

describe("postMessage", () => {
  it("should create comment via linearClient.createComment", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockComment = {
      id: "new-comment-1",
      body: "Bot reply",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/new-comment-1",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    const result = await adapter.postMessage(
      "linear:issue-123:c:parent-comment",
      "Hello from bot"
    );

    expect(mockCreateComment).toHaveBeenCalledWith({
      issueId: "issue-123",
      body: "Hello from bot",
      parentId: "parent-comment",
    });
    expect(result.id).toBe("new-comment-1");
    expect(result.threadId).toBe("linear:issue-123:c:parent-comment");
    expect(expectCommentRawMessage(result.raw).comment.body).toBe("Bot reply");
  });

  it("should create top-level comment for issue-level threads", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockComment = {
      id: "top-comment-1",
      body: "Top-level comment",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/top-comment-1",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    await adapter.postMessage("linear:issue-123", "Hello");

    expect(mockCreateComment).toHaveBeenCalledWith({
      issueId: "issue-123",
      body: "Hello",
      parentId: undefined,
    });
  });

  it("should throw when comment creation returns null", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(null),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    await expect(
      adapter.postMessage("linear:issue-123", "Hello")
    ).rejects.toThrow("Failed to create comment on Linear issue");
  });

  it("should handle AST message format", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockComment = {
      id: "ast-comment-1",
      body: "AST text",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/ast-comment-1",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    await adapter.postMessage("linear:issue-123", {
      markdown: "**bold text**",
    });

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-123",
      })
    );
    // The body should contain the markdown content
    const calledBody = mockCreateComment.mock.calls[0][0].body;
    expect(calledBody).toContain("bold text");
  });

  it("should call ensureValidToken before posting", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockComment = {
      id: "token-check-1",
      body: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
      url: "https://linear.app/test",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    // Spy on ensureValidToken
    const ensureSpy = vi
      .spyOn(adapter as never, "ensureValidToken" as never)
      .mockResolvedValue(undefined as never);

    await adapter.postMessage("linear:issue-123", "test");
    expect(ensureSpy).toHaveBeenCalled();

    ensureSpy.mockRestore();
  });
});

// =============================================================================
// editMessage
// =============================================================================

describe("editMessage", () => {
  it("should update comment via linearClient.updateComment", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockComment = {
      id: "edited-comment-1",
      body: "Updated body",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T13:00:00.000Z"),
      url: "https://linear.app/test/comment/edited-comment-1",
    };
    const mockUpdateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { updateComment: typeof mockUpdateComment };
      }
    ).linearClient = {
      updateComment: mockUpdateComment,
    } as never;

    const result = await adapter.editMessage(
      "linear:issue-123:c:parent-comment",
      "edited-comment-1",
      "Updated body"
    );

    expect(mockUpdateComment).toHaveBeenCalledWith("edited-comment-1", {
      body: "Updated body",
    });
    expect(result.id).toBe("edited-comment-1");
    const raw = expectCommentRawMessage(result.raw);
    expect(raw.comment.body).toBe("Updated body");
    expect(raw.comment.issueId).toBe("issue-123");
  });

  it("should throw when comment update returns null", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockUpdateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(null),
    });
    (
      adapter as unknown as {
        linearClient: { updateComment: typeof mockUpdateComment };
      }
    ).linearClient = {
      updateComment: mockUpdateComment,
    } as never;

    await expect(
      adapter.editMessage("linear:issue-123", "comment-1", "Updated")
    ).rejects.toThrow("Failed to update comment on Linear");
  });
});

// =============================================================================
// deleteMessage
// =============================================================================

describe("deleteMessage", () => {
  it("should call linearClient.deleteComment with the message ID", async () => {
    const adapter = createWebhookAdapter();
    const mockDeleteComment = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { deleteComment: typeof mockDeleteComment };
      }
    ).linearClient = {
      deleteComment: mockDeleteComment,
    } as never;

    await adapter.deleteMessage("linear:issue-123", "comment-to-delete");

    expect(mockDeleteComment).toHaveBeenCalledWith("comment-to-delete");
  });
});

// =============================================================================
// addReaction
// =============================================================================

describe("addReaction", () => {
  it("should create reaction with emoji string", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    await adapter.addReaction("linear:issue-123", "comment-1", "rocket");

    expect(mockCreateReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "\u{1F680}",
    });
  });

  it("should create reaction with EmojiValue object", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    await adapter.addReaction("linear:issue-123", "comment-1", {
      name: "heart",
    });

    expect(mockCreateReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "\u{2764}\u{FE0F}",
    });
  });

  it("should pass through unknown emoji names", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    await adapter.addReaction("linear:issue-123", "comment-1", "custom_emoji");

    expect(mockCreateReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "custom_emoji",
    });
  });

  it("should resolve all known emoji mappings", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    const knownEmoji: Record<string, string> = {
      thumbs_up: "\u{1F44D}",
      thumbs_down: "\u{1F44E}",
      heart: "\u{2764}\u{FE0F}",
      fire: "\u{1F525}",
      rocket: "\u{1F680}",
      eyes: "\u{1F440}",
      check: "\u{2705}",
      warning: "\u{26A0}\u{FE0F}",
      sparkles: "\u{2728}",
      wave: "\u{1F44B}",
      raised_hands: "\u{1F64C}",
      laugh: "\u{1F604}",
      hooray: "\u{1F389}",
      confused: "\u{1F615}",
    };

    for (const [name, unicode] of Object.entries(knownEmoji)) {
      mockCreateReaction.mockClear();
      await adapter.addReaction("linear:issue-123", "comment-1", name);
      expect(mockCreateReaction).toHaveBeenCalledWith({
        commentId: "comment-1",
        emoji: unicode,
      });
    }
  });
});

// =============================================================================
// removeReaction
// =============================================================================

describe("removeReaction", () => {
  it("should log a warning since it is not fully supported", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      logger,
    });

    await adapter.removeReaction("linear:issue-123", "comment-1", "heart");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("removeReaction is not fully supported")
    );
  });
});

// =============================================================================
// startTyping
// =============================================================================

describe("startTyping", () => {
  it("should be a no-op (Linear does not support typing indicators)", async () => {
    const adapter = createTestAdapter();
    // Should not throw
    await adapter.startTyping("linear:issue-123");
  });
});

// =============================================================================
// fetchMessages
// =============================================================================

describe("fetchMessages", () => {
  it("should fetch issue-level comments when no commentId in thread", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockUser = {
      id: "user-1",
      displayName: "Alice",
      name: "Alice Smith",
    };
    const mockComments = [
      {
        id: "comment-1",
        body: "First comment",
        userId: "user-1",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/1",
        user: Promise.resolve(mockUser),
      },
      {
        id: "comment-2",
        body: "Second comment",
        userId: "user-1",
        createdAt: new Date("2025-06-01T11:00:00.000Z"),
        updatedAt: new Date("2025-06-01T11:00:00.000Z"),
        url: "https://linear.app/comment/2",
        user: Promise.resolve(mockUser),
      },
    ];
    const mockIssue = {
      organizationId: "org-xyz",
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(mockLinearClient.issue).toHaveBeenCalledWith("issue-abc");
    expect(mockIssue.comments).toHaveBeenCalledWith({ first: 50 });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("First comment");
    expect(result.messages[1].text).toBe("Second comment");
    expect(result.messages[0].raw.organizationId).toBe("org-xyz");
    expect(result.nextCursor).toBeUndefined();
  });

  it("should fetch comment thread (root + children) when commentId present", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockUser = {
      id: "user-1",
      displayName: "Bob",
      name: "Bob Jones",
    };
    const mockRootComment = {
      id: "root-comment",
      body: "Root comment",
      userId: "user-1",
      createdAt: new Date("2025-06-01T10:00:00.000Z"),
      updatedAt: new Date("2025-06-01T10:00:00.000Z"),
      url: "https://linear.app/comment/root",
      user: Promise.resolve(mockUser),
    };
    const mockChildrenConnection = {
      nodes: [
        {
          id: "child-1",
          body: "Reply",
          userId: "user-1",
          createdAt: new Date("2025-06-01T11:00:00.000Z"),
          updatedAt: new Date("2025-06-01T11:00:00.000Z"),
          url: "https://linear.app/comment/child-1",
          user: Promise.resolve(mockUser),
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const mockLinearClient = {
      comment: vi.fn().mockResolvedValue(mockRootComment),
      comments: vi.fn().mockResolvedValue(mockChildrenConnection),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages(
      "linear:issue-abc:c:root-comment"
    );

    expect(mockLinearClient.comment).toHaveBeenCalledWith({
      id: "root-comment",
    });
    expect(mockLinearClient.comments).toHaveBeenCalledWith({
      filter: {
        parent: { id: { eq: "root-comment" } },
      },
      last: 50,
    });
    // Root comment + 1 child
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("Root comment");
    expect(result.messages[1].text).toBe("Reply");
  });

  it("should fetch agent session threads as visible comments only", async () => {
    const adapter = createWebhookAdapter(undefined, "agent-sessions");
    setDefaultOrganizationId(adapter, "org-xyz");
    setBotUserId(adapter, "bot-id");

    const mockRootComment = {
      id: "root-comment",
      body: "@test-bot Hello",
      parentId: undefined,
      userId: "user-1",
      createdAt: new Date("2025-06-01T10:00:00.000Z"),
      updatedAt: new Date("2025-06-01T10:00:00.000Z"),
      url: "https://linear.app/comment/root",
      user: Promise.resolve({
        id: "user-1",
        displayName: "Alice",
        name: "Alice Smith",
      }),
    };
    const mockChildrenConnection = {
      nodes: [
        {
          id: "bot-comment",
          body: "Hi there",
          parentId: "root-comment",
          createdAt: new Date("2025-06-01T10:01:00.000Z"),
          updatedAt: new Date("2025-06-01T10:01:00.000Z"),
          url: "https://linear.app/comment/bot",
          user: Promise.resolve(undefined),
          botActor: Promise.resolve({
            id: "bot-id",
            name: "Test Bot",
            userDisplayName: "Test Bot",
          }),
        },
        {
          id: "user-follow-up",
          body: "What is Argos?",
          parentId: "root-comment",
          userId: "user-1",
          createdAt: new Date("2025-06-01T10:02:00.000Z"),
          updatedAt: new Date("2025-06-01T10:02:00.000Z"),
          url: "https://linear.app/comment/user-follow-up",
          user: Promise.resolve({
            id: "user-1",
            displayName: "Alice",
            name: "Alice Smith",
          }),
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const mockLinearClient = {
      agentSession: vi.fn().mockResolvedValue({
        id: "session-789",
        issueId: "issue-abc",
        commentId: "root-comment",
        comment: Promise.resolve(mockRootComment),
      }),
      comments: vi.fn().mockResolvedValue(mockChildrenConnection),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages(
      "linear:issue-abc:c:root-comment:s:session-789"
    );

    expect(mockLinearClient.agentSession).toHaveBeenCalledWith("session-789");
    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((message) => message.raw.kind)).toEqual([
      "agent_session_comment",
      "agent_session_comment",
      "agent_session_comment",
    ]);
    expect(result.messages[1].author.isBot).toBe(true);
    expect(result.messages[1].author.isMe).toBe(true);
    expect(result.messages[2].text).toBe("What is Argos?");
    expect(
      expectAgentSessionCommentRawMessage(result.messages[1].raw).agentSessionId
    ).toBe("session-789");
  });

  it("should surface root comment lookup failures", async () => {
    const adapter = createWebhookAdapter();
    const mockLinearClient = {
      comment: vi
        .fn()
        .mockRejectedValue(new Error("Could not find referenced comment")),
      comments: vi.fn().mockResolvedValue({
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    await expect(
      adapter.fetchMessages("linear:issue-abc:c:nonexistent")
    ).rejects.toThrow("Could not find referenced comment");
    expect(mockLinearClient.comment).toHaveBeenCalledWith({
      id: "nonexistent",
    });
    expect(mockLinearClient.comments).toHaveBeenCalledWith({
      filter: {
        parent: { id: { eq: "nonexistent" } },
      },
      last: 50,
    });
  });

  it("should pass limit option to API", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    await adapter.fetchMessages("linear:issue-abc", { limit: 10 });

    expect(mockIssue.comments).toHaveBeenCalledWith({ first: 10 });
  });

  it("should return nextCursor when hasNextPage is true", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "cursor-abc" },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.nextCursor).toBe("cursor-abc");
  });

  it("should detect edited messages in fetched comments", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockUser = {
      id: "user-1",
      displayName: "Alice",
      name: "Alice Smith",
    };
    const mockComments = [
      {
        id: "comment-edited",
        body: "Edited text",
        userId: "user-1",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T12:00:00.000Z"),
        url: "https://linear.app/comment/1",
        user: Promise.resolve(mockUser),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.messages[0].metadata.edited).toBe(true);
    expect(result.messages[0].metadata.editedAt).toEqual(
      new Date("2025-06-01T12:00:00.000Z")
    );
  });

  it("should set isMe true when user matches botUserId", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    setBotUserId(adapter, "bot-id");

    const mockUser = {
      id: "bot-id",
      displayName: "BotUser",
      name: "Bot",
    };
    const mockComments = [
      {
        id: "comment-bot",
        body: "Bot message",
        userId: "bot-id",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/bot",
        user: Promise.resolve(mockUser),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.messages[0].author.isMe).toBe(true);
    expect(result.messages[0].author.userId).toBe("bot-id");
  });

  it("should resolve bot-authored comments from botActor when userId is missing", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    setBotUserId(adapter, "bot-id");
    const mockComments = [
      {
        id: "comment-bot-actor",
        body: "Delegated reply",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/delegated",
        user: Promise.resolve(undefined),
        botActor: Promise.resolve({
          id: "bot-id",
          name: "Delegation Bot",
          userDisplayName: "Delegation Bot",
        }),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.messages[0].author.userId).toBe("bot-id");
    expect(result.messages[0].author.userName).toBe("Delegation Bot");
    expect(result.messages[0].author.isBot).toBe(true);
    expect(result.messages[0].author.isMe).toBe(true);
  });

  it("should throw when a comment has neither userId nor botActor", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockComments = [
      {
        id: "comment-no-user",
        body: "Orphan comment",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/orphan",
        user: Promise.resolve(undefined),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    await expect(adapter.fetchMessages("linear:issue-abc")).rejects.toThrow(
      "Comment comment-no-user has no userId and no botActor, cannot determine author."
    );
  });
});

// =============================================================================
// fetchThread
// =============================================================================

describe("fetchThread", () => {
  it("should return thread info for an issue", async () => {
    const adapter = createWebhookAdapter();
    const mockIssue = {
      identifier: "TEST-42",
      title: "Fix the thing",
      url: "https://linear.app/test/issue/TEST-42",
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchThread("linear:issue-uuid-123");

    expect(result.id).toBe("linear:issue-uuid-123");
    expect(result.channelId).toBe("issue-uuid-123");
    expect(result.channelName).toBe("TEST-42: Fix the thing");
    expect(result.isDM).toBe(false);
    expect(result.metadata).toEqual({
      issueId: "issue-uuid-123",
      identifier: "TEST-42",
      title: "Fix the thing",
      url: "https://linear.app/test/issue/TEST-42",
    });
  });

  it("should extract issueId from comment-level thread", async () => {
    const adapter = createWebhookAdapter();
    const mockIssue = {
      identifier: "BUG-99",
      title: "Regression",
      url: "https://linear.app/test/issue/BUG-99",
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    await adapter.fetchThread("linear:issue-xyz:c:comment-abc");

    // Should call with the issueId only
    expect(mockLinearClient.issue).toHaveBeenCalledWith("issue-xyz");
  });
});

// =============================================================================
// initialize
// =============================================================================

describe("initialize", () => {
  it("should fetch bot user ID on initialize", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);

    const mockRawRequest = vi.fn().mockResolvedValue({
      data: {
        viewer: {
          id: "viewer-id-123",
          displayName: "My Bot",
          organization: {
            id: "org-123",
          },
        },
      },
    });
    setDefaultClient(adapter, {
      client: { rawRequest: mockRawRequest },
    });

    const mockChat = createMockChatInstance(createMockState(), logger);

    await adapter.initialize(mockChat);

    expect(adapter.botUserId).toBe("viewer-id-123");
    expect(logger.info).toHaveBeenCalledWith(
      "Linear auth completed",
      expect.objectContaining({
        botUserId: "viewer-id-123",
        displayName: "My Bot",
        organizationId: "org-123",
      })
    );
  });

  it("should warn when viewer fetch fails", async () => {
    const logger = createMockLogger();
    const adapter = attachLegacyClientAlias(
      new LinearAdapter({
        apiKey: "test-api-key",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot",
        logger,
      })
    );

    const failingClient: Record<string, unknown> = {
      client: { rawRequest: vi.fn() },
    };
    Object.defineProperty(failingClient, "viewer", {
      get: () => Promise.reject(new Error("Auth failed")),
    });
    setDefaultClient(adapter, failingClient);

    const mockChat = createMockChatInstance(createMockState(), logger);

    await adapter.initialize(mockChat);

    expect(() => adapter.botUserId).toThrow(
      "No bot user ID available in context"
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Could not fetch Linear bot user ID",
      expect.any(Object)
    );
  });

  it("should refresh token for client credentials mode", async () => {
    const logger = createMockLogger();
    const adapter = createClientCredentialsAdapter(logger);

    // Mock the fetch call for token refresh
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-token-123",
          expires_in: 2592000, // 30 days
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    vi.spyOn(
      adapter as never,
      "fetchClientIdentity" as never
    ).mockResolvedValue({
      botUserId: "viewer-id-123",
      displayName: "My Bot",
      organizationId: "org-123",
    } as never);

    const mockChat = createMockChatInstance(createMockState(), logger);

    await adapter.initialize(mockChat);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = requestInit.body as URLSearchParams;
    expect(body.get("scope")).toBe("read,write,comments:create,issues:create");
  });
});

// =============================================================================
// ensureValidToken
// =============================================================================

describe("ensureValidToken", () => {
  it("should not refresh when no client credentials", async () => {
    const adapter = createWebhookAdapter();
    const refreshSpy = vi.spyOn(
      adapter as never,
      "refreshClientCredentialsToken" as never
    );

    await (
      adapter as unknown as {
        ensureValidToken: () => Promise<void>;
      }
    ).ensureValidToken();

    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("should refresh when token is expired", async () => {
    const adapter = createWebhookAdapter();
    setClientCredentialsState(
      adapter,
      {
        clientId: "test-client",
        clientSecret: "test-secret",
      },
      Date.now() - 1000
    );

    const refreshSpy = vi
      .spyOn(adapter as never, "refreshClientCredentialsToken" as never)
      .mockResolvedValue(undefined as never);

    await (
      adapter as unknown as {
        ensureValidToken: () => Promise<void>;
      }
    ).ensureValidToken();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it("should not refresh when token is still valid", async () => {
    const adapter = createWebhookAdapter();
    setClientCredentialsState(
      adapter,
      {
        clientId: "test-client",
        clientSecret: "test-secret",
      },
      Date.now() + 86400000
    );

    const refreshSpy = vi
      .spyOn(adapter as never, "refreshClientCredentialsToken" as never)
      .mockResolvedValue(undefined as never);

    await (
      adapter as unknown as {
        ensureValidToken: () => Promise<void>;
      }
    ).ensureValidToken();

    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// refreshClientCredentialsToken
// =============================================================================

describe("refreshClientCredentialsToken", () => {
  it("should throw on failed token fetch", async () => {
    const adapter = createClientCredentialsAdapter();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      (
        adapter as unknown as {
          refreshClientCredentialsToken: () => Promise<void>;
        }
      ).refreshClientCredentialsToken()
    ).rejects.toThrow(
      "Failed to fetch Linear client credentials token: 401 Unauthorized"
    );
  });

  it("should be a no-op when clientCredentials is null", async () => {
    const adapter = createWebhookAdapter(); // API key mode, no client credentials

    // Should not throw
    await (
      adapter as unknown as {
        refreshClientCredentialsToken: () => Promise<void>;
      }
    ).refreshClientCredentialsToken();
  });

  it("should set accessTokenExpiry with 1 hour buffer", async () => {
    const logger = createMockLogger();
    const adapter = createClientCredentialsAdapter(logger);

    const expiresIn = 2592000; // 30 days in seconds
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token-123",
          expires_in: expiresIn,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const before = Date.now();
    await (
      adapter as unknown as {
        refreshClientCredentialsToken: () => Promise<void>;
      }
    ).refreshClientCredentialsToken();
    const after = Date.now();

    const expiry = (adapter as unknown as { accessTokenExpiry: number })
      .accessTokenExpiry;
    // expiry should be approximately now + expiresIn*1000 - 3600000 (1 hour buffer)
    const expectedMin = before + expiresIn * 1000 - 3600000;
    const expectedMax = after + expiresIn * 1000 - 3600000;
    expect(expiry).toBeGreaterThanOrEqual(expectedMin);
    expect(expiry).toBeLessThanOrEqual(expectedMax);

    expect(logger.info).toHaveBeenCalledWith(
      "Linear client credentials token obtained",
      expect.objectContaining({ expiresIn: "30 days" })
    );
  });

  it("should use custom scopes for client credentials token fetch", async () => {
    const logger = createMockLogger();
    const adapter = createClientCredentialsAdapter(logger, [
      "read",
      "write",
      "comments:create",
      "app:mentionable",
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token-123",
          expires_in: 2592000,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await (
      adapter as unknown as {
        refreshClientCredentialsToken: () => Promise<void>;
      }
    ).refreshClientCredentialsToken();

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = requestInit.body as URLSearchParams;
    expect(body.get("scope")).toBe(
      "read,write,comments:create,app:mentionable"
    );
  });
});

// =============================================================================
// Updated runtime/auth coverage
// =============================================================================

describe("runtime operations", () => {
  it("postMessage uses the default client and preserves organizationId", async () => {
    const adapter = createWebhookAdapter();
    setBotUserId(adapter, "bot-user-id");
    setDefaultOrganizationId(adapter, "org-123");

    const mockComment = {
      id: "new-comment-1",
      body: "Bot reply",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/new-comment-1",
    };
    const mockClient = {
      createComment: vi.fn().mockResolvedValue({
        comment: Promise.resolve(mockComment),
      }),
    };
    setDefaultClient(adapter, mockClient);

    const result = await adapter.postMessage(
      "linear:issue-123:c:parent-comment",
      "Hello from bot"
    );

    expect(mockClient.createComment).toHaveBeenCalledWith({
      issueId: "issue-123",
      body: "Hello from bot",
      parentId: "parent-comment",
    });
    expect(result.raw.organizationId).toBe("org-123");
    expect(expectCommentRawMessage(result.raw).comment.user.id).toBe(
      "bot-user-id"
    );
  });

  it("editMessage uses the default client and preserves organizationId", async () => {
    const adapter = createWebhookAdapter();
    setBotUserId(adapter, "bot-user-id");
    setDefaultOrganizationId(adapter, "org-123");

    const mockComment = {
      id: "edited-comment-1",
      body: "Updated body",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T13:00:00.000Z"),
      url: "https://linear.app/test/comment/edited-comment-1",
    };
    const mockClient = {
      updateComment: vi.fn().mockResolvedValue({
        comment: Promise.resolve(mockComment),
      }),
    };
    setDefaultClient(adapter, mockClient);

    const result = await adapter.editMessage(
      "linear:issue-123:c:parent-comment",
      "edited-comment-1",
      "Updated body"
    );

    expect(mockClient.updateComment).toHaveBeenCalledWith("edited-comment-1", {
      body: "Updated body",
    });
    expect(result.raw.organizationId).toBe("org-123");
  });

  it("deleteMessage and addReaction use the current client", async () => {
    const adapter = createWebhookAdapter();
    const mockClient = {
      deleteComment: vi.fn().mockResolvedValue(undefined),
      createReaction: vi.fn().mockResolvedValue(undefined),
    };
    setDefaultClient(adapter, mockClient);

    await adapter.deleteMessage("linear:issue-123", "comment-1");
    await adapter.addReaction("linear:issue-123", "comment-1", "rocket");

    expect(mockClient.deleteComment).toHaveBeenCalledWith("comment-1");
    expect(mockClient.createReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "\u{1F680}",
    });
  });

  it("fetchMessages uses the current client for issue threads", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-xyz");
    const mockUser = {
      id: "user-1",
      displayName: "Alice",
      name: "Alice Smith",
    };
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "comment-1",
            body: "First comment",
            userId: "user-1",
            createdAt: new Date("2025-06-01T10:00:00.000Z"),
            updatedAt: new Date("2025-06-01T10:00:00.000Z"),
            url: "https://linear.app/comment/1",
            user: Promise.resolve(mockUser),
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    const mockClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    setDefaultClient(adapter, mockClient);

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(mockClient.issue).toHaveBeenCalledWith("issue-abc");
    expect(result.messages[0].raw.organizationId).toBe("org-xyz");
    expect(result.messages[0].author.userName).toBe("Alice");
  });

  it("fetchThread uses the current client", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockClient = {
      issue: vi.fn().mockResolvedValue({
        identifier: "TEST-42",
        title: "Fix the thing",
        url: "https://linear.app/test/issue/TEST-42",
      }),
    };
    setDefaultClient(adapter, mockClient);

    const result = await adapter.fetchThread("linear:issue-uuid-123");

    expect(result.channelName).toBe("TEST-42: Fix the thing");
    expect(mockClient.issue).toHaveBeenCalledWith("issue-uuid-123");
  });

  it("postMessage uses agentActivityCreate for agent-session threads", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockCreateAgentActivity = vi.fn().mockResolvedValue({
      success: true,
      agentActivity: Promise.resolve({
        id: "activity-123",
        agentSessionId: "session-789",
        createdAt: "2025-06-01T12:00:00.000Z",
        updatedAt: "2025-06-01T12:00:00.000Z",
        content: {
          type: "response",
          body: "Agent response",
        },
        sourceComment: Promise.resolve({
          id: "comment-activity-123",
          body: "Agent response",
          parentId: "comment-root",
          createdAt: new Date("2025-06-01T12:00:01.000Z"),
          updatedAt: new Date("2025-06-01T12:00:01.000Z"),
          url: "https://linear.app/comment/comment-activity-123",
          user: Promise.resolve(undefined),
          botActor: Promise.resolve({
            id: "bot-user-id",
            name: "Test Bot",
            userDisplayName: "Test Bot",
          }),
        }),
      }),
    });
    setDefaultClient(adapter, {
      createAgentActivity: mockCreateAgentActivity,
    });

    const result = await adapter.postMessage(
      "linear:issue-123:c:comment-root:s:session-789",
      "Agent response"
    );

    expect(mockCreateAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "session-789",
      content: {
        type: "response",
        body: "Agent response",
      },
    });
    expect(result.id).toBe("comment-activity-123");
    expect(result.raw.kind).toBe("agent_session_comment");
    expect(result.raw.organizationId).toBe("org-123");
    expect(result.author.isBot).toBe(true);
    expect(result.author.isMe).toBe(true);
    expect(expectAgentSessionCommentRawMessage(result.raw).agentSessionId).toBe(
      "session-789"
    );
  });

  it("startTyping uses ephemeral thought activities for agent-session threads", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockCreateAgentActivity = vi.fn().mockResolvedValue({
      success: true,
      agentActivity: {
        id: "activity-thinking",
        createdAt: "2025-06-01T12:00:00.000Z",
        updatedAt: "2025-06-01T12:00:00.000Z",
        content: {
          type: "thought",
          body: "Looking things up...",
        },
      },
    });
    setDefaultClient(adapter, {
      createAgentActivity: mockCreateAgentActivity,
    });

    await adapter.startTyping(
      "linear:issue-123:c:comment-root:s:session-789",
      "Looking things up..."
    );

    expect(mockCreateAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "session-789",
      ephemeral: true,
      content: {
        type: "thought",
        body: "Looking things up...",
      },
    });
  });

  it("stream creates action activities for task updates and returns the final response activity", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockCreateAgentActivity = vi
      .fn()
      .mockResolvedValueOnce(
        createMockAgentActivityPayload("activity-opening", {
          type: "response",
          body: "Hello\n",
        })
      )
      .mockResolvedValueOnce(
        createMockAgentActivityPayload("activity-task", {
          type: "action",
          action: "Search docs",
          result: "Started",
        })
      )
      .mockResolvedValueOnce(
        createMockAgentActivityPayload("activity-final", {
          type: "response",
          body: "world",
        })
      );
    const mockUpdateAgentSession = vi.fn().mockResolvedValue({
      success: true,
    });
    setDefaultClient(adapter, {
      createAgentActivity: mockCreateAgentActivity,
      updateAgentSession: mockUpdateAgentSession,
    });

    async function* textStream() {
      yield "Hello\n";
      yield {
        type: "task_update" as const,
        id: "task-1",
        title: "Search docs",
        status: "in_progress" as const,
        output: "Started",
      };
      yield { type: "markdown_text" as const, text: "world" };
    }

    const result = await adapter.stream(
      "linear:issue-123:c:comment-root:s:session-789",
      textStream()
    );

    expect(mockCreateAgentActivity).toHaveBeenNthCalledWith(1, {
      agentSessionId: "session-789",
      content: {
        type: "thought",
        body: "Hello",
      },
    });
    expect(mockCreateAgentActivity).toHaveBeenNthCalledWith(2, {
      agentSessionId: "session-789",
      content: {
        type: "action",
        action: "Search docs",
        result: "Started",
        parameter: "",
      },
      ephemeral: true,
    });
    expect(mockCreateAgentActivity).toHaveBeenNthCalledWith(3, {
      agentSessionId: "session-789",
      content: {
        type: "response",
        body: "world",
      },
    });
    expect(mockUpdateAgentSession).not.toHaveBeenCalled();
    expect(result.id).toBe("comment-activity-final");
    expect(result.raw.kind).toBe("agent_session_comment");
  });

  it("stream creates error activities for failed task updates", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockCreateAgentActivity = vi
      .fn()
      .mockResolvedValueOnce(
        createMockAgentActivityPayload("activity-opening", {
          type: "response",
          body: "Hello\n",
        })
      )
      .mockResolvedValueOnce(
        createMockAgentActivityPayload("activity-error", {
          type: "error",
          body: "Search docs\nBoom",
        })
      )
      .mockResolvedValueOnce(
        createMockAgentActivityPayload("activity-final", {
          type: "response",
          body: "world",
        })
      );
    const mockUpdateAgentSession = vi.fn().mockResolvedValue({
      success: true,
    });
    setDefaultClient(adapter, {
      createAgentActivity: mockCreateAgentActivity,
      updateAgentSession: mockUpdateAgentSession,
    });

    async function* textStream() {
      yield "Hello\n";
      yield {
        type: "task_update" as const,
        id: "task-1",
        title: "Search docs",
        status: "error" as const,
        output: "Boom",
      };
      yield { type: "markdown_text" as const, text: "world" };
    }

    const result = await adapter.stream(
      "linear:issue-123:c:comment-root:s:session-789",
      textStream()
    );

    expect(mockCreateAgentActivity).toHaveBeenNthCalledWith(1, {
      agentSessionId: "session-789",
      content: {
        type: "thought",
        body: "Hello",
      },
    });
    expect(mockCreateAgentActivity).toHaveBeenNthCalledWith(2, {
      agentSessionId: "session-789",
      content: {
        type: "error",
        body: "Search docs\nBoom",
      },
    });
    expect(mockCreateAgentActivity).toHaveBeenNthCalledWith(3, {
      agentSessionId: "session-789",
      content: {
        type: "response",
        body: "world",
      },
    });
    expect(mockUpdateAgentSession).not.toHaveBeenCalled();
    expect(result.id).toBe("comment-activity-final");
    expect(result.raw.kind).toBe("agent_session_comment");
  });

  it("stream updates the session plan for plan updates and posts a final response", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockCreateAgentActivity = vi.fn().mockResolvedValue(
      createMockAgentActivityPayload("activity-final", {
        type: "response",
        body: "Hello world",
      })
    );
    const mockUpdateAgentSession = vi.fn().mockResolvedValue({
      success: true,
    });
    setDefaultClient(adapter, {
      createAgentActivity: mockCreateAgentActivity,
      updateAgentSession: mockUpdateAgentSession,
    });

    async function* textStream() {
      yield {
        type: "plan_update" as const,
        title: "Search docs",
      };
      yield "Hello world";
    }

    const result = await adapter.stream(
      "linear:issue-123:c:comment-root:s:session-789",
      textStream()
    );

    expect(mockUpdateAgentSession).toHaveBeenCalledWith("session-789", {
      plan: [
        {
          content: "Search docs",
          status: "completed",
        },
      ],
    });
    expect(mockCreateAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "session-789",
      content: {
        type: "response",
        body: "Hello world",
      },
    });
    expect(result.id).toBe("comment-activity-final");
    expect(result.raw.kind).toBe("agent_session_comment");
  });

  it("editMessage and deleteMessage throw for agent-session threads", async () => {
    const adapter = createWebhookAdapter();

    await expect(
      adapter.editMessage(
        "linear:issue-123:c:comment-root:s:session-789",
        "activity-1",
        "Updated"
      )
    ).rejects.toThrow("append-only");

    await expect(
      adapter.deleteMessage(
        "linear:issue-123:c:comment-root:s:session-789",
        "activity-1"
      )
    ).rejects.toThrow("append-only");
  });

  it("fetchThread includes issue metadata for session threads", async () => {
    const adapter = createWebhookAdapter();
    setDefaultOrganizationId(adapter, "org-123");
    const mockIssue = {
      identifier: "TEST-42",
      title: "Fix the thing",
      url: "https://linear.app/test/issue/TEST-42",
    };
    setDefaultClient(adapter, {
      issue: vi.fn().mockResolvedValue(mockIssue),
    });

    const result = await adapter.fetchThread(
      "linear:issue-123:c:comment-root:s:session-789"
    );

    expect(result.metadata).toEqual(
      expect.objectContaining({
        issueId: "issue-123",
        agentSessionId: "session-789",
        identifier: "TEST-42",
        title: "Fix the thing",
        url: "https://linear.app/test/issue/TEST-42",
      })
    );
  });

  it("throws when organizationId is unavailable", async () => {
    const adapter = createWebhookAdapter();
    setBotUserId(adapter, "bot-user-id");
    setDefaultClient(adapter, {
      createComment: vi.fn().mockResolvedValue({
        comment: Promise.resolve({
          id: "new-comment-1",
          body: "Bot reply",
          createdAt: new Date("2025-06-01T12:00:00.000Z"),
          updatedAt: new Date("2025-06-01T12:00:00.000Z"),
          url: "https://linear.app/test/comment/new-comment-1",
        }),
      }),
    });

    await expect(
      adapter.postMessage("linear:issue-123", "Hello from bot")
    ).rejects.toThrow("No Linear organization ID available");
  });
});

describe("initialize", () => {
  it("fetches bot identity in default-client mode", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockState = createMockState();
    const chat = createMockChatInstance(mockState, logger);
    const mockRawRequest = vi.fn().mockResolvedValue({
      data: {
        viewer: {
          id: "viewer-id-123",
          displayName: "My Bot",
          organization: {
            id: "org-123",
          },
        },
      },
    });
    setDefaultClient(adapter, {
      client: {
        rawRequest: mockRawRequest,
      },
    });

    await adapter.initialize(chat);

    expect(adapter.botUserId).toBe("viewer-id-123");
    expect(logger.info).toHaveBeenCalledWith(
      "Linear auth completed",
      expect.objectContaining({
        botUserId: "viewer-id-123",
        organizationId: "org-123",
      })
    );
  });

  it("initializes client credentials mode and requests default scopes", async () => {
    const logger = createMockLogger();
    const adapter = createClientCredentialsAdapter(logger);
    const state = createMockState();
    const chat = createMockChatInstance(state, logger);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token-123",
          expires_in: 2_592_000,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(
      adapter as never,
      "fetchClientIdentity" as never
    ).mockResolvedValue({
      botUserId: "viewer-id-123",
      displayName: "My Bot",
      organizationId: "org-123",
    } as never);

    await adapter.initialize(chat);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = requestInit.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("read,write,comments:create,issues:create");
    expect(adapter.botUserId).toBe("viewer-id-123");
  });
});

describe("client credentials auth", () => {
  it("refreshClientCredentialsToken throws on token fetch failure", async () => {
    const adapter = createClientCredentialsAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      })
    );

    await expect(
      (
        adapter as unknown as {
          refreshClientCredentialsToken: () => Promise<void>;
        }
      ).refreshClientCredentialsToken()
    ).rejects.toThrow(
      "Failed to fetch Linear client credentials token: 401 Unauthorized"
    );
  });

  it("ensureValidToken refreshes expired client credentials tokens", async () => {
    const adapter = createWebhookAdapter();
    setClientCredentialsState(
      adapter,
      {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
      Date.now() - 1_000
    );

    const refreshSpy = vi
      .spyOn(adapter as never, "refreshClientCredentialsToken" as never)
      .mockResolvedValue(undefined as never);

    await (
      adapter as unknown as {
        ensureValidToken: () => Promise<void>;
      }
    ).ensureValidToken();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it("refreshClientCredentialsToken honors custom scopes", async () => {
    const adapter = createClientCredentialsAdapter(createMockLogger(), [
      "read",
      "write",
      "comments:create",
      "app:mentionable",
    ]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token-123",
          expires_in: 2_592_000,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await (
      adapter as unknown as {
        refreshClientCredentialsToken: () => Promise<void>;
      }
    ).refreshClientCredentialsToken();

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = requestInit.body as URLSearchParams;
    expect(body.get("scope")).toBe(
      "read,write,comments:create,app:mentionable"
    );
  });
});

describe("multi-tenant installations", () => {
  it("handleOAuthCallback exchanges code and stores the installation", async () => {
    const logger = createMockLogger();
    const adapter = createMultiTenantAdapter(logger);
    const state = createMockState();
    const chat = createMockChatInstance(state, logger);
    await adapter.initialize(chat);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "oauth-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(
      adapter as never,
      "fetchClientIdentity" as never
    ).mockResolvedValue({
      botUserId: "bot-user-id",
      displayName: "Linear App",
      organizationId: "org-123",
    } as never);

    const result = await adapter.handleOAuthCallback(
      buildOAuthCallbackRequest({ code: "test-code" }),
      { redirectUri: "https://example.com/api/linear/install/callback" }
    );

    expect(result.organizationId).toBe("org-123");
    expect(result.installation.accessToken).toBe("oauth-token");
    expect(await adapter.getInstallation("org-123")).toEqual(
      expect.objectContaining({
        organizationId: "org-123",
        accessToken: "oauth-token",
        refreshToken: "refresh-token",
        botUserId: "bot-user-id",
      })
    );
  });

  it("handleOAuthCallback rejects callback errors and missing codes", async () => {
    const adapter = createMultiTenantAdapter();
    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    await expect(
      adapter.handleOAuthCallback(
        buildOAuthCallbackRequest({
          error: "access_denied",
          error_description: "user denied access",
        }),
        { redirectUri: "https://example.com/api/linear/install/callback" }
      )
    ).rejects.toThrow(
      "Linear OAuth failed: access_denied - user denied access"
    );

    await expect(
      adapter.handleOAuthCallback(buildOAuthCallbackRequest({}), {
        redirectUri: "https://example.com/api/linear/install/callback",
      })
    ).rejects.toThrow("Missing 'code' query parameter");
  });

  it("withInstallation refreshes expired installations and seeds request context", async () => {
    const adapter = createMultiTenantAdapter();
    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));
    await adapter.setInstallation(
      "org-123",
      createInstallation({
        accessToken: "expired-token",
        expiresAt: Date.now() - 1_000,
      })
    );

    vi.spyOn(adapter as never, "fetchOAuthToken" as never).mockResolvedValue({
      access_token: "refreshed-token",
      refresh_token: "rotated-refresh-token",
      expires_in: 3600,
    } as never);

    await adapter.withInstallation("org-123", async () => {
      expect(adapter.botUserId).toBe("bot-user-id");
      expect(
        (
          adapter as unknown as {
            organizationId: string;
          }
        ).organizationId
      ).toBe("org-123");
    });

    expect(await adapter.getInstallation("org-123")).toEqual(
      expect.objectContaining({
        accessToken: "refreshed-token",
        refreshToken: "rotated-refresh-token",
      })
    );
  });

  it("handleWebhook resolves installations by organizationId", async () => {
    const logger = createMockLogger();
    const adapter = createMultiTenantAdapter(logger);
    const state = createMockState();
    const chat = createMockChatInstance(state, logger);
    await adapter.initialize(chat);
    await adapter.setInstallation("org-123", createInstallation());

    const body = JSON.stringify(createCommentPayload());
    const request = buildWebhookRequest(body, signPayload(body));
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledWith(
      adapter,
      "linear:issue-123:c:comment-abc",
      expect.objectContaining({
        raw: expect.objectContaining({ organizationId: "org-123" }),
      }),
      undefined
    );
  });

  it("handleWebhook skips missing installations and deletes revoked ones", async () => {
    const logger = createMockLogger();
    const adapter = createMultiTenantAdapter(logger);
    const state = createMockState();
    const chat = createMockChatInstance(state, logger);
    await adapter.initialize(chat);

    const missingBody = JSON.stringify(createCommentPayload());
    const missingResponse = await adapter.handleWebhook(
      buildWebhookRequest(missingBody, signPayload(missingBody))
    );
    expect(missingResponse.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear installation found for organization",
      { organizationId: "org-123" }
    );

    await adapter.setInstallation("org-123", createInstallation());
    const revokedBody = JSON.stringify({
      type: "OAuthApp",
      action: "revoked",
      createdAt: "2025-06-01T12:00:00.000Z",
      organizationId: "org-123",
      webhookId: "webhook-3",
      webhookTimestamp: Date.now(),
    });
    const revokedResponse = await adapter.handleWebhook(
      buildWebhookRequest(revokedBody, signPayload(revokedBody))
    );

    expect(revokedResponse.status).toBe(200);
    expect(await adapter.getInstallation("org-123")).toBeNull();
  });
});

// =============================================================================
// createLinearAdapter factory
// =============================================================================

describe("createLinearAdapter", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clean Linear env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("LINEAR_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("should create adapter with apiKey config", () => {
    const adapter = createLinearAdapter({
      apiKey: "lin_api_123",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
    expect(adapter.name).toBe("linear");
  });

  it("should create adapter with accessToken config", () => {
    const adapter = createLinearAdapter({
      accessToken: "lin_oauth_123",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should create adapter with clientId/clientSecret config", () => {
    const adapter = createLinearAdapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      mode: "agent-sessions",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should accept explicit comment mode", () => {
    const adapter = createLinearAdapter({
      apiKey: "lin_api_123",
      mode: "comments",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should throw when webhookSecret is not provided and not in env", () => {
    expect(() => createLinearAdapter({ apiKey: "key" })).toThrow(
      "webhookSecret is required"
    );
  });

  it("should use LINEAR_WEBHOOK_SECRET env var", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    const adapter = createLinearAdapter({ apiKey: "key" });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_API_KEY env var when no auth config provided", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_API_KEY = "env-api-key";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_ACCESS_TOKEN env var when no auth config and no api key", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_ACCESS_TOKEN = "env-access-token";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_CLIENT_ID/SECRET env vars when no other auth", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_CLIENT_ID = "env-client-id";
    process.env.LINEAR_CLIENT_SECRET = "env-client-secret";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_CLIENT_CREDENTIALS env vars before LINEAR_CLIENT_ID/SECRET", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_ID = "env-cc-client-id";
    process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET =
      "env-cc-client-secret";
    process.env.LINEAR_CLIENT_ID = "env-oauth-client-id";
    process.env.LINEAR_CLIENT_SECRET = "env-oauth-client-secret";

    const adapter = createLinearAdapter();

    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should throw when no auth is available", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    expect(() => createLinearAdapter()).toThrow("Authentication is required");
  });

  it("should use LINEAR_BOT_USERNAME env var for userName", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_BOT_USERNAME = "custom-bot-name";
    process.env.LINEAR_API_KEY = "key";
    const adapter = createLinearAdapter();
    expect(adapter.userName).toBe("custom-bot-name");
  });

  it("should default userName to linear-bot", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_API_KEY = "key";
    const adapter = createLinearAdapter();
    expect(adapter.userName).toBe("linear-bot");
  });

  it("should prefer config userName over env var", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_BOT_USERNAME = "env-name";
    const adapter = createLinearAdapter({
      apiKey: "key",
      userName: "config-name",
    });
    expect(adapter.userName).toBe("config-name");
  });

  it("should not mix auth modes - explicit apiKey ignores env accessToken", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_ACCESS_TOKEN = "env-token";
    // Providing apiKey means we have an auth config, so env vars are skipped
    const adapter = createLinearAdapter({ apiKey: "explicit-key" });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should accept custom logger", () => {
    const customLogger = createMockLogger();
    const adapter = createLinearAdapter({
      apiKey: "key",
      webhookSecret: "secret",
      logger: customLogger,
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should accept apiUrl config", () => {
    const adapter = createLinearAdapter({
      apiKey: "lin_api_123",
      webhookSecret: "secret",
      apiUrl: "https://custom-linear.example.com",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
    expect((adapter as unknown as { apiUrl: string }).apiUrl).toBe(
      "https://custom-linear.example.com"
    );
  });

  it("should resolve apiUrl from LINEAR_API_URL env var", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_API_KEY = "env-key";
    process.env.LINEAR_API_URL = "https://custom-linear.example.com";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
    expect((adapter as unknown as { apiUrl: string }).apiUrl).toBe(
      "https://custom-linear.example.com"
    );
  });

  it("should prefer apiUrl config over LINEAR_API_URL env var", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_API_KEY = "env-key";
    process.env.LINEAR_API_URL = "https://env-linear.example.com";
    const adapter = createLinearAdapter({
      apiKey: "key",
      apiUrl: "https://config-linear.example.com",
    });
    expect((adapter as unknown as { apiUrl: string }).apiUrl).toBe(
      "https://config-linear.example.com"
    );
  });
});
