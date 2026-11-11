import { PermissionError, ValidationError } from "@chat-adapter/shared";
import { createMockChatInstance, createMockState } from "@chat-adapter/tests";
import { Client as GraphClient } from "@microsoft/teams.graph";
import { chats, shares, teams } from "@microsoft/teams.graph-endpoints";
import { ConsoleLogger } from "chat";
import { describe, expect, it, vi } from "vitest";
import type { TeamsApp } from "./app";
import { TeamsGraphReader } from "./graph-api";
import { createTeamsAdapter, type TeamsAdapter } from "./index";
import { TeamsFormatConverter } from "./markdown";
import { decodeThreadId, encodeThreadId, isDM } from "./thread-id";

function createAttachmentFetchers() {
  return {
    createAnonymousFetchData: vi.fn(),
    fetchAuthenticated: vi.fn(),
    fetchGraphFile: vi.fn(),
  };
}

function createTestReader(): TeamsGraphReader {
  return new TeamsGraphReader({
    attachmentFetchers: createAttachmentFetchers(),
    botId: "test-app",
    graph: new GraphClient(),
    formatConverter: new TeamsFormatConverter(),
    getGraphContext: async () => null,
    logger: new ConsoleLogger("error"),
  });
}

describe("extractTextFromGraphMessage", () => {
  it("should extract plain text content", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: { content: "Hello world", contentType: "text" },
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe(
      "Hello world"
    );
  });

  it("should strip HTML tags from html content", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: {
        content: "<p>Hello <b>world</b></p>",
        contentType: "html",
      },
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe(
      "Hello world"
    );
  });

  it("should return empty string for missing body", () => {
    const reader = createTestReader();
    const msg = { id: "1" };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe("");
  });

  it("should return '[Card]' for adaptive card without title", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: { content: "", contentType: "html" },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify({ type: "AdaptiveCard", body: [] }),
        },
      ],
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe("[Card]");
  });

  it("should extract card title from bolder TextBlock", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: { content: "", contentType: "html" },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify({
            type: "AdaptiveCard",
            body: [
              { type: "TextBlock", text: "Some description" },
              { type: "TextBlock", text: "My Card Title", weight: "bolder" },
            ],
          }),
        },
      ],
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe(
      "My Card Title"
    );
  });

  it("should return '[Card]' for invalid JSON in card content", () => {
    const reader = createTestReader();
    const msg = {
      id: "1",
      body: { content: "", contentType: "html" },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: "not valid json",
        },
      ],
    };
    expect(reader.extractTextFromGraphMessage(msg as never)).toBe("[Card]");
  });
});

describe("extractCardTitle", () => {
  it("should return null for null/undefined", () => {
    const reader = createTestReader();
    expect(reader.extractCardTitle(null)).toBeNull();
    expect(reader.extractCardTitle(undefined)).toBeNull();
  });

  it("should return null for non-object values", () => {
    const reader = createTestReader();
    expect(reader.extractCardTitle("string")).toBeNull();
    expect(reader.extractCardTitle(42)).toBeNull();
  });

  it("should return null for empty body", () => {
    const reader = createTestReader();
    expect(reader.extractCardTitle({ body: [] })).toBeNull();
  });

  it("should find title with size: large", () => {
    const reader = createTestReader();
    const card = {
      body: [
        { type: "TextBlock", text: "Big Title", size: "large" },
        { type: "TextBlock", text: "Description" },
      ],
    };
    expect(reader.extractCardTitle(card)).toBe("Big Title");
  });

  it("should fallback to first TextBlock when no styled title found", () => {
    const reader = createTestReader();
    const card = {
      body: [
        { type: "TextBlock", text: "First block" },
        { type: "TextBlock", text: "Second block" },
      ],
    };
    expect(reader.extractCardTitle(card)).toBe("First block");
  });
});

