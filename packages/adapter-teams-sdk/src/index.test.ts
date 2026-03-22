import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamsAdapter, TeamsAdapter } from "./index";

const TEAMS_PREFIX_PATTERN = /^teams:/;

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

describe("TeamsAdapter (teams-sdk)", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("TEAMS_")) {
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
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(TeamsAdapter);
    expect(adapter.name).toBe("teams");
  });

  // ── Thread ID encoding ──────────────────────────────────────────────────────

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

  // ── Constructor / Initialization ────────────────────────────────────────────

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

    it("should throw when appId is missing and env var not set", () => {
      expect(() => new TeamsAdapter({})).toThrow("appId is required");
    });

    it("should throw when no auth method is provided", () => {
      expect(() => new TeamsAdapter({ appId: "test" })).toThrow(
        "One of appPassword, certificate, or federated must be provided"
      );
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
  });

  // ── Factory function ────────────────────────────────────────────────────────

  describe("createTeamsAdapter factory", () => {
    it("should delegate to constructor", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(TeamsAdapter);
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
  });

  // ── parseMessage ────────────────────────────────────────────────────────────

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

    it("should detect exact match of appId as isMe", () => {
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

    it("should detect Teams-prefixed bot ID (28:appId) as isMe", () => {
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
  });

  // ── isDM ────────────────────────────────────────────────────────────────────

  describe("isDM", () => {
    it("should return false for channel conversations (19: prefix)", () => {
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

    it("should return true for 1:1 conversations (non-19: prefix)", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "a:1Abc123_xyzABC",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      expect(adapter.isDM(threadId)).toBe(true);
    });
  });

  // ── channelIdFromThreadId ───────────────────────────────────────────────────

  describe("channelIdFromThreadId", () => {
    it("should strip ;messageid= from conversation ID", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2;messageid=12345",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const channelId = adapter.channelIdFromThreadId(threadId);
      const decoded = adapter.decodeThreadId(channelId);
      expect(decoded.conversationId).toBe("19:abc@thread.tacv2");
      expect(decoded.conversationId).not.toContain(";messageid=");
    });

    it("should return same thread ID when no messageid present", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const original = {
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };
      const threadId = adapter.encodeThreadId(original);
      const channelId = adapter.channelIdFromThreadId(threadId);

      expect(channelId).toBe(threadId);
    });
  });

  // ── initialize ──────────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("should store chat instance", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const mockChat = {
        getState: vi.fn(),
      } as unknown as import("chat").ChatInstance;
      await adapter.initialize(mockChat);
      // No errors should be thrown
      expect(true).toBe(true);
    });
  });

  // ── addReaction / removeReaction ────────────────────────────────────────────

  describe("addReaction / removeReaction via Graph API", () => {
    it("should throw NotImplementedError when graph client not configured", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
        // No appTenantId → no graphClient
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(
        adapter.addReaction(threadId, "msg-1", "like")
      ).rejects.toThrow();

      await expect(
        adapter.removeReaction(threadId, "msg-1", "like")
      ).rejects.toThrow();
    });
  });

  // ── fetchMessages ───────────────────────────────────────────────────────────

  describe("fetchMessages", () => {
    it("should throw when graph client is not configured", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
        // No appTenantId → no graphClient
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      await expect(adapter.fetchMessages(threadId)).rejects.toThrow();
    });
  });

  // ── handleWebhook ───────────────────────────────────────────────────────────

  describe("handleWebhook", () => {
    it("should return 400 for invalid JSON body", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });
  });

  // ── renderFormatted ─────────────────────────────────────────────────────────

  describe("renderFormatted", () => {
    it("should convert AST back to Teams markdown", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const activity = {
        type: "message",
        id: "msg-1",
        text: "**bold** text",
        from: { id: "user-1", name: "Alice" },
        conversation: { id: "19:abc@thread.tacv2" },
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const message = adapter.parseMessage(activity);
      const rendered = adapter.renderFormatted(message.formatted);
      expect(rendered).toContain("bold");
    });
  });

  // ── fetchThread ─────────────────────────────────────────────────────────────

  describe("fetchThread", () => {
    it("should return thread info with correct id", async () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const threadId = adapter.encodeThreadId({
        conversationId: "19:abc@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      });

      const threadInfo = await adapter.fetchThread(threadId);
      expect(threadInfo.id).toBe(threadId);
    });
  });
});
