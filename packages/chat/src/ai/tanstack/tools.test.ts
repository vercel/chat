import {
  convertSchemaToJsonSchema,
  type chat as tanstackChat,
} from "@tanstack/ai";
import { beforeEach, describe, expect, it } from "vitest";
import { Chat } from "../../chat";
import {
  createMockAdapter,
  createMockState,
  mockLogger,
} from "../../mock-adapter";
import type { Adapter, StateAdapter } from "../../types";
import type { ChatToolName } from "../toolset";
import {
  createTanStackTools,
  type TanStackChatToolsOptions,
  type TanStackTool,
  type TanStackToolOverrides,
} from "./tools";

const REQUIRES_CHAT_INSTANCE_REGEX = /requires a `chat` instance/;
const OUT_OF_SCOPE_REGEX = /tools are scoped to/;
const NO_GET_USER_REGEX = /does not support getUser/;

const ALL_TOOL_NAMES: ChatToolName[] = [
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
];

const WRITE_TOOL_NAMES: ChatToolName[] = [
  "postMessage",
  "postChannelMessage",
  "sendDirectMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "subscribeThread",
  "unsubscribeThread",
];

function byName(tools: TanStackTool[]): Record<string, TanStackTool> {
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}

describe("createTanStackTools", () => {
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

  it("throws when no chat instance is supplied", () => {
    expect(() =>
      createTanStackTools({} as unknown as TanStackChatToolsOptions)
    ).toThrow(REQUIRES_CHAT_INSTANCE_REGEX);
  });

  it("returns every tool as an array with unique names", () => {
    const tools = createTanStackTools({ chat });
    expect(tools).toHaveLength(ALL_TOOL_NAMES.length);
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("is assignable to TanStack AI's chat({ tools }) option", () => {
    type ChatTools = NonNullable<Parameters<typeof tanstackChat>[0]["tools"]>;
    const tools: ChatTools = createTanStackTools({ chat });
    expect(tools.length).toBeGreaterThan(0);
  });

  it("filters by a single preset", () => {
    const tools = createTanStackTools({ chat, preset: "reader" });
    expect(tools.map((t) => t.name).sort()).toEqual([
      "fetchChannelMessages",
      "fetchMessages",
      "fetchThread",
      "getChannelInfo",
      "getThreadParticipants",
      "getUser",
      "listThreads",
    ]);
  });

  it("unions multiple presets", () => {
    const tools = createTanStackTools({
      chat,
      preset: ["reader", "messenger"],
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("listThreads");
    expect(names).toContain("postMessage");
    expect(names).not.toContain("deleteMessage");
  });

  it("marks write tools and getUser as needing approval by default", () => {
    const tools = byName(createTanStackTools({ chat }));
    for (const name of WRITE_TOOL_NAMES) {
      expect(tools[name]?.needsApproval, name).toBe(true);
    }
    expect(tools.getUser?.needsApproval).toBe(true);
    for (const name of [
      "fetchMessages",
      "fetchThread",
      "getChannelInfo",
      "startTyping",
    ]) {
      expect(tools[name]).not.toHaveProperty("needsApproval");
    }
  });

  it("disables approval everywhere with requireApproval: false", () => {
    const tools = createTanStackTools({ chat, requireApproval: false });
    for (const tool of tools) {
      expect(tool.needsApproval).not.toBe(true);
    }
  });

  it("applies per-tool approval overrides", () => {
    const tools = byName(
      createTanStackTools({
        chat,
        requireApproval: { postMessage: false, getUser: false },
      })
    );
    expect(tools.postMessage?.needsApproval).toBe(false);
    expect(tools.getUser?.needsApproval).toBe(false);
    expect(tools.deleteMessage?.needsApproval).toBe(true);
  });

  it("applies description, needsApproval, metadata and lazy overrides", () => {
    const tools = byName(
      createTanStackTools({
        chat,
        overrides: {
          postMessage: {
            description: "Reply in the support thread.",
            needsApproval: false,
            metadata: { team: "support" },
            lazy: true,
          },
        },
      })
    );
    expect(tools.postMessage).toMatchObject({
      description: "Reply in the support thread.",
      needsApproval: false,
      metadata: { team: "support" },
      lazy: true,
    });
  });

  it("refuses to override protected fields", async () => {
    const original = byName(createTanStackTools({ chat })).postMessage;
    const tools = byName(
      createTanStackTools({
        chat,
        requireApproval: false,
        overrides: {
          postMessage: {
            name: "renamed",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            execute: async () => "hijacked",
          } as unknown as TanStackToolOverrides,
        },
      })
    );
    const tool = tools.postMessage;
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("postMessage");
    expect(tool?.inputSchema).toBe(original?.inputSchema);
    expect(tool).not.toHaveProperty("outputSchema");
    const result = await tool?.execute({
      threadId: "slack:C123:1234.5678",
      message: "hello",
    });
    expect(result).toMatchObject({ messageId: "msg-1" });
  });

  it("postMessage dispatches via the adapter's postMessage", async () => {
    const tools = byName(createTanStackTools({ chat, requireApproval: false }));
    const result = await tools.postMessage?.execute({
      threadId: "slack:C123:1234.5678",
      message: "hello",
    });
    expect(mockAdapter.postMessage).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "hello"
    );
    expect(result).toMatchObject({ messageId: "msg-1" });
  });

  it("ignores the TanStack execution context argument", async () => {
    const tools = byName(createTanStackTools({ chat, requireApproval: false }));
    const result = await tools.postMessage?.execute(
      { threadId: "slack:C123:1234.5678", message: "hello" },
      { toolCallId: "call_1" }
    );
    expect(result).toMatchObject({ messageId: "msg-1" });
  });

  it("blocks reading a thread outside the scoped channel", async () => {
    const tools = byName(
      createTanStackTools({ chat, scope: "slack:C123:1234.5678" })
    );
    await expect(
      tools.fetchMessages?.execute({
        threadId: "slack:C999:1111.2222",
        limit: 5,
        cursor: undefined,
        direction: "backward",
      })
    ).rejects.toThrow(OUT_OF_SCOPE_REGEX);
    expect(mockAdapter.fetchMessages).not.toHaveBeenCalled();
  });

  it("blocks a sibling thread when scoped to a single thread with strictScope", async () => {
    const tools = byName(
      createTanStackTools({
        chat,
        scope: "slack:C123:1234.5678",
        strictScope: true,
      })
    );
    await expect(
      tools.fetchMessages?.execute({
        threadId: "slack:C123:9999.0000",
        limit: 5,
        cursor: undefined,
        direction: "backward",
      })
    ).rejects.toThrow(OUT_OF_SCOPE_REGEX);
    expect(mockAdapter.fetchMessages).not.toHaveBeenCalled();
  });

  it("reaches other channels when scope is false", async () => {
    const tools = byName(createTanStackTools({ chat, scope: false }));
    await tools.fetchMessages?.execute({
      threadId: "slack:C999:1111.2222",
      limit: 5,
      cursor: undefined,
      direction: "backward",
    });
    expect(mockAdapter.fetchMessages).toHaveBeenCalled();
  });

  it("lets user-id tools bypass the conversation scope", async () => {
    const tools = byName(
      createTanStackTools({
        chat,
        scope: "slack:C123:1234.5678",
        requireApproval: false,
      })
    );
    await tools.sendDirectMessage?.execute({
      userId: "U999",
      message: "ping",
    });
    expect(mockAdapter.openDM).toHaveBeenCalledWith("U999");
    // The mock adapter has no user lookup, so reaching that error proves the
    // call went past the scope guard.
    await expect(tools.getUser?.execute({ userId: "U999" })).rejects.toThrow(
      NO_GET_USER_REGEX
    );
  });

  it("input schemas convert to JSON Schema through TanStack's converter", () => {
    const tools = byName(createTanStackTools({ chat }));
    const schema = convertSchemaToJsonSchema(
      tools.fetchMessages?.inputSchema as Parameters<
        typeof convertSchemaToJsonSchema
      >[0]
    ) as {
      properties?: Record<string, { description?: string }>;
      required?: string[];
      type?: string;
    };
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("threadId");
    expect(schema.properties?.threadId?.description).toBe("Full thread id");
    expect(schema.properties?.limit?.description).toBe(
      "Maximum number of messages to fetch"
    );
  });
});