describe("TeamsAdapter.fetchMessages Graph routing", () => {
  it.each([
    {
      name: "resolves an opaque DM conversation through stored Graph context",
      conversationId: "a:opaque-conversation-id",
      conversationType: "personal" as const,
      context: {
        type: "dm",
        graphChatId: "19:user-aad-id_bot-id@unq.gbl.spaces",
      },
      expectedChatId: "19:user-aad-id_bot-id@unq.gbl.spaces",
    },
    {
      name: "uses a group conversation ID without stored context",
      conversationId: "19:group-chat@thread.v2",
      conversationType: "groupChat" as const,
      context: undefined,
      expectedChatId: "19:group-chat@thread.v2",
    },
  ])("$name", async ({
    conversationId,
    conversationType,
    context,
    expectedChatId,
  }) => {
    const state = createMockState();
    if (context) {
      await state.set(
        `teams:channelContext:${conversationId}`,
        JSON.stringify(context)
      );
    }
    const adapter = createTeamsAdapter({
      appId: "bot-id",
      appPassword: "test",
      logger: new ConsoleLogger("error"),
    });
    const app = (adapter as unknown as { app: TeamsApp }).app;
    vi.spyOn(app, "initialize").mockResolvedValue(undefined);
    const call = vi.spyOn(app.graph, "call").mockResolvedValue({
      value: [
        { id: "message-1", body: { content: "Hello", contentType: "text" } },
      ],
    });
    await adapter.initialize(createMockChatInstance({ state }));

    const result = await adapter.fetchMessages(
      adapter.encodeThreadId({
        conversationId,
        conversationType,
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      })
    );

    expect(call).toHaveBeenCalledExactlyOnceWith(
      chats.messages.list,
      expect.objectContaining({ "chat-id": expectedChatId })
    );
    expect(result.messages).toMatchObject([{ id: "message-1", text: "Hello" }]);
  });

  it("downloads group chat file references through Microsoft Graph", async () => {
    const fileUrl =
      "https://contoso-my.sharepoint.com/personal/user/Documents/report.pdf";
    const downloadUrl = "https://contoso-my.sharepoint.com/download?token=abc";
    const adapter = createTeamsAdapter({
      appId: "bot-id",
      appPassword: "test",
      logger: new ConsoleLogger("error"),
    });
    const app = (adapter as unknown as { app: TeamsApp }).app;
    vi.spyOn(app, "initialize").mockResolvedValue(undefined);
    const call = vi
      .spyOn(app.graph, "call")
      .mockResolvedValueOnce({
        value: [
          {
            id: "1747634491000",
            body: { content: "summarize this", contentType: "html" },
            attachments: [
              {
                contentType: "reference",
                contentUrl: fileUrl,
                name: "report.pdf",
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        "@microsoft.graph.downloadUrl": downloadUrl,
      });
    const download = vi.fn(async () => Buffer.from("pdf bytes"));
    const createFetchDataFn = vi
      .spyOn(
        adapter as unknown as {
          createFetchDataFn: (url: string) => () => Promise<Buffer>;
        },
        "createFetchDataFn"
      )
      .mockReturnValue(download);
    await adapter.initialize(
      createMockChatInstance({ state: createMockState() })
    );

    const result = await adapter.fetchMessages(
      adapter.encodeThreadId({
        conversationId: "19:group-chat@thread.v2",
        conversationType: "groupChat",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      })
    );
    const attachment = result.messages[0]?.attachments[0];

    expect(attachment).toMatchObject({
      type: "file",
      name: "report.pdf",
      mimeType: "application/pdf",
    });
    await expect(attachment?.fetchData?.()).resolves.toEqual(
      Buffer.from("pdf bytes")
    );
    expect(call).toHaveBeenLastCalledWith(shares.driveItem.get, {
      "sharedDriveItem-id": `u!${Buffer.from(fileUrl).toString("base64url")}`,
    });
    expect(createFetchDataFn).toHaveBeenCalledWith(downloadUrl);
  });

  it("maps Graph permission failures when resolving a file reference", async () => {
    const adapter = createTeamsAdapter({
      appId: "bot-id",
      appPassword: "test",
      logger: new ConsoleLogger("error"),
    });
    const app = (adapter as unknown as { app: TeamsApp }).app;
    vi.spyOn(app, "initialize").mockResolvedValue(undefined);
    vi.spyOn(app.graph, "call")
      .mockResolvedValueOnce({
        value: [
          {
            id: "1747634491000",
            body: { content: "summarize this", contentType: "html" },
            attachments: [
              {
                contentType: "reference",
                contentUrl:
                  "https://contoso.sharepoint.com/sites/team/report.pdf",
                name: "report.pdf",
              },
            ],
          },
        ],
      })
      .mockRejectedValueOnce(
        Object.assign(new Error("Forbidden"), { statusCode: 403 })
      );
    await adapter.initialize(
      createMockChatInstance({ state: createMockState() })
    );

    const result = await adapter.fetchMessages(
      adapter.encodeThreadId({
        conversationId: "19:group-chat@thread.v2",
        conversationType: "groupChat",
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      })
    );

    await expect(
      result.messages[0]?.attachments[0]?.fetchData?.()
    ).rejects.toThrow(PermissionError);
  });
});

describe("listThreads", () => {
  it("preserves an explicit group-chat conversation type", async () => {
    const graph = {
      call: vi.fn(async () => ({
        value: [
          {
            id: "message-1",
            body: { content: "Hello", contentType: "text" },
          },
        ],
      })),
    };
    const reader = new TeamsGraphReader({
      attachmentFetchers: createAttachmentFetchers(),
      botId: "test-app",
      graph: graph as unknown as GraphClient,
      formatConverter: new TeamsFormatConverter(),
      getGraphContext: async () => ({
        type: "dm",
        graphChatId: "19:stale-personal-chat@unq.gbl.spaces",
      }),
      logger: new ConsoleLogger("error"),
    });
    const channelId = encodeThreadId({
      conversationId: "a:group-chat-id",
      conversationType: "groupChat",
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    });

    const result = await reader.listThreads(channelId);
    const threadId = result.threads[0]?.id;

    expect(graph.call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ "chat-id": "a:group-chat-id" })
    );
    expect(threadId).toBeDefined();
    expect(decodeThreadId(threadId as string).conversationType).toBe(
      "groupChat"
    );
    expect(isDM(threadId as string)).toBe(false);
  });
});

describe("channel pagination", () => {
  const context = {
    type: "channel" as const,
    teamId: "team-id",
    channelId: "19:channel@thread.tacv2",
  };
  const channelId = encodeThreadId({
    conversationId: context.channelId,
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  });
  const collectionUrl = `https://graph.microsoft.com/v1.0/teams/${context.teamId}/channels/${encodeURIComponent(context.channelId)}/messages`;
  const root = (id: number, day: number) => ({
    id: `179100000000${id}`,
    createdDateTime: `2026-10-0${day}T00:00:00Z`,
    body: { content: `Root ${id}`, contentType: "text" },
  });
  const roots = [root(1, 1), root(2, 2), root(3, 3), root(4, 4), root(5, 4)];

  function fixture() {
    // Graph orders roots by activity in their reply chains, not creation time.
    const pages = [
      {
        value: [roots[0], roots[3]],
        "@odata.nextLink": `${collectionUrl}?$skiptoken=1`,
      },
      { value: [], "@odata.nextLink": `${collectionUrl}?$skiptoken=2` },
      {
        value: [{ body: { content: "Missing ID" } }, roots[2]],
        "@odata.nextLink": `${collectionUrl}?$skiptoken=3`,
      },
      { value: [roots[4], roots[1]] },
    ];
    const graph = {
      call: vi.fn(async () => structuredClone(pages[0])),
      http: {
        get: vi.fn(async (url: string) => ({
          data: structuredClone(
            pages[Number(new URL(url).searchParams.get("$skiptoken"))]
          ),
        })),
      },
    };
    const reader = new TeamsGraphReader({
      attachmentFetchers: createAttachmentFetchers(),
      botId: "test-app",
      graph: graph as unknown as GraphClient,
      formatConverter: new TeamsFormatConverter(),
      getGraphContext: async () => context,
      logger: new ConsoleLogger("error"),
    });
    return { reader, graph };
  }

  it.each([
    "forward",
    "backward",
  ] as const)("returns all roots in creation order when paging %s", async (direction) => {
    const { reader, graph } = fixture();
    const seen = new Set<string>();
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const result = await reader.fetchChannelMessages(channelId, {
        direction,
        limit: 2,
        cursor,
      });
      pages.push(result.messages.map((message) => message.id));
      expect(pages.length).toBeLessThanOrEqual(3);
      if (result.nextCursor) {
        expect(seen.has(result.nextCursor)).toBe(false);
        seen.add(result.nextCursor);
      }
      cursor = result.nextCursor;
    } while (cursor);
    expect(pages).toEqual(
      direction === "forward"
        ? [
            [roots[0].id, roots[1].id],
            [roots[2].id, roots[3].id],
            [roots[4].id],
          ]
        : [
            [roots[3].id, roots[4].id],
            [roots[1].id, roots[2].id],
            [roots[0].id],
          ]
    );
    expect(graph.call.mock.calls.length).toBe(3);
    expect(graph.http.get.mock.calls.length).toBe(9);
  });

  it.each([
    "forward",
    "backward",
  ] as const)("does not skip equal-timestamp roots when paging %s", async (direction) => {
    const { reader } = fixture();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await reader.fetchChannelMessages(channelId, {
        direction,
        limit: 1,
        cursor,
      });
      ids.push(...result.messages.map((message) => message.id));
      expect(ids.length).toBeLessThanOrEqual(5);
      cursor = result.nextCursor;
    } while (cursor);
    expect(ids).toEqual(
      (direction === "forward" ? roots : [...roots].reverse()).map(
        (message) => message.id
      )
    );
  });

  it("accepts legacy creation-time boundaries", async () => {
    const { reader } = fixture();
    const cursor = roots[2].createdDateTime;
    const forward = await reader.fetchChannelMessages(channelId, {
      direction: "forward",
      cursor,
    });
    const backward = await reader.fetchChannelMessages(channelId, {
      direction: "backward",
      cursor,
    });
    expect(forward.messages.map((message) => message.id)).toEqual([
      roots[3].id,
      roots[4].id,
    ]);
    expect(backward.messages.map((message) => message.id)).toEqual([
      roots[0].id,
      roots[1].id,
    ]);
    expect(forward.nextCursor).toBeUndefined();
    expect(backward.nextCursor).toBeUndefined();
  });

  it("continues activity-ordered thread pages through empty Graph pages", async () => {
    const { reader, graph } = fixture();
    const first = await reader.listThreads(channelId, { limit: 2 });
    expect(first.threads.map((thread) => thread.rootMessage.id)).toEqual([
      roots[0].id,
      roots[3].id,
    ]);
    expect(first.nextCursor).toBe(`${collectionUrl}?$skiptoken=1`);
    const second = await reader.listThreads(channelId, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.threads.map((thread) => thread.rootMessage.id)).toEqual([
      roots[2].id,
    ]);
    expect(second.nextCursor).toBe(`${collectionUrl}?$skiptoken=3`);
    const third = await reader.listThreads(channelId, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.threads.map((thread) => thread.rootMessage.id)).toEqual([
      roots[4].id,
      roots[1].id,
    ]);
    expect(third.nextCursor).toBeUndefined();
    expect(graph.call).toHaveBeenCalledTimes(1);
    expect(graph.http.get.mock.calls.map(([url]) => url)).toEqual(
      [1, 2, 3].map((page) => `${collectionUrl}?$skiptoken=${page}`)
    );
  });

  it.each([
    "groupChat",
    "personal",
  ] as const)("preserves %s history routing and timestamp cursors", async (conversationType) => {
    const conversationId = `a:${conversationType}`;
    const graph = {
      call: vi.fn(async () => ({ value: [roots[1], roots[0]] })),
    };
    const reader = new TeamsGraphReader({
      attachmentFetchers: createAttachmentFetchers(),
      botId: "test-app",
      graph: graph as unknown as GraphClient,
      formatConverter: new TeamsFormatConverter(),
      getGraphContext: async () => ({
        type: "dm",
        graphChatId: "19:personal-graph-chat@unq.gbl.spaces",
      }),
      logger: new ConsoleLogger("error"),
    });
    const result = await reader.fetchChannelMessages(
      encodeThreadId({
        conversationId,
        conversationType,
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      }),
      { limit: 2, cursor: roots[2].createdDateTime }
    );
    expect(graph.call).toHaveBeenCalledExactlyOnceWith(chats.messages.list, {
      "chat-id":
        conversationType === "groupChat"
          ? conversationId
          : "19:personal-graph-chat@unq.gbl.spaces",
      $top: 2,
      $orderby: ["createdDateTime desc"],
      $filter: `createdDateTime lt ${roots[2].createdDateTime}`,
    });
    expect(result.messages.map((message) => message.id)).toEqual([
      roots[0].id,
      roots[1].id,
    ]);
    expect(result.nextCursor).toBe(roots[0].createdDateTime);
  });

  it("uses edit timestamps instead of modification timestamps in channel history", async () => {
    const { reader, graph } = fixture();
    const modified = "2026-10-05T00:00:00Z";
    const value = [
      { ...roots[0], lastModifiedDateTime: modified, lastEditedDateTime: null },
      {
        ...roots[1],
        lastModifiedDateTime: modified,
        lastEditedDateTime: modified,
      },
    ];
    graph.call.mockResolvedValue({ value });
    const messages = await reader.fetchChannelMessages(channelId);
    expect(messages.messages.map((message) => message.metadata.edited)).toEqual(
      [false, true]
    );
    const threads = await reader.listThreads(channelId);
    expect(
      threads.threads.map((thread) => thread.rootMessage.metadata.edited)
    ).toEqual([false, true]);
  });

  it.each([
    "https://example.com/v1.0/teams/team-id/channels/channel/messages",
    "http://graph.microsoft.com/v1.0/teams/team-id/channels/channel/messages",
    "https://graph.microsoft.com/v1.0/users",
    "https://graph.microsoft.com/v1.0/teams/another-team/channels/channel/messages",
    "not a url",
    "https://graph.microsoft.com/v1.0/teams/team-id/channels/%E0%A4%A/messages",
  ])("rejects a continuation outside this Graph collection: %s", async (cursor) => {
    const { reader, graph } = fixture();
    await expect(reader.listThreads(channelId, { cursor })).rejects.toThrow(
      ValidationError
    );
    expect(graph.call).not.toHaveBeenCalled();
    expect(graph.http.get).not.toHaveBeenCalled();
  });

  it("accepts the unencoded channel ID form Graph documents for continuations", async () => {
    const { reader, graph } = fixture();
    const cursor = `https://graph.microsoft.com/v1.0/teams/TEAM-ID/channels/${context.channelId}/messages?$skiptoken=3`;
    const result = await reader.listThreads(channelId, { cursor });
    expect(result.threads.map((thread) => thread.rootMessage.id)).toEqual([
      roots[4].id,
      roots[1].id,
    ]);
    expect(graph.http.get).toHaveBeenCalledExactlyOnceWith(cursor);
  });

  it("follows Graph-issued continuations without matching them to the collection path", async () => {
    const { reader, graph } = fixture();
    const otherForm = "https://graph.microsoft.com/beta/teams/x/messages";
    graph.call.mockResolvedValueOnce({
      value: [roots[0]],
      "@odata.nextLink": `${otherForm}?$skiptoken=3`,
    });
    const result = await reader.fetchChannelMessages(channelId);
    expect(result.messages.map((message) => message.id)).toEqual([
      roots[0].id,
      roots[1].id,
      roots[4].id,
    ]);
    expect(graph.http.get).toHaveBeenCalledExactlyOnceWith(
      `${otherForm}?$skiptoken=3`
    );
  });
});

