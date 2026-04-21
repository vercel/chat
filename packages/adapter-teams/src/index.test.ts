import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthenticationError, ValidationError } from "@chat-adapter/shared";
import { ConsoleLogger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamsAdapter, TeamsAdapter } from "./index";

const TEAMS_PREFIX_PATTERN = /^teams:/;
const WHITESPACE_START_PATTERN = /^\s/;
const WHITESPACE_END_PATTERN = /\s$/;

class MockTeamsError extends Error {
  statusCode?: number;
  retryAfter?: number;
  innerHttpError?: { statusCode?: number };
  constructor(props: {
    statusCode?: number;
    message?: string;
    retryAfter?: number;
    innerHttpError?: { statusCode?: number };
  }) {
    super(props.message ?? "Mock error");
    this.statusCode = props.statusCode;
    this.retryAfter = props.retryAfter;
    this.innerHttpError = props.innerHttpError;
  }
}

const logger = new ConsoleLogger("error");

describe("ESM compatibility", () => {
  it(
    "all subpath imports resolve in Node.js ESM (no bare directory imports)",
    {
      timeout: 30_000,
    },
    () => {
      const source = readFileSync(
        resolve(import.meta.dirname, "index.ts"),
        "utf-8"
      );
      const pkgDir = resolve(import.meta.dirname, "..");

      // Extract non-relative, non-type-only import specifiers with subpaths
      const importRegex = /from\s+["']([^"'.][^"']*)["']/g;
      const specifiers = new Set<string>();
      for (const [, specifier] of source.matchAll(importRegex)) {
        specifiers.add(specifier);
      }

      for (const specifier of specifiers) {
        // Spawn a real Node.js ESM process — vitest uses esbuild which
        // tolerates bare directory imports, but Node.js ESM does not.
        const script = `await import(${JSON.stringify(specifier)})`;
        try {
          execSync(`node --input-type=module -e ${JSON.stringify(script)}`, {
            cwd: pkgDir,
            stdio: "pipe",
          });
        } catch (error: unknown) {
          const stderr =
            error instanceof Error && "stderr" in error
              ? String((error as { stderr: Buffer }).stderr)
              : "";
          throw new Error(
            `Import "${specifier}" fails in Node.js ESM.\n` +
              "Bare directory imports need an explicit /index.js suffix.\n" +
              stderr
          );
        }
      }
    }
  );
});

