import type { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import {
  connectWebhookContract,
  createMockChatInstance,
  createMockState,
  mockLogger,
  selfMessageContract,
  threadIdContract,
} from "@chat-adapter/tests";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubAdapter, GitHubAdapter } from "./index";
import type {
  GitHubThreadId,
  IssueCommentWebhookPayload,
  PullRequestReviewCommentWebhookPayload,
} from "./types";

// ─── Mock Octokit ────────────────────────────────────────────────────────────

const mockIssuesCreateComment = vi.fn();
const mockIssuesUpdateComment = vi.fn();
const mockIssuesDeleteComment = vi.fn();
const mockIssuesGet = vi.fn();
const mockIssuesListComments = vi.fn();
const mockPullsCreateReplyForReviewComment = vi.fn();
const mockPullsUpdateReviewComment = vi.fn();
const mockPullsDeleteReviewComment = vi.fn();
const mockPullsListReviewComments = vi.fn();
const mockPullsGet = vi.fn();
const mockPullsList = vi.fn();
const mockReactionsCreateForIssueComment = vi.fn();
const mockReactionsCreateForPullRequestReviewComment = vi.fn();
const mockReactionsListForIssueComment = vi.fn();
const mockReactionsListForPullRequestReviewComment = vi.fn();
const mockReactionsDeleteForIssueComment = vi.fn();
const mockReactionsDeleteForPullRequestComment = vi.fn();
const mockUsersGetAuthenticated = vi.fn();
const mockUsersGetByUsername = vi.fn();
const mockAppsGetAuthenticated = vi.fn();
const mockReposGet = vi.fn();
const mockRequest = vi.fn();
const mockHookBefore = vi.fn();

vi.mock("@octokit/rest", () => {
  class MockOctokit {
    issues = {
      createComment: mockIssuesCreateComment,
      updateComment: mockIssuesUpdateComment,
      deleteComment: mockIssuesDeleteComment,
      get: mockIssuesGet,
      listComments: mockIssuesListComments,
    };
    pulls = {
      createReplyForReviewComment: mockPullsCreateReplyForReviewComment,
      updateReviewComment: mockPullsUpdateReviewComment,
      deleteReviewComment: mockPullsDeleteReviewComment,
      listReviewComments: mockPullsListReviewComments,
      get: mockPullsGet,
      list: mockPullsList,
    };
    reactions = {
      createForIssueComment: mockReactionsCreateForIssueComment,
      createForPullRequestReviewComment:
        mockReactionsCreateForPullRequestReviewComment,
      listForIssueComment: mockReactionsListForIssueComment,
      listForPullRequestReviewComment:
        mockReactionsListForPullRequestReviewComment,
      deleteForIssueComment: mockReactionsDeleteForIssueComment,
      deleteForPullRequestComment: mockReactionsDeleteForPullRequestComment,
    };
    users = {
      getAuthenticated: mockUsersGetAuthenticated,
      getByUsername: mockUsersGetByUsername,
    };
    apps = {
      getAuthenticated: mockAppsGetAuthenticated,
    };
    repos = {
      get: mockReposGet,
    };
    request = mockRequest;
    hook = { before: mockHookBefore };
  }
  return { Octokit: MockOctokit };
});

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test-secret";
const INSTALLATION_ERROR_PATTERN = /installation/i;
const TEST_BOT_MENTION_WITH_WHITESPACE_REGEX = /@test-bot\s+hi there/;
const EMPTY_INSTALLATION_TOKEN_PATTERN = /empty installation token/i;
const WEBHOOK_LOG_SENTINELS = [
  "secret-access-token",
  "secret-refresh-token",
  "Bearer secret-token",
  "Authorization",
  "customer-team-slug",
  "access_token",
  "refresh_token",
] as const;

function signPayload(body: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
}

function makeIssueCommentPayload(
  overrides: Partial<IssueCommentWebhookPayload> = {}
): IssueCommentWebhookPayload {
  return {
    action: "created",
    comment: {
      id: 100,
      body: "Hello from test",
      user: { id: 1, login: "testuser", type: "User" },
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
    },
    issue: {
      number: 42,
      title: "Test PR",
      pull_request: { url: "https://api.github.com/repos/acme/app/pulls/42" },
    },
    repository: {
      id: 1,
      name: "app",
      full_name: "acme/app",
      owner: { id: 10, login: "acme", type: "Organization" },
    },
    sender: { id: 1, login: "testuser", type: "User" },
    ...overrides,
  };
}

function makeReviewCommentPayload(
  overrides: Partial<PullRequestReviewCommentWebhookPayload> = {}
): PullRequestReviewCommentWebhookPayload {
  return {
    action: "created",
    comment: {
      id: 200,
      body: "Review comment text",
      user: { id: 2, login: "reviewer", type: "User" },
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      html_url: "https://github.com/acme/app/pull/42#discussion_r200",
      path: "src/index.ts",
      diff_hunk: "@@ -1,3 +1,4 @@",
      commit_id: "abc123",
      original_commit_id: "abc123",
    },
    pull_request: {
      id: 500,
      number: 42,
      title: "Test PR",
      state: "open",
      body: "PR body",
      html_url: "https://github.com/acme/app/pull/42",
      user: { id: 10, login: "acme", type: "Organization" },
    },
    repository: {
      id: 1,
      name: "app",
      full_name: "acme/app",
      owner: { id: 10, login: "acme", type: "Organization" },
    },
    sender: { id: 2, login: "reviewer", type: "User" },
    ...overrides,
  };
}

function makeWebhookRequest(
  body: string,
  eventType: string,
  signature?: string
): Request {
  const headers: Record<string, string> = {
    "x-github-event": eventType,
    "content-type": "application/json",
  };
  if (signature !== undefined) {
    headers["x-hub-signature-256"] = signature;
  }
  return new Request("https://example.com/api/webhooks/github", {
    method: "POST",
    headers,
    body,
  });
}

function stringifyLoggerCalls(): string {
  return JSON.stringify({
    debug: vi.mocked(mockLogger.debug).mock.calls,
    error: vi.mocked(mockLogger.error).mock.calls,
    info: vi.mocked(mockLogger.info).mock.calls,
    warn: vi.mocked(mockLogger.warn).mock.calls,
  });
}

