import { describe, expect, it } from "vitest";
import { toAiMessages } from "./ai";
import { createTestMessage } from "./mock-adapter";

describe("toAiMessages", () => {
  it("maps isMe to assistant and others to user", () => {
    const messages = [
      createTestMessage("1", "Hello bot"),
      createTestMessage("2", "Hi there!", {
        author: {
          userId: "bot",
          userName: "bot",
          fullName: "Bot",
          isBot: true,
          isMe: true,
        },
      }),
      createTestMessage("3", "Follow up question"),
    ];

    const result = toAiMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "Hello bot" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "Follow up question" },
    ]);
  });

  it("filters out empty and whitespace-only text", () => {
    const messages = [
      createTestMessage("1", "Hello"),
      createTestMessage("2", ""),
      createTestMessage("3", "   "),
      createTestMessage("4", "\t\n"),
      createTestMessage("5", "World"),
    ];

    const result = toAiMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "Hello" },
      { role: "user", content: "World" },
    ]);
  });

  it("preserves chronological order", () => {
    const messages = [
      createTestMessage("1", "First"),
      createTestMessage("2", "Second", {
        author: {
          userId: "bot",
          userName: "bot",
          fullName: "Bot",
          isBot: true,
          isMe: true,
        },
      }),
      createTestMessage("3", "Third"),
    ];

    const result = toAiMessages(messages);

    expect(result.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
  });

  it("prefixes user messages with username when includeNames is true", () => {
    const messages = [
      createTestMessage("1", "Hello", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      }),
      createTestMessage("2", "Hi!", {
        author: {
          userId: "bot",
          userName: "bot",
          fullName: "Bot",
          isBot: true,
          isMe: true,
        },
      }),
      createTestMessage("3", "Thanks", {
        author: {
          userId: "U2",
          userName: "bob",
          fullName: "Bob",
          isBot: false,
          isMe: false,
        },
      }),
    ];

    const result = toAiMessages(messages, { includeNames: true });

    expect(result).toEqual([
      { role: "user", content: "[alice]: Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "[bob]: Thanks" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(toAiMessages([])).toEqual([]);
  });

  it("returns empty array when all messages have empty text", () => {
    const messages = [
      createTestMessage("1", ""),
      createTestMessage("2", "   "),
    ];

    expect(toAiMessages(messages)).toEqual([]);
  });

  it("appends link preview metadata to content", () => {
    const messages = [
      createTestMessage("1", "Check this out", {
        links: [
          {
            url: "https://vercel.com/blog/post",
            title: "New Feature",
            description: "A cool new feature",
            siteName: "Vercel",
          },
        ],
      }),
    ];

    const result = toAiMessages(messages);

    expect(result).toEqual([
      {
        role: "user",
        content:
          "Check this out\n\nLinks:\nhttps://vercel.com/blog/post\nTitle: New Feature\nDescription: A cool new feature\nSite: Vercel",
      },
    ]);
  });

  it("appends multiple links", () => {
    const messages = [
      createTestMessage("1", "See these links", {
        links: [
          { url: "https://example.com" },
          { url: "https://vercel.com", title: "Vercel" },
        ],
      }),
    ];

    const result = toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "See these links\n\nLinks:\nhttps://example.com\n\nhttps://vercel.com\nTitle: Vercel"
    );
  });

  it("labels links with fetchMessage as embedded messages", () => {
    const messages = [
      createTestMessage("1", "Look at this thread", {
        links: [
          {
            url: "https://team.slack.com/archives/C123/p1234567890123456",
            fetchMessage: async () => createTestMessage("linked", "linked"),
          },
        ],
      }),
    ];

    const result = toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "Look at this thread\n\nLinks:\n[Embedded message: https://team.slack.com/archives/C123/p1234567890123456]"
    );
  });

  it("includes metadata on embedded message links", () => {
    const messages = [
      createTestMessage("1", "Look at this", {
        links: [
          {
            url: "https://team.slack.com/archives/C123/p1234567890123456",
            title: "Original message preview",
            fetchMessage: async () => createTestMessage("linked", "linked"),
          },
        ],
      }),
    ];

    const result = toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "Look at this\n\nLinks:\n[Embedded message: https://team.slack.com/archives/C123/p1234567890123456]\nTitle: Original message preview"
    );
  });

  it("mixes embedded messages and regular links", () => {
    const messages = [
      createTestMessage("1", "Check these", {
        links: [
          {
            url: "https://team.slack.com/archives/C123/p1234567890123456",
            fetchMessage: async () => createTestMessage("linked", "linked"),
          },
          {
            url: "https://vercel.com",
            title: "Vercel",
            siteName: "Vercel",
          },
        ],
      }),
    ];

    const result = toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "Check these\n\nLinks:\n[Embedded message: https://team.slack.com/archives/C123/p1234567890123456]\n\nhttps://vercel.com\nTitle: Vercel\nSite: Vercel"
    );
  });

  it("does not append links section when links array is empty", () => {
    const messages = [createTestMessage("1", "No links here")];

    const result = toAiMessages(messages);

    expect(result[0]?.content).toBe("No links here");
  });
});
