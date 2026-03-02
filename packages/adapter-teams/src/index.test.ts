import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createTeamsAdapter, TeamsAdapter } from "./index";

const TEAMS_PREFIX_PATTERN = /^teams:/;

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("ESM compatibility", () => {
  it(
    "all subpath imports resolve in Node.js ESM (no bare directory imports)",
    { timeout: 30_000 },
    () => {
      const source = readFileSync(
        resolve(import.meta.dirname, "index.ts"),
        "utf-8"
      );
      const pkgDir = resolve(import.meta.dirname, "..");

      // Extract non-relative, non-type-only import specifiers with subpaths
      const importRegex = /from\s+["']([^"'.][^"']*)["']/g;
      const specifiers = new Set<string>();
      for (const [, specifier] of source.matchAll(importRegex)) {
        specifiers.add(specifier);
      }

      for (const specifier of specifiers) {
        // Spawn a real Node.js ESM process — vitest uses esbuild which
        // tolerates bare directory imports, but Node.js ESM does not.
        const script = `await import(${JSON.stringify(specifier)})`;
        try {
          execSync(`node --input-type=module -e ${JSON.stringify(script)}`, {
            cwd: pkgDir,
            stdio: "pipe",
          });
        } catch (error: unknown) {
          const stderr =
            error instanceof Error && "stderr" in error
              ? String((error as { stderr: Buffer }).stderr)
              : "";
          throw new Error(
            `Import "${specifier}" fails in Node.js ESM.\n` +
              "Bare directory imports need an explicit /index.js suffix.\n" +
              stderr
          );
        }
      }
    }
  );
});

describe("TeamsAdapter", () => {
  it("should export createTeamsAdapter function", () => {
    expect(typeof createTeamsAdapter).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createTeamsAdapter({
      appId: "test-app-id",
      appPassword: "test-password",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(TeamsAdapter);
    expect(adapter.name).toBe("teams");
  });

  describe("thread ID encoding", () => {
    it("should encode and decode thread IDs", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      const original = {
        conversationId: "19:abc123@thread.tacv2",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };

      const encoded = adapter.encodeThreadId(original);
      expect(encoded).toMatch(TEAMS_PREFIX_PATTERN);

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.serviceUrl).toBe(original.serviceUrl);
    });

    it("should preserve messageid in thread context for channel threads", () => {
      const adapter = createTeamsAdapter({
        appId: "test",
        appPassword: "test",
        logger: mockLogger,
      });

      // Teams channel threads include ;messageid=XXX in the conversation ID
      // This is the thread context needed to reply in the correct thread
      const original = {
        conversationId:
          "19:d441d38c655c47a085215b2726e76927@thread.tacv2;messageid=1767297849909",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      };

      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);

      // The full conversation ID including messageid must be preserved
      expect(decoded.conversationId).toBe(original.conversationId);
      expect(decoded.conversationId).toContain(";messageid=");
    });
  });
});