function findLoggedSentinels(): string[] {
  const logCalls = stringifyLoggerCalls();
  return WEBHOOK_LOG_SENTINELS.filter((sentinel) =>
    logCalls.includes(sentinel)
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GitHubAdapter", () => {
  let adapter: GitHubAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitHubAdapter({
      token: "test-token",
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      logger: mockLogger,
    });
  });

  describe("constructor", () => {
    it("should create adapter with PAT config", () => {
      const a = new GitHubAdapter({
        token: "ghp_abc",
        webhookSecret: "secret",
        userName: "bot",
        logger: mockLogger,
      });
      expect(a.name).toBe("github");
      expect(a.userName).toBe("bot");
      expect(a.isMultiTenant).toBe(false);
    });

    it("should create adapter with app + installationId config (single-tenant)", () => {
      const a = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        installationId: 99,
        webhookSecret: "secret",
        userName: "my-bot[bot]",
        logger: mockLogger,
      });
      expect(a.isMultiTenant).toBe(false);
    });

    it("should create adapter in multi-tenant mode (app without installationId)", () => {
      const a = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: "secret",
        userName: "my-bot[bot]",
        logger: mockLogger,
      });
      expect(a.isMultiTenant).toBe(true);
    });

    it("should throw when no auth method is provided", () => {
      expect(
        () =>
          new GitHubAdapter({
            webhookSecret: "secret",
            userName: "bot",
            logger: mockLogger,
          } as never)
      ).toThrow("Authentication is required");
    });

    it("should set botUserId when provided in config", () => {
      const a = new GitHubAdapter({
        token: "ghp_abc",
        webhookSecret: "secret",
        userName: "bot",
        botUserId: 42,
        logger: mockLogger,
      });
      expect(a.botUserId).toBe("42");
    });

    it("should return undefined botUserId when not provided", () => {
      expect(adapter.botUserId).toBeUndefined();
    });
  });

  describe("octokit getter", () => {
    it("should return the underlying Octokit instance in PAT mode", () => {
      const a = new GitHubAdapter({
        token: "ghp_abc",
        webhookSecret: "secret",
        userName: "bot",
        logger: mockLogger,
      });

      const octokit = a.octokit;
      expect(octokit).toBeDefined();
      // Mocked Octokit exposes the rest namespace surface
      expect(octokit.issues).toBeDefined();
      expect(octokit.pulls).toBeDefined();
    });

    it("should return the same instance across calls in single-tenant mode", () => {
      const a = new GitHubAdapter({
        token: "ghp_abc",
        webhookSecret: "secret",
        userName: "bot",
        logger: mockLogger,
      });

      expect(a.octokit).toBe(a.octokit);
    });

    it("should expose the same instance via the deprecated `client` alias", () => {
      const a = new GitHubAdapter({
        token: "ghp_abc",
        webhookSecret: "secret",
        userName: "bot",
        logger: mockLogger,
      });

      expect(a.client).toBe(a.octokit);
    });

    it("should throw in multi-tenant mode when called outside a webhook", () => {
      const a = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: "secret",
        userName: "my-bot[bot]",
        logger: mockLogger,
      });

      expect(() => a.octokit).toThrow(INSTALLATION_ERROR_PATTERN);
      expect(() => a.client).toThrow(INSTALLATION_ERROR_PATTERN);
    });

    it("should resolve the per-installation Octokit when accessed inside a webhook context", () => {
      const a = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: "secret",
        userName: "my-bot[bot]",
        logger: mockLogger,
      });
      const requestContext = (
        a as unknown as {
          requestContext: AsyncLocalStorage<{ installationId?: number }>;
        }
      ).requestContext;

      // Inside an installation context, the same client is returned
      // across calls and the deprecated alias matches.
      let capturedFirst: unknown;
      let capturedSecond: unknown;
      let capturedAlias: unknown;
      requestContext.run({ installationId: 12_345 }, () => {
        capturedFirst = a.octokit;
        capturedSecond = a.octokit;
        capturedAlias = a.client;
      });
      expect(capturedFirst).toBeDefined();
      expect(capturedSecond).toBe(capturedFirst);
      expect(capturedAlias).toBe(capturedFirst);

      // A different installation resolves to a different cached client.
      let capturedOther: unknown;
      requestContext.run({ installationId: 67_890 }, () => {
        capturedOther = a.octokit;
      });
      expect(capturedOther).toBeDefined();
      expect(capturedOther).not.toBe(capturedFirst);

      // Outside of any context, the getter still throws — the per-call
      // context isn't sticky.
      expect(() => a.octokit).toThrow(INSTALLATION_ERROR_PATTERN);
    });
  });

  describe("initialize", () => {
    it("should store chat instance and fetch bot user ID", async () => {
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });

      const mockChat = createMockChatInstance();

      await adapter.initialize(mockChat);

      expect(mockUsersGetAuthenticated).toHaveBeenCalled();
      expect(adapter.botUserId).toBe("777");
    });

    it("should handle auth failure gracefully", async () => {
      mockUsersGetAuthenticated.mockRejectedValueOnce(
        new Error("Bad credentials")
      );
      mockAppsGetAuthenticated.mockRejectedValueOnce(
        new Error("Bad credentials")
      );

      const mockChat = createMockChatInstance();

      await adapter.initialize(mockChat);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Could not auto-detect GitHub bot user ID",
        expect.any(Object)
      );
      expect(adapter.botUserId).toBeUndefined();
    });

    it("should skip fetching user if botUserId already set", async () => {
      const a = new GitHubAdapter({
        token: "test-token",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot",
        botUserId: 42,
        logger: mockLogger,
      });

      const mockChat = createMockChatInstance();

      await a.initialize(mockChat);

      expect(mockUsersGetAuthenticated).not.toHaveBeenCalled();
    });
  });

  describe("getInstallationId", () => {
    it("should return the fixed installation ID from a thread in single-tenant app mode", async () => {
      const singleTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        installationId: 456,
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });

      await expect(
        singleTenantAdapter.getInstallationId("github:acme/app:42")
      ).resolves.toBe(456);
    });

    it("should accept a Thread object and extract its id", async () => {
      const singleTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        installationId: 456,
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });

      const mockThread = { id: "github:acme/app:42" } as { id: string };

      await expect(
        singleTenantAdapter.getInstallationId(mockThread as never)
      ).resolves.toBe(456);
    });

    it("should return undefined in PAT mode", async () => {
      await expect(
        adapter.getInstallationId("github:acme/app:42")
      ).resolves.toBeUndefined();
    });

    it("should return the cached installation ID in multi-tenant mode after a webhook", async () => {
      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });
      const state = createMockState();
      const chat = createMockChatInstance({ state });
      await multiTenantAdapter.initialize(chat);

      const payload = makeIssueCommentPayload({
        installation: { id: 789 },
      });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      await multiTenantAdapter.handleWebhook(request);

      await expect(
        multiTenantAdapter.getInstallationId("github:acme/app:42")
      ).resolves.toBe(789);
    });

    it("should return undefined when the multi-tenant installation is not cached", async () => {
      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });
      const state = createMockState();
      const chat = createMockChatInstance({ state });
      await multiTenantAdapter.initialize(chat);

      await expect(
        multiTenantAdapter.getInstallationId("github:acme/app:42")
      ).resolves.toBeUndefined();
    });

    it("should throw for non-GitHub thread or message context", async () => {
      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });

      await expect(
        multiTenantAdapter.getInstallationId("slack:C123:1234.5678")
      ).rejects.toThrow("Invalid GitHub thread ID");
    });

    it("should throw before initialization in multi-tenant mode", async () => {
      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });

      await expect(
        multiTenantAdapter.getInstallationId("github:acme/app:42")
      ).rejects.toThrow(
        "Adapter not initialized. Ensure chat.initialize() has been called first."
      );
    });
  });

  describe("handleWebhook", () => {
    it("should return 401 for missing signature", async () => {
      const body = JSON.stringify(makeIssueCommentPayload());
      const request = new Request("https://example.com/api/webhooks/github", {
        method: "POST",
        headers: {
          "x-github-event": "issue_comment",
          "content-type": "application/json",
        },
        body,
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Invalid signature");
    });

    it("should return 401 for invalid signature", async () => {
      const body = JSON.stringify(makeIssueCommentPayload());
      const request = makeWebhookRequest(
        body,
        "issue_comment",
        "sha256=invalid"
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("should not log raw payload content for invalid signatures", async () => {
      const body = JSON.stringify({
        action: "created",
        access_token: "secret-access-token",
        authorization: "Bearer secret-token",
        comment: {
          body: "Authorization: Bearer secret-token",
        },
        refresh_token: "secret-refresh-token",
        repository: {
          full_name: "customer-team-slug/app",
          owner: { login: "customer-team-slug" },
        },
      });
      const request = makeWebhookRequest(
        body,
        "issue_comment",
        "sha256=invalid"
      );

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(401);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "GitHub webhook signature verification failed",
        {
          bodyBytes: Buffer.byteLength(body, "utf8"),
          contentType: "application/json",
          eventType: "issue_comment",
          signaturePresent: true,
        }
      );
      expect(findLoggedSentinels()).toEqual([]);
      expect(stringifyLoggerCalls()).not.toContain(body);
      expect(stringifyLoggerCalls()).not.toContain("GitHub webhook raw body");
    });

    it("should return 200 pong for ping event", async () => {
      const body = JSON.stringify({ zen: "test" });
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "ping", signature);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("pong");
    });

    it("should return 400 for invalid JSON", async () => {
      const body = "not-json{{{";
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid JSON");
    });

    it("should not log raw payload content for invalid JSON", async () => {
      const body =
        "not-json secret-access-token secret-refresh-token Bearer secret-token Authorization customer-team-slug access_token refresh_token";
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(400);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "GitHub webhook invalid JSON",
        {
          bodyBytes: Buffer.byteLength(body, "utf8"),
          contentType: "application/json",
          eventType: "issue_comment",
          jsonParseStatus: "error",
          signaturePresent: true,
        }
      );
      expect(findLoggedSentinels()).toEqual([]);
      expect(stringifyLoggerCalls()).not.toContain(body);
      expect(stringifyLoggerCalls()).not.toContain("bodyPreview");
    });

    it("should not log raw payload content for valid webhooks", async () => {
      const mockChat = createMockChatInstance();
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const basePayload = makeIssueCommentPayload();
      const payload = {
        ...makeIssueCommentPayload({
          comment: {
            ...basePayload.comment,
            body: "Authorization: Bearer secret-token secret-access-token secret-refresh-token",
          },
          repository: {
            ...basePayload.repository,
            full_name: "customer-team-slug/app",
            owner: {
              ...basePayload.repository.owner,
              login: "customer-team-slug",
            },
          },
        }),
        access_token: "secret-access-token",
        authorization: "Bearer secret-token",
        refresh_token: "secret-refresh-token",
      };
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        "github:customer-team-slug/app:42",
        expect.objectContaining({ id: "100" }),
        undefined
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "GitHub webhook request verified",
        {
          bodyBytes: Buffer.byteLength(body, "utf8"),
          contentType: "application/json",
          eventType: "issue_comment",
          signaturePresent: true,
        }
      );
      expect(findLoggedSentinels()).toEqual([]);
      expect(stringifyLoggerCalls()).not.toContain(body);
      expect(stringifyLoggerCalls()).not.toContain("GitHub webhook raw body");
    });

    // The valid-signature issue_comment happy path (a non-bot author dispatches
    // `processMessage`) is covered by the shared `selfMessageContract` below.
    // The exact PR-level thread id + message id are still asserted by
    // "should not log raw payload content for valid webhooks" and the plain-issue
    // dispatch test.

    it("should process issue_comment on a plain issue", async () => {
      const mockChat = createMockChatInstance();
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const payload = makeIssueCommentPayload({
        issue: { number: 10, title: "Bug", pull_request: undefined },
      });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        "github:acme/app:issue:10",
        expect.objectContaining({
          id: "100",
          threadId: "github:acme/app:issue:10",
        }),
        undefined
      );
    });

    it("should ignore issue_comment with action other than created", async () => {
      const mockChat = createMockChatInstance();
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const payload = makeIssueCommentPayload({ action: "edited" });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(mockChat).not.toHaveDispatched("processMessage");
    });

    it("should process pull_request_review_comment event", async () => {
      const mockChat = createMockChatInstance();
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const payload = makeReviewCommentPayload();
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(
        body,
        "pull_request_review_comment",
        signature
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      // Root comment (no in_reply_to_id) -> reviewCommentId = comment.id (200)
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        "github:acme/app:42:rc:200",
        expect.objectContaining({ id: "200" }),
        undefined
      );
    });

    it("should use in_reply_to_id as root for review comment replies", async () => {
      const mockChat = createMockChatInstance();
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const payload = makeReviewCommentPayload({
        comment: {
          ...makeReviewCommentPayload().comment,
          id: 300,
          in_reply_to_id: 200,
        },
      });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(
        body,
        "pull_request_review_comment",
        signature
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      // Thread ID should use in_reply_to_id (200) not the comment id (300)
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        "github:acme/app:42:rc:200",
        expect.objectContaining({ id: "300" }),
        undefined
      );
    });

    it("should ignore review_comment with action other than created", async () => {
      const mockChat = createMockChatInstance();
      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const payload = makeReviewCommentPayload({ action: "deleted" });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(
        body,
        "pull_request_review_comment",
        signature
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(mockChat).not.toHaveDispatched("processMessage");
    });

    it("should return ok for unrecognized event types", async () => {
      const body = JSON.stringify({ action: "completed" });
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "check_run", signature);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    });

    it("should handle events without repository in multi-tenant mode", async () => {
      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });
      const state = createMockState();
      const mockChat = createMockChatInstance({ state });
      await multiTenantAdapter.initialize(mockChat);

      const body = JSON.stringify({
        action: "created",
        installation: { id: 999 },
      });
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "installation", signature);

      const response = await multiTenantAdapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    });

    it("should warn and ignore issue_comment when chat not initialized", async () => {
      // adapter is NOT initialized (no chat instance)
      const payload = makeIssueCommentPayload();
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Chat instance not initialized, ignoring comment"
      );
    });

    it("should warn and ignore review_comment when chat not initialized", async () => {
      // adapter is NOT initialized (no chat instance)
      const payload = makeReviewCommentPayload();
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(
        body,
        "pull_request_review_comment",
        signature
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Chat instance not initialized, ignoring comment"
      );
    });
  });

  describe("self-message detection", () => {
    // The issue_comment self-ignore path (bot author is dropped) and its
    // matching other-user dispatch are covered by the shared
    // `selfMessageContract` below. The review-comment self path and the
    // multi-tenant bot-id detection regressions are GitHub-specific and stay
    // local.
    it("should ignore messages from the bot itself (review comment)", async () => {
      const mockChat = createMockChatInstance();

      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot" },
      });
      await adapter.initialize(mockChat);

      const payload = makeReviewCommentPayload({
        sender: { id: 777, login: "test-bot", type: "Bot" },
      });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(
        body,
        "pull_request_review_comment",
        signature
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(mockChat).not.toHaveDispatched("processMessage");
    });

    it("should auto-detect botUserId on first webhook in multi-tenant mode (regression for self-reply loop)", async () => {
      // Regression: previously the multi-tenant App constructor left
      // this.defaultOctokit null, so initialize()'s detection branch was skipped.
      // The fallback only ran inside removeReaction(), so bots that never
      // remove reactions had _botUserId === null forever — meaning isMe was
      // always false and the bot would re-process its own replies in an
      // unbounded loop.
      const state = createMockState();
      const mockChat = createMockChatInstance({ state });

      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });
      expect(multiTenantAdapter.isMultiTenant).toBe(true);
      await multiTenantAdapter.initialize(mockChat);
      // No detection happens at initialize time in multi-tenant mode.
      expect(multiTenantAdapter.botUserId).toBeUndefined();

      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot[bot]" },
      });

      // Bot's own reply arrives as a webhook from a tenant installation.
      const payload = makeIssueCommentPayload({
        installation: { id: 789 },
        sender: { id: 777, login: "test-bot[bot]", type: "Bot" },
        comment: {
          ...makeIssueCommentPayload().comment,
          user: { id: 777, login: "test-bot[bot]", type: "Bot" },
        },
      });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await multiTenantAdapter.handleWebhook(request);
      expect(response.status).toBe(200);
      // botUserId must be set after the first webhook so isMe works.
      expect(multiTenantAdapter.botUserId).toBe("777");
      // The bot's own reply must NOT be dispatched to handlers.
      expect(mockChat).not.toHaveDispatched("processMessage");
    });

    it("should fall back to apps.getAuthenticated when users.getAuthenticated rejects (multi-tenant App)", async () => {
      // Belt-and-suspenders: in multi-tenant App mode, /user may not be
      // available with installation tokens depending on permissions. Fall
      // back to /app + /users/{slug}[bot] to recover the bot user ID.
      const state = createMockState();
      const mockChat = createMockChatInstance({ state });

      const multiTenantAdapter = new GitHubAdapter({
        appId: "12345",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot[bot]",
        logger: mockLogger,
      });
      await multiTenantAdapter.initialize(mockChat);

      mockUsersGetAuthenticated.mockRejectedValueOnce(
        new Error("Not Found: /user is unavailable for installation tokens")
      );
      mockAppsGetAuthenticated.mockResolvedValueOnce({
        data: { slug: "test-bot" },
      });
      mockUsersGetByUsername.mockResolvedValueOnce({
        data: { id: 777, login: "test-bot[bot]" },
      });

      const payload = makeIssueCommentPayload({
        installation: { id: 789 },
      });
      const body = JSON.stringify(payload);
      const signature = signPayload(body);
      const request = makeWebhookRequest(body, "issue_comment", signature);

      const response = await multiTenantAdapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(multiTenantAdapter.botUserId).toBe("777");
    });
  });

  describe("postMessage", () => {
    it("should post an issue comment for PR-level thread", async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({
        data: {
          id: 999,
          body: "Hello",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-999",
        },
      });

      const result = await adapter.postMessage(
        "github:acme/app:42",
        "Hello world"
      );

      expect(mockIssuesCreateComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        issue_number: 42,
        body: "Hello world",
      });
      expect(result.id).toBe("999");
      expect(result.threadId).toBe("github:acme/app:42");
      expect(result.raw.type).toBe("issue_comment");
    });

    it("should post a review comment reply for review comment thread", async () => {
      mockPullsCreateReplyForReviewComment.mockResolvedValueOnce({
        data: {
          id: 1001,
          body: "LGTM",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#discussion_r1001",
          path: "src/index.ts",
          diff_hunk: "@@",
          commit_id: "abc",
          original_commit_id: "abc",
        },
      });

      const result = await adapter.postMessage(
        "github:acme/app:42:rc:200",
        "LGTM"
      );

      expect(mockPullsCreateReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        pull_number: 42,
        comment_id: 200,
        body: "LGTM",
      });
      expect(result.id).toBe("1001");
      expect(result.raw.type).toBe("review_comment");
    });

    it("should post with AST message format", async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({
        data: {
          id: 888,
          body: "**bold**",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-888",
        },
      });

      await adapter.postMessage("github:acme/app:42", {
        markdown: "**bold**",
      });

      expect(mockIssuesCreateComment).toHaveBeenCalledWith(
        expect.objectContaining({ body: "**bold**" })
      );
    });

    it("should render card messages to GitHub markdown", async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({
        data: {
          id: 555,
          body: "**Title**",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-555",
        },
      });

      const cardMessage = {
        type: "card" as const,
        title: "Deploy Status",
        children: [{ type: "text" as const, content: "Deploy succeeded" }],
      };

      await adapter.postMessage("github:acme/app:42", cardMessage);

      expect(mockIssuesCreateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("Deploy Status"),
        })
      );
    });
  });

  describe("editMessage", () => {
    it("should edit an issue comment", async () => {
      mockIssuesUpdateComment.mockResolvedValueOnce({
        data: {
          id: 100,
          body: "Updated text",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
      });

      const result = await adapter.editMessage(
        "github:acme/app:42",
        "100",
        "Updated text"
      );

      expect(mockIssuesUpdateComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 100,
        body: "Updated text",
      });
      expect(result.id).toBe("100");
      expect(result.raw.type).toBe("issue_comment");
    });

    it("should edit a review comment", async () => {
      mockPullsUpdateReviewComment.mockResolvedValueOnce({
        data: {
          id: 200,
          body: "Updated review",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#discussion_r200",
          path: "src/index.ts",
          diff_hunk: "@@",
          commit_id: "abc",
          original_commit_id: "abc",
        },
      });

      const result = await adapter.editMessage(
        "github:acme/app:42:rc:200",
        "200",
        "Updated review"
      );

      expect(mockPullsUpdateReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 200,
        body: "Updated review",
      });
      expect(result.id).toBe("200");
      expect(result.raw.type).toBe("review_comment");
    });

    it("should render card messages when editing", async () => {
      mockIssuesUpdateComment.mockResolvedValueOnce({
        data: {
          id: 100,
          body: "**Updated Card**",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
      });

      const cardMessage = {
        type: "card" as const,
        title: "Updated Card",
        children: [{ type: "text" as const, content: "New content" }],
      };

      await adapter.editMessage("github:acme/app:42", "100", cardMessage);

      expect(mockIssuesUpdateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("Updated Card"),
        })
      );
    });
  });

  describe("stream", () => {
    it("should accumulate text chunks and post once to an issue comment thread", async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({
        data: {
          id: 500,
          body: "Hello World",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-500",
        },
      });

      async function* textStream() {
        yield "Hello";
        yield " ";
        yield "World";
      }

      const result = await adapter.stream("github:acme/app:42", textStream());

      expect(mockIssuesCreateComment).toHaveBeenCalledTimes(1);
      expect(mockIssuesCreateComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        issue_number: 42,
        body: "Hello World",
      });
      expect(mockIssuesUpdateComment).not.toHaveBeenCalled();
      expect(result.id).toBe("500");
    });

    it("should accumulate text chunks and post once to a review comment thread", async () => {
      mockPullsCreateReplyForReviewComment.mockResolvedValueOnce({
        data: {
          id: 501,
          body: "Looks good",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#discussion_r501",
          path: "src/index.ts",
          diff_hunk: "@@",
          commit_id: "abc",
          original_commit_id: "abc",
        },
      });

      async function* textStream() {
        yield "Looks";
        yield " ";
        yield "good";
      }

      const result = await adapter.stream(
        "github:acme/app:42:rc:200",
        textStream()
      );

      expect(mockPullsCreateReplyForReviewComment).toHaveBeenCalledTimes(1);
      expect(mockPullsCreateReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        pull_number: 42,
        comment_id: 200,
        body: "Looks good",
      });
      expect(mockPullsUpdateReviewComment).not.toHaveBeenCalled();
      expect(result.id).toBe("501");
    });

    it("should handle StreamChunk objects alongside strings", async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({
        data: {
          id: 502,
          body: "Hello World",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-502",
        },
      });

      async function* mixedStream() {
        yield "Hello";
        yield { type: "markdown_text" as const, text: " World" };
        yield { type: "task_update" as const, taskId: "1", status: "done" };
      }

      const result = await adapter.stream("github:acme/app:42", mixedStream());

      expect(mockIssuesCreateComment).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Hello World" })
      );
      expect(result.id).toBe("502");
    });

    it("should post empty markdown when stream yields no text", async () => {
      mockIssuesCreateComment.mockResolvedValueOnce({
        data: {
          id: 503,
          body: "",
          user: { id: 777, login: "test-bot", type: "Bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-503",
        },
      });

      async function* emptyStream() {
        // yields nothing
      }

      await adapter.stream("github:acme/app:42", emptyStream());

      expect(mockIssuesCreateComment).toHaveBeenCalledWith(
        expect.objectContaining({ body: "" })
      );
    });
  });

  describe("deleteMessage", () => {
    it("should delete an issue comment", async () => {
      mockIssuesDeleteComment.mockResolvedValueOnce({});

      await adapter.deleteMessage("github:acme/app:42", "100");

      expect(mockIssuesDeleteComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 100,
      });
    });

    it("should delete a review comment", async () => {
      mockPullsDeleteReviewComment.mockResolvedValueOnce({});

      await adapter.deleteMessage("github:acme/app:42:rc:200", "300");

      expect(mockPullsDeleteReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 300,
      });
    });
  });

  describe("addReaction", () => {
    it("should add reaction to an issue comment", async () => {
      mockReactionsCreateForIssueComment.mockResolvedValueOnce({});

      await adapter.addReaction("github:acme/app:42", "100", "thumbs_up");

      expect(mockReactionsCreateForIssueComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 100,
        content: "+1",
      });
    });

    it("should add reaction to a review comment", async () => {
      mockReactionsCreateForPullRequestReviewComment.mockResolvedValueOnce({});

      await adapter.addReaction("github:acme/app:42:rc:200", "200", "heart");

      expect(
        mockReactionsCreateForPullRequestReviewComment
      ).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 200,
        content: "heart",
      });
    });

    it("should handle EmojiValue objects", async () => {
      mockReactionsCreateForIssueComment.mockResolvedValueOnce({});

      await adapter.addReaction("github:acme/app:42", "100", {
        name: "rocket",
      });

      expect(mockReactionsCreateForIssueComment).toHaveBeenCalledWith(
        expect.objectContaining({ content: "rocket" })
      );
    });
  });

  describe("removeReaction", () => {
    it("should remove bot reaction from an issue comment", async () => {
      const botUserId = 777;
      const adapterWithBot = new GitHubAdapter({
        token: "test-token",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot",
        botUserId,
        logger: mockLogger,
      });

      mockReactionsListForIssueComment.mockResolvedValueOnce({
        data: [
          { id: 50, content: "+1", user: { id: botUserId } },
          { id: 51, content: "+1", user: { id: 999 } },
        ],
      });
      mockReactionsDeleteForIssueComment.mockResolvedValueOnce({});

      await adapterWithBot.removeReaction(
        "github:acme/app:42",
        "100",
        "thumbs_up"
      );

      expect(mockReactionsDeleteForIssueComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 100,
        reaction_id: 50,
      });
    });

    it("should remove bot reaction from a review comment", async () => {
      const botUserId = 777;
      const adapterWithBot = new GitHubAdapter({
        token: "test-token",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot",
        botUserId,
        logger: mockLogger,
      });

      mockReactionsListForPullRequestReviewComment.mockResolvedValueOnce({
        data: [{ id: 60, content: "heart", user: { id: botUserId } }],
      });
      mockReactionsDeleteForPullRequestComment.mockResolvedValueOnce({});

      await adapterWithBot.removeReaction(
        "github:acme/app:42:rc:200",
        "200",
        "heart"
      );

      expect(mockReactionsDeleteForPullRequestComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 200,
        reaction_id: 60,
      });
    });

    it("should do nothing when no matching reaction found", async () => {
      mockReactionsListForIssueComment.mockResolvedValueOnce({
        data: [],
      });

      await adapter.removeReaction("github:acme/app:42", "100", "thumbs_up");

      expect(mockReactionsDeleteForIssueComment).not.toHaveBeenCalled();
    });

    it("should lazily detect botUserId when not set", async () => {
      const detectedBotId = 42;

      mockUsersGetAuthenticated.mockResolvedValueOnce({
        data: { id: detectedBotId, login: "test-bot[bot]" },
      });
      mockReactionsListForIssueComment.mockResolvedValueOnce({
        data: [
          { id: 70, content: "eyes", user: { id: detectedBotId } },
          { id: 71, content: "eyes", user: { id: 999 } },
        ],
      });
      mockReactionsDeleteForIssueComment.mockResolvedValueOnce({});

      await adapter.removeReaction("github:acme/app:42", "100", "eyes");

      expect(mockUsersGetAuthenticated).toHaveBeenCalled();
      expect(mockReactionsDeleteForIssueComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        comment_id: 100,
        reaction_id: 70,
      });
    });
  });

  describe("emojiToGitHubReaction (via addReaction)", () => {
    const cases: [string, string][] = [
      ["thumbs_up", "+1"],
      ["+1", "+1"],
      ["thumbs_down", "-1"],
      ["-1", "-1"],
      ["laugh", "laugh"],
      ["smile", "laugh"],
      ["confused", "confused"],
      ["thinking", "confused"],
      ["heart", "heart"],
      ["love_eyes", "heart"],
      ["hooray", "hooray"],
      ["party", "hooray"],
      ["confetti", "hooray"],
      ["rocket", "rocket"],
      ["eyes", "eyes"],
    ];

    for (const [input, expected] of cases) {
      it(`should map "${input}" to "${expected}"`, async () => {
        mockReactionsCreateForIssueComment.mockResolvedValueOnce({});

        await adapter.addReaction("github:acme/app:42", "100", input);

        expect(mockReactionsCreateForIssueComment).toHaveBeenCalledWith(
          expect.objectContaining({ content: expected })
        );
      });
    }

    it("should default to +1 for unknown emoji", async () => {
      mockReactionsCreateForIssueComment.mockResolvedValueOnce({});

      await adapter.addReaction("github:acme/app:42", "100", "unknown_emoji");

      expect(mockReactionsCreateForIssueComment).toHaveBeenCalledWith(
        expect.objectContaining({ content: "+1" })
      );
    });
  });

  describe("parseMessage", () => {
    it("should parse an issue_comment raw message", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Test comment",
          user: { id: 1, login: "testuser", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.id).toBe("100");
      expect(message.threadId).toBe("github:acme/app:42");
      expect(message.text).toBe("Test comment");
      expect(message.author.userName).toBe("testuser");
      expect(message.author.isBot).toBe(false);
    });

    it("should preserve whitespace in newline-separated issue comment mentions", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "@test-bot\nhi there",
          user: { id: 1, login: "testuser", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.text).toMatch(TEST_BOT_MENTION_WITH_WHITESPACE_REGEX);
      expect(message.text).not.toContain("@test-bothi there");
    });

    it("should parse an issue_comment raw message from an issue thread", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Issue comment",
          user: { id: 1, login: "testuser", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/issues/10#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 10,
        threadType: "issue" as const,
      };

      const message = adapter.parseMessage(raw);
      expect(message.id).toBe("100");
      expect(message.threadId).toBe("github:acme/app:issue:10");
      expect(message.text).toBe("Issue comment");
      expect(message.raw.type).toBe("issue_comment");
      if (message.raw.type === "issue_comment") {
        expect(message.raw.threadType).toBe("issue");
      }
    });

    it("should default to PR thread format when threadType is omitted", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Test comment",
          user: { id: 1, login: "testuser", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
        // threadType omitted — should default to PR format
      };

      const message = adapter.parseMessage(raw);
      expect(message.threadId).toBe("github:acme/app:42");
    });

    it("should parse a review_comment raw message (root comment)", () => {
      const raw = {
        type: "review_comment" as const,
        comment: {
          id: 200,
          body: "Line comment",
          user: { id: 2, login: "reviewer", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#discussion_r200",
          path: "src/index.ts",
          diff_hunk: "@@",
          commit_id: "abc",
          original_commit_id: "abc",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.id).toBe("200");
      // Root comment -> reviewCommentId = comment.id
      expect(message.threadId).toBe("github:acme/app:42:rc:200");
    });

    it("should preserve whitespace in newline-separated review comment mentions", () => {
      const raw = {
        type: "review_comment" as const,
        comment: {
          id: 200,
          body: "@test-bot\nhi there",
          user: { id: 2, login: "reviewer", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#discussion_r200",
          path: "src/index.ts",
          diff_hunk: "@@",
          commit_id: "abc",
          original_commit_id: "abc",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.text).toMatch(TEST_BOT_MENTION_WITH_WHITESPACE_REGEX);
      expect(message.text).not.toContain("@test-bothi there");
    });

    it("should parse a review_comment raw message (reply)", () => {
      const raw = {
        type: "review_comment" as const,
        comment: {
          id: 300,
          body: "Reply",
          user: { id: 2, login: "reviewer", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#discussion_r300",
          path: "src/index.ts",
          diff_hunk: "@@",
          commit_id: "abc",
          original_commit_id: "abc",
          in_reply_to_id: 200,
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.id).toBe("300");
      // Reply -> uses in_reply_to_id as root
      expect(message.threadId).toBe("github:acme/app:42:rc:200");
    });

    it("should mark edited messages", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Edited",
          user: { id: 1, login: "testuser", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.metadata.edited).toBe(true);
      expect(message.metadata.editedAt).toEqual(
        new Date("2024-01-02T00:00:00Z")
      );
    });

    it("should not mark unedited messages as edited", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Not edited",
          user: { id: 1, login: "testuser", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.metadata.edited).toBe(false);
      expect(message.metadata.editedAt).toBeUndefined();
    });
  });

  describe("parseAuthor (via parseMessage)", () => {
    it("should identify bot users", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Automated comment",
          user: { id: 50, login: "dependabot[bot]", type: "Bot" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.author.isBot).toBe(true);
      expect(message.author.userName).toBe("dependabot[bot]");
      expect(message.author.userId).toBe("50");
    });

    it("should detect isMe when botUserId matches", () => {
      const a = new GitHubAdapter({
        token: "test-token",
        webhookSecret: WEBHOOK_SECRET,
        userName: "test-bot",
        botUserId: 50,
        logger: mockLogger,
      });

      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "My comment",
          user: { id: 50, login: "test-bot", type: "Bot" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = a.parseMessage(raw);
      expect(message.author.isMe).toBe(true);
    });

    it("should set isMe to false when user is not the bot", () => {
      const raw = {
        type: "issue_comment" as const,
        comment: {
          id: 100,
          body: "Someone else",
          user: { id: 999, login: "someone", type: "User" as const },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
        },
        repository: {
          id: 1,
          name: "app",
          full_name: "acme/app",
          owner: { id: 10, login: "acme", type: "User" as const },
        },
        prNumber: 42,
      };

      const message = adapter.parseMessage(raw);
      expect(message.author.isMe).toBe(false);
    });
  });

  describe("fetchMessages", () => {
    it("should fetch issue comments for PR-level thread", async () => {
      mockIssuesListComments.mockResolvedValueOnce({
        data: [
          {
            id: 100,
            body: "First",
            user: { id: 1, login: "user1", type: "User" },
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            html_url: "https://github.com/acme/app/pull/42#issuecomment-100",
          },
          {
            id: 101,
            body: "Second",
            user: { id: 2, login: "user2", type: "User" },
            created_at: "2024-01-02T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            html_url: "https://github.com/acme/app/pull/42#issuecomment-101",
          },
        ],
      });

      const result = await adapter.fetchMessages("github:acme/app:42");

      expect(mockIssuesListComments).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        issue_number: 42,
        per_page: 100,
      });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe("100");
      expect(result.messages[1].id).toBe("101");
      expect(result.nextCursor).toBeUndefined();
    });

    it("should fetch review comments filtered by thread", async () => {
      mockPullsListReviewComments.mockResolvedValueOnce({
        data: [
          {
            id: 200,
            body: "Root comment",
            user: { id: 1, login: "user1", type: "User" },
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            html_url: "https://github.com/acme/app/pull/42#discussion_r200",
            path: "src/index.ts",
            diff_hunk: "@@",
            commit_id: "abc",
            original_commit_id: "abc",
          },
          {
            id: 201,
            body: "Reply",
            in_reply_to_id: 200,
            user: { id: 2, login: "user2", type: "User" },
            created_at: "2024-01-02T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            html_url: "https://github.com/acme/app/pull/42#discussion_r201",
            path: "src/index.ts",
            diff_hunk: "@@",
            commit_id: "abc",
            original_commit_id: "abc",
          },
          {
            id: 300,
            body: "Different thread",
            user: { id: 3, login: "user3", type: "User" },
            created_at: "2024-01-03T00:00:00Z",
            updated_at: "2024-01-03T00:00:00Z",
            html_url: "https://github.com/acme/app/pull/42#discussion_r300",
            path: "src/other.ts",
            diff_hunk: "@@",
            commit_id: "def",
            original_commit_id: "def",
          },
        ],
      });

      const result = await adapter.fetchMessages("github:acme/app:42:rc:200");

      // Should only return comments in thread 200 (root + reply), not 300
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe("200");
      expect(result.messages[1].id).toBe("201");
    });

    it("should respect limit option", async () => {
      const manyComments = Array.from({ length: 10 }, (_, i) => ({
        id: 100 + i,
        body: `Comment ${i}`,
        user: { id: 1, login: "user1", type: "User" },
        created_at: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        updated_at: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        html_url: `https://github.com/acme/app/pull/42#issuecomment-${100 + i}`,
      }));

      mockIssuesListComments.mockResolvedValueOnce({ data: manyComments });

      const result = await adapter.fetchMessages("github:acme/app:42", {
        limit: 3,
      });

      // backward direction: takes last 3
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].id).toBe("107");
      expect(result.messages[2].id).toBe("109");
    });

    it("should respect forward direction with limit", async () => {
      const manyComments = Array.from({ length: 10 }, (_, i) => ({
        id: 100 + i,
        body: `Comment ${i}`,
        user: { id: 1, login: "user1", type: "User" },
        created_at: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        updated_at: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        html_url: `https://github.com/acme/app/pull/42#issuecomment-${100 + i}`,
      }));

      mockIssuesListComments.mockResolvedValueOnce({ data: manyComments });

      const result = await adapter.fetchMessages("github:acme/app:42", {
        limit: 3,
        direction: "forward",
      });

      // forward direction: takes first 3
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].id).toBe("100");
      expect(result.messages[2].id).toBe("102");
    });
  });

  describe("fetchThread", () => {
    it("should fetch PR metadata for thread info", async () => {
      mockPullsGet.mockResolvedValueOnce({
        data: {
          title: "Add new feature",
          state: "open",
          number: 42,
        },
      });

      const result = await adapter.fetchThread("github:acme/app:42");

      expect(mockPullsGet).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        pull_number: 42,
      });
      expect(result.id).toBe("github:acme/app:42");
      expect(result.channelId).toBe("acme/app");
      expect(result.channelName).toBe("app #42");
      expect(result.isDM).toBe(false);
      expect(result.metadata).toEqual({
        owner: "acme",
        repo: "app",
        prNumber: 42,
        prTitle: "Add new feature",
        prState: "open",
        reviewCommentId: undefined,
      });
    });

    it("should include reviewCommentId in metadata for review thread", async () => {
      mockPullsGet.mockResolvedValueOnce({
        data: {
          title: "Fix bug",
          state: "open",
          number: 42,
        },
      });

      const result = await adapter.fetchThread("github:acme/app:42:rc:200");

      expect(result.metadata.reviewCommentId).toBe(200);
    });

    it("should fetch issue metadata for issue thread", async () => {
      mockIssuesGet.mockResolvedValueOnce({
        data: {
          title: "Bug report",
          state: "open",
          number: 10,
        },
      });

      const result = await adapter.fetchThread("github:acme/app:issue:10");

      expect(mockIssuesGet).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        issue_number: 10,
      });
      expect(mockPullsGet).not.toHaveBeenCalled();
      expect(result.id).toBe("github:acme/app:issue:10");
      expect(result.channelId).toBe("acme/app");
      expect(result.channelName).toBe("app #10");
      expect(result.isDM).toBe(false);
      expect(result.metadata).toEqual({
        owner: "acme",
        repo: "app",
        issueNumber: 10,
        issueTitle: "Bug report",
        issueState: "open",
        type: "issue",
      });
    });
  });

  describe("listThreads", () => {
    it("should list open PRs as threads", async () => {
      mockPullsList.mockResolvedValueOnce({
        data: [
          {
            number: 42,
            title: "Add feature",
            body: "Description",
            state: "open",
            html_url: "https://github.com/acme/app/pull/42",
            user: { id: 1, login: "testuser", type: "User" },
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
          },
          {
            number: 43,
            title: "Fix bug",
            body: null,
            state: "open",
            html_url: "https://github.com/acme/app/pull/43",
            user: { id: 2, login: "otheruser", type: "User" },
            created_at: "2024-01-03T00:00:00Z",
            updated_at: "2024-01-04T00:00:00Z",
          },
        ],
      });

      const result = await adapter.listThreads("github:acme/app");

      expect(mockPullsList).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
        state: "open",
        sort: "updated",
        direction: "desc",
        per_page: 30,
        page: 1,
      });
      expect(result.threads).toHaveLength(2);
      expect(result.threads[0].id).toBe("github:acme/app:42");
      expect(result.threads[0].rootMessage.text).toBe("Add feature");
      expect(result.threads[1].id).toBe("github:acme/app:43");
    });

    it("should handle cursor-based pagination", async () => {
      mockPullsList.mockResolvedValueOnce({ data: [] });

      await adapter.listThreads("github:acme/app", { cursor: "3" });

      expect(mockPullsList).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3 })
      );
    });

    it("should provide nextCursor when results fill the limit", async () => {
      const pulls = Array.from({ length: 5 }, (_, i) => ({
        number: i + 1,
        title: `PR ${i + 1}`,
        body: null,
        state: "open",
        html_url: `https://github.com/acme/app/pull/${i + 1}`,
        user: { id: 1, login: "testuser", type: "User" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }));
      mockPullsList.mockResolvedValueOnce({ data: pulls });

      const result = await adapter.listThreads("github:acme/app", {
        limit: 5,
      });

      expect(result.nextCursor).toBe("2");
    });

    it("should not provide nextCursor when results are fewer than limit", async () => {
      mockPullsList.mockResolvedValueOnce({
        data: [
          {
            number: 1,
            title: "Only PR",
            body: null,
            state: "open",
            html_url: "https://github.com/acme/app/pull/1",
            user: { id: 1, login: "testuser", type: "User" },
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const result = await adapter.listThreads("github:acme/app", {
        limit: 30,
      });

      expect(result.nextCursor).toBeUndefined();
    });

    it("should throw for invalid channel ID", async () => {
      await expect(adapter.listThreads("github:invalid")).rejects.toThrow(
        "Invalid GitHub channel ID"
      );
    });

    it("should use PR title as fallback body when body is null", async () => {
      mockPullsList.mockResolvedValueOnce({
        data: [
          {
            number: 1,
            title: "No body PR",
            body: null,
            state: "open",
            html_url: "https://github.com/acme/app/pull/1",
            user: { id: 1, login: "testuser", type: "User" },
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const result = await adapter.listThreads("github:acme/app");
      // raw.comment.body should be the title since body is null
      expect(result.threads[0].rootMessage.raw.comment.body).toBe("No body PR");
    });
  });

  describe("fetchChannelInfo", () => {
    it("should return repo metadata as channel info", async () => {
      mockReposGet.mockResolvedValueOnce({
        data: {
          full_name: "acme/app",
          description: "An app",
          visibility: "public",
          default_branch: "main",
          open_issues_count: 5,
        },
      });

      const result = await adapter.fetchChannelInfo("github:acme/app");

      expect(mockReposGet).toHaveBeenCalledWith({
        owner: "acme",
        repo: "app",
      });
      expect(result.id).toBe("github:acme/app");
      expect(result.name).toBe("acme/app");
      expect(result.isDM).toBe(false);
      expect(result.metadata).toEqual({
        owner: "acme",
        repo: "app",
        description: "An app",
        visibility: "public",
        defaultBranch: "main",
        openIssuesCount: 5,
      });
    });

    it("should throw for invalid channel ID", async () => {
      await expect(adapter.fetchChannelInfo("github:noslash")).rejects.toThrow(
        "Invalid GitHub channel ID"
      );
    });
  });

  describe("channelIdFromThreadId", () => {
    it("should derive channel ID from PR-level thread", () => {
      const result = adapter.channelIdFromThreadId("github:acme/app:42");
      expect(result).toBe("github:acme/app");
    });

    it("should derive channel ID from review comment thread", () => {
      const result = adapter.channelIdFromThreadId("github:acme/app:42:rc:200");
      expect(result).toBe("github:acme/app");
    });
  });

  describe("startTyping", () => {
    it("should be a no-op", async () => {
      // Should not throw
      await adapter.startTyping("github:acme/app:42");
      await adapter.startTyping("github:acme/app:42", "thinking...");
    });
  });

  describe("encodeThreadId", () => {
    // Round-trip + pinned-encoding coverage lives in the shared
    // `threadIdContract` at the bottom of this file; only the encode-specific
    // validation that the contract does not cover is kept here.
    it("should throw for issue thread with reviewCommentId", () => {
      expect(() =>
        adapter.encodeThreadId({
          owner: "acme",
          repo: "app",
          prNumber: 10,
          type: "issue",
          reviewCommentId: 999,
        })
      ).toThrow("Review comments are not supported on issue threads");
    });
  });

  describe("decodeThreadId", () => {
    // PR/issue/review-comment decode + round-trip coverage lives in the shared
    // `threadIdContract` at the bottom of this file; only the malformed-id and
    // invalid-prefix errors the contract does not cover are kept here.
    it("should throw for invalid thread ID prefix", () => {
      expect(() => adapter.decodeThreadId("slack:C123:ts")).toThrow(
        "Invalid GitHub thread ID"
      );
    });

    it("should throw for malformed thread ID", () => {
      expect(() => adapter.decodeThreadId("github:invalid")).toThrow(
        "Invalid GitHub thread ID format"
      );
    });
  });

  describe("renderFormatted", () => {
    it("should render simple markdown", () => {
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
      expect(result).toBe("Hello world");
    });

    it("should render bold text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "strong" as const,
                children: [{ type: "text" as const, value: "bold" }],
              },
            ],
          },
        ],
      };
      const result = adapter.renderFormatted(ast);
      expect(result).toBe("**bold**");
    });
  });
});

