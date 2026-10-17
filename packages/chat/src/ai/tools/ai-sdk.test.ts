import type { Tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "../../chat";
import { runInConversation } from "../../context";
import {
  createMockAdapter,
  createMockState,
  mockLogger,
} from "../../mock-adapter";
import type { Adapter } from "../../types";
import {
  fetchChannelMessages,
  fetchMessages,
  getUser,
  postMessage,
  sendDirectMessage,
} from "./ai-sdk";

const OUT_OF_SCOPE_REGEX = /tools are scoped to/;
const MISSING_SCOPE_REGEX = /Tool call blocked: no conversation scope/;

type ToolExecOptions = Parameters<NonNullable<Tool["execute"]>>[1];
const TOOL_OPTIONS = {
  toolCallId: "t1",
  messages: [],
} as unknown as ToolExecOptions;

const CALLER_THREAD = "slack:C123:1234.5678";
const SIBLING_THREAD = "slack:C123:9999.0000";
const OTHER_THREAD = "slack:C999:1111.2222";

const readInput = (threadId: string) => ({
  threadId,
  limit: 5,
  direction: "backward" as const,
});

describe("standalone AI SDK tool factories", () => {
  let chat: Chat<{ slack: Adapter }>;
  let mockAdapter: Adapter;

  beforeEach(async () => {
    mockAdapter = createMockAdapter("slack");
    chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: createMockState(),
      logger: mockLogger,
    });
    await chat.initialize();
  });

  describe("read factories", () => {
    it("rejects calls in a handler with no conversation", async () => {
      const tool = fetchMessages(chat);
      await expect(
        runInConversation(undefined, () =>
          tool.execute?.(readInput(CALLER_THREAD), TOOL_OPTIONS)
        )
      ).rejects.toThrow(MISSING_SCOPE_REGEX);
      expect(mockAdapter.fetchMessages).not.toHaveBeenCalled();
    });

    it("runs calls outside a handler workspace-wide", async () => {
      const tool = fetchMessages(chat);
      await tool.execute?.(readInput(OTHER_THREAD), TOOL_OPTIONS);
      expect(mockAdapter.fetchMessages).toHaveBeenCalled();
    });

    it("uses a guard function passed as the second argument", async () => {
      const guard = vi.fn((id: string) => {
        if (id !== CALLER_THREAD) {
          throw new Error("custom guard");
        }
      });
      const tool = fetchMessages(chat, guard);
      await expect(
        runInConversation(CALLER_THREAD, () =>
          tool.execute?.(readInput(OTHER_THREAD), TOOL_OPTIONS)
        )
      ).rejects.toThrow("custom guard");
      expect(guard).toHaveBeenCalledWith(OTHER_THREAD);
    });

    it("inherits the active conversation at call time", async () => {
      const tool = fetchMessages(chat);
      await runInConversation(CALLER_THREAD, () =>
        tool.execute?.(readInput(CALLER_THREAD), TOOL_OPTIONS)
      );
      expect(mockAdapter.fetchMessages).toHaveBeenCalled();
    });

    it("rejects targets outside the active conversation", async () => {
      const tool = fetchMessages(chat);
      await expect(
        runInConversation(CALLER_THREAD, () =>
          tool.execute?.(readInput(OTHER_THREAD), TOOL_OPTIONS)
        )
      ).rejects.toThrow(OUT_OF_SCOPE_REGEX);
      expect(mockAdapter.fetchMessages).not.toHaveBeenCalled();
    });

    it("applies an explicit scope", async () => {
      const tool = fetchMessages(chat, { scope: CALLER_THREAD });
      await tool.execute?.(readInput(SIBLING_THREAD), TOOL_OPTIONS);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
      await expect(
        tool.execute?.(readInput(OTHER_THREAD), TOOL_OPTIONS)
      ).rejects.toThrow(OUT_OF_SCOPE_REGEX);
      expect(mockAdapter.fetchMessages).toHaveBeenCalledTimes(1);
    });

    it("confines a thread scope to that thread with strictScope", async () => {
      const tool = fetchMessages(chat, {
        scope: CALLER_THREAD,
        strictScope: true,
      });
      await expect(
        tool.execute?.(readInput(SIBLING_THREAD), TOOL_OPTIONS)
      ).rejects.toThrow(OUT_OF_SCOPE_REGEX);
      expect(mockAdapter.fetchMessages).not.toHaveBeenCalled();
    });

    it("allows any conversation with scope: false", async () => {
      const tool = fetchChannelMessages(chat, { scope: false });
      await tool.execute?.(
        { channelId: "slack:C999", limit: 5, direction: "backward" },
        TOOL_OPTIONS
      );
      expect(mockAdapter.fetchChannelMessages).toHaveBeenCalled();
    });
  });

  describe("write factories", () => {
    it("rejects calls in a handler with no conversation", async () => {
      const tool = postMessage(chat);
      await expect(
        runInConversation(undefined, () =>
          tool.execute?.(
            { threadId: CALLER_THREAD, message: "hi" },
            TOOL_OPTIONS
          )
        )
      ).rejects.toThrow(MISSING_SCOPE_REGEX);
      expect(mockAdapter.postMessage).not.toHaveBeenCalled();
    });

    it("prefers a deprecated guard over scope", async () => {
      const guard = vi.fn();
      const tool = postMessage(chat, { guard, scope: CALLER_THREAD });
      await tool.execute?.(
        { threadId: OTHER_THREAD, message: "hi" },
        TOOL_OPTIONS
      );
      expect(guard).toHaveBeenCalledWith(OTHER_THREAD);
      expect(mockAdapter.postMessage).toHaveBeenCalled();
    });

    it("inherits the active conversation at call time", async () => {
      const tool = postMessage(chat);
      await runInConversation(CALLER_THREAD, () =>
        tool.execute?.({ threadId: CALLER_THREAD, message: "hi" }, TOOL_OPTIONS)
      );
      expect(mockAdapter.postMessage).toHaveBeenCalled();
    });

    it("applies an explicit scope", async () => {
      const tool = postMessage(chat, { scope: CALLER_THREAD });
      await expect(
        tool.execute?.({ threadId: OTHER_THREAD, message: "hi" }, TOOL_OPTIONS)
      ).rejects.toThrow(OUT_OF_SCOPE_REGEX);
      await tool.execute?.(
        { threadId: CALLER_THREAD, message: "hi" },
        TOOL_OPTIONS
      );
      expect(mockAdapter.postMessage).toHaveBeenCalledTimes(1);
    });

    it("allows any conversation with scope: false", async () => {
      const tool = postMessage(chat, { scope: false });
      await tool.execute?.(
        { threadId: OTHER_THREAD, message: "hi" },
        TOOL_OPTIONS
      );
      expect(mockAdapter.postMessage).toHaveBeenCalled();
    });

    it("keeps needsApproval on by default and honors an override", () => {
      expect(postMessage(chat).needsApproval).toBe(true);
      expect(postMessage(chat, { needsApproval: false }).needsApproval).toBe(
        false
      );
    });
  });

  describe("user-id factories", () => {
    it("runs sendDirectMessage without a conversation scope", async () => {
      const tool = sendDirectMessage(chat);
      expect(tool.needsApproval).toBe(true);
      await tool.execute?.({ userId: "U123", message: "hi" }, TOOL_OPTIONS);
      expect(mockAdapter.openDM).toHaveBeenCalledWith("U123");
      expect(mockAdapter.postMessage).toHaveBeenCalled();
    });

    it("keeps getUser approval-gated without a conversation scope", () => {
      expect(getUser(chat).needsApproval).toBe(true);
      expect(getUser(chat, false).needsApproval).toBe(false);
    });
  });
});