describe("channel reply pagination", () => {
  const context = {
    type: "channel" as const,
    teamId: "team-id",
    channelId: "19:channel@thread.tacv2",
  };
  const root = (id: number, day: number) => ({
    id: `179100000000${id}`,
    createdDateTime: `2026-10-0${day}T00:00:00Z`,
    body: { content: `Message ${id}`, contentType: "text" },
  });
  const messages = [root(1, 1), root(2, 2), root(3, 3), root(4, 4), root(5, 4)];
  const threadId = encodeThreadId({
    conversationId: `${context.channelId};messageid=${messages[0].id}`,
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  });

  function fixture() {
    const collection = `https://graph.microsoft.com/v1.0/teams/${context.teamId}/channels/${encodeURIComponent(context.channelId)}/messages/${messages[0].id}/replies`;
    const pages = [
      {
        value: [messages[4], messages[3]],
        "@odata.nextLink": `${collection}?$skiptoken=1`,
      },
      { value: [], "@odata.nextLink": `${collection}?$skiptoken=2` },
      { value: [messages[2], messages[1]] },
    ];
    const graph = {
      call: vi.fn(async (_endpoint: unknown, params: { $top?: number }) =>
        structuredClone(params.$top ? pages[0] : messages[0])
      ),
      http: {
        get: vi.fn(async (url: string) => ({
          data: structuredClone(
            pages[Number(new URL(url).searchParams.get("$skiptoken"))]
          ),
        })),
      },
    };
    return new TeamsGraphReader({
      attachmentFetchers: createAttachmentFetchers(),
      botId: "test-app",
      graph: graph as unknown as GraphClient,
      formatConverter: new TeamsFormatConverter(),
      getGraphContext: async () => context,
      logger: new ConsoleLogger("error"),
    });
  }

  it.each([
    "forward",
    "backward",
  ] as const)("does not skip equal-timestamp replies when paging %s", async (direction) => {
    const reader = fixture();
    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await reader.fetchMessages(threadId, {
        direction,
        limit: 1,
        cursor,
      });
      actual.push(...result.messages.map((message) => message.id));
      expect(actual.length).toBeLessThanOrEqual(messages.length);
      cursor = result.nextCursor;
    } while (cursor);
    expect(actual).toEqual(
      (direction === "forward" ? messages : [...messages].reverse()).map(
        (message) => message.id
      )
    );
  });

  it.each([
    "2026-10-01T00:00:00Z",
    "2026-09-30T00:00:00Z",
  ])("exhausts backward history at or before the parent boundary %s", async (cursor) => {
    const result = await fixture().fetchMessages(threadId, {
      direction: "backward",
      limit: 2,
      cursor,
    });
    expect(result.messages).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns replies when the parent message cannot be fetched", async () => {
    const graph = {
      call: vi.fn(async (_endpoint: unknown, params: { $top?: number }) => {
        if (!params.$top) {
          throw new Error("Not found");
        }
        return { value: [messages[2], messages[1]] };
      }),
    };
    const logger = new ConsoleLogger("error");
    const warn = vi.spyOn(logger, "warn");
    const reader = new TeamsGraphReader({
      attachmentFetchers: createAttachmentFetchers(),
      botId: "test-app",
      graph: graph as unknown as GraphClient,
      formatConverter: new TeamsFormatConverter(),
      getGraphContext: async () => context,
      logger,
    });

    const result = await reader.fetchMessages(threadId);

    expect(result.messages.map((message) => message.id)).toEqual([
      messages[1].id,
      messages[2].id,
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Failed to fetch parent message",
      expect.objectContaining({ threadMessageId: messages[0].id })
    );
  });
});