connectWebhookContract({
  name: "github",
  createAdapter: ({ webhookVerifier }) =>
    new GitHubAdapter({
      installationToken: "t",
      webhookVerifier,
      botUserId: 999,
      logger: mockLogger,
    }),
  makeWebhookRequest: () =>
    makeWebhookRequest(
      JSON.stringify(makeIssueCommentPayload()),
      "issue_comment"
    ),
});

// `encodeThreadId`/`decodeThreadId` are pure, so one Connect-mode adapter (no
// network, no init) is enough to exercise the shared thread-id codec contract.
const threadIdAdapter = new GitHubAdapter({
  installationToken: "t",
  webhookVerifier: () => true,
  botUserId: 1,
  logger: mockLogger,
});

threadIdContract<GitHubThreadId>({
  name: "github",
  encode: (decoded) => threadIdAdapter.encodeThreadId(decoded),
  decode: (id) => threadIdAdapter.decodeThreadId(id),
  cases: [
    {
      decoded: { owner: "acme", repo: "app", prNumber: 123, type: "pr" },
      encoded: "github:acme/app:123",
    },
    {
      decoded: {
        owner: "acme",
        repo: "app",
        prNumber: 123,
        type: "pr",
        reviewCommentId: 456_789,
      },
      encoded: "github:acme/app:123:rc:456789",
    },
    {
      decoded: { owner: "acme", repo: "app", prNumber: 10, type: "issue" },
      encoded: "github:acme/app:issue:10",
    },
    {
      // owners/repos with hyphens must survive the round-trip untouched.
      decoded: {
        owner: "my-org",
        repo: "my-cool-app",
        prNumber: 42,
        type: "pr",
      },
      encoded: "github:my-org/my-cool-app:42",
    },
  ],
});

