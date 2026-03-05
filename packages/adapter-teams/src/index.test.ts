import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import type { Logger } from "chat";
import { NotImplementedError } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createTeamsAdapter, TeamsAdapter } from "./index";

const TEAMS_PREFIX_PATTERN = /^teams:/;
const WHITESPACE_START_PATTERN = /^\s/;
const WHITESPACE_END_PATTERN = /\s$/;

class MockTeamsError extends Error {
  statusCode?: number;
  retryAfter?: number;
  constructor(props: {
    statusCode?: number;
    message?: string;
    retryAfter?: number;
  }) {
    super(props.message ?? "Mock error");
    this.statusCode = props.statusCode;
    this.retryAfter = props.retryAfter;
  }
}

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("ESM compatibility", () => {
  it(
    "all subpath imports resolve in Node.js ESM (no bare directory imports)",
    { timeout: 30_000 },
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
  it("should export createTeamsAdapter function", () => {
    expect(typeof createTeamsAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createTeamsAdapter({
      appId: "test-app-id",
      appPassword: "test-password",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(TeamsAdapter);
    expect(adapter.name).toBe("teams");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
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
        logger: mockLogger,
      });

      // Teams channel threads include ;messageid=XXX in the conversation ID
      // This is the thread context needed to reply in the correct thread
      const original = {
        conversationId:
          "19:d441d38c655c47a085215b2726e76927@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      // The full conversation ID including messageid must be preserved
      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.conversationId).toContain(";messageid=");
    });

    it("should throw ValidationError for invalid thread IDs", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
      });
      expect(adapter.userName).toBe("bot");
    });

    it("should use provided userName", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
        userName: "mybot",
      });
      expect(adapter.userName).toBe("mybot");
    });

    it("should throw ValidationError when SingleTenant without appTenantId", () => {
      expect(
        () =>
          new TeamsAdapter({
            appId: "test",
            appPassword: "test",
            logger: mockLogger,
            appType: "SingleTenant",
          })
      ).toThrow(ValidationError);
    });

    it("should not throw when SingleTenant with appTenantId", () => {
      expect(
        () =>
          new TeamsAdapter({
            appId: "test",
            appPassword: "test",
            logger: mockLogger,
            appType: "SingleTenant",
            appTenantId: "some-tenant-id",
          })
      ).not.toThrow();
    });

    it("should have name 'teams'", () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });
      expect(adapter.name).toBe("teams");
    });
  });

  // ==========================================================================
  // createTeamsAdapter Factory Tests
  // ==========================================================================

  describe("createTeamsAdapter factory", () => {
    it("should throw when appId is missing and env var not set", () => {
      const origAppId = process.env.TEAMS_APP_ID;
      const origAppPwd = process.env.TEAMS_APP_PASSWORD;
      // biome-ignore lint/performance/noDelete: env var removal requires delete
      delete process.env.TEAMS_APP_ID;
      // biome-ignore lint/performance/noDelete: env var removal requires delete
      delete process.env.TEAMS_APP_PASSWORD;
      try {
        expect(() => createTeamsAdapter({})).toThrow(ValidationError);
      } finally {
        if (origAppId !== undefined) {
          process.env.TEAMS_APP_ID = origAppId;
        }
        if (origAppPwd !== undefined) {
          process.env.TEAMS_APP_PASSWORD = origAppPwd;
        }
      }
    });

    it("should throw when appPassword is missing and env var not set", () => {
      const origAppPwd = process.env.TEAMS_APP_PASSWORD;
      // biome-ignore lint/performance/noDelete: env var removal requires delete
      delete process.env.TEAMS_APP_PASSWORD;
      try {
        expect(() =>
          createTeamsAdapter({ appId: "test-id", logger: mockLogger })
        ).toThrow(ValidationError);
      } finally {
        if (origAppPwd !== undefined) {
          process.env.TEAMS_APP_PASSWORD = origAppPwd;
        }
      }
    });

    it("should pick up appTenantId from env", () => {
      const origTenant = process.env.TEAMS_APP_TENANT_ID;
      process.env.TEAMS_APP_TENANT_ID = "env-tenant";
      try {
        // Should not throw - means it's initializing graph client with the tenant
        const adapter = createTeamsAdapter({
          appId: "test",
          appPassword: "test",
          logger: mockLogger,
        });
        expect(adapter).toBeInstanceOf(TeamsAdapter);
      } finally {
        if (origTenant !== undefined) {
          process.env.TEAMS_APP_TENANT_ID = origTenant;
        } else {
          // biome-ignore lint/performance/noDelete: env var removal requires delete
          delete process.env.TEAMS_APP_TENANT_ID;
        }
      }
    });

    it("should create adapter with certificate auth (thumbprint)", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        certificate: {
          certificatePrivateKey:
            "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
          certificateThumbprint: "AABBCCDD",
        },
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should create adapter with certificate auth (x5c)", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        certificate: {
          certificatePrivateKey:
            "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
          x5c: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
        },
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should throw when certificate has neither thumbprint nor x5c", () => {
      expect(() =>
        createTeamsAdapter({
          appId: "test",
          certificate: {
            certificatePrivateKey:
              "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
          },
          logger: mockLogger,
        })
      ).toThrow(ValidationError);
    });

    it("should create adapter with federated auth", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        federated: {
          clientId: "managed-identity-client-id",
        },
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
    });

    it("should throw when multiple auth methods are provided", () => {
      expect(() =>
        createTeamsAdapter({
          appId: "test",
          appPassword: "test",
          certificate: {
            certificatePrivateKey:
              "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
            certificateThumbprint: "AABBCCDD",
          },
          logger: mockLogger,
        })
      ).toThrow(ValidationError);
    });

    it("should not require appPassword env var when certificate is provided", () => {
      const origAppPwd = process.env.TEAMS_APP_PASSWORD;
      // biome-ignore lint/performance/noDelete: env var removal requires delete
      delete process.env.TEAMS_APP_PASSWORD;
      try {
        const adapter = createTeamsAdapter({
          appId: "test",
          certificate: {
            certificatePrivateKey:
              "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
            certificateThumbprint: "AABBCCDD",
          },
          logger: mockLogger,
        });
        expect(adapter).toBeInstanceOf(TeamsAdapter);
      } finally {
        if (origAppPwd !== undefined) {
          process.env.TEAMS_APP_PASSWORD = origAppPwd;
        }
      }
    });

    it("should not require appPassword env var when federated is provided", () => {
      const origAppPwd = process.env.TEAMS_APP_PASSWORD;
      // biome-ignore lint/performance/noDelete: env var removal requires delete
      delete process.env.TEAMS_APP_PASSWORD;
      try {
        const adapter = createTeamsAdapter({
          appId: "test",
          federated: {
            clientId: "managed-identity-client-id",
          },
          logger: mockLogger,
        });
        expect(adapter).toBeInstanceOf(TeamsAdapter);
      } finally {
        if (origAppPwd !== undefined) {
          process.env.TEAMS_APP_PASSWORD = origAppPwd;
        }
      }
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
      expect(message.author.isBot).toBe(false);
      expect(message.author.isMe).toBe(false);
    });

    it("should detect bot role from activity.from.role", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger: mockLogger,
      });

      const activity = {
        type: "message",
        id: "msg-101",
        text: "I am a bot",
        from: { id: "bot-1", name: "OtherBot", role: "bot" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      expect(message.author.isBot).toBe(true);
    });

    it("should handle missing text gracefully", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
      // Should only include the image, not the adaptive card
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe("image");
      expect(message.attachments[0].name).toBe("screenshot.png");
    });

    it("should filter out text/html attachments without contentUrl", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app",
        appPassword: "test",
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
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
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      expect(adapter.isDM(threadId)).toBe(false);
    });
  });

  // ==========================================================================
  // addReaction / removeReaction Tests
  // ==========================================================================

  describe("addReaction", () => {
    it("should throw NotImplementedError", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.addReaction(threadId, "msg-1", "thumbsup")
      ).rejects.toThrow(NotImplementedError);
    });
  });

  describe("removeReaction", () => {
    it("should throw NotImplementedError", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.removeReaction(threadId, "msg-1", "thumbsup")
      ).rejects.toThrow(NotImplementedError);
    });
  });

  // ==========================================================================
  // handleTeamsError Tests
  // ==========================================================================

  describe("handleTeamsError", () => {
    // Access private method via any for testing
    function callHandleTeamsError(
      adapter: TeamsAdapter,
      error: unknown,
      operation: string
    ): never {
      return (adapter as any).handleTeamsError(error, operation);
    }

    it("should throw AuthenticationError for 401 status", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { statusCode: 401, message: "Unauthorized" },
          "postMessage"
        )
      ).toThrow(AuthenticationError);
    });

    it("should throw AuthenticationError for 403 status", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { statusCode: 403, message: "Forbidden" },
          "postMessage"
        )
      ).toThrow(AuthenticationError);
    });

    it("should throw NetworkError for 404 status", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { statusCode: 404, message: "Not found" },
          "editMessage"
        )
      ).toThrow(NetworkError);
    });

    it("should throw AdapterRateLimitError for 429 status", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { statusCode: 429, retryAfter: 30 },
          "postMessage"
        )
      ).toThrow(AdapterRateLimitError);
    });

    it("should throw AdapterRateLimitError with retryAfter for 429", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      try {
        callHandleTeamsError(
          adapter,
          { statusCode: 429, retryAfter: 60 },
          "postMessage"
        );
      } catch (error) {
        expect(error).toBeInstanceOf(AdapterRateLimitError);
        expect((error as AdapterRateLimitError).retryAfter).toBe(60);
      }
    });

    it("should throw PermissionError for messages containing 'permission'", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { message: "Insufficient Permission to complete the operation" },
          "deleteMessage"
        )
      ).toThrow(PermissionError);
    });

    it("should throw NetworkError for generic errors with message", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { message: "Connection reset" },
          "startTyping"
        )
      ).toThrow(NetworkError);
    });

    it("should throw NetworkError for unknown error types", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(adapter, "some string error", "postMessage")
      ).toThrow(NetworkError);
    });

    it("should throw NetworkError for null/undefined errors", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() => callHandleTeamsError(adapter, null, "postMessage")).toThrow(
        NetworkError
      );
    });

    it("should use status field if statusCode not present", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(
          adapter,
          { status: 401, message: "Unauthorized" },
          "postMessage"
        )
      ).toThrow(AuthenticationError);
    });

    it("should use code field if statusCode and status not present", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(() =>
        callHandleTeamsError(adapter, { code: 429 }, "postMessage")
      ).toThrow(AdapterRateLimitError);
    });
  });

  // ==========================================================================
  // extractTextFromGraphMessage Tests
  // ==========================================================================

  describe("extractTextFromGraphMessage", () => {
    function callExtractText(adapter: TeamsAdapter, msg: unknown): string {
      return (adapter as any).extractTextFromGraphMessage(msg);
    }

    it("should extract plain text content", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        body: { content: "Hello world", contentType: "text" },
      };

      expect(callExtractText(adapter, msg)).toBe("Hello world");
    });

    it("should strip HTML tags from html content", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        body: {
          content: "<p>Hello <b>world</b></p>",
          contentType: "html",
        },
      };

      expect(callExtractText(adapter, msg)).toBe("Hello world");
    });

    it("should return empty string for missing body", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = { id: "1" };
      expect(callExtractText(adapter, msg)).toBe("");
    });

    it("should return '[Card]' for adaptive card without title", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        body: { content: "", contentType: "html" },
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: JSON.stringify({ type: "AdaptiveCard", body: [] }),
          },
        ],
      };

      expect(callExtractText(adapter, msg)).toBe("[Card]");
    });

    it("should extract card title from bolder TextBlock", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        body: { content: "", contentType: "html" },
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: JSON.stringify({
              type: "AdaptiveCard",
              body: [
                { type: "TextBlock", text: "My Card Title", weight: "bolder" },
                { type: "TextBlock", text: "Some description" },
              ],
            }),
          },
        ],
      };

      expect(callExtractText(adapter, msg)).toBe("My Card Title");
    });

    it("should return '[Card]' for invalid JSON in card content", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        body: { content: "", contentType: "html" },
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: "not valid json",
          },
        ],
      };

      expect(callExtractText(adapter, msg)).toBe("[Card]");
    });
  });

  // ==========================================================================
  // extractCardTitle Tests
  // ==========================================================================

  describe("extractCardTitle", () => {
    function callExtractCardTitle(
      adapter: TeamsAdapter,
      card: unknown
    ): string | null {
      return (adapter as any).extractCardTitle(card);
    }

    it("should return null for null/undefined", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(callExtractCardTitle(adapter, null)).toBeNull();
      expect(callExtractCardTitle(adapter, undefined)).toBeNull();
    });

    it("should return null for non-object values", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(callExtractCardTitle(adapter, "string")).toBeNull();
      expect(callExtractCardTitle(adapter, 42)).toBeNull();
    });

    it("should return null for empty body", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(callExtractCardTitle(adapter, { body: [] })).toBeNull();
    });

    it("should find title with weight: bolder", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const card = {
        body: [
          { type: "TextBlock", text: "Title", weight: "bolder" },
          { type: "TextBlock", text: "Description" },
        ],
      };

      expect(callExtractCardTitle(adapter, card)).toBe("Title");
    });

    it("should find title with size: large", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const card = {
        body: [
          { type: "TextBlock", text: "Big Title", size: "large" },
          { type: "TextBlock", text: "Description" },
        ],
      };

      expect(callExtractCardTitle(adapter, card)).toBe("Big Title");
    });

    it("should find title with size: extraLarge", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const card = {
        body: [{ type: "TextBlock", text: "Huge Title", size: "extraLarge" }],
      };

      expect(callExtractCardTitle(adapter, card)).toBe("Huge Title");
    });

    it("should fallback to first TextBlock when no styled title found", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const card = {
        body: [
          { type: "TextBlock", text: "First block" },
          { type: "TextBlock", text: "Second block" },
        ],
      };

      expect(callExtractCardTitle(adapter, card)).toBe("First block");
    });

    it("should skip non-TextBlock elements", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const card = {
        body: [
          { type: "Image", url: "https://example.com/image.png" },
          { type: "TextBlock", text: "After image" },
        ],
      };

      expect(callExtractCardTitle(adapter, card)).toBe("After image");
    });

    it("should return null when body has no TextBlocks", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const card = {
        body: [
          { type: "Image", url: "https://example.com/image.png" },
          { type: "Container", items: [] },
        ],
      };

      expect(callExtractCardTitle(adapter, card)).toBeNull();
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
        logger: mockLogger,
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
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const channelId = adapter.channelIdFromThreadId(threadId);
      const decoded = adapter.decodeThreadId(channelId);

      expect(decoded.conversationId).toBe("19:abc@thread.tacv2");
    });

    it("should preserve serviceUrl", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const serviceUrl = "https://smba.trafficmanager.net/amer/";
      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=123",
        serviceUrl,
      });

      const channelId = adapter.channelIdFromThreadId(threadId);
      const decoded = adapter.decodeThreadId(channelId);

      expect(decoded.serviceUrl).toBe(serviceUrl);
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
        logger: mockLogger,
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
  // fetchMessages Tests (without Graph client)
  // ==========================================================================

  describe("fetchMessages", () => {
    it("should throw NotImplementedError when no appTenantId configured", async () => {
      // Use TeamsAdapter directly to bypass createTeamsAdapter's env var fallback
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.fetchMessages(threadId)).rejects.toThrow(
        NotImplementedError
      );
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
        logger: mockLogger,
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

    it("should return 500 when bot adapter throws", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      // Valid JSON but will fail authentication in handleActivity
      const activity = {
        type: "message",
        text: "hello",
        from: { id: "user-1" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(activity),
        headers: {
          "content-type": "application/json",
          authorization: "Bearer invalid-token",
        },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toHaveProperty("error");
    });
  });

  // ==========================================================================
  // initialize Tests
  // ==========================================================================

  describe("initialize", () => {
    it("should store chat instance", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockChat = {
        getState: vi.fn(),
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };

      await adapter.initialize(mockChat as any);

      // Verify it doesn't throw after initialization by calling a method
      // that would fail if chat wasn't set
      expect(adapter.name).toBe("teams");
    });
  });

  // ==========================================================================
  // postMessage / editMessage / deleteMessage (mock continueConversationAsync)
  // ==========================================================================

  describe("postMessage", () => {
    it("should call continueConversationAsync and return message ID", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      // Mock botAdapter.continueConversationAsync
      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(
        async (
          _appId: string,
          _ref: unknown,
          callback: (ctx: unknown) => Promise<void>
        ) => {
          await callback({
            sendActivity: vi.fn(async () => ({ id: "sent-msg-123" })),
          });
        }
      );

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.postMessage(threadId, { text: "Hi there" });

      expect(result.id).toBe("sent-msg-123");
      expect(result.threadId).toBe(threadId);
      expect(botAdapter.continueConversationAsync).toHaveBeenCalledTimes(1);
    });

    it("should handle send failure by calling handleTeamsError", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(async () => {
        throw new MockTeamsError({ statusCode: 401, message: "Unauthorized" });
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.postMessage(threadId, { text: "Hi" })
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("editMessage", () => {
    it("should call continueConversationAsync with updateActivity", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(
        async (
          _appId: string,
          _ref: unknown,
          callback: (ctx: unknown) => Promise<void>
        ) => {
          await callback({
            updateActivity: vi.fn(async () => undefined),
          });
        }
      );

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.editMessage(threadId, "edit-msg-1", {
        text: "Updated text",
      });

      expect(result.id).toBe("edit-msg-1");
      expect(result.threadId).toBe(threadId);
      expect(botAdapter.continueConversationAsync).toHaveBeenCalledTimes(1);
    });

    it("should handle edit failure", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(async () => {
        throw new MockTeamsError({ statusCode: 404, message: "Not found" });
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.editMessage(threadId, "msg-1", { text: "Updated" })
      ).rejects.toThrow(NetworkError);
    });
  });

  describe("deleteMessage", () => {
    it("should call continueConversationAsync with deleteActivity", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(
        async (
          _appId: string,
          _ref: unknown,
          callback: (ctx: unknown) => Promise<void>
        ) => {
          await callback({
            deleteActivity: vi.fn(async () => undefined),
          });
        }
      );

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.deleteMessage(threadId, "del-msg-1")
      ).resolves.not.toThrow();
      expect(botAdapter.continueConversationAsync).toHaveBeenCalledTimes(1);
    });

    it("should handle delete failure", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(async () => {
        throw new MockTeamsError({ statusCode: 429, retryAfter: 10 });
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.deleteMessage(threadId, "msg-1")).rejects.toThrow(
        AdapterRateLimitError
      );
    });
  });

  // ==========================================================================
  // startTyping Tests
  // ==========================================================================

  describe("startTyping", () => {
    it("should send typing activity via continueConversationAsync", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockSendActivity = vi.fn(async () => undefined);

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(
        async (
          _appId: string,
          _ref: unknown,
          callback: (ctx: unknown) => Promise<void>
        ) => {
          await callback({ sendActivity: mockSendActivity });
        }
      );

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await adapter.startTyping(threadId);

      expect(botAdapter.continueConversationAsync).toHaveBeenCalledTimes(1);
      expect(mockSendActivity).toHaveBeenCalledWith({ type: "typing" });
    });

    it("should handle typing failure", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(async () => {
        throw new MockTeamsError({ statusCode: 401, message: "Auth failed" });
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.startTyping(threadId)).rejects.toThrow(
        AuthenticationError
      );
    });
  });

  // ==========================================================================
  // openDM Tests
  // ==========================================================================

  describe("openDM", () => {
    it("should throw ValidationError when no tenantId available", async () => {
      // Use TeamsAdapter directly to bypass createTeamsAdapter's env var fallback
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      // Mock chat with state that returns null for everything
      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };

      await adapter.initialize(mockChat as any);

      await expect(adapter.openDM("user-123")).rejects.toThrow(ValidationError);
    });

    it("should use cached serviceUrl and tenantId", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key === "teams:serviceUrl:user-123") {
            return "https://smba.trafficmanager.net/amer/";
          }
          if (key === "teams:tenantId:user-123") {
            return "tenant-abc";
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };

      await adapter.initialize(mockChat as any);

      // Mock createConversationAsync on botAdapter
      const botAdapter = (adapter as any).botAdapter;
      botAdapter.createConversationAsync = vi.fn(
        async (
          _appId: string,
          _channelId: string,
          _serviceUrl: string,
          _audience: string,
          _params: unknown,
          callback: (ctx: unknown) => Promise<void>
        ) => {
          await callback({
            activity: {
              conversation: { id: "new-dm-conv-id" },
              id: "activity-1",
            },
          });
        }
      );

      const result = await adapter.openDM("user-123");

      expect(result).toMatch(TEAMS_PREFIX_PATTERN);
      const decoded = adapter.decodeThreadId(result);
      expect(decoded.conversationId).toBe("new-dm-conv-id");
      expect(decoded.serviceUrl).toBe("https://smba.trafficmanager.net/amer/");
    });

    it("should throw NetworkError when no conversation ID returned", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
        appTenantId: "tenant-123",
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
        processReaction: vi.fn(),
      };

      await adapter.initialize(mockChat as any);

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.createConversationAsync = vi.fn(
        async (
          _appId: string,
          _channelId: string,
          _serviceUrl: string,
          _audience: string,
          _params: unknown,
          callback: (ctx: unknown) => Promise<void>
        ) => {
          // Callback returns empty conversation
          await callback({
            activity: { conversation: { id: "" } },
          });
        }
      );

      await expect(adapter.openDM("user-456")).rejects.toThrow(NetworkError);
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
        logger: mockLogger,
      });

      // Pass a simple AST (mdast root with a paragraph containing text)
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
  // extractAttachmentsFromGraphMessage Tests
  // ==========================================================================

  describe("extractAttachmentsFromGraphMessage", () => {
    function callExtractAttachments(
      adapter: TeamsAdapter,
      msg: unknown
    ): unknown[] {
      return (adapter as any).extractAttachmentsFromGraphMessage(msg);
    }

    it("should return empty array for message without attachments", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(callExtractAttachments(adapter, { id: "1" })).toEqual([]);
    });

    it("should return empty array for empty attachments array", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      expect(
        callExtractAttachments(adapter, { id: "1", attachments: [] })
      ).toEqual([]);
    });

    it("should map image attachments", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        attachments: [
          {
            contentType: "image/png",
            contentUrl: "https://example.com/img.png",
            name: "screenshot.png",
          },
        ],
      };

      const result = callExtractAttachments(adapter, msg);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: "image",
        name: "screenshot.png",
        url: "https://example.com/img.png",
        mimeType: "image/png",
      });
    });

    it("should map non-image attachments as file", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const msg = {
        id: "1",
        attachments: [
          {
            contentType: "application/pdf",
            contentUrl: "https://example.com/doc.pdf",
            name: "document.pdf",
          },
        ],
      };

      const result = callExtractAttachments(adapter, msg);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: "file",
        name: "document.pdf",
        url: "https://example.com/doc.pdf",
        mimeType: "application/pdf",
      });
    });
  });

  // ==========================================================================
  // handleTurn routing Tests (via handleWebhook with mocked botAdapter)
  // ==========================================================================

  describe("handleTurn routing", () => {
    function createAdapterWithMockedBot() {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      const mockProcessMessage = vi.fn();
      const mockProcessAction = vi.fn();
      const mockProcessReaction = vi.fn();

      const mockChat = {
        getState: () => mockState,
        processMessage: mockProcessMessage,
        processAction: mockProcessAction,
        processReaction: mockProcessReaction,
      };

      (adapter as any).chat = mockChat;

      return {
        adapter,
        mockChat,
        mockProcessMessage,
        mockProcessAction,
        mockProcessReaction,
      };
    }

    it("should ignore non-message activity types", async () => {
      const { adapter, mockProcessMessage } = createAdapterWithMockedBot();

      // Call handleTurn directly
      const context = {
        activity: {
          type: "conversationUpdate",
          from: { id: "user-1" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
        },
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it("should process message activities", async () => {
      const { adapter, mockProcessMessage } = createAdapterWithMockedBot();

      const context = {
        activity: {
          type: "message",
          id: "msg-1",
          text: "Hello bot",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
        },
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    });

    it("should route message actions (Action.Submit) to processAction", async () => {
      const { adapter, mockProcessAction, mockProcessMessage } =
        createAdapterWithMockedBot();

      const context = {
        activity: {
          type: "message",
          id: "msg-1",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
          value: { actionId: "btn-confirm", value: "yes" },
        },
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessAction).toHaveBeenCalledTimes(1);
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it("should route reaction activities to processReaction", async () => {
      const { adapter, mockProcessReaction, mockProcessMessage } =
        createAdapterWithMockedBot();

      const context = {
        activity: {
          type: "messageReaction",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: {
            id: "19:abc@thread.tacv2;messageid=123456",
          },
          channelData: {},
          reactionsAdded: [{ type: "like" }],
        },
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessReaction).toHaveBeenCalledTimes(1);
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it("should process multiple reactions in one activity", async () => {
      const { adapter, mockProcessReaction } = createAdapterWithMockedBot();

      const context = {
        activity: {
          type: "messageReaction",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: {
            id: "19:abc@thread.tacv2;messageid=123456",
          },
          channelData: {},
          reactionsAdded: [{ type: "like" }, { type: "heart" }],
          reactionsRemoved: [{ type: "angry" }],
        },
      };

      await (adapter as any).handleTurn(context);

      // 2 added + 1 removed = 3 calls
      expect(mockProcessReaction).toHaveBeenCalledTimes(3);
    });

    it("should handle invoke activities for adaptive card actions", async () => {
      const { adapter, mockProcessAction } = createAdapterWithMockedBot();

      const mockSendActivity = vi.fn(async () => undefined);

      const context = {
        activity: {
          type: "invoke",
          name: "adaptiveCard/action",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
          value: {
            action: {
              data: { actionId: "card-btn-1", value: "clicked" },
            },
          },
        },
        sendActivity: mockSendActivity,
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessAction).toHaveBeenCalledTimes(1);
      // Should send invoke response
      expect(mockSendActivity).toHaveBeenCalledWith({
        type: "invokeResponse",
        value: { status: 200 },
      });
    });

    it("should send invoke response for adaptive card without actionId", async () => {
      const { adapter, mockProcessAction } = createAdapterWithMockedBot();

      const mockSendActivity = vi.fn(async () => undefined);

      const context = {
        activity: {
          type: "invoke",
          name: "adaptiveCard/action",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
          value: {
            action: {
              data: { someOtherField: "value" },
            },
          },
        },
        sendActivity: mockSendActivity,
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessAction).not.toHaveBeenCalled();
      // Should still send acknowledgment
      expect(mockSendActivity).toHaveBeenCalledWith({
        type: "invokeResponse",
        value: { status: 200 },
      });
    });

    it("should ignore unsupported invoke types", async () => {
      const { adapter, mockProcessAction } = createAdapterWithMockedBot();

      const context = {
        activity: {
          type: "invoke",
          name: "some/other/invoke",
          from: { id: "user-1", name: "Alice" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
        },
        sendActivity: vi.fn(),
      };

      await (adapter as any).handleTurn(context);

      expect(mockProcessAction).not.toHaveBeenCalled();
    });

    it("should not process if chat is not initialized", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      // chat is null by default (not initialized)
      const context = {
        activity: {
          type: "message",
          text: "hello",
          from: { id: "user-1" },
          serviceUrl: "https://smba.trafficmanager.net/teams/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {},
        },
      };

      // Should not throw
      await (adapter as any).handleTurn(context);
    });
  });

  // ==========================================================================
  // Reaction event handling
  // ==========================================================================

  describe("handleReactionActivity", () => {
    it("should extract messageId from conversationId with ;messageid=", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockProcessReaction = vi.fn();
      (adapter as any).chat = {
        getState: () => ({
          get: vi.fn(async () => null),
          set: vi.fn(async () => undefined),
        }),
        processReaction: mockProcessReaction,
      };

      const activity = {
        type: "messageReaction",
        from: { id: "user-1", name: "Alice" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        conversation: {
          id: "19:abc@thread.tacv2;messageid=9876543210",
        },
        channelData: {},
        reactionsAdded: [{ type: "like" }],
      };

      (adapter as any).handleReactionActivity(activity);

      expect(mockProcessReaction).toHaveBeenCalledTimes(1);
      const call = mockProcessReaction.mock.calls[0][0];
      expect(call.messageId).toBe("9876543210");
      expect(call.added).toBe(true);
    });

    it("should fallback to replyToId when no messageid in conversationId", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockProcessReaction = vi.fn();
      (adapter as any).chat = {
        getState: () => ({
          get: vi.fn(async () => null),
          set: vi.fn(async () => undefined),
        }),
        processReaction: mockProcessReaction,
      };

      const activity = {
        type: "messageReaction",
        from: { id: "user-1", name: "Alice" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        conversation: { id: "19:abc@thread.tacv2" },
        replyToId: "fallback-msg-id",
        channelData: {},
        reactionsAdded: [{ type: "heart" }],
      };

      (adapter as any).handleReactionActivity(activity);

      const call = mockProcessReaction.mock.calls[0][0];
      expect(call.messageId).toBe("fallback-msg-id");
    });

    it("should mark removed reactions as added=false", () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockProcessReaction = vi.fn();
      (adapter as any).chat = {
        getState: () => ({
          get: vi.fn(async () => null),
          set: vi.fn(async () => undefined),
        }),
        processReaction: mockProcessReaction,
      };

      const activity = {
        type: "messageReaction",
        from: { id: "user-1", name: "Alice" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        conversation: { id: "19:abc@thread.tacv2" },
        channelData: {},
        reactionsRemoved: [{ type: "like" }],
      };

      (adapter as any).handleReactionActivity(activity);

      const call = mockProcessReaction.mock.calls[0][0];
      expect(call.added).toBe(false);
    });

    it("should not process if chat is not initialized", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      // chat is null
      const activity = {
        type: "messageReaction",
        from: { id: "user-1", name: "Alice" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
        conversation: { id: "19:abc@thread.tacv2" },
        reactionsAdded: [{ type: "like" }],
      };

      // Should not throw
      (adapter as any).handleReactionActivity(activity);
    });
  });

  // ==========================================================================
  // fetchChannelInfo Tests
  // ==========================================================================

  describe("fetchChannelInfo", () => {
    it("should return fallback info when no graph client", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "a]user-dm-id",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const info = await adapter.fetchChannelInfo(threadId);
      expect(info.id).toBe(threadId);
      expect(info.isDM).toBe(true);
      expect(info.metadata).toHaveProperty("conversationId", "a]user-dm-id");
    });

    it("should return fallback info for group chat without graph client", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const info = await adapter.fetchChannelInfo(threadId);
      expect(info.id).toBe(threadId);
      expect(info.isDM).toBe(false);
    });

    it("should strip messageid from conversationId for lookup", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=123",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const info = await adapter.fetchChannelInfo(threadId);
      expect(info.metadata).toHaveProperty(
        "conversationId",
        "19:abc@thread.tacv2"
      );
    });

    it("should use graph client when channel context is cached", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid-123",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };

      await adapter.initialize(mockChat as any);

      // Mock the graph client
      const mockGet = vi.fn(async () => ({
        displayName: "General",
        memberCount: 10,
        membershipType: "standard",
        description: "Main channel",
      }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ get: mockGet })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const info = await adapter.fetchChannelInfo(threadId);
      expect(info.name).toBe("General");
      expect(info.isDM).toBe(false);
      expect(info.memberCount).toBe(10);
    });

    it("should fallback when graph client throws", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid-123",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };

      await adapter.initialize(mockChat as any);

      // Mock the graph client that throws
      (adapter as any).graphClient = {
        api: vi.fn(() => ({
          get: vi.fn(async () => {
            throw new Error("Graph API error");
          }),
        })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const info = await adapter.fetchChannelInfo(threadId);
      // Should fallback gracefully
      expect(info.id).toBe(threadId);
      expect(info.isDM).toBe(false);
    });
  });

  // ==========================================================================
  // postChannelMessage Tests
  // ==========================================================================

  describe("postChannelMessage", () => {
    it("should post to base conversation ID (without messageid)", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      let capturedConversationId = "";
      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(
        async (
          _appId: string,
          ref: { conversation: { id: string } },
          callback: (ctx: unknown) => Promise<void>
        ) => {
          capturedConversationId = ref.conversation.id;
          await callback({
            sendActivity: vi.fn(async () => ({ id: "channel-msg-1" })),
          });
        }
      );

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=999",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.postChannelMessage(threadId, {
        text: "Channel message",
      });

      expect(result.id).toBe("channel-msg-1");
      // Should strip messageid from the conversation reference
      expect(capturedConversationId).toBe("19:abc@thread.tacv2");
    });

    it("should handle postChannelMessage failure", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        logger: mockLogger,
      });

      const botAdapter = (adapter as any).botAdapter;
      botAdapter.continueConversationAsync = vi.fn(async () => {
        throw new MockTeamsError({ statusCode: 403, message: "Forbidden" });
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.postChannelMessage(threadId, { text: "test" })
      ).rejects.toThrow(AuthenticationError);
    });
  });

  // ==========================================================================
  // fetchMessages with mocked Graph client Tests
  // ==========================================================================

  describe("fetchMessages with graph client", () => {
    function createAdapterWithGraph() {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
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
        processReaction: vi.fn(),
      };

      (adapter as any).chat = mockChat;

      return { adapter, mockState };
    }

    it("should fetch messages backward with default options", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "First", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "msg-2",
          body: { content: "Second", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      expect(result.messages).toHaveLength(2);
      // Messages should be reversed to chronological order
      expect(result.messages[0].text).toBe("Second");
      expect(result.messages[1].text).toBe("First");
    });

    it("should detect bot messages in fetched results", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Bot reply", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: {
            application: { id: "test-app-id", displayName: "Bot" },
          },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      expect(result.messages[0].author.isMe).toBe(true);
      expect(result.messages[0].author.isBot).toBe(true);
    });

    it("should use cursor for backward pagination", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockGet = vi.fn(async () => ({ value: [] }));
      const mockFilter = vi.fn(() => ({ get: mockGet }));
      const mockOrderby = vi.fn(() => ({
        get: mockGet,
        filter: mockFilter,
      }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await adapter.fetchMessages(threadId, {
        cursor: "2024-01-01T00:00:00Z",
        direction: "backward",
      });

      expect(mockFilter).toHaveBeenCalledWith(
        "createdDateTime lt 2024-01-01T00:00:00Z"
      );
    });

    it("should fetch forward direction with pagination", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockMessages = Array.from({ length: 5 }, (_, i) => ({
        id: `msg-${i}`,
        body: { content: `Message ${i}`, contentType: "text" },
        createdDateTime: `2024-01-0${i + 1}T00:00:00Z`,
        from: { user: { id: `u${i}`, displayName: `User ${i}` } },
      }));

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId, {
        direction: "forward",
        limit: 3,
      });

      // Should return first 3 messages in chronological order
      expect(result.messages).toHaveLength(3);
      expect(result.nextCursor).toBeDefined();
    });

    it("should throw NotImplementedError for 403 permission error", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockGet = vi.fn(async () => {
        throw new Error("403 Forbidden");
      });
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.fetchMessages(threadId)).rejects.toThrow(
        NotImplementedError
      );
    });

    it("should re-throw non-permission errors", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockGet = vi.fn(async () => {
        throw new Error("Network timeout");
      });
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.fetchMessages(threadId)).rejects.toThrow(
        "Network timeout"
      );
    });

    it("should return nextCursor for backward when full page returned", async () => {
      const { adapter } = createAdapterWithGraph();

      // Return exactly 50 messages (default limit) to trigger hasMoreMessages
      const mockMessages = Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        body: { content: `Message ${i}`, contentType: "text" },
        createdDateTime: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        from: { user: { id: `u${i}`, displayName: `User ${i}` } },
      }));

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      expect(result.nextCursor).toBeDefined();
    });

    it("should filter group chat messages by threadMessageId", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockMessages = [
        {
          id: "1000",
          body: { content: "Before thread", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "2000",
          body: { content: "Thread start", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "3000",
          body: { content: "After thread", contentType: "text" },
          createdDateTime: "2024-01-01T02:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      // Thread ID with messageid=2000 means filter to messages >= 2000
      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2;messageid=2000",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      // Should only include messages with id >= "2000"
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("After thread");
      expect(result.messages[1].text).toBe("Thread start");
    });

    it("should handle messages with edited flag", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Edited message", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          lastModifiedDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      expect(result.messages[0].metadata.edited).toBe(true);
    });

    it("should handle messages with graph attachments", async () => {
      const { adapter } = createAdapterWithGraph();

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "See attachment", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
          attachments: [
            {
              contentType: "image/png",
              contentUrl:
                "https://graph.microsoft.com/v1.0/drives/files/img.png",
              name: "image.png",
            },
          ],
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      expect(result.messages[0].attachments).toHaveLength(1);
      expect(result.messages[0].attachments[0].type).toBe("image");
    });
  });

  // ==========================================================================
  // fetchChannelMessages Tests
  // ==========================================================================

  describe("fetchChannelMessages", () => {
    it("should throw NotImplementedError when no appTenantId", async () => {
      // Use TeamsAdapter directly to bypass createTeamsAdapter's env var fallback
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.fetchChannelMessages(threadId)).rejects.toThrow(
        NotImplementedError
      );
    });

    it("should fetch group chat messages backward", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Hello", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchChannelMessages(threadId);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe("Hello");
    });

    it("should use channel context when available", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      let capturedUrl = "";
      const mockGet = vi.fn(async () => ({ value: [] }));
      const mockTop = vi.fn(() => ({ get: mockGet }));
      (adapter as any).graphClient = {
        api: vi.fn((url: string) => {
          capturedUrl = url;
          return { top: mockTop };
        }),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await adapter.fetchChannelMessages(threadId);

      // Should use the team channel endpoint
      expect(capturedUrl).toContain("/teams/");
      expect(capturedUrl).toContain("/channels/");
    });
  });

  // ==========================================================================
  // listThreads Tests
  // ==========================================================================

  describe("listThreads", () => {
    it("should throw NotImplementedError when no appTenantId", async () => {
      // Use TeamsAdapter directly to bypass createTeamsAdapter's env var fallback
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.listThreads(threadId)).rejects.toThrow(
        NotImplementedError
      );
    });

    it("should list group chat messages as threads", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Thread 1", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "msg-2",
          body: { content: "Thread 2", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          lastModifiedDateTime: "2024-01-01T02:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.listThreads(channelId);
      expect(result.threads).toHaveLength(2);
      expect(result.threads[0].rootMessage.text).toBe("Thread 1");
      expect(result.threads[1].rootMessage.text).toBe("Thread 2");
      // Group chat path doesn't set lastReplyAt (only channel path does)
      expect(result.threads[1].lastReplyAt).toBeUndefined();
    });

    it("should skip messages without id", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          body: { content: "No ID", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "msg-2",
          body: { content: "Has ID", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.listThreads(channelId);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].rootMessage.text).toBe("Has ID");
    });

    it("should use channel context for team channels", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Channel thread", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      let capturedUrl = "";
      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockTop = vi.fn(() => ({ get: mockGet }));
      (adapter as any).graphClient = {
        api: vi.fn((url: string) => {
          capturedUrl = url;
          return { top: mockTop };
        }),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.listThreads(channelId);
      expect(capturedUrl).toContain("/teams/");
      expect(result.threads).toHaveLength(1);
    });

    it("should rethrow graph API errors", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockGet = vi.fn(async () => {
        throw new Error("Graph timeout");
      });
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.listThreads(channelId)).rejects.toThrow(
        "Graph timeout"
      );
    });
  });

  // ==========================================================================
  // fetchChannelThreadMessages (via fetchMessages with channelContext)
  // ==========================================================================

  describe("fetchChannelThreadMessages (via fetchMessages)", () => {
    it("should use channel thread endpoint when context and threadMessageId exist", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const parentMessage = {
        id: "parent-1",
        body: { content: "Thread start", contentType: "text" },
        createdDateTime: "2024-01-01T00:00:00Z",
        from: { user: { id: "u1", displayName: "Alice" } },
      };

      const replies = [
        {
          id: "reply-1",
          body: { content: "Reply 1", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
      ];

      (adapter as any).graphClient = {
        api: vi.fn((url: string) => {
          if (url.endsWith("/replies")) {
            return {
              top: vi.fn(() => ({
                get: vi.fn(async () => ({ value: replies })),
              })),
            };
          }
          // Parent message endpoint
          return {
            get: vi.fn(async () => parentMessage),
          };
        }),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=1234567890",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);

      // Should have fetched parent + replies
      expect(result.messages).toHaveLength(2);
      // Parent should be first (oldest)
      expect(result.messages[0].text).toBe("Thread start");
      expect(result.messages[1].text).toBe("Reply 1");
    });

    it("should handle missing parent message gracefully", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      (adapter as any).graphClient = {
        api: vi.fn((url: string) => {
          if (url.endsWith("/replies")) {
            return {
              top: vi.fn(() => ({
                get: vi.fn(async () => ({
                  value: [
                    {
                      id: "reply-1",
                      body: { content: "Reply", contentType: "text" },
                      createdDateTime: "2024-01-01T01:00:00Z",
                      from: {
                        user: { id: "u1", displayName: "Alice" },
                      },
                    },
                  ],
                })),
              })),
            };
          }
          // Parent message fails
          return {
            get: vi.fn(async () => {
              throw new Error("Parent not found");
            }),
          };
        }),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=1234567890",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId);
      // Only replies, no parent
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe("Reply");
    });
  });

  // ==========================================================================
  // handleTurn state caching Tests
  // ==========================================================================

  describe("handleTurn state caching", () => {
    it("should cache serviceUrl and tenantId from incoming activities", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockSet = vi.fn(async () => undefined);
      const mockState = {
        get: vi.fn(async () => null),
        set: mockSet,
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };
      (adapter as any).chat = mockChat;

      const context = {
        activity: {
          type: "message",
          id: "msg-1",
          text: "hello",
          from: { id: "user-xyz", name: "User" },
          serviceUrl: "https://smba.trafficmanager.net/amer/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {
            tenant: { id: "my-tenant-id" },
          },
        },
      };

      await (adapter as any).handleTurn(context);

      // Should cache serviceUrl
      expect(mockSet).toHaveBeenCalledWith(
        "teams:serviceUrl:user-xyz",
        "https://smba.trafficmanager.net/amer/",
        expect.any(Number)
      );
      // Should cache tenantId
      expect(mockSet).toHaveBeenCalledWith(
        "teams:tenantId:user-xyz",
        "my-tenant-id",
        expect.any(Number)
      );
    });

    it("should cache channel context when aadGroupId is present", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockSet = vi.fn(async () => undefined);
      const mockState = {
        get: vi.fn(async () => null),
        set: mockSet,
        delete: vi.fn(async () => undefined),
      };
      const mockChat = {
        getState: () => mockState,
        processMessage: vi.fn(),
        processAction: vi.fn(),
        processReaction: vi.fn(),
      };
      (adapter as any).chat = mockChat;

      const context = {
        activity: {
          type: "installationUpdate",
          from: { id: "user-xyz", name: "User" },
          serviceUrl: "https://smba.trafficmanager.net/amer/",
          conversation: { id: "19:abc@thread.tacv2" },
          channelData: {
            tenant: { id: "tenant-id" },
            team: {
              id: "19:team@thread.tacv2",
              aadGroupId: "guid-team-123",
            },
            channel: { id: "19:channel@thread.tacv2" },
          },
        },
      };

      await (adapter as any).handleTurn(context);

      // Should cache channel context with aadGroupId
      expect(mockSet).toHaveBeenCalledWith(
        "teams:channelContext:19:abc@thread.tacv2",
        expect.stringContaining("guid-team-123"),
        expect.any(Number)
      );
      // Should also cache team context
      expect(mockSet).toHaveBeenCalledWith(
        "teams:teamContext:19:team@thread.tacv2",
        expect.stringContaining("guid-team-123"),
        expect.any(Number)
      );
    });
  });

  // ==========================================================================
  // fetchChannelMessages forward direction Tests
  // ==========================================================================

  describe("fetchChannelMessages forward direction", () => {
    it("should fetch forward direction for group chats", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "First", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "msg-2",
          body: { content: "Second", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
        {
          id: "msg-3",
          body: { content: "Third", contentType: "text" },
          createdDateTime: "2024-01-01T02:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchChannelMessages(channelId, {
        direction: "forward",
        limit: 2,
      });

      expect(result.messages).toHaveLength(2);
      expect(result.nextCursor).toBeDefined();
    });

    it("should fetch forward direction with channel context", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Channel msg", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockTop = vi.fn(() => ({ get: mockGet }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchChannelMessages(channelId, {
        direction: "forward",
      });

      expect(result.messages).toHaveLength(1);
    });

    it("should handle cursor with forward direction for group chats", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      // API returns messages in descending order (newest first)
      const mockMessages = [
        {
          id: "msg-3",
          body: { content: "Newest", contentType: "text" },
          createdDateTime: "2024-01-03T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "msg-2",
          body: { content: "Middle", contentType: "text" },
          createdDateTime: "2024-01-02T00:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
        {
          id: "msg-1",
          body: { content: "Oldest", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      // Cursor at Jan 1 - should get messages after that (Jan 2 and Jan 3)
      const result = await adapter.fetchChannelMessages(channelId, {
        direction: "forward",
        cursor: "2024-01-01T00:00:00Z",
        limit: 2,
      });

      // After reverse to chronological: [msg-1 (Jan 1), msg-2 (Jan 2), msg-3 (Jan 3)]
      // Cursor finds first msg > cursor. msg-2 (Jan 2) > Jan 1 cursor, so startIndex=1
      // Slice(1, 3) = [msg-2, msg-3]
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Middle");
      expect(result.messages[1].text).toBe("Newest");
    });

    it("should handle cursor with backward direction with channel context", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Hello", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockFilter = vi.fn(() => ({ get: mockGet }));
      const mockOrderby = vi.fn(() => ({
        get: mockGet,
        filter: mockFilter,
      }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await adapter.fetchChannelMessages(channelId, {
        direction: "backward",
        cursor: "2024-01-02T00:00:00Z",
      });

      expect(mockFilter).toHaveBeenCalledWith(
        "createdDateTime lt 2024-01-02T00:00:00Z"
      );
    });

    it("should rethrow fetchChannelMessages errors", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const mockState = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockGet = vi.fn(async () => {
        throw new Error("API failure");
      });
      const mockOrderby = vi.fn(() => ({ get: mockGet }));
      const mockTop = vi.fn(() => ({ orderby: mockOrderby }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.v2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.fetchChannelMessages(channelId)).rejects.toThrow(
        "API failure"
      );
    });
  });

  // ==========================================================================
  // fetchChannelThreadMessages forward direction Tests
  // ==========================================================================

  describe("fetchChannelThreadMessages forward direction", () => {
    it("should fetch forward with parent and replies", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const parentMessage = {
        id: "1234567890",
        body: { content: "Thread start", contentType: "text" },
        createdDateTime: "2024-01-01T00:00:00Z",
        from: { user: { id: "u1", displayName: "Alice" } },
      };

      // API returns replies in descending order (newest first)
      const replies = [
        {
          id: "reply-2",
          body: { content: "Reply 2", contentType: "text" },
          createdDateTime: "2024-01-01T02:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
        {
          id: "reply-1",
          body: { content: "Reply 1", contentType: "text" },
          createdDateTime: "2024-01-01T01:00:00Z",
          from: { user: { id: "u2", displayName: "Bob" } },
        },
      ];

      (adapter as any).graphClient = {
        api: vi.fn((url: string) => {
          if (url.endsWith("/replies")) {
            return {
              top: vi.fn(() => ({
                get: vi.fn(async () => ({ value: replies })),
              })),
            };
          }
          return {
            get: vi.fn(async () => parentMessage),
          };
        }),
      };

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=1234567890",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.fetchMessages(threadId, {
        direction: "forward",
        limit: 2,
      });

      // After reverse: [reply-1. reply-2]. Prepend parent: [parent, reply-1, reply-2]
      // Limit 2: [parent, reply-1]
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Thread start");
      expect(result.messages[1].text).toBe("Reply 1");
      expect(result.nextCursor).toBeDefined();
    });
  });

  // ==========================================================================
  // listThreads with channel context Tests
  // ==========================================================================

  describe("listThreads with channel context (team channel path)", () => {
    it("should include lastReplyAt from lastModifiedDateTime", async () => {
      const adapter = createTeamsAdapter({
        appId: "test-app-id",
        appPassword: "test",
        appTenantId: "tenant-123",
        logger: mockLogger,
      });

      const channelContext = JSON.stringify({
        teamId: "team-guid",
        channelId: "19:channel@thread.tacv2",
        tenantId: "tenant-123",
      });

      const mockState = {
        get: vi.fn(async (key: string) => {
          if (key.startsWith("teams:channelContext:")) {
            return channelContext;
          }
          return null;
        }),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      };
      (adapter as any).chat = {
        getState: () => mockState,
      };

      const mockMessages = [
        {
          id: "msg-1",
          body: { content: "Thread", contentType: "text" },
          createdDateTime: "2024-01-01T00:00:00Z",
          lastModifiedDateTime: "2024-01-01T05:00:00Z",
          from: { user: { id: "u1", displayName: "Alice" } },
        },
      ];

      const mockGet = vi.fn(async () => ({ value: mockMessages }));
      const mockTop = vi.fn(() => ({ get: mockGet }));
      (adapter as any).graphClient = {
        api: vi.fn(() => ({ top: mockTop })),
      };

      const channelId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const result = await adapter.listThreads(channelId);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].lastReplyAt).toEqual(
        new Date("2024-01-01T05:00:00Z")
      );
    });
  });
});
