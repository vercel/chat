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
});