selfMessageContract({
  name: "github",
  setup: async () => {
    const chat = createMockChatInstance();
    // A known bot user id makes self-detection network-free: `initialize`
    // skips the users.getAuthenticated lookup when `botUserId` is preset.
    const selfAdapter = new GitHubAdapter({
      token: "test-token",
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      botUserId: 777,
      logger: mockLogger,
    });
    await selfAdapter.initialize(chat);
    return { adapter: selfAdapter, chat };
  },
  makeOtherMessageRequest: () => {
    const body = JSON.stringify(makeIssueCommentPayload());
    return makeWebhookRequest(body, "issue_comment", signPayload(body));
  },
  makeSelfMessageRequest: () => {
    const body = JSON.stringify(
      makeIssueCommentPayload({
        sender: { id: 777, login: "test-bot", type: "Bot" },
        comment: {
          ...makeIssueCommentPayload().comment,
          user: { id: 777, login: "test-bot", type: "Bot" },
        },
      })
    );
    return makeWebhookRequest(body, "issue_comment", signPayload(body));
  },
});

describe("GitHubAdapter - Vercel Connect mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs with installationToken + webhookVerifier (no secret)", () => {
    const adapter = new GitHubAdapter({
      installationToken: "ghs_connect_token",
      webhookVerifier: () => true,
      userName: "connect-bot",
      botUserId: 123,
      logger: mockLogger,
    });
    expect(adapter.name).toBe("github");
    expect(adapter.isMultiTenant).toBe(false);
    expect(adapter.botUserId).toBe("123");
  });

  it("registers a before-hook that resolves the token per request", async () => {
    const resolver = vi.fn(() => Promise.resolve("ghs_fresh"));
    new GitHubAdapter({
      installationToken: resolver,
      webhookVerifier: () => true,
      botUserId: 1,
      logger: mockLogger,
    });

    expect(mockHookBefore).toHaveBeenCalledWith(
      "request",
      expect.any(Function)
    );
    const hookCb = mockHookBefore.mock.calls[0][1] as (options: {
      headers?: Record<string, string>;
    }) => Promise<void>;

    const first = { headers: {} as Record<string, string> };
    await hookCb(first);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(first.headers.authorization).toBe("token ghs_fresh");

    // Resolved again on the next request (short-lived tokens).
    const second = { headers: {} as Record<string, string> };
    await hookCb(second);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(second.headers.authorization).toBe("token ghs_fresh");
  });

  it("accepts a static installationToken string", async () => {
    new GitHubAdapter({
      installationToken: "ghs_static",
      webhookVerifier: () => true,
      botUserId: 1,
      logger: mockLogger,
    });
    const hookCb = mockHookBefore.mock.calls[0][1] as (options: {
      headers?: Record<string, string>;
    }) => Promise<void>;
    const opts = { headers: {} as Record<string, string> };
    await hookCb(opts);
    expect(opts.headers.authorization).toBe("token ghs_static");
  });

  it("rejects mixing Connect installationToken with App auth at the type level", () => {
    const adapter = new GitHubAdapter({
      installationToken: "t",
      webhookVerifier: () => true,
      // @ts-expect-error installationToken is mutually exclusive with appId/privateKey
      appId: "123",
      botUserId: 1,
      logger: mockLogger,
    });
    expect(adapter.name).toBe("github");
  });

  it("returns 400 for invalid JSON on the verifier path", async () => {
    const adapter = new GitHubAdapter({
      installationToken: "t",
      webhookVerifier: () => true,
      botUserId: 1,
      logger: mockLogger,
    });
    const request = makeWebhookRequest("not-json{{{", "issue_comment");
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("throws when the installationToken resolver returns an empty token", async () => {
    new GitHubAdapter({
      installationToken: () => "",
      webhookVerifier: () => true,
      botUserId: 1,
      logger: mockLogger,
    });
    const hookCb = mockHookBefore.mock.calls[0][1] as (options: {
      headers?: Record<string, string>;
    }) => Promise<void>;
    await expect(hookCb({ headers: {} })).rejects.toThrow(
      EMPTY_INSTALLATION_TOKEN_PATTERN
    );
  });

  it("rejects mixing Connect installationToken with a webhookSecret at the type level", () => {
    const adapter = new GitHubAdapter({
      installationToken: "t",
      webhookVerifier: () => true,
      // @ts-expect-error webhookSecret is not allowed in Connect mode (verifier-only)
      webhookSecret: "secret",
      botUserId: 1,
      logger: mockLogger,
    });
    expect(adapter.name).toBe("github");
  });

  it("learns the bot user id from the first posted comment", async () => {
    mockIssuesCreateComment.mockResolvedValueOnce({
      data: {
        id: 100,
        body: "hi",
        user: { id: 4242, login: "chat-sdk-example[bot]", type: "Bot" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/acme/app/issues/42#issuecomment-100",
      },
    });
    const adapter = new GitHubAdapter({
      installationToken: "t",
      webhookVerifier: () => true,
      logger: mockLogger,
    });
    // Auto-detection can't work in Connect mode, so it starts unset...
    expect(adapter.botUserId).toBeUndefined();

    await adapter.postMessage("github:acme/app:42", "hi");

    // ...and is learned from the comment the bot just posted.
    expect(adapter.botUserId).toBe("4242");
  });
});

describe("createGitHubAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Clear GitHub env vars to prevent cross-test leaking
    for (const key of [
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_TOKEN",
      "GITHUB_APP_ID",
      "GITHUB_PRIVATE_KEY",
      "GITHUB_INSTALLATION_ID",
      "GITHUB_BOT_USERNAME",
      "GITHUB_BOT_USER_ID",
      "GITHUB_API_URL",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create adapter with explicit PAT config", () => {
    const a = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
      userName: "bot",
    });
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect(a.userName).toBe("bot");
  });

  it("auto-detects botUserId from the GITHUB_BOT_USER_ID env var", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_BOT_USER_ID = "4242";
    const a = createGitHubAdapter();
    expect(a.botUserId).toBe("4242");
  });

  it("prefers an explicit botUserId over GITHUB_BOT_USER_ID", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_BOT_USER_ID = "4242";
    const a = createGitHubAdapter({ botUserId: 99 });
    expect(a.botUserId).toBe("99");
  });

  it("should create adapter with explicit app config (single-tenant)", () => {
    const a = createGitHubAdapter({
      appId: "123",
      privateKey:
        "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
      installationId: 456,
      webhookSecret: "secret",
      userName: "bot[bot]",
    });
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect(a.isMultiTenant).toBe(false);
  });

  it("should create adapter in multi-tenant mode (no installationId)", () => {
    const a = createGitHubAdapter({
      appId: "123",
      privateKey:
        "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
      webhookSecret: "secret",
      userName: "bot[bot]",
    });
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect(a.isMultiTenant).toBe(true);
  });

  it("should throw when webhookSecret is missing", () => {
    expect(() => createGitHubAdapter({ token: "ghp_test" })).toThrow(
      "webhookSecret or webhookVerifier is required"
    );
  });

  it("should throw when no auth is provided", () => {
    expect(() => createGitHubAdapter({ webhookSecret: "secret" })).toThrow(
      "Authentication is required"
    );
  });

  it("should fall back to env vars for token", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_BOT_USERNAME = "env-bot";

    const a = createGitHubAdapter();
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect(a.userName).toBe("env-bot");
  });

  it("should fall back to env vars for app credentials", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    process.env.GITHUB_APP_ID = "env-app-id";
    process.env.GITHUB_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----";
    process.env.GITHUB_INSTALLATION_ID = "789";

    const a = createGitHubAdapter();
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect(a.isMultiTenant).toBe(false);
  });

  it("should not mix auth modes when explicit config has auth fields", () => {
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";

    // Providing appId explicitly should NOT also try GITHUB_TOKEN
    expect(() =>
      createGitHubAdapter({
        appId: "123",
        webhookSecret: "secret",
      })
    ).toThrow("Authentication is required");
  });

  it("should use default userName when not provided", () => {
    const a = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });
    expect(a.userName).toBe("github-bot");
  });

  it("should pass botUserId to adapter", () => {
    const a = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
      botUserId: 42,
    });
    expect(a.botUserId).toBe("42");
  });

  it("should accept apiUrl config for GitHub Enterprise", () => {
    const a = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
      apiUrl: "https://github.example.com/api/v3",
    });
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect((a as unknown as { apiUrl: string }).apiUrl).toBe(
      "https://github.example.com/api/v3"
    );
  });

  it("should resolve apiUrl from GITHUB_API_URL env var", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_API_URL = "https://github.example.com/api/v3";
    const a = createGitHubAdapter();
    expect(a).toBeInstanceOf(GitHubAdapter);
    expect((a as unknown as { apiUrl: string }).apiUrl).toBe(
      "https://github.example.com/api/v3"
    );
  });

  it("should prefer apiUrl config over GITHUB_API_URL env var", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    process.env.GITHUB_TOKEN = "env-token";
    process.env.GITHUB_API_URL = "https://env-github.example.com/api/v3";
    const a = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
      apiUrl: "https://config-github.example.com/api/v3",
    });
    expect((a as unknown as { apiUrl: string }).apiUrl).toBe(
      "https://config-github.example.com/api/v3"
    );
  });
});

