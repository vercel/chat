import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthenticationError, ValidationError } from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockState,
  threadIdContract,
} from "@chat-adapter/tests";
import type { IStreamer } from "@microsoft/teams.apps";
import { ConsoleLogger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamsAdapter, TeamsAdapter, type TeamsThreadId } from "./index";

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

// encodeThreadId/decodeThreadId/isDM are pure — a minimally configured adapter
// suffices for the shared thread-id contract (no init/network needed).
const contractAdapter = createTeamsAdapter({
  appId: "test",
  appPassword: "test",
  logger,
});

threadIdContract<TeamsThreadId>({
  name: "teams",
  encode: (d) => contractAdapter.encodeThreadId(d),
  decode: (id) => contractAdapter.decodeThreadId(id),
  cases: [
    {
      decoded: {
        conversationId: "19:abc123@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      },
      encoded:
        "teams:MTk6YWJjMTIzQHRocmVhZC50YWN2Mg:aHR0cHM6Ly9zbWJhLnRyYWZmaWNtYW5hZ2VyLm5ldC90ZWFtcy8",
    },
    {
      // Channel thread carrying a ;messageid= suffix (threaded reply root).
      decoded: {
        conversationId:
          "19:d441d38c655c47a085215b2726e76927@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      },
      encoded:
        "teams:MTk6ZDQ0MWQzOGM2NTVjNDdhMDg1MjE1YjI3MjZlNzY5MjdAdGhyZWFkLnRhY3YyO21lc3NhZ2VpZD0xNzY3Mjk3ODQ5OTA5:aHR0cHM6Ly9zbWJhLnRyYWZmaWNtYW5hZ2VyLm5ldC9hbWVyLw",
    },
    {
      // DM conversation (non-19: prefix).
      decoded: {
        conversationId: "a]8:orgid:user-id-here",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      },
      encoded:
        "teams:YV04Om9yZ2lkOnVzZXItaWQtaGVyZQ:aHR0cHM6Ly9zbWJhLnRyYWZmaWNtYW5hZ2VyLm5ldC90ZWFtcy8",
    },
    {
      // Special characters in both segments survive base64url round-trip.
      decoded: {
        conversationId:
          "19:meeting_MDE4OWI4N2UtNzEzNC00ZGE2LTkxMGEtNDM3@thread.v2",
        serviceUrl:
          "https://smba.trafficmanager.net/amer/?special=chars&foo=bar",
      },
      encoded:
        "teams:MTk6bWVldGluZ19NREU0T1dJNE4yVXROekV6TkMwMFpHRTJMVGt4TUdFdE5ETTNAdGhyZWFkLnYy:aHR0cHM6Ly9zbWJhLnRyYWZmaWNtYW5hZ2VyLm5ldC9hbWVyLz9zcGVjaWFsPWNoYXJzJmZvbz1iYXI",
    },
  ],
  isDM: {
    fn: (id) => contractAdapter.isDM(id),
    dmThreadId: contractAdapter.encodeThreadId({
      conversationId: "a]8:orgid:user-id-here",
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    }),
    nonDmThreadId: contractAdapter.encodeThreadId({
      conversationId: "19:abc@thread.tacv2",
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    }),
  },
});

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

  // Round-trip, prefix, pinned-encoding, and DM detection coverage lives in the
  // top-level threadIdContract. These remain because the contract does not
  // exercise malformed-id / wrong-prefix decode errors.
  describe("thread ID decode errors", () => {
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

  describe("streaming", () => {
    class StreamingTestAdapter extends TeamsAdapter {
      streamNatively(
        textStream: AsyncIterable<string>,
        stream: IStreamer,
        placeholderText?: string | null
      ) {
        return this.streamViaEmit(
          "teams:dm",
          textStream,
          stream,
          placeholderText
        );
      }
    }

    let adapter: StreamingTestAdapter;

    beforeEach(() => {
      adapter = new StreamingTestAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });
    });

    const textStream = async function* (chunks: string[]) {
      yield* chunks;
    };

    const createStreamer = () => {
      let onChunk: ((activity: { id: string }) => void) | undefined;
      return {
        canceled: false,
        close: vi.fn(),
        emit: vi.fn(() => onChunk?.({ id: "answer-id" })),
        events: {
          once: vi.fn((_event, listener) => {
            onChunk = listener;
          }),
        },
        update: vi.fn(),
      } as unknown as IStreamer;
    };

    it("uses core fallback for an explicit group-chat placeholder", async () => {
      let consumed = false;
      const source = {
        async *[Symbol.asyncIterator]() {
          consumed = true;
          yield "Done";
        },
      };

      const result = await adapter.stream("teams:group", source, {
        fallbackStreamingPlaceholderText: "Working...",
      });

      expect(result).toBeNull();
      expect(consumed).toBe(false);
    });

    it.each([
      undefined,
      null,
    ])("preserves buffered group-chat streaming for placeholder %s", async (placeholderText) => {
      const postMessage = vi.spyOn(adapter, "postMessage").mockResolvedValue({
        id: "answer-id",
        threadId: "teams:group",
        raw: {},
      });

      const result = await adapter.stream(
        "teams:group",
        textStream(["Do", "ne"]),
        placeholderText === undefined
          ? undefined
          : { fallbackStreamingPlaceholderText: placeholderText }
      );

      expect(postMessage).toHaveBeenCalledOnce();
      expect(postMessage).toHaveBeenCalledWith("teams:group", {
        markdown: "Done",
      });
      expect(result?.id).toBe("answer-id");
    });

    it("sends an explicit placeholder as native status before the first chunk", async () => {
      const stream = createStreamer();

      const result = await adapter.streamNatively(
        textStream(["Do", "ne"]),
        stream,
        "Working..."
      );

      expect(stream.update).toHaveBeenCalledWith("Working...");
      expect(vi.mocked(stream.update).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(stream.emit).mock.invocationCallOrder[0] ?? 0
      );
      expect(stream.emit).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ id: "answer-id", threadId: "teams:dm" });
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

  // Baseline DM vs non-DM detection is covered by the top-level
  // threadIdContract's isDM check. This retains the Teams-specific edge case
  // where a ;messageid= suffix must not flip a channel thread to a DM.
  describe("isDM", () => {
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

      // initialize() calls app.initialize() which registers the bridge route handler
      await adapter.initialize(createMockChatInstance());

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

      // Mock app.initialize to avoid real HTTP setup
      const mockApp = (
        adapter as unknown as { app: { initialize: ReturnType<typeof vi.fn> } }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);
      await adapter.initialize(createMockChatInstance());

      await expect(adapter.openDM("user-123")).rejects.toThrow(ValidationError);
    });
  });

  // ==========================================================================
  // getUser Tests
  // ==========================================================================

  describe("incoming sender email", () => {
    class IncomingMessageTestAdapter extends TeamsAdapter {
      handleIncoming(activity: Record<string, unknown>) {
        return this.handleMessageActivity({ activity } as never);
      }
    }

    const activity = (aadObjectId?: string) => ({
      type: "message",
      id: "msg-100",
      text: "Hello world",
      from: {
        id: "29:user-123",
        name: "Alice",
        aadObjectId,
      },
      conversation: { id: "19:abc@thread.tacv2" },
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    });

    const setup = async (
      graphResult: Record<string, unknown> | Error,
      cachedAadObjectId?: string
    ) => {
      const adapter = new IncomingMessageTestAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });
      const state = createMockState();
      if (cachedAadObjectId) {
        state.cache.set("teams:aadObjectId:29:user-123", cachedAadObjectId);
      }
      const chat = createMockChatInstance({ state });
      const mockApp = (
        adapter as unknown as {
          app: {
            initialize: ReturnType<typeof vi.fn>;
            graph: { call: ReturnType<typeof vi.fn> };
          };
        }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);
      mockApp.graph = {
        call: vi.fn(async () => {
          if (graphResult instanceof Error) {
            throw graphResult;
          }
          return graphResult;
        }),
      };
      await adapter.initialize(chat);
      return { adapter, chat, mockApp, state };
    };

    it("hydrates email from the activity AAD object ID without cached state", async () => {
      const { adapter, chat, mockApp, state } = await setup({
        displayName: "Alice",
        mail: "alice@example.com",
        userPrincipalName: "alice@contoso.com",
      });

      await adapter.handleIncoming(activity("activity-aad-id"));

      expect(state.get).not.toHaveBeenCalledWith(
        "teams:aadObjectId:29:user-123"
      );
      expect(mockApp.graph.call).toHaveBeenCalledWith(expect.anything(), {
        "user-id": "activity-aad-id",
      });
      const message = vi.mocked(chat.processMessage).mock.calls[0]?.[2];
      expect(message?.author.email).toBe("alice@example.com");
    });

    it("falls back to the cached AAD object ID", async () => {
      const { adapter, chat, mockApp } = await setup(
        {
          displayName: "Alice",
          mail: null,
          userPrincipalName: "alice@contoso.com",
        },
        "cached-aad-id"
      );

      await adapter.handleIncoming(activity());

      expect(mockApp.graph.call).toHaveBeenCalledWith(expect.anything(), {
        "user-id": "cached-aad-id",
      });
      const message = vi.mocked(chat.processMessage).mock.calls[0]?.[2];
      expect(message?.author.email).toBe("alice@contoso.com");
    });

    it("dispatches the message when Graph lookup fails", async () => {
      const { adapter, chat } = await setup(new Error("Forbidden"));

      await adapter.handleIncoming(activity("activity-aad-id"));

      expect(chat.processMessage).toHaveBeenCalledOnce();
      const message = vi.mocked(chat.processMessage).mock.calls[0]?.[2];
      expect(message?.author.email).toBeUndefined();
    });

    it("caches the Graph lookup across messages", async () => {
      const { adapter, chat, mockApp } = await setup({
        displayName: "Alice",
        mail: "alice@example.com",
        userPrincipalName: "alice@contoso.com",
      });

      await adapter.handleIncoming(activity("activity-aad-id"));
      await adapter.handleIncoming(activity("activity-aad-id"));

      expect(mockApp.graph.call).toHaveBeenCalledOnce();
      const message = vi.mocked(chat.processMessage).mock.calls[1]?.[2];
      expect(message?.author.email).toBe("alice@example.com");
    });

    it("caches failed Graph lookups without retrying", async () => {
      const { adapter, chat, mockApp } = await setup(new Error("Forbidden"));

      await adapter.handleIncoming(activity("activity-aad-id"));
      await adapter.handleIncoming(activity("activity-aad-id"));

      expect(mockApp.graph.call).toHaveBeenCalledOnce();
      expect(chat.processMessage).toHaveBeenCalledTimes(2);
      const message = vi.mocked(chat.processMessage).mock.calls[1]?.[2];
      expect(message?.author.email).toBeUndefined();
    });

    it("hydrates email on the DM path and completes processing", async () => {
      const { adapter, chat } = await setup({
        displayName: "Alice",
        mail: "alice@example.com",
        userPrincipalName: "alice@contoso.com",
      });
      // DM handling blocks on a waitUntil-driven promise for native
      // streaming, so the mock must invoke waitUntil for the handler
      // to resolve.
      vi.mocked(chat.processMessage).mockImplementation(
        (_adapter, _threadId, _message, options) => {
          (
            options as { waitUntil?: (task: Promise<unknown>) => void }
          )?.waitUntil?.(Promise.resolve());
        }
      );

      await adapter.handleIncoming({
        ...activity("activity-aad-id"),
        conversation: { id: "a:1dm-conversation" },
      });

      expect(chat.processMessage).toHaveBeenCalledOnce();
      const message = vi.mocked(chat.processMessage).mock.calls[0]?.[2];
      expect(message?.author.email).toBe("alice@example.com");
    });
  });

  describe("getUser", () => {
    it("should return user info when aadObjectId is cached and Graph call succeeds", async () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const state = createMockState();
      state.cache.set("teams:aadObjectId:29:user-123", "aad-object-id-456");
      const mockChat = createMockChatInstance({ state });

      const mockApp = (
        adapter as unknown as {
          app: {
            initialize: ReturnType<typeof vi.fn>;
            graph: { call: ReturnType<typeof vi.fn> };
          };
        }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);
      mockApp.graph = {
        call: vi.fn(async () => ({
          displayName: "Alice Smith",
          mail: "alice.smith@contoso.com",
          userPrincipalName: "alice@contoso.com",
          id: "aad-object-id-456",
        })),
      };

      await adapter.initialize(mockChat);

      const user = await adapter.getUser("29:user-123");
      expect(user).not.toBeNull();
      expect(user?.fullName).toBe("Alice Smith");
      expect(user?.email).toBe("alice.smith@contoso.com");
      expect(user?.userName).toBe("alice@contoso.com");
      expect(user?.userId).toBe("29:user-123");
      expect(user?.isBot).toBe(false);
    });

    it("should return null when aadObjectId is not cached", async () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const mockChat = createMockChatInstance();

      const mockApp = (
        adapter as unknown as {
          app: { initialize: ReturnType<typeof vi.fn> };
        }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);

      await adapter.initialize(mockChat);

      const user = await adapter.getUser("29:unknown-user");
      expect(user).toBeNull();
    });

    it("should return null when Graph call fails", async () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const state = createMockState();
      state.cache.set("teams:aadObjectId:29:user-123", "aad-object-id-456");
      const mockChat = createMockChatInstance({ state });

      const mockApp = (
        adapter as unknown as {
          app: {
            initialize: ReturnType<typeof vi.fn>;
            graph: { call: ReturnType<typeof vi.fn> };
          };
        }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);
      mockApp.graph = {
        call: vi.fn(async () => {
          throw new Error("Forbidden");
        }),
      };

      await adapter.initialize(mockChat);

      const user = await adapter.getUser("29:user-123");
      expect(user).toBeNull();
    });

    it("should fall back to userPrincipalName when mail is missing", async () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const state = createMockState();
      state.cache.set("teams:aadObjectId:29:user-123", "aad-object-id-456");
      const mockChat = createMockChatInstance({ state });

      const mockApp = (
        adapter as unknown as {
          app: {
            initialize: ReturnType<typeof vi.fn>;
            graph: { call: ReturnType<typeof vi.fn> };
          };
        }
      ).app;
      mockApp.initialize = vi.fn(async () => undefined);
      mockApp.graph = {
        call: vi.fn(async () => ({
          displayName: "Bob Jones",
          mail: null,
          userPrincipalName: "bob@contoso.com",
          id: "aad-object-id-456",
        })),
      };

      await adapter.initialize(mockChat);

      const user = await adapter.getUser("29:user-123");
      expect(user).not.toBeNull();
      expect(user?.fullName).toBe("Bob Jones");
      expect(user?.email).toBe("bob@contoso.com");
      expect(user?.userName).toBe("bob@contoso.com");
    });

    it("should return null when adapter is not initialized", async () => {
      const adapter = new TeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger,
      });

      const user = await adapter.getUser("29:user-123");
      expect(user).toBeNull();
    });
  });
});

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends TeamsAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.handleMessageActivity,
        ] as const;
      }
    }
    expect(TestSubclass.prototype.checkAccess).toBeInstanceOf(Function);
  });
});