describe("TeamsAdapter", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith("TEAMS_") ||
        key === "CLIENT_ID" ||
        key === "CLIENT_SECRET" ||
        key === "TENANT_ID" ||
        key === "TEAMS_APP_ID" ||
        key === "TEAMS_APP_PASSWORD" ||
        key === "TEAMS_APP_TENANT_ID"
      ) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("should export createTeamsAdapter function", () => {
    expect(typeof createTeamsAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createTeamsAdapter({
      appId: "test-app-id",
      appPassword: "test-password",
      logger,
    });
    expect(adapter).toBeInstanceOf(TeamsAdapter);
    expect(adapter.name).toBe("teams");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const original = {
        conversationId: "19:abc123@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(TEAMS_PREFIX_PATTERN);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.serviceUrl).toBe(original.serviceUrl);
    });

    it("should preserve messageid in thread context for channel threads", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const original = {
        conversationId:
          "19:d441d38c655c47a085215b2726e76927@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.conversationId).toContain(";messageid=");
    });

    it("should throw ValidationError for invalid thread IDs", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
      expect(() => adapter.decodeThreadId("slack:abc:def")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("teams")).toThrow(ValidationError);
    });

    it("should handle special characters in conversationId and serviceUrl", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const original = {
        conversationId:
          "19:meeting_MDE4OWI4N2UtNzEzNC00ZGE2LTkxMGEtNDM3@thread.v2",
        serviceUrl:
          "https://smba.trafficmanager.net/amer/?special=chars&foo=bar",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.serviceUrl).toBe(original.serviceUrl);
    });
  });

  // ==========================================================================
  // Constructor / Initialization Tests
  // ==========================================================================

  describe("constructor", () => {
    it("should set default userName to 'bot'", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });
      expect(adapter.userName).toBe("bot");
    });

    it("should use provided userName", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
        userName: "mybot",
      });
      expect(adapter.userName).toBe("mybot");
    });

    it("should accept appTenantId config", () => {
      expect(
        () =>
          new TeamsAdapter({
            appId: "test",
            appPassword: "test",
            logger,
            appTenantId: "some-tenant-id",
          })
      ).not.toThrow();
    });

    it("should have name 'teams'", () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });
      expect(adapter.name).toBe("teams");
    });
  });

  // ==========================================================================
  // Constructor env var resolution
  // ==========================================================================

  describe("constructor env var resolution", () => {
    it("should resolve appId from TEAMS_APP_ID env var", () => {
      process.env.TEAMS_APP_ID = "env-app-id";
      process.env.TEAMS_APP_PASSWORD = "env-password";
      const adapter = new TeamsAdapter();
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should resolve appPassword from TEAMS_APP_PASSWORD env var", () => {
      process.env.TEAMS_APP_PASSWORD = "env-password";
      const adapter = new TeamsAdapter({ appId: "test" });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should resolve appTenantId from TEAMS_APP_TENANT_ID env var", () => {
      process.env.TEAMS_APP_TENANT_ID = "env-tenant";
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should default logger when not provided", () => {
      process.env.TEAMS_APP_ID = "env-app-id";
      process.env.TEAMS_APP_PASSWORD = "env-password";
      const adapter = new TeamsAdapter();
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should prefer config values over env vars", () => {
      process.env.TEAMS_APP_ID = "env-app-id";
      const adapter = new TeamsAdapter({
        appId: "config-app-id",
        appPassword: "test",
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
      expect(adapter.name).toBe("teams");
    });

    it("should resolve apiUrl from TEAMS_API_URL env var", () => {
      process.env.TEAMS_APP_ID = "env-app-id";
      process.env.TEAMS_APP_PASSWORD = "env-password";
      process.env.TEAMS_API_URL = "https://custom-teams.example.com";
      const adapter = new TeamsAdapter();
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should accept apiUrl config", () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        apiUrl: "https://custom-teams.example.com",
        logger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });
  });

  // ==========================================================================
  // createTeamsAdapter Factory Tests
  // ==========================================================================

  describe("createTeamsAdapter factory", () => {
    it("should delegate to constructor", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should create adapter with federated auth", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        federated: { clientId: "managed-identity-client-id" },
        logger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });
  });

  // ==========================================================================
  // isMessageFromSelf Tests (via parseMessage)
  // ==========================================================================

  describe("isMessageFromSelf (via parseMessage)", () => {
    it("should detect exact match of appId", () => {
      const adapter = createTeamsAdapter({
        appId: "abc123-def456",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-1",
        text: "Hello",
        from: { id: "abc123-def456", name: "Bot" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.author.isMe).toBe(true);
    });

    it("should detect Teams-prefixed bot ID (28:appId)", () => {
      const adapter = createTeamsAdapter({
        appId: "abc123-def456",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-2",
        text: "Hello",
        from: { id: "28:abc123-def456", name: "Bot" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.author.isMe).toBe(true);
    });

    it("should not detect unrelated user as self", () => {
      const adapter = createTeamsAdapter({
        appId: "abc123-def456",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-3",
        text: "Hello",
        from: { id: "user-xyz", name: "User" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.author.isMe).toBe(false);
    });

    it("should return false when from.id is undefined", () => {
      const adapter = createTeamsAdapter({
        appId: "abc123",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-4",
        text: "Hello",
        from: { name: "Unknown" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.author.isMe).toBe(false);
    });
  });

  // ==========================================================================
  // parseMessage / parseTeamsMessage Tests
  // ==========================================================================

  describe("parseMessage", () => {
    it("should parse basic text message", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-100",
        text: "Hello world",
        from: { id: "user-1", name: "Alice", role: "user" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      const message = adapter.parseMessage(activity);
      expect(message.id).toBe("msg-100");
      expect(message.text).toContain("Hello world");
      expect(message.author.userId).toBe("user-1");
      expect(message.author.userName).toBe("Alice");
      expect(message.author.isMe).toBe(false);
    });

    it("should handle missing text gracefully", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-102",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.text).toBe("");
    });

    it("should handle missing from fields gracefully", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-103",
        text: "test",
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.author.userId).toBe("unknown");
      expect(message.author.userName).toBe("unknown");
    });

    it("should filter out adaptive card attachments", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-104",
        text: "test",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {},
          },
          {
            contentType: "image/png",
            contentUrl: "https://example.com/image.png",
            name: "screenshot.png",
          },
        ],
      };

      const message = adapter.parseMessage(activity);
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe("image");
      expect(message.attachments[0].name).toBe("screenshot.png");
    });

    it("should filter out text/html attachments without contentUrl", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-105",
        text: "test",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        attachments: [
          {
            contentType: "text/html",
            content: "<p>Formatted version</p>",
          },
        ],
      };

      const message = adapter.parseMessage(activity);
      expect(message.attachments).toHaveLength(0);
    });

    it("should classify attachment types by contentType", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-106",
        text: "test",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        attachments: [
          {
            contentType: "image/jpeg",
            contentUrl: "https://example.com/photo.jpg",
            name: "photo.jpg",
          },
          {
            contentType: "video/mp4",
            contentUrl: "https://example.com/video.mp4",
            name: "video.mp4",
          },
          {
            contentType: "audio/mpeg",
            contentUrl: "https://example.com/audio.mp3",
            name: "audio.mp3",
          },
          {
            contentType: "application/pdf",
            contentUrl: "https://example.com/doc.pdf",
            name: "doc.pdf",
          },
        ],
      };

      const message = adapter.parseMessage(activity);
      expect(message.attachments).toHaveLength(4);
      expect(message.attachments[0].type).toBe("image");
      expect(message.attachments[1].type).toBe("video");
      expect(message.attachments[2].type).toBe("audio");
      expect(message.attachments[3].type).toBe("file");
    });

    it("should set metadata.edited to false for new messages", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-107",
        text: "test",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        timestamp: "2024-06-01T12:00:00Z",
      };

      const message = adapter.parseMessage(activity);
      expect(message.metadata.edited).toBe(false);
      expect(message.metadata.dateSent).toEqual(
        new Date("2024-06-01T12:00:00Z")
      );
    });
  });

  // ==========================================================================
  // normalizeMentions Tests (via parseMessage)
  // ==========================================================================

  describe("normalizeMentions (via parseMessage)", () => {
    it("should trim whitespace from text", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger,
      });

      const activity = {
        type: "message",
        id: "msg-200",
        text: "  Hello world  ",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.text).not.toMatch(WHITESPACE_START_PATTERN);
      expect(message.text).not.toMatch(WHITESPACE_END_PATTERN);
    });
  });

  // ==========================================================================
  // isDM Tests
  // ==========================================================================

  describe("isDM", () => {
    it("should return false for group chats (19: prefix)", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      expect(adapter.isDM(threadId)).toBe(false);
    });

    it("should return true for DM conversations (non-19: prefix)", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "a]8:orgid:user-id-here",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      expect(adapter.isDM(threadId)).toBe(true);
    });

    it("should return false for channel threads with messageid", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      expect(adapter.isDM(threadId)).toBe(false);
    });
  });

  // ==========================================================================
  // channelIdFromThreadId Tests
  // ==========================================================================

  describe("channelIdFromThreadId", () => {
    it("should strip messageid from thread ID", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const channelId = adapter.channelIdFromThreadId(threadId);
      const decoded = adapter.decodeThreadId(channelId);

      expect(decoded.conversationId).toBe("19:abc@thread.tacv2");
      expect(decoded.conversationId).not.toContain(";messageid=");
    });

    it("should return same ID when no messageid present", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const channelId = adapter.channelIdFromThreadId(threadId);
      const decoded = adapter.decodeThreadId(channelId);

      expect(decoded.conversationId).toBe("19:abc@thread.tacv2");
    });
  });

  // ==========================================================================
  // fetchThread Tests
  // ==========================================================================

  describe("fetchThread", () => {
    it("should return basic thread info", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const info = await adapter.fetchThread(threadId);
      expect(info.id).toBe(threadId);
      expect(info.channelId).toBe("19:abc@thread.tacv2");
      expect(info.metadata).toEqual({});
    });
  });

  // ==========================================================================
  // handleWebhook Tests
  // ==========================================================================

  describe("handleWebhook", () => {
    it("should return 400 for invalid JSON body", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "not valid json{{{",
        headers: { "content-type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe("Invalid JSON");
    });
  });

  // ==========================================================================
  // initialize Tests
  // ==========================================================================

  describe("initialize", () => {
    it("should store chat instance and initialize app", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const mockChat = {
        getState: vi.fn(),
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processOptionsLoad: vi.fn().mockResolvedValue(undefined),
        processReaction: vi.fn(),
      };

      // initialize() calls app.initialize() which registers the bridge route handler
      await adapter.initialize(
        mockChat as unknown as Parameters<typeof adapter.initialize>[0]
      );

      expect(adapter.name).toBe("teams");
    });
  });

  // ==========================================================================
  // renderFormatted Tests
  // ==========================================================================

  describe("renderFormatted", () => {
    it("should delegate to format converter", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

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
      expect(typeof result).toBe("string");
      expect(result).toContain("Hello world");
    });
  });

  // ==========================================================================
  // postMessage / editMessage / deleteMessage Tests (mock app API)
  // ==========================================================================

  describe("postMessage", () => {
    it("should call app.send and return message ID", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger,
      });

      // Mock app.send
      const mockApp = (
        adapter as unknown as { app: { send: ReturnType<typeof vi.fn> } }
      ).app;
      mockApp.send = vi.fn(async () => ({
        id: "sent-msg-123",
        type: "message",
      }));

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.postMessage(threadId, {
        markdown: "Hi there",
      });

      expect(result.id).toBe("sent-msg-123");
      expect(result.threadId).toBe(threadId);
      expect(mockApp.send).toHaveBeenCalledTimes(1);
    });

    it("should handle send failure by calling handleTeamsError", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger,
      });

      const mockApp = (
        adapter as unknown as { app: { send: ReturnType<typeof vi.fn> } }
      ).app;
      mockApp.send = vi.fn(async () => {
        throw new MockTeamsError({ statusCode: 401, message: "Unauthorized" });
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.postMessage(threadId, { markdown: "Hi" })
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("editMessage", () => {
    it("should call api.conversations.activities.update", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger,
      });

      const mockUpdate = vi.fn(async () => ({ id: "edit-msg-1" }));
      const mockApp = (adapter as unknown as { app: { api: unknown } }).app;
      mockApp.api = {
        conversations: {
          activities: () => ({
            update: mockUpdate,
            delete: vi.fn(),
          }),
        },
        reactions: { add: vi.fn(), remove: vi.fn() },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.editMessage(threadId, "edit-msg-1", {
        markdown: "Updated text",
      });

      expect(result.id).toBe("edit-msg-1");
      expect(result.threadId).toBe(threadId);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteMessage", () => {
    it("should call api.conversations.activities.delete", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger,
      });

      const mockDelete = vi.fn(async () => undefined);
      const mockApp = (adapter as unknown as { app: { api: unknown } }).app;
      mockApp.api = {
        conversations: {
          activities: () => ({
            update: vi.fn(),
            delete: mockDelete,
          }),
        },
        reactions: { add: vi.fn(), remove: vi.fn() },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.deleteMessage(threadId, "del-msg-1")
      ).resolves.not.toThrow();
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // startTyping Tests
  // ==========================================================================

  describe("startTyping", () => {
    it("should send typing activity via app.send", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger,
      });

      const mockApp = (
        adapter as unknown as { app: { send: ReturnType<typeof vi.fn> } }
      ).app;
      mockApp.send = vi.fn(async () => ({ id: "typing-1", type: "typing" }));

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await adapter.startTyping(threadId);

      expect(mockApp.send).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // openDM Tests
  // ==========================================================================

  describe("openDM", () => {
    it("should throw ValidationError when no tenantId available", async () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processOptionsLoad: vi.fn().mockResolvedValue(undefined),
        processReaction: vi.fn(),
      };

      // Mock app.initialize to avoid real HTTP setup
      const mockApp = (
        adapter as unknown as { app: { initialize: ReturnType<typeof vi.fn> } }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);
      await adapter.initialize(
        mockChat as unknown as Parameters<typeof adapter.initialize>[0]
      );

      await expect(adapter.openDM("user-123")).rejects.toThrow(ValidationError);
    });
  });
});