describe("getUser", () => {
  it("should return user info from GitHub API", async () => {
    mockRequest.mockResolvedValue({
      data: {
        id: 12345,
        login: "alice",
        name: "Alice Smith",
        email: "alice@example.com",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        type: "User",
      },
    });

    const adapter = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });

    const user = await adapter.getUser("12345");
    expect(user).not.toBeNull();
    expect(user?.fullName).toBe("Alice Smith");
    expect(user?.userName).toBe("alice");
    expect(user?.email).toBe("alice@example.com");
    expect(user?.avatarUrl).toBe(
      "https://avatars.githubusercontent.com/u/12345"
    );
    expect(user?.isBot).toBe(false);
  });

  it("should return null on error", async () => {
    mockRequest.mockRejectedValue(new Error("Not found"));

    const adapter = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });

    const user = await adapter.getUser("999999");
    expect(user).toBeNull();
  });

  it("should call GitHub API with correct endpoint and params", async () => {
    mockRequest.mockResolvedValue({
      data: {
        id: 12345,
        login: "alice",
        name: "Alice Smith",
        email: null,
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        type: "User",
      },
    });

    const adapter = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });

    await adapter.getUser("12345");
    expect(mockRequest).toHaveBeenCalledWith("GET /user/{account_id}", {
      account_id: Number("12345"),
    });
  });

  it("should return isBot true for Bot type users", async () => {
    mockRequest.mockResolvedValue({
      data: {
        id: 99999,
        login: "dependabot[bot]",
        name: "Dependabot",
        email: null,
        avatar_url: "https://avatars.githubusercontent.com/u/99999",
        type: "Bot",
      },
    });

    const adapter = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });

    const user = await adapter.getUser("99999");
    expect(user).not.toBeNull();
    expect(user?.isBot).toBe(true);
  });

  it("should fall back to login when name is null", async () => {
    mockRequest.mockResolvedValue({
      data: {
        id: 55555,
        login: "noname-user",
        name: null,
        email: null,
        avatar_url: "https://avatars.githubusercontent.com/u/55555",
        type: "User",
      },
    });

    const adapter = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });

    const user = await adapter.getUser("55555");
    expect(user).not.toBeNull();
    expect(user?.fullName).toBe("noname-user");
  });

  it("should include userId in the response", async () => {
    mockRequest.mockResolvedValue({
      data: {
        id: 12345,
        login: "alice",
        name: "Alice Smith",
        email: "alice@example.com",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        type: "User",
      },
    });

    const adapter = createGitHubAdapter({
      token: "ghp_test",
      webhookSecret: "secret",
    });

    const user = await adapter.getUser("12345");
    expect(user).not.toBeNull();
    expect(user?.userId).toBe("12345");
  });
});

