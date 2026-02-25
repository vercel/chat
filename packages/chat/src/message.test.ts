import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import { Message, type SerializedMessage } from "./message";

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
      });
      expect("data" in json.attachments[0]).toBe(false);
      expect("fetchData" in json.attachments[0]).toBe(false);
    });

    it("should include isMention flag", () => {
      const json = makeMessage({ isMention: true }).toJSON();
      expect(json.isMention).toBe(true);
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
});
