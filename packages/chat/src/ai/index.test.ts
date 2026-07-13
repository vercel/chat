import type { Tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "../chat";
import {
  createMockAdapter,
  createMockState,
  mockLogger,
} from "../mock-adapter";
import type { Adapter, StateAdapter } from "../types";
import { createChatTools } from "./index";
import type { ToolOverrides } from "./types";

const REQUIRES_CHAT_INSTANCE_REGEX = /requires a `chat` instance/;
const NO_FETCH_CHANNEL_MESSAGES_REGEX =
  /does not support fetching channel messages/;
const NO_LIST_THREADS_REGEX = /does not support listing threads/;

// Minimal tool execution options stub used by every test below. Derived from
// `Tool["execute"]` so the same code typechecks against both ai v6 and v7
// (v7 made the `ToolExecutionOptions` generic parameter required).
type ToolExecOptions = Parameters<NonNullable<Tool["execute"]>>[1];
const TOOL_OPTIONS = {
  toolCallId: "t1",
  messages: [],
} as unknown as ToolExecOptions;

describe("createChatTools", () => {
  let chat: Chat<{ slack: Adapter }>;
  let mockAdapter: Adapter;
  let mockState: StateAdapter;

  beforeEach(async () => {
    mockAdapter = createMockAdapter("slack");
    mockState = createMockState();
    chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
    });
    await chat.initialize();
  });

  it("returns the full toolset when no preset is supplied", () => {
    const tools = createChatTools({ chat });
    expect(Object.keys(tools).sort()).toEqual(
      [
        "addReaction",
        "deleteMessage",
        "editMessage",
        "fetchChannelMessages",
        "fetchMessages",
        "fetchThread",
        "getChannelInfo",
        "getThreadParticipants",
        "getUser",
        "listThreads",
        "postChannelMessage",
        "postMessage",
        "removeReaction",
        "sendDirectMessage",
        "startTyping",
        "subscribeThread",
        "unsubscribeThread",
      ].sort()
    );
  });

  it("requires a chat instance", () => {
    expect(() =>
      createChatTools({
        chat: undefined as unknown as Chat<{ slack: Adapter }>,
      })
    ).toThrow(REQUIRES_CHAT_INSTANCE_REGEX);
  });

  it("scopes tools to a single preset", () => {
    const tools = createChatTools({ chat, preset: "reader" });
    const names = Object.keys(tools).sort();
    expect(names).toEqual(
      [
        "fetchChannelMessages",
        "fetchMessages",
        "fetchThread",
        "getChannelInfo",
        "getThreadParticipants",
        "getUser",
        "listThreads",
      ].sort()
    );
    // No write tools at all
    expect(names).not.toContain("postMessage");
    expect(names).not.toContain("deleteMessage");
  });

  it("composes multiple presets", () => {
    const tools = createChatTools({
      chat,
      preset: ["reader", "messenger"],
    });
    const names = Object.keys(tools).sort();
    expect(names).toContain("postMessage");
    expect(names).toContain("fetchMessages");
    expect(names).toContain("listThreads");
    expect(names).not.toContain("deleteMessage");
  });

  it("requires approval on every write tool by default", () => {
    const tools = createChatTools({ chat });
    // Every mutating tool must default to needsApproval: true so a misnamed
    // write tool (or one that silently drops `needsApproval`) is caught.
    expect(tools.postMessage?.needsApproval).toBe(true);
    expect(tools.postChannelMessage?.needsApproval).toBe(true);
    expect(tools.sendDirectMessage?.needsApproval).toBe(true);
    expect(tools.editMessage?.needsApproval).toBe(true);
    expect(tools.deleteMessage?.needsApproval).toBe(true);
    expect(tools.addReaction?.needsApproval).toBe(true);
    expect(tools.removeReaction?.needsApproval).toBe(true);
    expect(tools.subscribeThread?.needsApproval).toBe(true);
    expect(tools.unsubscribeThread?.needsApproval).toBe(true);
    // Read tools never gate on approval
    expect(tools.fetchMessages?.needsApproval).toBeUndefined();
    expect(tools.fetchChannelMessages?.needsApproval).toBeUndefined();
    expect(tools.fetchThread?.needsApproval).toBeUndefined();
    expect(tools.listThreads?.needsApproval).toBeUndefined();
    expect(tools.getThreadParticipants?.needsApproval).toBeUndefined();
    expect(tools.getChannelInfo?.needsApproval).toBeUndefined();
    expect(tools.getUser?.needsApproval).toBeUndefined();
    // Typing indicator is harmless and never gated
    expect(tools.startTyping?.needsApproval).toBeUndefined();
  });

  it("disables approval on every write tool when requireApproval is false", () => {
    const tools = createChatTools({ chat, requireApproval: false });
    expect(tools.postMessage?.needsApproval).toBe(false);
    expect(tools.postChannelMessage?.needsApproval).toBe(false);
    expect(tools.sendDirectMessage?.needsApproval).toBe(false);
    expect(tools.editMessage?.needsApproval).toBe(false);
    expect(tools.deleteMessage?.needsApproval).toBe(false);
    expect(tools.addReaction?.needsApproval).toBe(false);
    expect(tools.removeReaction?.needsApproval).toBe(false);
    expect(tools.subscribeThread?.needsApproval).toBe(false);
    expect(tools.unsubscribeThread?.needsApproval).toBe(false);
  });

  it("supports per-tool approval overrides", () => {
    const tools = createChatTools({
      chat,
      requireApproval: {
        postMessage: false,
        deleteMessage: true,
        subscribeThread: false,
      },
    });
    expect(tools.postMessage?.needsApproval).toBe(false);
    expect(tools.deleteMessage?.needsApproval).toBe(true);
    expect(tools.subscribeThread?.needsApproval).toBe(false);
    // Unspecified write tools fall back to true
    expect(tools.editMessage?.needsApproval).toBe(true);
    expect(tools.unsubscribeThread?.needsApproval).toBe(true);
  });

  it("applies tool overrides without breaking execution", () => {
    const tools = createChatTools({
      chat,
      overrides: {
        postMessage: {
          description: "Reply in the active support thread",
          needsApproval: false,
        },
      },
    });
    expect(tools.postMessage?.description).toBe(
      "Reply in the active support thread"
    );
    expect(tools.postMessage?.needsApproval).toBe(false);
  });

  it("does not allow overrides to replace core tool fields", async () => {
    const execute = vi.fn().mockResolvedValue({ hijacked: true });
    const inputSchema = { sentinel: "input" };
    const outputSchema = { sentinel: "output" };
    const inputExamples = [
      { input: { threadId: "slack:C123:1234.5678", message: "hello" } },
    ];
    const metadata = { source: "chat-sdk" };
    const tools = createChatTools({
      chat,
      requireApproval: false,
      overrides: {
        postMessage: {
          args: { name: "custom" },
          description: "Reply in the active support thread",
          execute,
          id: "openai.custom",
          inputExamples,
          inputSchema,
          metadata,
          outputSchema,
          supportsDeferredResults: true,
          type: "provider",
        } as unknown as ToolOverrides,
      },
    });
    const postMessage = tools.postMessage as unknown as Record<string, unknown>;

    expect(tools.postMessage?.description).toBe(
      "Reply in the active support thread"
    );
    expect(tools.postMessage?.execute).not.toBe(execute);
    expect(postMessage.args).toBeUndefined();
    expect(postMessage.id).toBeUndefined();
    expect(postMessage.inputExamples).toEqual(inputExamples);
    expect(postMessage.inputSchema).not.toBe(inputSchema);
    expect(postMessage.metadata).toEqual(metadata);
    expect(postMessage.outputSchema).not.toBe(outputSchema);
    expect(postMessage.supportsDeferredResults).toBeUndefined();
    expect(postMessage.type).not.toBe("provider");

    const result = await tools.postMessage?.execute?.(
      { threadId: "slack:C123:1234.5678", message: "hello" },
      TOOL_OPTIONS
    );

    expect(execute).not.toHaveBeenCalled();
    expect(mockAdapter.postMessage).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "hello"
    );
    expect(result).toMatchObject({ messageId: "msg-1" });
  });

  it("postMessage dispatches via the adapter's postMessage", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    const result = await tools.postMessage?.execute?.(
      { threadId: "slack:C123:1234.5678", message: "hello" },
      TOOL_OPTIONS
    );
    expect(mockAdapter.postMessage).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "hello"
    );
    expect(result).toMatchObject({ messageId: "msg-1" });
  });

  it("postChannelMessage dispatches via the adapter's postChannelMessage", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    await tools.postChannelMessage?.execute?.(
      {
        channelId: "slack:C123",
        message: { markdown: "**hi**" },
      },
      TOOL_OPTIONS
    );
    expect(mockAdapter.postChannelMessage).toHaveBeenCalledWith("slack:C123", {
      markdown: "**hi**",
    });
  });

  it("sendDirectMessage opens a DM and posts in it", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    await tools.sendDirectMessage?.execute?.(
      { userId: "U123456", message: "ping" },
      TOOL_OPTIONS
    );
    expect(mockAdapter.openDM).toHaveBeenCalledWith("U123456");
    expect(mockAdapter.postMessage).toHaveBeenCalled();
  });

  it("addReaction dispatches via the adapter's addReaction", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    await tools.addReaction?.execute?.(
      {
        threadId: "slack:C123:1234.5678",
        messageId: "msg-1",
        emoji: "thumbs_up",
      },
      TOOL_OPTIONS
    );
    expect(mockAdapter.addReaction).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "msg-1",
      "thumbs_up"
    );
  });

  it("deleteMessage dispatches via the adapter's deleteMessage", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    const result = await tools.deleteMessage?.execute?.(
      { threadId: "slack:C123:1234.5678", messageId: "msg-1" },
      TOOL_OPTIONS
    );
    expect(mockAdapter.deleteMessage).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "msg-1"
    );
    expect(result).toMatchObject({ deleted: true });
  });

  it("subscribeThread persists the subscription", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    await tools.subscribeThread?.execute?.(
      { threadId: "slack:C123:1234.5678" },
      TOOL_OPTIONS
    );
    expect(await mockState.isSubscribed("slack:C123:1234.5678")).toBe(true);
  });

  it("startTyping dispatches via the adapter's startTyping", async () => {
    const tools = createChatTools({ chat });
    await tools.startTyping?.execute?.(
      { threadId: "slack:C123:1234.5678", status: "Searching..." },
      TOOL_OPTIONS
    );
    expect(mockAdapter.startTyping).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "Searching..."
    );
  });

  it("fetchMessages projects a model-friendly shape", async () => {
    const stubMessage = {
      id: "m1",
      threadId: "slack:C123:1234.5678",
      text: "hello",
      author: {
        userId: "U1",
        userName: "alice",
        fullName: "Alice",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: new Date("2026-01-01T00:00:00Z"),
        edited: false,
      },
      attachments: [],
    } as unknown as Awaited<
      ReturnType<typeof mockAdapter.fetchMessages>
    >["messages"][number];
    vi.mocked(mockAdapter.fetchMessages).mockResolvedValueOnce({
      messages: [stubMessage],
      nextCursor: undefined,
    });
    const tools = createChatTools({ chat });
    const result = (await tools.fetchMessages?.execute?.(
      { threadId: "slack:C123:1234.5678", limit: 5, direction: "backward" },
      TOOL_OPTIONS
    )) as { messages: Array<{ id: string; text: string }> };
    expect(result.messages).toEqual([
      expect.objectContaining({ id: "m1", text: "hello" }),
    ]);
  });

  it("getChannelInfo returns flattened metadata", async () => {
    const tools = createChatTools({ chat });
    const result = await tools.getChannelInfo?.execute?.(
      { channelId: "slack:C123" },
      TOOL_OPTIONS
    );
    expect(result).toMatchObject({
      id: "slack:C123",
      name: "#slack:C123",
      isDM: false,
    });
  });

  it("editMessage dispatches via the adapter's editMessage", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    const result = await tools.editMessage?.execute?.(
      {
        threadId: "slack:C123:1234.5678",
        messageId: "msg-1",
        message: { markdown: "**updated**" },
      },
      TOOL_OPTIONS
    );
    expect(mockAdapter.editMessage).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "msg-1",
      { markdown: "**updated**" }
    );
    expect(result).toMatchObject({ messageId: "msg-1" });
  });

  it("postMessage forwards a `raw` PostableInput unchanged", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    await tools.postMessage?.execute?.(
      {
        threadId: "slack:C123:1234.5678",
        message: { raw: "<blocks>...</blocks>" },
      },
      TOOL_OPTIONS
    );
    expect(mockAdapter.postMessage).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      { raw: "<blocks>...</blocks>" }
    );
  });

  it("removeReaction dispatches via the adapter's removeReaction", async () => {
    const tools = createChatTools({ chat, requireApproval: false });
    const result = await tools.removeReaction?.execute?.(
      {
        threadId: "slack:C123:1234.5678",
        messageId: "msg-1",
        emoji: "thumbs_up",
      },
      TOOL_OPTIONS
    );
    expect(mockAdapter.removeReaction).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "msg-1",
      "thumbs_up"
    );
    expect(result).toMatchObject({ removed: true, emoji: "thumbs_up" });
  });

  it("unsubscribeThread clears the subscription", async () => {
    await mockState.subscribe("slack:C123:1234.5678");
    expect(await mockState.isSubscribed("slack:C123:1234.5678")).toBe(true);

    const tools = createChatTools({ chat, requireApproval: false });
    const result = await tools.unsubscribeThread?.execute?.(
      { threadId: "slack:C123:1234.5678" },
      TOOL_OPTIONS
    );
    expect(await mockState.isSubscribed("slack:C123:1234.5678")).toBe(false);
    expect(result).toMatchObject({ subscribed: false });
  });

  it("fetchChannelMessages dispatches via the adapter and projects messages", async () => {
    const stubMessage = {
      id: "m1",
      threadId: "slack:C123:1234.5678",
      text: "channel hello",
      author: {
        userId: "U1",
        userName: "alice",
        fullName: "Alice",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: new Date("2026-02-01T00:00:00Z"),
        edited: false,
      },
      attachments: [],
    } as unknown as Awaited<
      ReturnType<NonNullable<Adapter["fetchChannelMessages"]>>
    >["messages"][number];
    vi.mocked(
      mockAdapter.fetchChannelMessages as NonNullable<
        Adapter["fetchChannelMessages"]
      >
    ).mockResolvedValueOnce({
      messages: [stubMessage],
      nextCursor: "next",
    });

    const tools = createChatTools({ chat });
    const result = (await tools.fetchChannelMessages?.execute?.(
      { channelId: "slack:C123", limit: 5, direction: "backward" },
      TOOL_OPTIONS
    )) as {
      messages: Array<{ id: string; text: string }>;
      nextCursor: string | undefined;
    };
    expect(mockAdapter.fetchChannelMessages).toHaveBeenCalledWith(
      "slack:C123",
      {
        limit: 5,
        cursor: undefined,
        direction: "backward",
      }
    );
    expect(result.messages).toEqual([
      expect.objectContaining({ id: "m1", text: "channel hello" }),
    ]);
    expect(result.nextCursor).toBe("next");
  });

  it("fetchChannelMessages throws when the adapter does not support it", async () => {
    (mockAdapter as { fetchChannelMessages?: unknown }).fetchChannelMessages =
      undefined;
    const tools = createChatTools({ chat });
    await expect(
      tools.fetchChannelMessages?.execute?.(
        { channelId: "slack:C123" },
        TOOL_OPTIONS
      )
    ).rejects.toThrow(NO_FETCH_CHANNEL_MESSAGES_REGEX);
  });

  it("fetchThread returns a flattened ThreadInfo", async () => {
    vi.mocked(mockAdapter.fetchThread).mockResolvedValueOnce({
      id: "slack:C123:1234.5678",
      channelId: "C123",
      channelName: "#general",
      channelVisibility: "public",
      isDM: false,
      metadata: {},
    });
    const tools = createChatTools({ chat });
    const result = await tools.fetchThread?.execute?.(
      { threadId: "slack:C123:1234.5678" },
      TOOL_OPTIONS
    );
    expect(result).toMatchObject({
      id: "slack:C123:1234.5678",
      channelId: "C123",
      channelName: "#general",
      channelVisibility: "public",
      isDM: false,
    });
  });

  it("listThreads projects ThreadSummary entries", async () => {
    const rootMessage = {
      id: "m1",
      threadId: "slack:C123:1234.5678",
      text: "root",
      author: {
        userId: "U1",
        userName: "alice",
        fullName: "Alice",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: new Date("2026-03-01T00:00:00Z"),
        edited: false,
      },
      attachments: [],
    } as unknown as Awaited<
      ReturnType<NonNullable<Adapter["listThreads"]>>
    >["threads"][number]["rootMessage"];
    vi.mocked(
      mockAdapter.listThreads as NonNullable<Adapter["listThreads"]>
    ).mockResolvedValueOnce({
      threads: [
        {
          id: "slack:C123:1234.5678",
          replyCount: 4,
          lastReplyAt: new Date("2026-03-02T00:00:00Z"),
          rootMessage,
        },
      ],
      nextCursor: undefined,
    });

    const tools = createChatTools({ chat });
    const result = (await tools.listThreads?.execute?.(
      { channelId: "slack:C123", limit: 10 },
      TOOL_OPTIONS
    )) as {
      threads: Array<{
        id: string;
        replyCount?: number;
        rootMessage: { id: string; text: string };
      }>;
    };
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]).toMatchObject({
      id: "slack:C123:1234.5678",
      replyCount: 4,
      rootMessage: expect.objectContaining({ id: "m1", text: "root" }),
    });
  });

  it("listThreads throws when the adapter does not support it", async () => {
    (mockAdapter as { listThreads?: unknown }).listThreads = undefined;
    const tools = createChatTools({ chat });
    await expect(
      tools.listThreads?.execute?.({ channelId: "slack:C123" }, TOOL_OPTIONS)
    ).rejects.toThrow(NO_LIST_THREADS_REGEX);
  });

  it("getThreadParticipants delegates to thread.getParticipants and projects authors", async () => {
    // `chat.thread(...)` is the public entry point used by the tool; we stub
    // it here so we don't depend on the broader thread machinery (cursor
    // pagination, _currentMessage handling, etc.) for this projection test.
    const participantsStub = [
      {
        userId: "UALICE1",
        userName: "alice",
        fullName: "Alice",
        isBot: false,
        isMe: false,
      },
      {
        userId: "UBOB1",
        userName: "bob",
        fullName: "Bob",
        isBot: false,
        isMe: false,
      },
    ];
    vi.spyOn(chat, "thread").mockReturnValueOnce({
      getParticipants: vi.fn().mockResolvedValue(participantsStub),
    } as unknown as ReturnType<typeof chat.thread>);

    const tools = createChatTools({ chat });
    const result = (await tools.getThreadParticipants?.execute?.(
      { threadId: "slack:C123:1234.5678" },
      TOOL_OPTIONS
    )) as {
      participants: Array<{ userId: string; userName: string; isBot: boolean }>;
    };
    expect(result.participants).toEqual([
      {
        userId: "UALICE1",
        userName: "alice",
        fullName: "Alice",
        isBot: false,
      },
      { userId: "UBOB1", userName: "bob", fullName: "Bob", isBot: false },
    ]);
  });

  it("getUser projects UserInfo when the adapter resolves a user", async () => {
    (mockAdapter as { getUser?: unknown }).getUser = vi.fn().mockResolvedValue({
      userId: "U123456",
      userName: "alice",
      fullName: "Alice Doe",
      email: "alice@example.com",
      isBot: false,
      avatarUrl: "https://example.com/a.png",
    });
    const tools = createChatTools({ chat });
    const result = await tools.getUser?.execute?.(
      { userId: "U123456" },
      TOOL_OPTIONS
    );
    expect(result).toMatchObject({
      userId: "U123456",
      userName: "alice",
      fullName: "Alice Doe",
      email: "alice@example.com",
      isBot: false,
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("getUser returns null when the adapter does not know the user", async () => {
    (mockAdapter as { getUser?: unknown }).getUser = vi
      .fn()
      .mockResolvedValue(null);
    const tools = createChatTools({ chat });
    const result = await tools.getUser?.execute?.(
      { userId: "UMISSING" },
      TOOL_OPTIONS
    );
    expect(result).toBeNull();
  });
});
