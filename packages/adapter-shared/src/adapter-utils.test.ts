/**
 * Tests for shared adapter utility functions.
 */

import type { AdapterPostableMessage, Attachment, FileUpload } from "chat";
import { Card, CardText } from "chat";
import { describe, expect, it } from "vitest";
import { extractAttachments, extractCard, extractFiles } from "./adapter-utils";

describe("extractCard", () => {
  describe("with CardElement", () => {
    it("extracts a CardElement passed directly", () => {
      const card = Card({
        title: "Test Card",
        children: [CardText("Content")],
      });
      const result = extractCard(card);
      expect(result).toBe(card);
    });

    it("extracts a card with all properties", () => {
      const card = Card({
        title: "Order #123",
        subtitle: "Processing",
        imageUrl: "https://example.com/img.png",
        children: [CardText("Details")],
      });
      const result = extractCard(card);
      expect(result).toEqual(card);
      expect(result?.title).toBe("Order #123");
      expect(result?.subtitle).toBe("Processing");
    });
  });

  describe("with PostableCard object", () => {
    it("extracts card from { card: CardElement }", () => {
      const card = Card({ title: "Nested Card" });
      const message: AdapterPostableMessage = { card };
      const result = extractCard(message);
      expect(result).toBe(card);
    });

    it("extracts card from PostableCard with fallbackText", () => {
      const card = Card({ title: "With Fallback" });
      const message: AdapterPostableMessage = {
        card,
        fallbackText: "Plain text version",
      };
      const result = extractCard(message);
      expect(result).toBe(card);
    });

    it("extracts card from PostableCard with files", () => {
      const card = Card({ title: "With Files" });
      const files: FileUpload[] = [
        { data: Buffer.from("test"), filename: "test.txt" },
      ];
      const message: AdapterPostableMessage = { card, files };
      const result = extractCard(message);
      expect(result).toBe(card);
    });
  });

  describe("with non-card messages", () => {
    it("returns null for plain string", () => {
      const result = extractCard("Hello world");
      expect(result).toBeNull();
    });

    it("returns null for PostableRaw", () => {
      const message: AdapterPostableMessage = { raw: "Raw text" };
      const result = extractCard(message);
      expect(result).toBeNull();
    });

    it("returns null for PostableMarkdown", () => {
      const message: AdapterPostableMessage = { markdown: "**Bold** text" };
      const result = extractCard(message);
      expect(result).toBeNull();
    });

    it("returns null for PostableAst", () => {
      const message: AdapterPostableMessage = {
        ast: { type: "root", children: [] },
      };
      const result = extractCard(message);
      expect(result).toBeNull();
    });

    it("returns null for null input", () => {
      // @ts-expect-error testing invalid input
      const result = extractCard(null);
      expect(result).toBeNull();
    });

    it("returns null for undefined input", () => {
      // @ts-expect-error testing invalid input
      const result = extractCard(undefined);
      expect(result).toBeNull();
    });

    it("returns null for object without card or type", () => {
      const message = {
        something: "else",
      } as unknown as AdapterPostableMessage;
      const result = extractCard(message);
      expect(result).toBeNull();
    });

    it("returns null for non-card type object", () => {
      const message = {
        type: "text",
        content: "not a card",
      } as unknown as AdapterPostableMessage;
      const result = extractCard(message);
      expect(result).toBeNull();
    });
  });
});

describe("extractFiles", () => {
  describe("with files present", () => {
    it("extracts files array from PostableRaw", () => {
      const files: FileUpload[] = [
        { data: Buffer.from("content1"), filename: "file1.txt" },
        { data: Buffer.from("content2"), filename: "file2.txt" },
      ];
      const message: AdapterPostableMessage = { raw: "Text", files };
      const result = extractFiles(message);
      expect(result).toBe(files);
      expect(result).toHaveLength(2);
    });

    it("extracts files array from PostableMarkdown", () => {
      const files: FileUpload[] = [
        {
          data: Buffer.from("image"),
          filename: "image.png",
          mimeType: "image/png",
        },
      ];
      const message: AdapterPostableMessage = { markdown: "**Text**", files };
      const result = extractFiles(message);
      expect(result).toEqual(files);
      expect(result[0].mimeType).toBe("image/png");
    });

    it("extracts files array from PostableCard", () => {
      const card = Card({ title: "Test" });
      const files: FileUpload[] = [
        { data: Buffer.from("doc"), filename: "doc.pdf" },
      ];
      const message: AdapterPostableMessage = { card, files };
      const result = extractFiles(message);
      expect(result).toBe(files);
    });

    it("handles Blob data in files", () => {
      const blob = new Blob(["content"], { type: "text/plain" });
      const files: FileUpload[] = [{ data: blob, filename: "blob.txt" }];
      const message: AdapterPostableMessage = { raw: "Text", files };
      const result = extractFiles(message);
      expect(result).toHaveLength(1);
      expect(result[0].data).toBe(blob);
    });

    it("handles ArrayBuffer data in files", () => {
      const buffer = new ArrayBuffer(8);
      const files: FileUpload[] = [{ data: buffer, filename: "binary.bin" }];
      const message: AdapterPostableMessage = { raw: "Text", files };
      const result = extractFiles(message);
      expect(result).toHaveLength(1);
      expect(result[0].data).toBe(buffer);
    });
  });

  describe("with empty or missing files", () => {
    it("returns empty array when files property is empty array", () => {
      const message: AdapterPostableMessage = { raw: "Text", files: [] };
      const result = extractFiles(message);
      expect(result).toEqual([]);
    });

    it("returns empty array when files property is undefined", () => {
      const message = {
        raw: "Text",
        files: undefined,
      } as AdapterPostableMessage;
      const result = extractFiles(message);
      expect(result).toEqual([]);
    });

    it("returns empty array for PostableRaw without files", () => {
      const message: AdapterPostableMessage = { raw: "Just text" };
      const result = extractFiles(message);
      expect(result).toEqual([]);
    });

    it("returns empty array for PostableMarkdown without files", () => {
      const message: AdapterPostableMessage = { markdown: "**Bold**" };
      const result = extractFiles(message);
      expect(result).toEqual([]);
    });
  });

  describe("with non-object messages", () => {
    it("returns empty array for plain string", () => {
      const result = extractFiles("Hello world");
      expect(result).toEqual([]);
    });

    it("returns empty array for CardElement (no files property)", () => {
      const card = Card({ title: "Test" });
      const result = extractFiles(card);
      expect(result).toEqual([]);
    });

    it("returns empty array for null input", () => {
      // @ts-expect-error testing invalid input
      const result = extractFiles(null);
      expect(result).toEqual([]);
    });

    it("returns empty array for undefined input", () => {
      // @ts-expect-error testing invalid input
      const result = extractFiles(undefined);
      expect(result).toEqual([]);
    });
  });
});