describe("inbound markdown budget", () => {
  const MARKDOWN = "**bold** with [a link](https://example.com)";
  const EMPHASIS = "*a".repeat(8192);
  const NESTED = ">".repeat(6000);
  const serviceUrl = "https://smba.trafficmanager.net/teams/";
  const channelContext = {
    teamId: "team-id",
    channelId: "19:channel@thread.tacv2",
  };

  async function createAdapter(content: string) {
    const state = createMockState();
    await state.set(
      `teams:channelContext:${channelContext.channelId}`,
      JSON.stringify(channelContext)
    );
    const adapter = createTeamsAdapter({
      appId: "bot-id",
      appPassword: "test",
      logger: new ConsoleLogger("error"),
    });
    const app = (adapter as unknown as { app: TeamsApp }).app;
    vi.spyOn(app, "initialize").mockResolvedValue(undefined);
    const call = vi.spyOn(app.graph, "call").mockResolvedValue({
      value: [
        {
          id: "1791000000001",
          createdDateTime: "2026-10-01T00:00:00Z",
          body: { content, contentType: "text" },
          from: { user: { id: "user-1", displayName: "Alice" } },
        },
      ],
    });
    await adapter.initialize(createMockChatInstance({ state }));
    return { adapter, call };
  }

  const groupChatId = encodeThreadId({
    conversationId: "a:group-chat-id",
    conversationType: "groupChat",
    serviceUrl,
  });

  const sources = [
    {
      source: "fetched chat history",
      endpoint: chats.messages.list,
      load: async (adapter: TeamsAdapter) =>
        (await adapter.fetchMessages(groupChatId)).messages[0],
    },
    {
      source: "chat thread roots",
      endpoint: chats.messages.list,
      load: async (adapter: TeamsAdapter) =>
        (await adapter.listThreads(groupChatId)).threads[0]?.rootMessage,
    },
    {
      source: "channel thread roots",
      endpoint: teams.channels.messages.list,
      load: async (adapter: TeamsAdapter) =>
        (
          await adapter.listThreads(
            encodeThreadId({
              conversationId: channelContext.channelId,
              serviceUrl,
            })
          )
        ).threads[0]?.rootMessage,
    },
  ];

  describe.each(sources)("$source", ({ endpoint, load }) => {
    it("parses markdown into formatting nodes", async () => {
      const { adapter, call } = await createAdapter(MARKDOWN);
      const message = await load(adapter);

      expect(call).toHaveBeenCalledWith(endpoint, expect.anything());
      expect(message?.text).toBe(MARKDOWN);
      expect(message?.formatted.children).toMatchObject([
        {
          type: "paragraph",
          children: [
            { type: "strong", children: [{ type: "text", value: "bold" }] },
            { type: "text", value: " with " },
            {
              type: "link",
              url: "https://example.com",
              children: [{ type: "text", value: "a link" }],
            },
          ],
        },
      ]);
    });

    it.each([
      ["too many emphasis markers", EMPHASIS],
      ["a line opening too many blockquotes", NESTED],
    ])("keeps a message with %s verbatim", async (_case, value) => {
      const { adapter, call } = await createAdapter(value);
      const message = await load(adapter);

      expect(call).toHaveBeenCalledWith(endpoint, expect.anything());
      expect(message?.text).toBe(value);
      expect(message?.formatted).toEqual({
        type: "root",
        children: [{ type: "paragraph", children: [{ type: "text", value }] }],
      });
      expect(() => JSON.stringify(message?.formatted)).not.toThrow();
    });

    it("checks the budget after decoding entities", async () => {
      const value = `&gt;${"- ".repeat(8000)}a`;
      const decoded = `>${"- ".repeat(8000)}a`;
      const toAst = vi.spyOn(TeamsFormatConverter.prototype, "toAst");
      try {
        const { adapter } = await createAdapter(value);
        const message = await load(adapter);

        expect(message?.text).toBe(value);
        expect(message?.formatted).toEqual({
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: decoded }],
            },
          ],
        });
        expect(toAst).not.toHaveBeenCalled();
      } finally {
        toAst.mockRestore();
      }
    });

    it("still parses an encoded blockquote under the budget", async () => {
      const { adapter } = await createAdapter("&gt; quoted");
      const message = await load(adapter);

      expect(message?.formatted.children).toMatchObject([
        {
          type: "blockquote",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "quoted" }],
            },
          ],
        },
      ]);
    });

    it("renders a skipped message as plain text", async () => {
      const brackets = "[x]".repeat(513);
      const { adapter } = await createAdapter(
        `<at>Bot</at> Tom &amp; Jerry &lt;3 ${brackets}`
      );
      const message = await load(adapter);

      expect(message?.formatted).toEqual({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: `@Bot Tom & Jerry <3 ${brackets}` },
            ],
          },
        ],
      });
    });
  });
});
