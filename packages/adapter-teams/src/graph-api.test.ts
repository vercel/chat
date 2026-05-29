import { Client as GraphClient } from "@microsoft/teams.graph";
import { ConsoleLogger } from "chat";
import { describe, expect, it } from "vitest";
import { TeamsGraphReader } from "./graph-api";
import { TeamsFormatConverter } from "./markdown";

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
              { type: "TextBlock", text: "My Card Title", weight: "bolder" },
              { type: "TextBlock", text: "Some description" },
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

  it("should find title with weight: bolder", () => {
    const reader = createTestReader();
    const card = {
      body: [
        { type: "TextBlock", text: "Title", weight: "bolder" },
        { type: "TextBlock", text: "Description" },
      ],
    };
    expect(reader.extractCardTitle(card)).toBe("Title");
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

describe("chatIdFromContext", () => {
  it("should use graphChatId from DM context", () => {
    const reader = createTestReader();
    // biome-ignore lint/complexity/useLiteralKeys: testing private method
    const result = (reader as never)["chatIdFromContext"](
      { type: "dm", graphChatId: "19:user-aad-id_bot-id@unq.gbl.spaces" },
      "a:opaque-conversation-id"
    );
    expect(result).toBe("19:user-aad-id_bot-id@unq.gbl.spaces");
  });

  it("should use raw conversation ID when no context", () => {
    const reader = createTestReader();
    // biome-ignore lint/complexity/useLiteralKeys: testing private method
    const result = (reader as never)["chatIdFromContext"](
      null,
      "19:group-chat@thread.v2"
    );
    expect(result).toBe("19:group-chat@thread.v2");
  });

  it("should use raw conversation ID for channel context", () => {
    const reader = createTestReader();
    // biome-ignore lint/complexity/useLiteralKeys: testing private method
    const result = (reader as never)["chatIdFromContext"](
      { teamId: "team-id", channelId: "channel-id" },
      "19:channel@thread.tacv2"
    );
    expect(result).toBe("19:channel@thread.tacv2");
  });
});
