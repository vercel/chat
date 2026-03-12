import { describe, expect, it, vi } from "vitest";
import type { AiMessagePart } from "./ai";
import { toAiMessages } from "./ai";
import { createTestMessage } from "./mock-adapter";

describe("toAiMessages", () => {
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
            mimeType: "image/jpeg",
            name: "photo.jpg",
            fetchData: async () => Buffer.from("jpeg-data"),
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Look at this image" });
    expect(content[1]?.type).toBe("file");
  });

  it("includes text file attachments as file parts", async () => {
    const messages = [
      createTestMessage("1", "Here is a config", {
        attachments: [
          {
            type: "file",
            mimeType: "application/json",
            name: "config.json",
            fetchData: async () => Buffer.from('{"key": "value"}'),
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Here is a config" });
    expect(content[1]?.type).toBe("file");
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
            {
              type: "file",
              mimeType,
              fetchData: async () => Buffer.from("content"),
            },
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
            mimeType: "image/png",
            fetchData: async () => Buffer.from("png1"),
          },
          {
            type: "image",
            mimeType: "image/jpeg",
            fetchData: async () => Buffer.from("jpg2"),
          },
          {
            type: "file",
            mimeType: "text/plain",
            name: "log.txt",
            fetchData: async () => Buffer.from("log content"),
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(content).toHaveLength(4); // 1 text + 3 attachments
    expect(content[0]?.type).toBe("text");
    expect(content[1]?.type).toBe("file");
    expect(content[2]?.type).toBe("file");
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
    expect(content[1]?.type).toBe("file");
    const imgPart = content[1] as {
      type: "file";
      data: string;
      mediaType: string;
    };
    expect(imgPart.data).toBe(
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

  it("skips image when fetchData fails", async () => {
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

    // No image part — fetchData failed and we don't fall back to URL
    expect(result[0]?.content).toBe("Image here");
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
            mimeType: "image/png",
            fetchData: async () => Buffer.from("img"),
          },
        ],
      }),
    ];

    const result = await toAiMessages(messages);
    const content = result[0]?.content as AiMessagePart[];

    expect(Array.isArray(content)).toBe(true);
    const textPart = content[0] as { type: "text"; text: string };
    expect(textPart.text).toContain("Links:\nhttps://example.com");
    expect(content[1]?.type).toBe("file");
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

  // ===========================================================================
  // transformMessage tests
  // ===========================================================================

  it("transformMessage can modify text content", async () => {
    const messages = [createTestMessage("1", "Hello <@U123>")];

    const result = await toAiMessages(messages, {
      transformMessage: (aiMessage) => ({
        ...aiMessage,
        content: (aiMessage.content as string).replace("<@U123>", "@VercelBot"),
      }),
    });

    expect(result).toEqual([{ role: "user", content: "Hello @VercelBot" }]);
  });

  it("transformMessage returning null skips the message", async () => {
    const messages = [
      createTestMessage("1", "Keep this"),
      createTestMessage("2", "Skip this"),
      createTestMessage("3", "Keep this too"),
    ];

    const result = await toAiMessages(messages, {
      transformMessage: (aiMessage) =>
        (aiMessage.content as string).includes("Skip") ? null : aiMessage,
    });

    expect(result).toEqual([
      { role: "user", content: "Keep this" },
      { role: "user", content: "Keep this too" },
    ]);
  });

  it("transformMessage receives correct source Message", async () => {
    const messages = [
      createTestMessage("msg-1", "Hello", {
        author: {
          userId: "U1",
          userName: "alice",
          fullName: "Alice",
          isBot: false,
          isMe: false,
        },
      }),
    ];

    const transform = vi.fn((aiMessage: import("./ai").AiMessage) => aiMessage);

    await toAiMessages(messages, { transformMessage: transform });

    expect(transform).toHaveBeenCalledOnce();
    const call = transform.mock.calls[0];
    const [aiMsg, sourceMsg] = call ?? [];
    expect(aiMsg).toEqual({ role: "user", content: "Hello" });
    expect(sourceMsg?.id).toBe("msg-1");
    expect(sourceMsg?.author.userName).toBe("alice");
  });

  it("transformMessage works with async callbacks", async () => {
    const messages = [createTestMessage("1", "Original")];

    const result = await toAiMessages(messages, {
      transformMessage: async (aiMessage) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { ...aiMessage, content: "Transformed" };
      },
    });

    expect(result).toEqual([{ role: "user", content: "Transformed" }]);
  });

  it("transformMessage receives multipart content for messages with attachments", async () => {
    const messages = [
      createTestMessage("1", "Image here", {
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
            fetchData: async () => Buffer.from("png-data"),
          },
        ],
      }),
    ];

    const transform = vi.fn((aiMessage: import("./ai").AiMessage) => aiMessage);

    await toAiMessages(messages, { transformMessage: transform });

    expect(transform).toHaveBeenCalledOnce();
    const [aiMsg] = transform.mock.calls[0] ?? [];
    expect(aiMsg?.role).toBe("user");
    expect(Array.isArray(aiMsg.content)).toBe(true);
    expect((aiMsg.content as AiMessagePart[]).length).toBe(2);
  });
});