describe("fetchSubject", () => {
  it("should return issue data from issue_comment raw", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              title: "Add feature",
              body: "Feature description",
              state: "open",
              html_url: "https://github.com/vercel/chat/issues/42",
              user: { id: 123, login: "dancer" },
              assignees: [{ id: 456, login: "alice" }],
              labels: [{ name: "enhancement" }],
            },
          }),
        },
      },
    };

    const adapter = new GitHubAdapter({
      token: "ghp_test",
      webhookSecret: "test-secret",
      userName: "test-bot",
    });
    (adapter as unknown as { defaultOctokit: unknown }).defaultOctokit =
      mockOctokit;

    const raw = {
      type: "issue_comment" as const,
      comment: { id: 1, body: "test" },
      repository: {
        id: 0,
        name: "chat",
        full_name: "vercel/chat",
        owner: { login: "vercel" },
      },
      prNumber: 42,
      threadType: "issue" as const,
    };

    const result = await adapter.fetchSubject(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("issue");
    expect(result?.id).toBe("42");
    expect(result?.title).toBe("Add feature");
    expect(result?.status).toBe("open");
    expect(result?.labels).toEqual(["enhancement"]);
  });

  it("should return pull_request data for PR comments", async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 10,
              title: "Fix bug",
              body: "Bug fix",
              state: "open",
              html_url: "https://github.com/vercel/chat/pull/10",
              user: { id: 123, login: "dancer" },
              assignees: [],
              labels: [{ name: "fix" }],
            },
          }),
        },
      },
    };

    const adapter = new GitHubAdapter({
      token: "ghp_test",
      webhookSecret: "test-secret",
      userName: "test-bot",
    });
    (adapter as unknown as { defaultOctokit: unknown }).defaultOctokit =
      mockOctokit;

    const raw = {
      type: "issue_comment" as const,
      comment: { id: 1, body: "test" },
      repository: {
        id: 0,
        name: "chat",
        full_name: "vercel/chat",
        owner: { login: "vercel" },
      },
      prNumber: 10,
    };

    const result = await adapter.fetchSubject(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("pull_request");
    expect(result?.id).toBe("10");
    expect(result?.title).toBe("Fix bug");
  });

  it("should return pull_request data for review_comment type", async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 15,
              title: "Refactor auth",
              body: "Refactoring",
              state: "open",
              html_url: "https://github.com/vercel/chat/pull/15",
              user: { id: 789, login: "bob" },
              assignees: [],
              labels: [],
            },
          }),
        },
      },
    };

    const adapter = new GitHubAdapter({
      token: "ghp_test",
      webhookSecret: "test-secret",
      userName: "test-bot",
    });
    (adapter as unknown as { defaultOctokit: unknown }).defaultOctokit =
      mockOctokit;

    const raw = {
      type: "review_comment" as const,
      comment: { id: 1, body: "nit" },
      repository: {
        id: 0,
        name: "chat",
        full_name: "vercel/chat",
        owner: { login: "vercel" },
      },
      prNumber: 15,
    };

    const result = await adapter.fetchSubject(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("pull_request");
    expect(result?.id).toBe("15");
    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "vercel",
      repo: "chat",
      pull_number: 15,
    });
  });

  it("should return null on API error", async () => {
    const adapter = new GitHubAdapter({
      token: "ghp_test",
      webhookSecret: "test-secret",
      userName: "test-bot",
    });
    (adapter as unknown as { defaultOctokit: unknown }).defaultOctokit = {
      rest: {
        issues: {
          get: vi.fn().mockRejectedValue(new Error("Not Found")),
        },
      },
    };

    const raw = {
      type: "issue_comment" as const,
      comment: { id: 1, body: "test" },
      repository: {
        id: 0,
        name: "chat",
        full_name: "vercel/chat",
        owner: { login: "vercel" },
      },
      prNumber: 99,
      threadType: "issue" as const,
    };

    const result = await adapter.fetchSubject(raw);
    expect(result).toBeNull();
  });
});

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends GitHubAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.verifySignature,
        ] as const;
      }
    }
    expect(TestSubclass.prototype.checkAccess).toBeInstanceOf(Function);
  });
});
