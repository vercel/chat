import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "./markdown";
import { Message, type SerializedMessage, setMessageAdapter } from "./message";
import type { Adapter, MessageSubject } from "./types";

function makeMessage(overrides?: Record<string, unknown>) {
  return new Message({
    id: "msg-1",
    threadId: "slack:C123:1234.5678",
    text: "Hello world",
    formatted: parseMarkdown("Hello world"),
    raw: { platform: "test" },
    author: {
      userId: "U123",
      userName: "testuser",
      fullName: "Test User",
      isBot: false,
      isMe: false,
    },
    metadata: {
      dateSent: new Date("2024-01-15T10:30:00.000Z"),
      edited: false,
    },
    attachments: [],
    ...overrides,
  });
}

describe("Message", () => {
  describe("constructor", () => {
    it("should assign all properties", () => {
      const msg = makeMessage();
      expect(msg.id).toBe("msg-1");
      expect(msg.threadId).toBe("slack:C123:1234.5678");
      expect(msg.text).toBe("Hello world");
      expect(msg.author.userName).toBe("testuser");
      expect(msg.metadata.dateSent).toBeInstanceOf(Date);
      expect(msg.attachments).toEqual([]);
      expect(msg.isMention).toBeUndefined();
    });

    it("should assign isMention when provided", () => {
      const msg = makeMessage({ isMention: true });
      expect(msg.isMention).toBe(true);
    });
  });

  describe("toJSON()", () => {
    it("should produce correct type tag", () => {
      const json = makeMessage().toJSON();
      expect(json._type).toBe("chat:Message");
    });

    it("should serialize dates as ISO strings", () => {
      const msg = makeMessage({
        metadata: {
          dateSent: new Date("2024-06-01T12:00:00.000Z"),
          edited: true,
          editedAt: new Date("2024-06-01T13:00:00.000Z"),
        },
      });
      const json = msg.toJSON();
      expect(json.metadata.dateSent).toBe("2024-06-01T12:00:00.000Z");
      expect(json.metadata.editedAt).toBe("2024-06-01T13:00:00.000Z");
    });

    it("should strip data and fetchData from attachments", () => {
      const msg = makeMessage({
        attachments: [
          {
            type: "image" as const,
            url: "https://example.com/img.png",
            name: "img.png",
            data: Buffer.from("binary"),
            fetchData: () => Promise.resolve(Buffer.from("binary")),
          },
        ],
      });
      const json = msg.toJSON();
      expect(json.attachments[0]).toEqual({
        type: "image",
        url: "https://example.com/img.png",
        name: "img.png",
        mimeType: undefined,
        size: undefined,
        width: undefined,
        height: undefined,
        fetchMetadata: undefined,
      });
      expect("data" in json.attachments[0]).toBe(false);
      expect("fetchData" in json.attachments[0]).toBe(false);
    });

    it("should preserve fetchMetadata in attachments", () => {
      const msg = makeMessage({
        attachments: [
          {
            type: "image" as const,
            url: "https://example.com/img.png",
            fetchMetadata: {
              mediaId: "123",
              url: "https://example.com/img.png",
            },
            fetchData: () => Promise.resolve(Buffer.from("binary")),
          },
        ],
      });
      const json = msg.toJSON();
      expect(json.attachments[0].fetchMetadata).toEqual({
        mediaId: "123",
        url: "https://example.com/img.png",
      });
      const restored = Message.fromJSON(json);
      expect(restored.attachments[0].fetchMetadata).toEqual({
        mediaId: "123",
        url: "https://example.com/img.png",
      });
    });

    it("should preserve fetchMetadata through full JSON.stringify/parse roundtrip", () => {
      const msg = makeMessage({
        attachments: [
          {
            type: "image" as const,
            url: "https://example.com/img.png",
            fetchMetadata: {
              mediaId: "123",
              url: "https://example.com/img.png",
            },
            fetchData: () => Promise.resolve(Buffer.from("binary")),
          },
        ],
      });
      const roundtripped = JSON.parse(JSON.stringify(msg.toJSON()));
      const restored = Message.fromJSON(roundtripped);
      expect(restored.attachments[0].fetchMetadata).toEqual({
        mediaId: "123",
        url: "https://example.com/img.png",
      });
      expect(restored.attachments[0].fetchData).toBeUndefined();
    });

    it("should include isMention flag", () => {
      const json = makeMessage({ isMention: true }).toJSON();
      expect(json.isMention).toBe(true);
    });

    it("should preserve author.isSystem through a full JSON roundtrip", () => {
      const msg = makeMessage({
        author: {
          userId: "USLACK",
          userName: "Slack",
          fullName: "Slack",
          isBot: false,
          isMe: false,
          isSystem: true,
        },
      });
      const roundtripped = JSON.parse(JSON.stringify(msg.toJSON()));
      const restored = Message.fromJSON(roundtripped);
      expect(restored.author.isSystem).toBe(true);
    });

    it("should leave author.isSystem absent for non-system authors", () => {
      const json = makeMessage().toJSON();
      expect(json.author.isSystem).toBeUndefined();
    });

    it("should preserve author email through serialization", () => {
      const original = makeMessage({
        author: {
          userId: "U123",
          userName: "testuser",
          fullName: "Test User",
          email: "test@example.com",
          isBot: false,
          isMe: false,
        },
      });

      const json = original.toJSON();
      expect(json.author.email).toBe("test@example.com");
      expect(Message.fromJSON(json).author.email).toBe("test@example.com");
    });
  });

  describe("fromJSON()", () => {
    it("should convert ISO strings back to Dates", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-2",
        threadId: "teams:ch:th",
        text: "hi",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U1",
          userName: "u",
          fullName: "U",
          isBot: false,
          isMe: false,
        },
        metadata: {
          dateSent: "2024-03-01T00:00:00.000Z",
          edited: true,
          editedAt: "2024-03-01T01:00:00.000Z",
        },
        attachments: [],
      };
      const msg = Message.fromJSON(json);
      expect(msg.metadata.dateSent).toBeInstanceOf(Date);
      expect(msg.metadata.editedAt).toBeInstanceOf(Date);
    });

    it("should handle missing editedAt", () => {
      const json: SerializedMessage = {
        _type: "chat:Message",
        id: "msg-3",
        threadId: "t",
        text: "t",
        formatted: { type: "root", children: [] },
        raw: {},
        author: {
          userId: "U",
          userName: "u",
          fullName: "U",
          isBot: false,
          isMe: false,
        },
        metadata: { dateSent: "2024-01-01T00:00:00.000Z", edited: false },
        attachments: [],
      };
      const msg = Message.fromJSON(json);
      expect(msg.metadata.editedAt).toBeUndefined();
    });
  });

  describe("toJSON/fromJSON round-trip", () => {
    it("should preserve all fields", () => {
      const original = makeMessage({
        isMention: true,
        metadata: {
          dateSent: new Date("2024-01-15T10:30:00.000Z"),
          edited: true,
          editedAt: new Date("2024-01-15T11:00:00.000Z"),
        },
        attachments: [
          {
            type: "file" as const,
            url: "https://example.com/f.pdf",
            name: "f.pdf",
          },
        ],
      });

      const restored = Message.fromJSON(original.toJSON());
      expect(restored.id).toBe(original.id);
      expect(restored.text).toBe(original.text);
      expect(restored.isMention).toBe(original.isMention);
      expect(restored.metadata.dateSent.getTime()).toBe(
        original.metadata.dateSent.getTime()
      );
    });
  });

  describe("WORKFLOW_SERIALIZE / WORKFLOW_DESERIALIZE", () => {
    it("should serialize via static method", () => {
      const msg = makeMessage();
      const serialized = Message[WORKFLOW_SERIALIZE](msg);
      expect(serialized._type).toBe("chat:Message");
      expect(serialized.id).toBe("msg-1");
    });

    it("should deserialize via static method", () => {
      const msg = makeMessage();
      const serialized = Message[WORKFLOW_SERIALIZE](msg);
      const restored = Message[WORKFLOW_DESERIALIZE](serialized);
      expect(restored.id).toBe(msg.id);
      expect(restored.metadata.dateSent).toBeInstanceOf(Date);
    });
  });

  describe("subject", () => {
    it("should return null when no adapter is set", async () => {
      const msg = makeMessage();
      expect(await msg.subject).toBeNull();
    });

    it("should return null when adapter has no fetchSubject", async () => {
      const msg = makeMessage();
      setMessageAdapter(msg, {} as Adapter);
      expect(await msg.subject).toBeNull();
    });

    it("should return subject from adapter", async () => {
      const msg = makeMessage();
      const expected: MessageSubject = {
        type: "issue",
        id: "ENG-123",
        title: "Fix bug",
        status: "In Progress",
        url: "https://linear.app/team/ENG-123",
        raw: {},
      };
      setMessageAdapter(msg, {
        fetchSubject: vi.fn().mockResolvedValue(expected),
      } as unknown as Adapter);

      const result = await msg.subject;
      expect(result).toEqual(expected);
    });

    it("should cache the result", async () => {
      const msg = makeMessage();
      const fetchSubject = vi.fn().mockResolvedValue({
        type: "issue",
        id: "1",
        raw: {},
      });
      setMessageAdapter(msg, { fetchSubject } as unknown as Adapter);

      await msg.subject;
      await msg.subject;
      expect(fetchSubject).toHaveBeenCalledTimes(1);
    });

    it("should cache null result", async () => {
      const msg = makeMessage();
      const fetchSubject = vi.fn().mockResolvedValue(null);
      setMessageAdapter(msg, { fetchSubject } as unknown as Adapter);

      await msg.subject;
      await msg.subject;
      expect(fetchSubject).toHaveBeenCalledTimes(1);
    });

    it("should handle concurrent access", async () => {
      const msg = makeMessage();
      const fetchSubject = vi.fn().mockResolvedValue({
        type: "issue",
        id: "1",
        raw: {},
      });
      setMessageAdapter(msg, { fetchSubject } as unknown as Adapter);

      const [a, b] = await Promise.all([msg.subject, msg.subject]);
      expect(a).toEqual(b);
      expect(fetchSubject).toHaveBeenCalledTimes(1);
    });
  });
});