describe("extractAttachments", () => {
  describe("with attachments present", () => {
    it("extracts attachments array from PostableRaw", () => {
      const attachments: Attachment[] = [
        { data: Buffer.from("content1"), name: "file1.txt", type: "file" },
        { data: Buffer.from("content2"), name: "file2.txt", type: "file" },
      ];
      const message: AdapterPostableMessage = { raw: "Text", attachments };
      const result = extractAttachments(message);
      expect(result).toBe(attachments);
      expect(result).toHaveLength(2);
    });

    it("extracts attachments array from PostableMarkdown", () => {
      const attachments: Attachment[] = [
        {
          data: Buffer.from("image"),
          name: "image.png",
          mimeType: "image/png",
          type: "image",
        },
      ];
      const message: AdapterPostableMessage = {
        markdown: "**Text**",
        attachments,
      };
      const result = extractAttachments(message);
      expect(result).toEqual(attachments);
      expect(result[0].mimeType).toBe("image/png");
    });

    it("extracts attachments array from PostableCard", () => {
      const card = Card({ title: "Test" });
      const attachments: Attachment[] = [
        { data: Buffer.from("doc"), name: "doc.pdf", type: "file" },
      ];
      const message: AdapterPostableMessage = { card, attachments };
      const result = extractAttachments(message);
      expect(result).toBe(attachments);
    });

    it("handles Blob data in attachments", () => {
      const blob = new Blob(["content"], { type: "text/plain" });
      const attachments: Attachment[] = [
        { data: blob, name: "blob.txt", type: "file" },
      ];
      const message: AdapterPostableMessage = { raw: "Text", attachments };
      const result = extractAttachments(message);
      expect(result).toHaveLength(1);
      expect(result[0].data).toBe(blob);
    });

    it("handles ArrayBuffer data in attachments", () => {
      const buffer = new ArrayBuffer(8);
      const attachments: Attachment[] = [
        { data: buffer, name: "binary.bin", type: "file" },
      ];
      const message: AdapterPostableMessage = { raw: "Text", attachments };
      const result = extractAttachments(message);
      expect(result).toHaveLength(1);
      expect(result[0].data).toBe(buffer);
    });
  });

  describe("with empty or missing attachments", () => {
    it("returns empty array when attachments property is empty array", () => {
      const message: AdapterPostableMessage = { raw: "Text", attachments: [] };
      const result = extractAttachments(message);
      expect(result).toEqual([]);
    });

    it("returns empty array when attachments property is undefined", () => {
      const message = {
        raw: "Text",
        attachments: undefined,
      } as AdapterPostableMessage;
      const result = extractAttachments(message);
      expect(result).toEqual([]);
    });

    it("returns empty array for PostableRaw without attachments", () => {
      const message: AdapterPostableMessage = { raw: "Just text" };
      const result = extractAttachments(message);
      expect(result).toEqual([]);
    });

    it("returns empty array for PostableMarkdown without attachments", () => {
      const message: AdapterPostableMessage = { markdown: "**Bold**" };
      const result = extractAttachments(message);
      expect(result).toEqual([]);
    });
  });

  describe("with non-object messages", () => {
    it("returns empty array for plain string", () => {
      const result = extractAttachments("Hello world");
      expect(result).toEqual([]);
    });

    it("returns empty array for CardElement (no attachments property)", () => {
      const card = Card({ title: "Test" });
      const result = extractAttachments(card);
      expect(result).toEqual([]);
    });

    it("returns empty array for null input", () => {
      // @ts-expect-error testing invalid input
      const result = extractAttachments(null);
      expect(result).toEqual([]);
    });

    it("returns empty array for undefined input", () => {
      // @ts-expect-error testing invalid input
      const result = extractAttachments(undefined);
      expect(result).toEqual([]);
    });
  });
});
