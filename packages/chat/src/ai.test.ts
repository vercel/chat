import { describe, expect, it, vi } from "vitest";
import type { AiMessagePart } from "./ai";
import { toAiMessages } from "./ai";
import { createTestMessage } from "./mock-adapter";

describe("toAiMessages", async () => {
  it("maps isMe to assistant and others to user", async () => {
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

    const result = await toAiMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "Hello bot" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "Follow up question" },
    ]);
  });

  it("filters out empty and whitespace-only text", async () => {
    const messages = [
      createTestMessage("1", "Hello"),
      createTestMessage("2", ""),
      createTestMessage("3", "   "),
      createTestMessage("4", "\t\n"),
      createTestMessage("5", "World"),
    ];

    const result = await toAiMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "Hello" },
      { role: "user", content: "World" },
    ]);
  });

  it("preserves chronological order", async () => {
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

    const result = await toAiMessages(messages);

    expect(result.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
  });

  it("prefixes user messages with username when includeNames is true", async () => {
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

    const result = await toAiMessages(messages, { includeNames: true });

    expect(result).toEqual([
      { role: "user", content: "[alice]: Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "[bob]: Thanks" },
    ]);
  });

  it("returns empty array for empty input", async () => {
    expect(await toAiMessages([])).toEqual([]);
  });

  it("returns empty array when all messages have empty text", async () => {
    const messages = [
      createTestMessage("1", ""),
      createTestMessage("2", "   "),
    ];

    expect(await toAiMessages(messages)).toEqual([]);
  });

  // ===========================================================================
  // Link preview tests
  // ===========================================================================

  it("appends link preview metadata to content", async () => {
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

    const result = await toAiMessages(messages);

    expect(result).toEqual([
      {
        role: "user",
        content:
          "Check this out\n\nLinks:\nhttps://vercel.com/blog/post\nTitle: New Feature\nDescription: A cool new feature\nSite: Vercel",
      },
    ]);
  });

  it("appends multiple links", async () => {
    const messages = [
      createTestMessage("1", "See these links", {
        links: [
          { url: "https://example.com" },
          { url: "https://vercel.com", title: "Vercel" },
        ],
      }),
    ];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "See these links\n\nLinks:\nhttps://example.com\n\nhttps://vercel.com\nTitle: Vercel"
    );
  });

  it("labels links with fetchMessage as embedded messages", async () => {
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

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "Look at this thread\n\nLinks:\n[Embedded message: https://team.slack.com/archives/C123/p1234567890123456]"
    );
  });

  it("includes metadata on embedded message links", async () => {
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

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "Look at this\n\nLinks:\n[Embedded message: https://team.slack.com/archives/C123/p1234567890123456]\nTitle: Original message preview"
    );
  });

  it("mixes embedded messages and regular links", async () => {
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

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe(
      "Check these\n\nLinks:\n[Embedded message: https://team.slack.com/archives/C123/p1234567890123456]\n\nhttps://vercel.com\nTitle: Vercel\nSite: Vercel"
    );
  });

  it("does not append links section when links array is empty", async () => {
    const messages = [createTestMessage("1", "No links here")];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe("No links here");
  });

  // ===========================================================================
  // Attachment tests
  // ===========================================================================

  it("includes image attachments as image parts", async () => {
    const messages = [
      createTestMessage("1", "Look at this image", {
        attachments: [
          {
            type: "image",
            url: "https://example.com/photo.jpg",
            mimeType: "image/jpeg",
            name: "photo.jpg",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Look at this image" });
    expect(content[1]).toEqual({
      type: "image",
      image: new URL("https://example.com/photo.jpg"),
      mediaType: "image/jpeg",
    });
  });

  it("includes text file attachments as file parts", async () => {
    const messages = [
      createTestMessage("1", "Here is a config", {
        attachments: [
          {
            type: "file",
            url: "https://example.com/config.json",
            mimeType: "application/json",
            name: "config.json",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Here is a config" });
    expect(content[1]).toEqual({
      type: "file",
      data: new URL("https://example.com/config.json"),
      filename: "config.json",
      mediaType: "application/json",
    });
  });

  it("supports various text MIME types", async () => {
    const mimeTypes = [
      "text/plain",
      "text/csv",
      "text/html",
      "application/json",
      "application/xml",
      "application/javascript",
      "application/yaml",
    ];

    for (const mimeType of mimeTypes) {
      const messages = [
        createTestMessage("1", "file", {
          attachments: [
            { type: "file", url: "https://example.com/f", mimeType },
          ],
        }),
      ];

      const result = await toAiMessages(messages);
      const content = result[0]?.content as AiMessagePart[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[1]?.type).toBe("file");
    }
  });

  it("includes multiple attachments as parts", async () => {
    const messages = [
      createTestMessage("1", "Multiple files", {
        attachments: [
          {
            type: "image",
            url: "https://example.com/a.png",
            mimeType: "image/png",
          },
          {
            type: "image",
            url: "https://example.com/b.jpg",
            mimeType: "image/jpeg",
          },
          {
            type: "file",
            url: "https://example.com/log.txt",
            mimeType: "text/plain",
            name: "log.txt",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(content).toHaveLength(4); // 1 text + 3 attachments
    expect(content[0]?.type).toBe("text");
    expect(content[1]?.type).toBe("image");
    expect(content[2]?.type).toBe("image");
    expect(content[3]?.type).toBe("file");
  });

  it("warns on video attachments", async () => {
    const onUnsupported = vi.fn();
    const messages = [
      createTestMessage("1", "Watch this", {
        attachments: [
          {
            type: "video",
            url: "https://example.com/video.mp4",
            mimeType: "video/mp4",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages, {
      onUnsupportedAttachment: onUnsupported,
    });

    expect(result[0]?.content).toBe("Watch this"); // string, no parts
    expect(onUnsupported).toHaveBeenCalledOnce();
    expect(onUnsupported.mock.calls[0]?.[0].type).toBe("video");
  });

  it("warns on audio attachments", async () => {
    const onUnsupported = vi.fn();
    const messages = [
      createTestMessage("1", "Listen to this", {
        attachments: [
          {
            type: "audio",
            url: "https://example.com/audio.mp3",
            mimeType: "audio/mpeg",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages, {
      onUnsupportedAttachment: onUnsupported,
    });

    expect(result[0]?.content).toBe("Listen to this");
    expect(onUnsupported).toHaveBeenCalledOnce();
    expect(onUnsupported.mock.calls[0]?.[0].type).toBe("audio");
  });

  it("skips non-text file attachments silently", async () => {
    const onUnsupported = vi.fn();
    const messages = [
      createTestMessage("1", "Here is a PDF", {
        attachments: [
          {
            type: "file",
            url: "https://example.com/doc.pdf",
            mimeType: "application/pdf",
            name: "doc.pdf",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages, {
      onUnsupportedAttachment: onUnsupported,
    });

    // PDF is not a text type, but it's a "file" not "video"/"audio" — silently skipped
    expect(result[0]?.content).toBe("Here is a PDF");
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it("uses fetchData to inline image as base64", async () => {
    const messages = [
      createTestMessage("1", "Private image", {
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
            fetchData: async () => Buffer.from("fake-png-data"),
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    expect(content[1]?.type).toBe("image");
    const imgPart = content[1] as {
      type: "image";
      image: string;
      mediaType: string;
    };
    expect(imgPart.image).toBe(
      `data:image/png;base64,${Buffer.from("fake-png-data").toString("base64")}`
    );
    expect(imgPart.mediaType).toBe("image/png");
  });

  it("uses fetchData to inline text file as base64", async () => {
    const messages = [
      createTestMessage("1", "Here is a log", {
        attachments: [
          {
            type: "file",
            mimeType: "text/plain",
            name: "server.log",
            fetchData: async () => Buffer.from("error at line 42"),
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    expect(content[1]?.type).toBe("file");
    const filePart = content[1] as {
      type: "file";
      data: string;
      filename: string;
      mediaType: string;
    };
    expect(filePart.data).toBe(
      `data:text/plain;base64,${Buffer.from("error at line 42").toString("base64")}`
    );
    expect(filePart.filename).toBe("server.log");
  });

  it("falls back to URL when fetchData fails", async () => {
    const messages = [
      createTestMessage("1", "Image here", {
        attachments: [
          {
            type: "image",
            url: "https://example.com/img.png",
            mimeType: "image/png",
            fetchData: async () => {
              throw new Error("network error");
            },
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(content[1]).toEqual({
      type: "image",
      image: new URL("https://example.com/img.png"),
      mediaType: "image/png",
    });
  });

  it("skips attachments without URL or fetchData", async () => {
    const messages = [
      createTestMessage("1", "Uploaded something", {
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe("Uploaded something"); // string, no parts
  });

  it("keeps string content when no supported attachments", async () => {
    const messages = [
      createTestMessage("1", "Just text", {
        attachments: [],
      }),
    ];

    const result = await toAiMessages(messages);

    expect(typeof result[0]?.content).toBe("string");
  });

  it("includes links in text part when attachments are present", async () => {
    const messages = [
      createTestMessage("1", "Image with link", {
        links: [{ url: "https://example.com", title: "Example" }],
        attachments: [
          {
            type: "image",
            url: "https://example.com/img.png",
            mimeType: "image/png",
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    const textPart = content[0] as { type: "text"; text: string };
    expect(textPart.text).toContain("Links:\nhttps://example.com");
    expect(content[1]?.type).toBe("image");
  });

  // ===========================================================================
  // Mention rendering tests
  // ===========================================================================

  it("renders @mentions with display names in message text", async () => {
    // After Slack's toAst: <@U456|john> → @john in plain text
    const messages = [
      createTestMessage("1", "Hey @john, can you review this?"),
    ];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe("Hey @john, can you review this?");
    expect(result[0]?.content).not.toContain("<@");
  });

  it("renders mentions with user IDs when display name unavailable", async () => {
    // Sync parsing path: <@U456> → @U456 in plain text
    const messages = [createTestMessage("1", "Hey @U456, check this")];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe("Hey @U456, check this");
    expect(result[0]?.content).not.toContain("<@");
  });

  it("renders multiple mentions correctly", async () => {
    const messages = [
      createTestMessage("1", "@alice and @bob please look at this"),
    ];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toBe("@alice and @bob please look at this");
  });

  it("renders mentions in messages with links", async () => {
    const messages = [
      createTestMessage("1", "@alice shared a link", {
        links: [{ url: "https://example.com" }],
      }),
    ];

    const result = await toAiMessages(messages);

    expect(result[0]?.content).toContain("@alice shared a link");
    expect(result[0]?.content).toContain("https://example.com");
    expect(result[0]?.content).not.toContain("<@");
  });

  it("renders mentions with includeNames enabled", async () => {
    const messages = [
      createTestMessage("1", "Hey @bob, thoughts?", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      }),
    ];

    const result = await toAiMessages(messages, { includeNames: true });

    expect(result[0]?.content).toBe("[alice]: Hey @bob, thoughts?");
  });
});
