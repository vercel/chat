import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubAdapter } from "./index";
import type { GitHubThreadId } from "./types";

// Mock logger
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("GitHubAdapter", () => {
  let adapter: GitHubAdapter;

  beforeEach(() => {
    adapter = new GitHubAdapter({
      token: "test-token",
      webhookSecret: "test-secret",
      userName: "test-bot",
      logger: mockLogger,
    });
  });

  describe("encodeThreadId", () => {
    it("should encode PR-level thread ID", () => {
      const result = adapter.encodeThreadId({
        owner: "acme",
        repo: "app",
        prNumber: 123,
      });
      expect(result).toBe("github:acme/app:123");
    });

    it("should encode review comment thread ID", () => {
      const result = adapter.encodeThreadId({
        owner: "acme",
        repo: "app",
        prNumber: 123,
        reviewCommentId: 456789,
      });
      expect(result).toBe("github:acme/app:123:rc:456789");
    });

    it("should handle special characters in repo names", () => {
      const result = adapter.encodeThreadId({
        owner: "my-org",
        repo: "my-cool-app",
        prNumber: 42,
      });
      expect(result).toBe("github:my-org/my-cool-app:42");
    });
  });

  describe("decodeThreadId", () => {
    it("should decode PR-level thread ID", () => {
      const result = adapter.decodeThreadId("github:acme/app:123");
      expect(result).toEqual({
        owner: "acme",
        repo: "app",
        prNumber: 123,
      });
    });

    it("should decode review comment thread ID", () => {
      const result = adapter.decodeThreadId("github:acme/app:123:rc:456789");
      expect(result).toEqual({
        owner: "acme",
        repo: "app",
        prNumber: 123,
        reviewCommentId: 456789,
      });
    });

    it("should throw for invalid thread ID prefix", () => {
      expect(() => adapter.decodeThreadId("slack:C123:ts")).toThrow(
        "Invalid GitHub thread ID",
      );
    });

    it("should throw for malformed thread ID", () => {
      expect(() => adapter.decodeThreadId("github:invalid")).toThrow(
        "Invalid GitHub thread ID format",
      );
    });

    it("should handle repo names with hyphens", () => {
      const result = adapter.decodeThreadId("github:my-org/my-cool-app:42");
      expect(result).toEqual({
        owner: "my-org",
        repo: "my-cool-app",
        prNumber: 42,
      });
    });

    it("should roundtrip PR-level thread ID", () => {
      const original: GitHubThreadId = {
        owner: "vercel",
        repo: "next.js",
        prNumber: 99999,
      };
      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual(original);
    });

    it("should roundtrip review comment thread ID", () => {
      const original: GitHubThreadId = {
        owner: "vercel",
        repo: "next.js",
        prNumber: 99999,
        reviewCommentId: 123456789,
      };
      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe("renderFormatted", () => {
    it("should render simple markdown", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "Hello world" }],
          },
        ],
      };
      const result = adapter.renderFormatted(ast);
      expect(result).toBe("Hello world");
    });

    it("should render bold text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "strong" as const,
                children: [{ type: "text" as const, value: "bold" }],
              },
            ],
          },
        ],
      };
      const result = adapter.renderFormatted(ast);
      expect(result).toBe("**bold**");
    });
  });
});
