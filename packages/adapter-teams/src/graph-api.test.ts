import { createMockChatInstance, createMockState } from "@chat-adapter/tests";
import { Client as GraphClient } from "@microsoft/teams.graph";
import { chats } from "@microsoft/teams.graph-endpoints";
import { ConsoleLogger } from "chat";
import { describe, expect, it, vi } from "vitest";
import type { TeamsApp } from "./app";
import { TeamsGraphReader } from "./graph-api";
import { createTeamsAdapter } from "./index";
import { TeamsFormatConverter } from "./markdown";
import { decodeThreadId, encodeThreadId, isDM } from "./thread-id";

function createTestReader(): TeamsGraphReader {
  return new TeamsGraphReader({
    botId: "test-app",
    graph: new GraphClient(),
    formatConverter: new TeamsFormatConverter(),
    getGraphContext: async () => null,
    logger: new ConsoleLogger("error"),
  });
}

describe("extractTextFromGraphMessage", () => {
  it("should extract plain text content", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: { content: "Hello world", contentType: "text" },
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe(
      "Hello world"
    );
  });

  it("should strip HTML tags from html content", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: {
        content: "<p>Hello <b>world</b></p>",
        contentType: "html",
      },
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe(
      "Hello world"
    );
  });

  it("should return empty string for missing body", () => {
    const reader = createTestReader();
    const msg = { id: "1" };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe("");
  });

  it("should return '[Card]' for adaptive card without title", () => {
    const reader = createTestReader();
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
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe("[Card]");
  });

  it("should extract card title from bolder TextBlock", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: { content: "", contentType: "html" },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify({
            type: "AdaptiveCard",
            body: [
              { type: "TextBlock", text: "Some description" },
              { type: "TextBlock", text: "My Card Title", weight: "bolder" },
            ],
          }),
        },
      ],
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe(
      "My Card Title"
    );
  });

  it("should return '[Card]' for invalid JSON in card content", () => {
    const reader = createTestReader();
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
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe("[Card]");
  });
});

describe("extractCardTitle", () => {
  it("should return null for null/undefined", () => {
    const reader = createTestReader();
    expect(reader.extractCardTitle(null)).toBeNull();
    expect(reader.extractCardTitle(undefined)).toBeNull();
  });

  it("should return null for non-object values", () => {
    const reader = createTestReader();
    expect(reader.extractCardTitle("string")).toBeNull();
    expect(reader.extractCardTitle(42)).toBeNull();
  });

  it("should return null for empty body", () => {
    const reader = createTestReader();
    expect(reader.extractCardTitle({ body: [] })).toBeNull();
  });

  it("should find title with size: large", () => {
    const reader = createTestReader();
    const card = {
      body: [
        { type: "TextBlock", text: "Big Title", size: "large" },
        { type: "TextBlock", text: "Description" },
      ],
    };
    expect(reader.extractCardTitle(card)).toBe("Big Title");
  });

  it("should fallback to first TextBlock when no styled title found", () => {
    const reader = createTestReader();
    const card = {
      body: [
        { type: "TextBlock", text: "First block" },
        { type: "TextBlock", text: "Second block" },
      ],
    };
    expect(reader.extractCardTitle(card)).toBe("First block");
  });
});

describe("TeamsAdapter.fetchMessages Graph routing", () => {
  it.each([
    {
      name: "resolves an opaque DM conversation through stored Graph context",
      conversationId: "a:opaque-conversation-id",
      conversationType: "personal" as const,
      context: {
        type: "dm",
        graphChatId: "19:user-aad-id_bot-id@unq.gbl.spaces",
      },
      expectedChatId: "19:user-aad-id_bot-id@unq.gbl.spaces",
    },
    {
      name: "uses a group conversation ID without stored context",
      conversationId: "19:group-chat@thread.v2",
      conversationType: "groupChat" as const,
      context: undefined,
      expectedChatId: "19:group-chat@thread.v2",
    },
  ])("$name", async ({
    conversationId,
    conversationType,
    context,
    expectedChatId,
  }) => {
    const state = createMockState();
    if (context) {
      await state.set(
        `teams:channelContext:${conversationId}`,
        JSON.stringify(context)
      );
    }
    const adapter = createTeamsAdapter({
      appId: "bot-id",
      appPassword: "test",
      logger: new ConsoleLogger("error"),
    });
    const app = (adapter as unknown as { app: TeamsApp }).app;
    vi.spyOn(app, "initialize").mockResolvedValue(undefined);
    const call = vi.spyOn(app.graph, "call").mockResolvedValue({
      value: [
        { id: "message-1", body: { content: "Hello", contentType: "text" } },
      ],
    });
    await adapter.initialize(createMockChatInstance({ state }));

    const result = await adapter.fetchMessages(
      adapter.encodeThreadId({
        conversationId,
        conversationType,
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      })
    );

    expect(call).toHaveBeenCalledExactlyOnceWith(
      chats.messages.list,
      expect.objectContaining({ "chat-id": expectedChatId })
    );
    expect(result.messages).toMatchObject([{ id: "message-1", text: "Hello" }]);
  });
});

describe("listThreads", () => {
  it("preserves an explicit group-chat conversation type", async () => {
    const graph = {
      call: vi.fn(async () => ({
        value: [
          {
            id: "message-1",
            body: { content: "Hello", contentType: "text" },
          },
        ],
      })),
    };
    const reader = new TeamsGraphReader({
      botId: "test-app",
      graph: graph as unknown as GraphClient,
      formatConverter: new TeamsFormatConverter(),
      getGraphContext: async () => ({
        type: "dm",
        graphChatId: "19:stale-personal-chat@unq.gbl.spaces",
      }),
      logger: new ConsoleLogger("error"),
    });
    const channelId = encodeThreadId({
      conversationId: "a:group-chat-id",
      conversationType: "groupChat",
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    });

    const result = await reader.listThreads(channelId);
    const threadId = result.threads[0]?.id;

    expect(graph.call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ "chat-id": "a:group-chat-id" })
    );
    expect(threadId).toBeDefined();
    expect(decodeThreadId(threadId as string).conversationType).toBe(
      "groupChat"
    );
    expect(isDM(threadId as string)).toBe(false);
  });
});
