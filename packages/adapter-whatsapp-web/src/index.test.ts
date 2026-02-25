import { describe, expect, it } from "vitest";
import { WhatsAppFormatConverter } from "./markdown";

describe("WhatsAppFormatConverter", () => {
  const converter = new WhatsAppFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const result = converter.toAst("Hello world");
      expect(result.type).toBe("root");
      expect(result.children.length).toBeGreaterThan(0);
    });

    it("should convert WhatsApp bold (*text*) to markdown AST", () => {
      const result = converter.toAst("This is *bold* text");
      const text = converter.extractPlainText("This is *bold* text");
      expect(text).toContain("bold");
    });

    it("should convert WhatsApp strikethrough (~text~) to markdown AST", () => {
      const result = converter.toAst("This is ~strikethrough~ text");
      expect(result.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("should render plain text", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello");
      expect(result).toContain("world");
    });
  });

  describe("renderPostable", () => {
    it("should render string messages", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render raw messages", () => {
      const result = converter.renderPostable({ raw: "Hello *bold*" });
      expect(result).toBe("Hello *bold*");
    });

    it("should render markdown messages", () => {
      const result = converter.renderPostable({ markdown: "**bold** text" });
      expect(result).toContain("*bold*");
    });
  });
});

describe("WhatsAppAdapter", () => {
  describe("encodeThreadId / decodeThreadId", () => {
    it("should encode and decode thread IDs correctly", async () => {
      const { WhatsAppAdapter } = await import("./index");
      const { ConsoleLogger } = await import("chat");

      const adapter = new WhatsAppAdapter({
        logger: new ConsoleLogger("silent"),
      });

      const encoded = adapter.encodeThreadId({
        chatId: "1234567890@c.us",
      });
      expect(encoded).toBe("whatsapp:1234567890@c.us");

      const decoded = adapter.decodeThreadId("whatsapp:1234567890@c.us");
      expect(decoded.chatId).toBe("1234567890@c.us");
    });

    it("should handle group chat IDs", async () => {
      const { WhatsAppAdapter } = await import("./index");
      const { ConsoleLogger } = await import("chat");

      const adapter = new WhatsAppAdapter({
        logger: new ConsoleLogger("silent"),
      });

      const encoded = adapter.encodeThreadId({
        chatId: "1234567890-1234567890@g.us",
      });
      expect(encoded).toBe("whatsapp:1234567890-1234567890@g.us");
    });
  });

  describe("isDM", () => {
    it("should correctly identify DM chats", async () => {
      const { WhatsAppAdapter } = await import("./index");
      const { ConsoleLogger } = await import("chat");

      const adapter = new WhatsAppAdapter({
        logger: new ConsoleLogger("silent"),
      });

      expect(adapter.isDM("whatsapp:1234567890@c.us")).toBe(true);
      expect(adapter.isDM("whatsapp:1234567890-1234567890@g.us")).toBe(false);
    });
  });
});
