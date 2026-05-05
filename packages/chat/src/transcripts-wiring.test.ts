import { beforeEach, describe, expect, it, vi } from "vitest";

import { Chat } from "./chat";
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
  mockLogger,
} from "./mock-adapter";
import type { Adapter, StateAdapter } from "./types";

const TRANSCRIPTS_NOT_CONFIGURED_RE = /chat\.transcripts is not configured/;
const IDENTITY_REQUIRED_RE = /requires ChatConfig\.identity/;

describe("Chat — Transcripts API wiring", () => {
  let mockAdapter: Adapter;
  let mockState: StateAdapter;

  beforeEach(() => {
    mockAdapter = createMockAdapter("slack");
    mockState = createMockState();
  });

  it("throws at construction when transcripts is set without identity", () => {
    expect(
      () =>
        new Chat({
          userName: "testbot",
          adapters: { slack: mockAdapter },
          state: mockState,
          logger: mockLogger,
          transcripts: {},
        })
    ).toThrow(IDENTITY_REQUIRED_RE);
  });

  it("does not throw when neither transcripts nor identity is set", () => {
    expect(
      () =>
        new Chat({
          userName: "testbot",
          adapters: { slack: mockAdapter },
          state: mockState,
          logger: mockLogger,
        })
    ).not.toThrow();
  });

  it("does not throw when identity is set without transcripts", () => {
    expect(
      () =>
        new Chat({
          userName: "testbot",
          adapters: { slack: mockAdapter },
          state: mockState,
          logger: mockLogger,
          identity: () => "u1",
        })
    ).not.toThrow();
  });

  it("chat.transcripts getter throws when transcripts was not configured", () => {
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
    });

    expect(() => chat.transcripts).toThrow(TRANSCRIPTS_NOT_CONFIGURED_RE);
  });

  it("chat.transcripts returns the API instance when configured", () => {
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
      identity: () => "u1",
      transcripts: {},
    });

    const api = chat.transcripts;
    expect(api).toBeDefined();
    expect(typeof api.append).toBe("function");
    expect(typeof api.list).toBe("function");
    expect(typeof api.count).toBe("function");
    expect(typeof api.delete).toBe("function");
  });

  describe("dispatch hook", () => {
    it("populates message.userKey from the resolver before handlers run", async () => {
      const identity = vi.fn().mockResolvedValue("user@example.com");
      const handler = vi.fn().mockResolvedValue(undefined);

      const chat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        identity,
        transcripts: {},
      });
      await chat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );
      chat.onSubscribedMessage(handler);
      await mockState.subscribe("slack:C123:1234.5678");

      const message = createTestMessage("msg-1", "hello");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(identity).toHaveBeenCalledTimes(1);
      expect(identity).toHaveBeenCalledWith(
        expect.objectContaining({
          adapter: "slack",
          author: message.author,
          message,
        })
      );
      expect(handler).toHaveBeenCalled();
      expect(message.userKey).toBe("user@example.com");
    });

    it("leaves userKey undefined when the resolver returns null", async () => {
      const identity = vi.fn().mockResolvedValue(null);
      const handler = vi.fn().mockResolvedValue(undefined);

      const chat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        identity,
        transcripts: {},
      });
      await chat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );
      chat.onSubscribedMessage(handler);
      await mockState.subscribe("slack:C123:1234.5678");

      const message = createTestMessage("msg-1", "hello");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
      expect(message.userKey).toBeUndefined();
    });

    it("logs and proceeds without userKey when the resolver throws", async () => {
      const identity = vi.fn().mockRejectedValue(new Error("lookup failed"));
      const handler = vi.fn().mockResolvedValue(undefined);
      const warn = vi.fn();
      const logger = { ...mockLogger, warn };

      const chat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger,
        identity,
        transcripts: {},
      });
      await chat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );
      chat.onSubscribedMessage(handler);
      await mockState.subscribe("slack:C123:1234.5678");

      const message = createTestMessage("msg-1", "hello");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Identity resolver threw"),
        expect.objectContaining({ error: expect.any(Error) })
      );
      expect(handler).toHaveBeenCalled();
      expect(message.userKey).toBeUndefined();
    });

    it("does not call the resolver when no identity is configured", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const chat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
      });
      await chat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );
      chat.onSubscribedMessage(handler);
      await mockState.subscribe("slack:C123:1234.5678");

      const message = createTestMessage("msg-1", "hello");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
      expect(message.userKey).toBeUndefined();
    });
  });
});
