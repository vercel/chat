import { ValidationError } from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
  threadIdContract,
} from "@chat-adapter/tests";
import { Chat, type Message, parseMarkdown } from "chat";
import { createChatTools } from "chat/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNotionAdapter,
  type NotionAdapter,
  type NotionComment,
  type NotionWebhookEvent,
} from "./index";
import {
  buildAggregatedEventsEnvelope,
  buildCommentCreatedEvent,
  buildSignedNotionWebhook,
} from "./testing";
import type { NotionRichText } from "./types";
import { chunkMarkdown, signNotionBody } from "./utils";

const PAGE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DISCUSSION_ID = "11111111-2222-3333-4444-555555555555";
const COMMENT_ID = "99999999-8888-7777-6666-555555555555";
const BOT_USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PERSON_USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const VERIFICATION_TOKEN = "secret_test_verification_token";
const TOKEN = "ntn_test_token";
const REACTIONS_ERROR = /reactions/;
const EDIT_PERMISSION_ERROR = /edit this comment/;
const DELETE_PERMISSION_ERROR = /delete this comment/;
const FILE_UPLOAD_SEND_ID_RE = /file_uploads\/([^/]+)\/send/;
const FOREIGN_PAGE_ID = "eeeeeeee-1111-2222-3333-444444444444";
const FOREIGN_DISCUSSION_ID = "22222222-3333-4444-5555-666666666666";
const FOREIGN_COMMENT_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const FOREIGN_BLOCK_ID = "33333333-4444-5555-6666-777777777777";
const PAGE_BLOCK_ID = "44444444-5555-6666-7777-888888888888";
const OTHER_DISCUSSION_ID = "55555555-6666-7777-8888-999999999999";
const API_BASE_URL = "https://api.notion.test/v1";
const COMMENT_PATH_RE = /^\/comments\/([^/]+)$/;
const BLOCK_PATH_RE = /^\/blocks\/([^/]+)$/;
const NOT_ON_PAGE_ERROR = /does not belong to page/;
const UNCONFIRMED_DISCUSSION_ERROR = /Could not confirm Notion discussion/;

function fixtureComment(overrides: Partial<NotionComment> = {}): NotionComment {
  return {
    object: "comment",
    id: COMMENT_ID,
    parent: { type: "page_id", page_id: PAGE_ID },
    discussion_id: DISCUSSION_ID,
    created_time: "2026-07-01T12:00:00.000Z",
    last_edited_time: "2026-07-01T12:00:00.000Z",
    created_by: {
      object: "user",
      id: PERSON_USER_ID,
      name: "Alice",
      type: "person",
    },
    rich_text: [
      {
        type: "text",
        plain_text: "Hello bot",
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
        text: { content: "Hello bot" },
      },
    ],
    ...overrides,
  };
}

function fixtureCommentCreatedEvent(
  overrides: Partial<NotionWebhookEvent> = {}
): NotionWebhookEvent {
  return {
    id: "event-1",
    timestamp: "2026-07-01T12:00:00.000Z",
    workspace_id: "ws-1",
    subscription_id: "sub-1",
    integration_id: "int-1",
    type: "comment.created",
    entity: { id: COMMENT_ID, type: "comment" },
    data: {
      page_id: PAGE_ID,
      parent: { id: PAGE_ID, type: "page" },
    },
    ...overrides,
  };
}

function signedRequest(
  body: unknown,
  token = VERIFICATION_TOKEN,
  headers: Record<string, string> = {}
): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://example.com/api/webhooks/notion", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-notion-signature": signNotionBody(raw, token),
      ...headers,
    },
    body: raw,
  });
}

function createTestAdapter(
  overrides: ConstructorParameters<typeof NotionAdapter>[0] = {}
): NotionAdapter {
  return createNotionAdapter({
    token: TOKEN,
    verificationToken: VERIFICATION_TOKEN,
    logger: createMockLogger(),
    apiBaseUrl: "https://api.notion.test/v1",
    ...overrides,
  });
}

describe("createNotionAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NOTION_TOKEN = undefined;
    process.env.NOTION_VERIFICATION_TOKEN = undefined;
    process.env.NOTION_MENTION_MODE = undefined;
    process.env.NOTION_KEYWORDS = undefined;
    process.env.NOTION_BOT_USERNAME = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates from explicit config", () => {
    const adapter = createTestAdapter();
    expect(adapter.name).toBe("notion");
    expect(adapter.userName).toBe("notion-bot");
  });

  it("accepts an async token resolver", () => {
    const adapter = createTestAdapter({
      token: async () => TOKEN,
    });
    expect(adapter.name).toBe("notion");
  });

  it("throws ValidationError when token missing", () => {
    expect(() =>
      createNotionAdapter({ verificationToken: VERIFICATION_TOKEN })
    ).toThrow(ValidationError);
  });

  it("allows construction without verificationToken for handshake bootstrap", () => {
    const adapter = createNotionAdapter({
      token: TOKEN,
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("notion");
  });

  it("reads credentials from env", () => {
    process.env.NOTION_TOKEN = TOKEN;
    process.env.NOTION_VERIFICATION_TOKEN = VERIFICATION_TOKEN;
    process.env.NOTION_BOT_USERNAME = "docs-bot";
    const adapter = createNotionAdapter();
    expect(adapter.userName).toBe("docs-bot");
  });

  it("reads mentionMode and keywords from env", () => {
    process.env.NOTION_TOKEN = TOKEN;
    process.env.NOTION_VERIFICATION_TOKEN = VERIFICATION_TOKEN;
    process.env.NOTION_MENTION_MODE = "keyword";
    process.env.NOTION_KEYWORDS = "@docs, help";
    const adapter = createNotionAdapter({ logger: createMockLogger() });
    expect(
      (adapter as NotionAdapter & { mentionMode: string }).mentionMode
    ).toBe("keyword");
    expect(
      (adapter as NotionAdapter & { keywords: string[] }).keywords
    ).toEqual(["@docs", "help"]);
  });

  it("falls back to mention on invalid NOTION_MENTION_MODE", () => {
    process.env.NOTION_TOKEN = TOKEN;
    process.env.NOTION_VERIFICATION_TOKEN = VERIFICATION_TOKEN;
    process.env.NOTION_MENTION_MODE = "nope";
    const logger = createMockLogger();
    const adapter = createNotionAdapter({ logger });
    expect(
      (adapter as NotionAdapter & { mentionMode: string }).mentionMode
    ).toBe("mention");
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("config overrides env for mentionMode", () => {
    process.env.NOTION_TOKEN = TOKEN;
    process.env.NOTION_VERIFICATION_TOKEN = VERIFICATION_TOKEN;
    process.env.NOTION_MENTION_MODE = "all-comments";
    const adapter = createNotionAdapter({
      mentionMode: "mention",
      logger: createMockLogger(),
    });
    expect(
      (adapter as NotionAdapter & { mentionMode: string }).mentionMode
    ).toBe("mention");
  });
});

describe("token resolver initialization", () => {
  it("uses the resolved token to load the bot identity", async () => {
    const token = vi.fn().mockResolvedValue("notion-connect-token");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        object: "user",
        id: BOT_USER_ID,
        name: "Docs Bot",
        avatar_url: null,
        type: "bot",
        bot: { workspace_id: "ws-1", workspace_name: "Acme" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const adapter = createTestAdapter({ token });
      await adapter.initialize(createMockChatInstance() as never);

      expect(token).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.notion.test/v1/users/me",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer notion-connect-token",
          }),
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

threadIdContract({
  name: "notion",
  encode: (d) => createTestAdapter().encodeThreadId(d),
  decode: (id) => createTestAdapter().decodeThreadId(id),
  cases: [
    {
      decoded: { pageId: PAGE_ID },
      encoded: `notion:${PAGE_ID}`,
    },
    {
      decoded: { pageId: PAGE_ID, discussionId: DISCUSSION_ID },
      encoded: `notion:${PAGE_ID}:${DISCUSSION_ID}`,
    },
    {
      decoded: {
        pageId: PAGE_ID,
        blockId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      },
      encoded: `notion:${PAGE_ID}:block:dddddddd-dddd-dddd-dddd-dddddddddddd`,
    },
  ],
});

describe("UUID normalization", () => {
  it("normalizes compact UUIDs on decode", () => {
    const adapter = createTestAdapter();
    const compact = PAGE_ID.replace(/-/g, "");
    expect(adapter.decodeThreadId(`notion:${compact}`)).toEqual({
      pageId: PAGE_ID,
    });
  });

  it("rejects malformed thread IDs", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("notion:not-a-uuid")).toThrow(
      ValidationError
    );
    expect(() => adapter.decodeThreadId("slack:C123")).toThrow(ValidationError);
  });

  it("prefers discussionId over blockId when encoding", () => {
    const adapter = createTestAdapter();
    const blockId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    expect(
      adapter.encodeThreadId({
        pageId: PAGE_ID,
        discussionId: DISCUSSION_ID,
        blockId,
      })
    ).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);
  });

  it("channelIdFromThreadId ignores block segment", () => {
    const adapter = createTestAdapter();
    const blockId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    expect(
      adapter.channelIdFromThreadId(`notion:${PAGE_ID}:block:${blockId}`)
    ).toBe(`notion:${PAGE_ID}`);
  });
});

describe("handleWebhook", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs verification_token handshake and returns 200", async () => {
    const logger = createMockLogger();
    const adapter = createTestAdapter({ logger });
    const res = await adapter.handleWebhook(
      new Request("https://example.com/api/webhooks/notion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verification_token: "secret_from_notion" }),
      })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    const warnMsg = String(vi.mocked(logger.warn).mock.calls[0]?.[0] ?? "");
    expect(warnMsg).toContain("secret_from_notion");
    expect(warnMsg).toContain("URL is locked");
  });

  it("returns 401 for invalid signature", async () => {
    const adapter = createTestAdapter();
    const body = JSON.stringify(fixtureCommentCreatedEvent());
    const res = await adapter.handleWebhook(
      new Request("https://example.com/api/webhooks/notion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-notion-signature": "sha256=deadbeef",
        },
        body,
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for missing signature", async () => {
    const adapter = createTestAdapter();
    const body = JSON.stringify(fixtureCommentCreatedEvent());
    const res = await adapter.handleWebhook(
      new Request("https://example.com/api/webhooks/notion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for signed events when verificationToken is unset", async () => {
    const adapter = createNotionAdapter({
      token: TOKEN,
      logger: createMockLogger(),
      apiBaseUrl: "https://api.notion.test/v1",
    });
    const event = fixtureCommentCreatedEvent();
    const res = await adapter.handleWebhook(
      signedRequest(event, VERIFICATION_TOKEN)
    );
    expect(res.status).toBe(401);
  });

  it("dispatches comment.created via lazy factory and returns 200", async () => {
    const comment = fixtureComment({
      rich_text: [
        {
          type: "mention",
          plain_text: "@notion-bot",
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: "default",
          },
          mention: {
            type: "user",
            user: { object: "user", id: BOT_USER_ID },
          },
        },
        {
          type: "text",
          plain_text: " please help",
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: "default",
          },
          text: { content: " please help" },
        },
      ],
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Docs Bot",
          avatar_url: null,
          type: "bot",
          bot: { workspace_id: "ws-1", workspace_name: "Acme" },
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const event = fixtureCommentCreatedEvent();
    const res = await adapter.handleWebhook(signedRequest(event));
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);

    const [passedAdapter, threadId, factory] = chat.processMessage.mock
      .calls[0] as [NotionAdapter, string, () => Promise<unknown>];
    expect(passedAdapter).toBe(adapter);
    expect(threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);
    expect(typeof factory).toBe("function");

    const message = (await factory()) as {
      id: string;
      text: string;
      isMention?: boolean;
      author: { isMe: boolean };
    };
    expect(message.id).toBe(COMMENT_ID);
    expect(message.text).toContain("please help");
    expect(message.isMention).toBe(true);
    expect(message.author.isMe).toBe(false);
  });

  it("dedupes on event id", async () => {
    const comment = fixtureComment();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const event = fixtureCommentCreatedEvent({ id: "same-event" });
    expect((await adapter.handleWebhook(signedRequest(event))).status).toBe(
      200
    );
    expect((await adapter.handleWebhook(signedRequest(event))).status).toBe(
      200
    );
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });

  it("does not permanently dedupe after transient fetch failure", async () => {
    const comment = fixtureComment();
    let commentFetches = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        commentFetches += 1;
        if (commentFetches === 1) {
          return new Response("upstream error", { status: 500 });
        }
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const event = fixtureCommentCreatedEvent({ id: "retry-event" });
    expect((await adapter.handleWebhook(signedRequest(event))).status).toBe(
      500
    );
    expect(chat.processMessage).not.toHaveBeenCalled();

    expect((await adapter.handleWebhook(signedRequest(event))).status).toBe(
      200
    );
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });

  it("fans out defensive batched events envelope via testing builders", async () => {
    const comment = fixtureComment();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes("/comments/")) {
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const batch = buildAggregatedEventsEnvelope([
      buildCommentCreatedEvent({ id: "e1" }),
      buildCommentCreatedEvent({
        id: "e2",
        entity: { id: COMMENT_ID, type: "comment" },
      }),
    ]);
    const res = await adapter.handleWebhook(
      buildSignedNotionWebhook(batch, VERIFICATION_TOKEN)
    );
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(2);
  });

  it("drops comment.created when comment fetch returns 404", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      return new Response("gone", { status: 404 });
    });

    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const res = await adapter.handleWebhook(
      signedRequest(fixtureCommentCreatedEvent())
    );
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("marks bot-authored comments as isMe", async () => {
    const comment = fixtureComment({
      created_by: {
        object: "user",
        id: BOT_USER_ID,
        name: "Docs Bot",
        type: "bot",
      },
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Docs Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    await adapter.handleWebhook(signedRequest(fixtureCommentCreatedEvent()));
    const factory = chat.processMessage.mock.calls[0]?.[2] as () => Promise<{
      author: { isMe: boolean; isBot: boolean };
      isMention?: boolean;
    }>;
    const message = await factory();
    expect(message.author.isMe).toBe(true);
    expect(message.author.isBot).toBe(true);
    expect(message.isMention).toBe(false);
  });

  it("returns 200 for page.* events without processMessage", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        object: "user",
        id: BOT_USER_ID,
        name: "Bot",
        avatar_url: null,
        type: "bot",
        bot: {},
      })
    );
    const adapter = createTestAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const res = await adapter.handleWebhook(
      signedRequest({
        id: "page-event",
        timestamp: "2026-07-01T12:00:00.000Z",
        workspace_id: "ws-1",
        subscription_id: "sub-1",
        integration_id: "int-1",
        type: "page.content_updated",
        entity: { id: PAGE_ID, type: "page" },
        data: {},
      })
    );
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});

describe("mentionMode", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function dispatchWith(
    adapter: NotionAdapter,
    comment: NotionComment
  ): Promise<{ isMention?: boolean }> {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      return Response.json(comment);
    });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);
    await adapter.handleWebhook(signedRequest(fixtureCommentCreatedEvent()));
    const factory = chat.processMessage.mock.calls[0]?.[2] as () => Promise<{
      isMention?: boolean;
    }>;
    return factory();
  }

  it("keyword mode matches word boundaries", async () => {
    const adapter = createTestAdapter({
      mentionMode: "keyword",
      keywords: ["@docs", "help"],
    });
    const message = await dispatchWith(
      adapter,
      fixtureComment({
        rich_text: [
          {
            type: "text",
            plain_text: "please HELP me",
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
            text: { content: "please HELP me" },
          },
        ],
      })
    );
    expect(message.isMention).toBe(true);
  });

  it("keyword mode leaves comments without a keyword undetermined", async () => {
    const adapter = createTestAdapter({
      mentionMode: "keyword",
      keywords: ["deploy"],
    });
    const message = await dispatchWith(
      adapter,
      fixtureComment({
        rich_text: [
          {
            type: "text",
            plain_text: "hey @docs-bot can you look",
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
            text: { content: "hey @docs-bot can you look" },
          },
        ],
      })
    );
    // Not false: the SDK still gets to match @userName in the text.
    expect(message.isMention).toBeUndefined();
  });

  it("all-comments mode treats every non-bot comment as mention", async () => {
    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const message = await dispatchWith(adapter, fixtureComment());
    expect(message.isMention).toBe(true);
  });

  it("mention mode matches plain-text @userName", async () => {
    const adapter = createTestAdapter({
      mentionMode: "mention",
      userName: "docs-bot",
    });
    const message = await dispatchWith(
      adapter,
      fixtureComment({
        rich_text: [
          {
            type: "text",
            plain_text: "hey @docs-bot can you help?",
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
            text: { content: "hey @docs-bot can you help?" },
          },
        ],
      })
    );
    expect(message.isMention).toBe(true);
  });

  it("mention mode matches plain-text @botUserId", async () => {
    const adapter = createTestAdapter({ mentionMode: "mention" });
    const message = await dispatchWith(
      adapter,
      fixtureComment({
        rich_text: [
          {
            type: "text",
            plain_text: `@${BOT_USER_ID} please look`,
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
            text: { content: `@${BOT_USER_ID} please look` },
          },
        ],
      })
    );
    expect(message.isMention).toBe(true);
  });

  it("mention mode does not match without @userName or @botUserId", async () => {
    const adapter = createTestAdapter({
      mentionMode: "mention",
      userName: "docs-bot",
    });
    const message = await dispatchWith(adapter, fixtureComment());
    expect(message.isMention).toBe(false);
  });
});

describe("unsupported operations", () => {
  it("addReaction / removeReaction throw NotImplementedError", async () => {
    const adapter = createTestAdapter();
    await expect(
      adapter.addReaction(`notion:${PAGE_ID}`, COMMENT_ID, "👍")
    ).rejects.toThrow(REACTIONS_ERROR);
    await expect(
      adapter.removeReaction(`notion:${PAGE_ID}`, COMMENT_ID, "👍")
    ).rejects.toThrow(REACTIONS_ERROR);
  });

  it("startTyping is a no-op", async () => {
    const adapter = createTestAdapter();
    await expect(
      adapter.startTyping(`notion:${PAGE_ID}`)
    ).resolves.toBeUndefined();
  });
});

describe.each([
  "edit",
  "delete",
] as const)("%s comment ownership", (operation) => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const mutate = (adapter: NotionAdapter, threadId: string) =>
    operation === "edit"
      ? adapter.editMessage(threadId, COMMENT_ID, "Updated")
      : adapter.deleteMessage(threadId, COMMENT_ID);

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockImplementation(async () => Response.json(fixtureComment()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a comment on another page before mutation", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        fixtureComment({ parent: { type: "page_id", page_id: BOT_USER_ID } })
      )
    );
    await expect(
      mutate(createTestAdapter(), `notion:${PAGE_ID}`)
    ).rejects.toThrow(ValidationError);
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => (init as RequestInit).method === "GET"
      )
    ).toBe(true);
  });

  it("rejects another discussion on the same page", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(fixtureComment({ discussion_id: BOT_USER_ID }))
    );
    await expect(
      mutate(createTestAdapter(), `notion:${PAGE_ID}:${DISCUSSION_ID}`)
    ).rejects.toThrow(ValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    `notion:${PAGE_ID}`,
    `notion:${PAGE_ID}:${DISCUSSION_ID}`,
  ])("allows a comment in %s", async (threadId) => {
    await mutate(createTestAdapter(), threadId);
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", operation === "edit" ? "PATCH" : "DELETE"]);
  });

  it("normalizes the comment parent and discussion IDs", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        fixtureComment({
          parent: {
            type: "page_id",
            page_id: PAGE_ID.replaceAll("-", "").toUpperCase(),
          },
          discussion_id: DISCUSSION_ID.replaceAll("-", ""),
        })
      )
    );
    await mutate(createTestAdapter(), `notion:${PAGE_ID}:${DISCUSSION_ID}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing comment without mutation", async () => {
    fetchMock.mockImplementation(
      async () => new Response("not found", { status: 404 })
    );
    await expect(
      mutate(createTestAdapter(), `notion:${PAGE_ID}`)
    ).rejects.toThrow(ValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid message ID before requesting Notion", async () => {
    const adapter = createTestAdapter();
    const result =
      operation === "edit"
        ? adapter.editMessage(`notion:${PAGE_ID}`, "../pages/other", "Updated")
        : adapter.deleteMessage(`notion:${PAGE_ID}`, "../pages/other");
    await expect(result).rejects.toThrow(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mutate when block ownership cannot be retrieved", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/blocks/")
        ? new Response("forbidden", { status: 403 })
        : Response.json(
            fixtureComment({
              parent: { type: "block_id", block_id: PERSON_USER_ID },
            })
          )
    );
    await expect(
      mutate(createTestAdapter(), `notion:${PAGE_ID}:${DISCUSSION_ID}`)
    ).rejects.toThrow();
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", "GET"]);
  });

  it("rejects a page-level thread when a block ancestor is not found", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/blocks/")
        ? new Response("not found", { status: 404 })
        : Response.json(
            fixtureComment({
              parent: { type: "block_id", block_id: PERSON_USER_ID },
            })
          )
    );
    await expect(
      mutate(createTestAdapter(), `notion:${PAGE_ID}`)
    ).rejects.toThrow("Comment does not belong to this thread");
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", "GET"]);
  });

  it("verifies the current page of a block despite a stale cached page", async () => {
    const block = PERSON_USER_ID;
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(
        String(url).includes("/blocks/")
          ? { id: block, parent: { type: "page_id", page_id: BOT_USER_ID } }
          : fixtureComment({ parent: { type: "block_id", block_id: block } })
      )
    );
    const adapter = createTestAdapter();
    (
      adapter as unknown as { blockPageCache: Map<string, string> }
    ).blockPageCache.set(block, PAGE_ID);
    await expect(
      mutate(adapter, `notion:${PAGE_ID}:${DISCUSSION_ID}`)
    ).rejects.toThrow(ValidationError);
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", "GET"]);
  });

  it("allows a comment on a nested block in the requested page", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith(`/blocks/${PERSON_USER_ID}`)) {
        return Response.json({
          parent: { type: "block_id", block_id: BOT_USER_ID },
        });
      }
      if (String(url).endsWith(`/blocks/${BOT_USER_ID}`)) {
        return Response.json({ parent: { type: "page_id", page_id: PAGE_ID } });
      }
      return Response.json(
        fixtureComment({
          parent: { type: "block_id", block_id: PERSON_USER_ID },
        })
      );
    });
    await mutate(
      createTestAdapter(),
      `notion:${PAGE_ID}:block:${PERSON_USER_ID}`
    );
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", "GET", "GET", operation === "edit" ? "PATCH" : "DELETE"]);
  });

  it("walks a nested block for a page-level thread and refreshes the cache", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith(`/blocks/${PERSON_USER_ID}`)) {
        return Response.json({
          parent: { type: "block_id", block_id: BOT_USER_ID },
        });
      }
      if (String(url).endsWith(`/blocks/${BOT_USER_ID}`)) {
        return Response.json({ parent: { type: "page_id", page_id: PAGE_ID } });
      }
      return Response.json(
        fixtureComment({
          parent: { type: "block_id", block_id: PERSON_USER_ID },
        })
      );
    });
    const adapter = createTestAdapter();
    const cache = (
      adapter as unknown as { blockPageCache: Map<string, string> }
    ).blockPageCache;
    cache.set(PERSON_USER_ID, DISCUSSION_ID);
    await mutate(adapter, `notion:${PAGE_ID}`);
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", "GET", "GET", operation === "edit" ? "PATCH" : "DELETE"]);
    expect(cache.get(PERSON_USER_ID)).toBe(PAGE_ID);
    expect(cache.get(BOT_USER_ID)).toBe(PAGE_ID);
  });

  it("rejects a synced block comment whose ancestry leads to another page", async () => {
    const otherPage = PERSON_USER_ID;
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(
        String(url).includes("/blocks/")
          ? { parent: { type: "page_id", page_id: PAGE_ID } }
          : fixtureComment({
              parent: { type: "block_id", block_id: BOT_USER_ID },
            })
      )
    );
    await expect(
      mutate(createTestAdapter(), `notion:${otherPage}:${DISCUSSION_ID}`)
    ).rejects.toThrow(ValidationError);
    expect(
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    ).toEqual(["GET", "GET"]);
  });

  it("rejects a comment on another block in the requested page", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(
        String(url).includes("/blocks/")
          ? { parent: { type: "page_id", page_id: PAGE_ID } }
          : fixtureComment({
              parent: { type: "block_id", block_id: PERSON_USER_ID },
            })
      )
    );
    await expect(
      mutate(createTestAdapter(), `notion:${PAGE_ID}:block:${BOT_USER_ID}`)
    ).rejects.toThrow(ValidationError);
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => (init as RequestInit).method === "GET"
      )
    ).toBe(true);
  });

  it.each([
    {
      shape: "discussion",
      threadId: `notion:${PAGE_ID}:${DISCUSSION_ID}`,
      comment: fixtureComment({
        parent: { type: "page_id", page_id: BOT_USER_ID },
      }),
    },
    {
      shape: "block",
      threadId: `notion:${PAGE_ID}:block:${PERSON_USER_ID}`,
      comment: fixtureComment({
        parent: { type: "block_id", block_id: PERSON_USER_ID },
      }),
    },
  ])("blocks a foreign $shape comment through the scoped public tool", async ({
    threadId,
    comment,
  }) => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({ id: BOT_USER_ID, type: "bot", bot: {} });
      }
      if (String(url).includes("/blocks/")) {
        return Response.json({
          parent: { type: "page_id", page_id: BOT_USER_ID },
        });
      }
      return Response.json(comment);
    });
    const adapter = createTestAdapter();
    const chat = new Chat({
      userName: "test-bot",
      adapters: { notion: adapter },
      state: createMockState(),
      logger: createMockLogger(),
    });
    await chat.initialize();
    fetchMock.mockClear();
    try {
      const tools = createChatTools({
        chat,
        scope: `notion:${PAGE_ID}`,
        strictScope: true,
        requireApproval: false,
      });
      const input = { threadId, messageId: COMMENT_ID, message: "Updated" };
      const tool =
        operation === "edit" ? tools.editMessage : tools.deleteMessage;
      await expect(
        tool?.execute?.(input, { toolCallId: "ownership", messages: [] })
      ).rejects.toThrow("Comment does not belong to this thread");
      expect(
        fetchMock.mock.calls.every(
          ([, init]) => (init as RequestInit).method === "GET"
        )
      ).toBe(true);
    } finally {
      await chat.shutdown();
    }
  });

  it("blocks a foreign comment through the scoped public tool", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(
        String(url).endsWith("/users/me")
          ? { id: BOT_USER_ID, type: "bot", bot: {} }
          : fixtureComment({
              parent: { type: "page_id", page_id: BOT_USER_ID },
            })
      )
    );
    const adapter = createTestAdapter();
    const chat = new Chat({
      userName: "test-bot",
      adapters: { notion: adapter },
      state: createMockState(),
      logger: createMockLogger(),
    });
    await chat.initialize();
    fetchMock.mockClear();
    try {
      const tools = createChatTools({
        chat,
        scope: `notion:${PAGE_ID}`,
        strictScope: true,
        requireApproval: false,
      });
      const input = {
        threadId: `notion:${PAGE_ID}`,
        messageId: COMMENT_ID,
        message: "Updated",
      };
      const tool =
        operation === "edit" ? tools.editMessage : tools.deleteMessage;
      await expect(
        tool?.execute?.(input, { toolCallId: "ownership", messages: [] })
      ).rejects.toThrow("Comment does not belong to this thread");
      expect(
        fetchMock.mock.calls.every(
          ([, init]) => (init as RequestInit).method === "GET"
        )
      ).toBe(true);
    } finally {
      await chat.shutdown();
    }
  });
});

describe("postMessage / editMessage / deleteMessage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts page-level comment with markdown body", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        fixtureComment({
          id: "new-comment-id",
          discussion_id: DISCUSSION_ID,
        })
      )
    );
    const adapter = createTestAdapter();
    const result = await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "**hello**",
    });
    expect(result.id).toBe("new-comment-id");
    expect(result.threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.parent).toEqual({ page_id: PAGE_ID });
    expect(body.markdown).toContain("hello");
    expect(init.headers).toMatchObject({
      "Notion-Version": "2026-03-11",
    });
  });

  it("resolves a fresh token for each API request", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json(fixtureComment()))
    );
    const token = vi
      .fn()
      .mockResolvedValueOnce("notion-token-1")
      .mockResolvedValueOnce("notion-token-2");
    const adapter = createTestAdapter({ token });

    await adapter.postMessage(`notion:${PAGE_ID}`, "first");
    await adapter.postMessage(`notion:${PAGE_ID}`, "second");

    expect(token).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) => {
        const headers = (init as RequestInit).headers as Record<string, string>;
        return headers.Authorization;
      })
    ).toEqual(["Bearer notion-token-1", "Bearer notion-token-2"]);
  });

  it("rejects an empty resolved token before calling Notion", async () => {
    const adapter = createTestAdapter({ token: async () => "" });

    await expect(
      adapter.postMessage(`notion:${PAGE_ID}`, "hello")
    ).rejects.toThrow("token resolver returned an empty token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replies with discussion_id", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      Response.json(
        init?.method === "POST"
          ? fixtureComment()
          : { object: "list", results: [fixtureComment()], has_more: false }
      )
    );
    const adapter = createTestAdapter();
    await adapter.postMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, "reply");
    const [, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit).method === "POST"
    ) as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.discussion_id).toBe(DISCUSSION_ID);
    expect(body.parent).toBeUndefined();
  });

  it("splits an over-long body into sequential threaded comments", async () => {
    let call = 0;
    fetchMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        Response.json(
          fixtureComment({ id: `chunk-${call}`, discussion_id: DISCUSSION_ID })
        )
      );
    });

    const adapter = createTestAdapter();
    // Three ~1000-char paragraphs — must split across multiple comments.
    const paragraph = "x".repeat(1000);
    const long = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;

    const result = await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: long,
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    const bodies = fetchMock.mock.calls.map((c) => {
      const init = c[1] as RequestInit;
      return JSON.parse(String(init.body));
    });

    // First chunk opens the page-level discussion; the rest reply into it.
    expect(bodies[0].parent).toEqual({ page_id: PAGE_ID });
    for (const body of bodies.slice(1)) {
      expect(body.discussion_id).toBe(DISCUSSION_ID);
      expect(body.parent).toBeUndefined();
    }
    // Every chunk stays under the per-comment ceiling.
    for (const body of bodies) {
      expect(body.markdown.length).toBeLessThanOrEqual(1900);
    }
    // Returned message is the head (first) comment.
    expect(result.id).toBe("chunk-1");
    expect(result.threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);
  });

  it("maps edit 404 to PermissionError", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(fixtureComment()))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const adapter = createTestAdapter();
    await expect(
      adapter.editMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, COMMENT_ID, "x")
    ).rejects.toThrow(EDIT_PERMISSION_ERROR);
  });

  it("maps delete 404 to PermissionError", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(fixtureComment()))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const adapter = createTestAdapter();
    await expect(
      adapter.deleteMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, COMMENT_ID)
    ).rejects.toThrow(DELETE_PERMISSION_ERROR);
  });

  it("retries on 429 Retry-After then succeeds", async () => {
    vi.useFakeTimers();
    const token = vi
      .fn()
      .mockResolvedValueOnce("notion-token-1")
      .mockResolvedValueOnce("notion-token-2");
    fetchMock
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        })
      )
      .mockResolvedValueOnce(Response.json(fixtureComment()));

    const adapter = createTestAdapter({ token });
    const promise = adapter.postMessage(`notion:${PAGE_ID}`, "hi");
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;
    expect(result.id).toBe(COMMENT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(token).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) => {
        const headers = (init as RequestInit).headers as Record<string, string>;
        return headers.Authorization;
      })
    ).toEqual(["Bearer notion-token-1", "Bearer notion-token-2"]);
    vi.useRealTimers();
  });

  it("parses Retry-After HTTP-date without sleeping NaN", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    fetchMock
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: {
            "retry-after": "Wed, 01 Jul 2026 12:00:02 GMT",
          },
        })
      )
      .mockResolvedValueOnce(Response.json(fixtureComment()));

    const adapter = createTestAdapter();
    const promise = adapter.postMessage(`notion:${PAGE_ID}`, "hi");
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;
    expect(result.id).toBe(COMMENT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("uploads a file and attaches it on postMessage", async () => {
    const token = vi
      .fn()
      .mockResolvedValueOnce("notion-create-token")
      .mockResolvedValueOnce("notion-upload-token")
      .mockResolvedValueOnce("notion-comment-token");
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        return Promise.resolve(
          Response.json({
            id: "fu-1",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.includes("/file_uploads/fu-1/send")) {
        return Promise.resolve(
          Response.json({
            id: "fu-1",
            object: "file_upload",
            status: "uploaded",
          })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter({ token });
    await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      files: [
        {
          filename: "a.png",
          data: Buffer.from("x"),
          mimeType: "image/png",
        },
      ],
    });

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(commentCall).toBeDefined();
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toEqual([
      { type: "file_upload", file_upload_id: "fu-1" },
    ]);
    expect(body.markdown).toContain("hi");
    expect(body.markdown).not.toContain("a.png");
    expect(token).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(([, init]) => {
        const headers = (init as RequestInit).headers as Record<string, string>;
        return headers.Authorization;
      })
    ).toEqual([
      "Bearer notion-create-token",
      "Bearer notion-upload-token",
      "Bearer notion-comment-token",
    ]);
  });

  it("attaches first 3 files and links the 4th on overflow", async () => {
    let uploadIndex = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        uploadIndex += 1;
        return Promise.resolve(
          Response.json({
            id: `fu-${uploadIndex}`,
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.includes("/file_uploads/") && path.endsWith("/send")) {
        const id = path.match(FILE_UPLOAD_SEND_ID_RE)?.[1] ?? "fu";
        return Promise.resolve(
          Response.json({ id, object: "file_upload", status: "uploaded" })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter();
    await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      files: [
        { filename: "a.png", data: Buffer.from("1"), mimeType: "image/png" },
        { filename: "b.png", data: Buffer.from("2"), mimeType: "image/png" },
        { filename: "c.png", data: Buffer.from("3"), mimeType: "image/png" },
        { filename: "d.png", data: Buffer.from("4"), mimeType: "image/png" },
      ],
    });

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toEqual([
      { type: "file_upload", file_upload_id: "fu-1" },
      { type: "file_upload", file_upload_id: "fu-2" },
      { type: "file_upload", file_upload_id: "fu-3" },
    ]);
    expect(body.markdown).toContain("📎 d.png");
    expect(body.markdown).not.toContain("📎 a.png");
  });

  it("falls back to markdown link when file upload fails", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        return Promise.resolve(
          new Response("upload create failed", { status: 400 })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter();
    await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      files: [
        {
          filename: "a.png",
          data: Buffer.from("x"),
          mimeType: "image/png",
        },
      ],
    });

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toBeUndefined();
    expect(body.markdown).toContain("hi");
    expect(body.markdown).toContain("📎 a.png");
  });

  it("polls external_url until uploaded before attaching", async () => {
    vi.useFakeTimers();
    let pollCount = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.mode).toBe("external_url");
        expect(body.external_url).toBe("https://cdn.example.com/photo.png");
        return Promise.resolve(
          Response.json({
            id: "fu-ext-1",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.endsWith("/file_uploads/fu-ext-1") && !path.endsWith("/send")) {
        pollCount += 1;
        return Promise.resolve(
          Response.json({
            id: "fu-ext-1",
            object: "file_upload",
            status: pollCount >= 2 ? "uploaded" : "pending",
          })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter();
    const promise = adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      attachments: [
        {
          type: "image",
          url: "https://cdn.example.com/photo.png",
          name: "photo.png",
        },
      ],
    });
    // Default window: immediate poll (0), then 5s — uploaded on 2nd check
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.id).toBe("new-comment-id");

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toEqual([
      { type: "file_upload", file_upload_id: "fu-ext-1" },
    ]);
    expect(body.markdown).not.toContain("https://cdn.example.com/photo.png");
    expect(pollCount).toBe(2);
    vi.useRealTimers();
  });

  it("links external_url when import stays pending past poll window", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-pending",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.includes("/file_uploads/fu-ext-pending")) {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-pending",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter();
    const promise = adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      attachments: [
        {
          type: "file",
          url: "https://cdn.example.com/slow.pdf",
          name: "slow.pdf",
        },
      ],
    });
    // Default: immediate + 5s + 10s
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000 + 10_000);
    await promise;

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toBeUndefined();
    expect(body.markdown).toContain("https://cdn.example.com/slow.pdf");
    vi.useRealTimers();
  });

  it("links external_url when Notion reports failed import", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-fail",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.includes("/file_uploads/fu-ext-fail")) {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-fail",
            object: "file_upload",
            status: "failed",
          })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter();
    const promise = adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      attachments: [
        {
          type: "file",
          url: "https://cdn.example.com/bad.bin",
        },
      ],
    });
    // Immediate first poll (delay 0) sees failed
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await promise;

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toBeUndefined();
    expect(body.markdown).toContain("https://cdn.example.com/bad.bin");
    vi.useRealTimers();
  });

  it("attaches external_url on immediate poll when already uploaded", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-fast",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.endsWith("/file_uploads/fu-ext-fast")) {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-fast",
            object: "file_upload",
            status: "uploaded",
          })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter();
    await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      attachments: [
        {
          type: "image",
          url: "https://cdn.example.com/fast.png",
          name: "fast.png",
        },
      ],
    });

    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toEqual([
      { type: "file_upload", file_upload_id: "fu-ext-fast" },
    ]);
    // Only create + one immediate retrieve + comment — no long sleeps
    const retrieveCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("/file_uploads/fu-ext-fast")
    );
    expect(retrieveCalls).toHaveLength(1);
  });

  it("skips waiting when externalUrlPollDelaysMs is empty", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/file_uploads") && init?.method === "POST") {
        return Promise.resolve(
          Response.json({
            id: "fu-ext-skip",
            object: "file_upload",
            status: "pending",
          })
        );
      }
      if (path.endsWith("/comments") && init?.method === "POST") {
        return Promise.resolve(
          Response.json(
            fixtureComment({
              id: "new-comment-id",
              discussion_id: DISCUSSION_ID,
            })
          )
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    });

    const adapter = createTestAdapter({ externalUrlPollDelaysMs: [] });
    await adapter.postMessage(`notion:${PAGE_ID}`, {
      markdown: "hi",
      attachments: [
        {
          type: "file",
          url: "https://cdn.example.com/nowait.pdf",
        },
      ],
    });

    const retrieveCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/file_uploads/fu-ext-skip")
    );
    expect(retrieveCalls).toHaveLength(0);
    const commentCall = fetchMock.mock.calls.find(([u, init]) => {
      return (
        String(u).endsWith("/comments") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    const body = JSON.parse(String((commentCall?.[1] as RequestInit).body));
    expect(body.attachments).toBeUndefined();
    expect(body.markdown).toContain("https://cdn.example.com/nowait.pdf");
  });
});

interface NotionRoutes {
  /** Block ancestry: each block's parent is a page, or another block via `parentBlockId`. */
  blocks?: Record<
    string,
    { pageId?: string; parentBlockId?: string; type?: string }
  >;
  comments?: NotionComment[];
  /** Comment list pages per `block_id`, served in order via `start_cursor`. */
  listings?: Record<string, NotionComment[][]>;
  posted?: NotionComment;
}

function routeNotion({
  blocks = {},
  comments = [],
  listings = {},
  posted = fixtureComment(),
}: NotionRoutes = {}) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(new URL(API_BASE_URL).pathname, "");
    const method = init?.method ?? "GET";
    if (path === "/users/me") {
      return Response.json({ id: BOT_USER_ID, type: "bot", bot: {} });
    }
    if (method === "POST" && path === "/comments") {
      return Response.json(posted);
    }
    if (method === "POST" && path === "/file_uploads") {
      return Response.json({ id: "fu-1", object: "file_upload" });
    }
    if (method === "POST" && path === "/file_uploads/fu-1/send") {
      return Response.json({ id: "fu-1", status: "uploaded" });
    }
    if (method === "GET" && path === "/comments") {
      const pages = listings[url.searchParams.get("block_id") ?? ""] ?? [];
      const index = Number(url.searchParams.get("start_cursor") ?? "0");
      const hasMore = index + 1 < pages.length;
      return Response.json({
        object: "list",
        results: pages[index] ?? [],
        has_more: hasMore,
        next_cursor: hasMore ? String(index + 1) : null,
      });
    }
    const comment = comments.find(
      (c) => c.id === COMMENT_PATH_RE.exec(path)?.[1]
    );
    if (method === "GET" && comment) {
      return Response.json(comment);
    }
    const blockId = BLOCK_PATH_RE.exec(path)?.[1];
    const block = blockId ? blocks[blockId] : undefined;
    if (method === "GET" && block) {
      return Response.json({
        object: "block",
        id: blockId,
        type: block.type ?? "paragraph",
        parent: block.parentBlockId
          ? { type: "block_id", block_id: block.parentBlockId }
          : { type: "page_id", page_id: block.pageId },
      });
    }
    return new Response(`unexpected ${method} ${path}`, { status: 500 });
  };
}

/** `METHOD /path?query` for every request, relative to the API base URL. */
function requestsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(
    ([url, init]) =>
      `${(init as RequestInit).method} ${String(url).replace(API_BASE_URL, "")}`
  );
}

function listingsOf(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit).method === "GET")
    .map(([url]) => new URL(String(url)))
    .filter((url) => url.pathname.endsWith("/comments"))
    .map((url) => url.searchParams);
}

function writesOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return requestsOf(fetchMock).filter(
    (request) => !request.startsWith("GET") || request.includes("file_uploads")
  );
}

function postBodyOf(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const posts = fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init as RequestInit).method === "POST" &&
      String(url).endsWith("/comments")
  );
  return JSON.parse(String((posts[index]?.[1] as RequestInit).body));
}

describe("postMessage target ownership", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function withScopedTools(
    run: (tools: ReturnType<typeof createChatTools>) => Promise<void>
  ): Promise<void> {
    const chat = new Chat({
      userName: "test-bot",
      adapters: { notion: createTestAdapter() },
      state: createMockState(),
      logger: createMockLogger(),
    });
    await chat.initialize();
    fetchMock.mockClear();
    try {
      await run(
        createChatTools({
          chat,
          scope: `notion:${PAGE_ID}`,
          requireApproval: false,
        })
      );
    } finally {
      await chat.shutdown();
    }
  }

  async function receiveComment(
    adapter: NotionAdapter,
    state: ReturnType<typeof createMockState>,
    comment: NotionComment,
    pageId: string
  ): Promise<void> {
    await adapter.initialize(createMockChatInstance({ state }) as never);
    const event = fixtureCommentCreatedEvent({
      entity: { id: comment.id, type: "comment" },
      data: { page_id: pageId, parent: { id: pageId, type: "page" } },
    });
    const response = await adapter.handleWebhook(signedRequest(event));
    if (response.status !== 200) {
      throw new Error(`Webhook for ${comment.id} failed: ${response.status}`);
    }
  }

  const foreignRoutes = {
    listings: {
      [PAGE_ID]: [[fixtureComment()]],
      [FOREIGN_PAGE_ID]: [
        [
          fixtureComment({
            parent: { type: "page_id", page_id: FOREIGN_PAGE_ID },
            discussion_id: FOREIGN_DISCUSSION_ID,
          }),
        ],
      ],
    },
  };

  it.each([
    {
      tool: "postMessage",
      input: { threadId: `notion:${PAGE_ID}:${FOREIGN_DISCUSSION_ID}` },
    },
    {
      tool: "postChannelMessage",
      input: { channelId: `notion:${PAGE_ID}:${FOREIGN_DISCUSSION_ID}` },
    },
  ] as const)("rejects a foreign discussion through the scoped $tool tool", async ({
    tool,
    input,
  }) => {
    fetchMock.mockImplementation(routeNotion(foreignRoutes));
    await withScopedTools(async (tools) => {
      const execute = tools[tool]?.execute as
        | ((args: unknown, options: unknown) => Promise<unknown>)
        | undefined;
      const result = execute?.(
        { ...input, message: "hijack" },
        { toolCallId: "ownership", messages: [] }
      );
      await expect(result).rejects.toThrow(ValidationError);
      await expect(result).rejects.toThrow(UNCONFIRMED_DISCUSSION_ERROR);
    });
    expect(writesOf(fetchMock)).toEqual([]);
    expect(listingsOf(fetchMock).map((p) => p.get("block_id"))).toEqual([
      PAGE_ID,
    ]);
  });

  it("rejects a foreign discussion before uploading its files", async () => {
    fetchMock.mockImplementation(routeNotion(foreignRoutes));
    const result = createTestAdapter().postMessage(
      `notion:${PAGE_ID}:${FOREIGN_DISCUSSION_ID}`,
      {
        markdown: "x",
        files: [
          { filename: "a.png", data: Buffer.from("x"), mimeType: "image/png" },
        ],
      }
    );
    await expect(result).rejects.toThrow(ValidationError);
    await expect(result).rejects.toThrow(UNCONFIRMED_DISCUSSION_ERROR);
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it("rejects a discussion recorded on another page without listing", async () => {
    const foreignComment = fixtureComment({
      id: FOREIGN_COMMENT_ID,
      parent: { type: "page_id", page_id: FOREIGN_PAGE_ID },
      discussion_id: FOREIGN_DISCUSSION_ID,
    });
    fetchMock.mockImplementation(
      routeNotion({
        comments: [foreignComment],
        listings: { [PAGE_ID]: [[foreignComment]] },
      })
    );
    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    await receiveComment(
      adapter,
      createMockState(),
      foreignComment,
      FOREIGN_PAGE_ID
    );
    fetchMock.mockClear();

    const result = adapter.postMessage(
      `notion:${PAGE_ID}:${FOREIGN_DISCUSSION_ID}`,
      "hijack"
    );
    await expect(result).rejects.toThrow(ValidationError);
    await expect(result).rejects.toThrow(NOT_ON_PAGE_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a block on another page", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        blocks: { [FOREIGN_BLOCK_ID]: { pageId: FOREIGN_PAGE_ID } },
      })
    );
    const result = createTestAdapter().postMessage(
      `notion:${PAGE_ID}:block:${FOREIGN_BLOCK_ID}`,
      "hijack"
    );
    await expect(result).rejects.toThrow(ValidationError);
    await expect(result).rejects.toThrow(NOT_ON_PAGE_ERROR);
    expect(requestsOf(fetchMock)).toEqual([`GET /blocks/${FOREIGN_BLOCK_ID}`]);
  });

  it.each([
    "child_page",
    "child_database",
  ])("rejects a %s block even when its parent is the thread's page", async (type) => {
    fetchMock.mockImplementation(
      routeNotion({ blocks: { [PAGE_BLOCK_ID]: { pageId: PAGE_ID, type } } })
    );
    await expect(
      createTestAdapter().postMessage(
        `notion:${PAGE_ID}:block:${PAGE_BLOCK_ID}`,
        "hello"
      )
    ).rejects.toThrow(ValidationError);
    expect(requestsOf(fetchMock)).toEqual([`GET /blocks/${PAGE_BLOCK_ID}`]);
  });

  it("replies to a webhook discussion without listing", async () => {
    fetchMock.mockImplementation(routeNotion({ comments: [fixtureComment()] }));
    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    await receiveComment(adapter, createMockState(), fixtureComment(), PAGE_ID);
    fetchMock.mockClear();

    await adapter.postMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, "reply");
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).discussion_id).toBe(DISCUSSION_ID);
  });

  it("replies from another instance using the binding in shared state", async () => {
    fetchMock.mockImplementation(routeNotion({ comments: [fixtureComment()] }));
    const state = createMockState();
    await receiveComment(
      createTestAdapter({ mentionMode: "all-comments" }),
      state,
      fixtureComment(),
      PAGE_ID
    );
    const other = createTestAdapter();
    await other.initialize(createMockChatInstance({ state }) as never);
    fetchMock.mockClear();

    await other.postMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, "reply");
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).discussion_id).toBe(DISCUSSION_ID);
  });

  it("finds an unrecorded discussion on a later listing page once", async () => {
    // The token bucket refills from Date.now(); advance it instead of sleeping.
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockImplementation(
      routeNotion({
        listings: {
          [PAGE_ID]: [
            [fixtureComment({ discussion_id: OTHER_DISCUSSION_ID })],
            [fixtureComment()],
          ],
        },
      })
    );
    const adapter = createTestAdapter();
    const threadId = `notion:${PAGE_ID}:${DISCUSSION_ID}`;

    await adapter.postMessage(threadId, "first");
    expect(listingsOf(fetchMock).map((p) => p.get("start_cursor"))).toEqual([
      null,
      "1",
    ]);
    expect(writesOf(fetchMock)).toEqual(["POST /comments"]);

    fetchMock.mockClear();
    vi.setSystemTime(Date.now() + 1000);
    await adapter.postMessage(threadId, "second");
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).discussion_id).toBe(DISCUSSION_ID);
  });

  it("skips relisting a missed discussion until the miss expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockImplementation(
      routeNotion({
        listings: {
          [PAGE_ID]: [[fixtureComment({ discussion_id: OTHER_DISCUSSION_ID })]],
        },
      })
    );
    const adapter = createTestAdapter();
    const threadId = `notion:${PAGE_ID}:${DISCUSSION_ID}`;

    await expect(adapter.postMessage(threadId, "first")).rejects.toThrow(
      UNCONFIRMED_DISCUSSION_ERROR
    );
    expect(listingsOf(fetchMock)).toHaveLength(1);

    fetchMock.mockClear();
    await expect(adapter.postMessage(threadId, "retry")).rejects.toThrow(
      UNCONFIRMED_DISCUSSION_ERROR
    );
    expect(requestsOf(fetchMock)).toEqual([]);

    vi.setSystemTime(Date.now() + 60_001);
    await expect(adapter.postMessage(threadId, "later")).rejects.toThrow(
      UNCONFIRMED_DISCUSSION_ERROR
    );
    expect(listingsOf(fetchMock)).toHaveLength(1);
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it("accepts a discussion recorded in shared state after a miss", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        comments: [fixtureComment()],
        listings: { [PAGE_ID]: [[]] },
      })
    );
    const state = createMockState();
    const adapter = createTestAdapter();
    await adapter.initialize(createMockChatInstance({ state }) as never);
    const threadId = `notion:${PAGE_ID}:${DISCUSSION_ID}`;
    await expect(adapter.postMessage(threadId, "first")).rejects.toThrow(
      UNCONFIRMED_DISCUSSION_ERROR
    );

    await receiveComment(
      createTestAdapter({ mentionMode: "all-comments" }),
      state,
      fixtureComment(),
      PAGE_ID
    );
    fetchMock.mockClear();

    await adapter.postMessage(threadId, "reply");
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
  });

  it("persists a discussion binding when a webhook retries after a failed state write", async () => {
    fetchMock.mockImplementation(routeNotion({ comments: [fixtureComment()] }));
    const state = createMockState();
    const writeState = vi.mocked(state.set).getMockImplementation();
    let failedOnce = false;
    vi.mocked(state.set).mockImplementation(async (key, value, ttlMs) => {
      if (!failedOnce && key.startsWith("notion:discussion-page:")) {
        failedOnce = true;
        throw new Error("state unavailable");
      }
      return writeState?.(key, value, ttlMs);
    });
    const receiver = createTestAdapter({ mentionMode: "all-comments" });
    await receiver.initialize(createMockChatInstance({ state }) as never);
    const event = fixtureCommentCreatedEvent();

    const failed = await receiver.handleWebhook(signedRequest(event));
    expect(failed.status).not.toBe(200);
    const retried = await receiver.handleWebhook(signedRequest(event));
    expect(retried.status).toBe(200);

    const other = createTestAdapter();
    await other.initialize(createMockChatInstance({ state }) as never);
    fetchMock.mockClear();
    await other.postMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, "reply");
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
  });

  it("keeps other listed discussions in memory without writing them to state", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        listings: {
          [PAGE_ID]: [
            [
              fixtureComment({ discussion_id: OTHER_DISCUSSION_ID }),
              fixtureComment(),
            ],
          ],
        },
      })
    );
    const state = createMockState();
    const adapter = createTestAdapter();
    await adapter.initialize(createMockChatInstance({ state }) as never);
    fetchMock.mockClear();

    await adapter.postMessage(`notion:${PAGE_ID}:${DISCUSSION_ID}`, "first");
    fetchMock.mockClear();
    await adapter.postMessage(
      `notion:${PAGE_ID}:${OTHER_DISCUSSION_ID}`,
      "second"
    );

    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).discussion_id).toBe(OTHER_DISCUSSION_ID);
    expect(await state.get(`notion:discussion-page:${DISCUSSION_ID}`)).toBe(
      PAGE_ID
    );
    expect(
      await state.get(`notion:discussion-page:${OTHER_DISCUSSION_ID}`)
    ).toBeNull();
  });

  it("matches a listed discussion ID in another case and hyphenation", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        listings: {
          [PAGE_ID]: [
            [
              fixtureComment({
                discussion_id: DISCUSSION_ID.replaceAll("-", "").toUpperCase(),
              }),
            ],
          ],
        },
      })
    );
    await createTestAdapter().postMessage(
      `notion:${PAGE_ID}:${DISCUSSION_ID}`,
      "reply"
    );
    expect(writesOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).discussion_id).toBe(DISCUSSION_ID);
  });

  it("starts a block discussion and replies to it without listing", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        blocks: { [PAGE_BLOCK_ID]: { pageId: PAGE_ID } },
        posted: fixtureComment({
          parent: { type: "block_id", block_id: PAGE_BLOCK_ID },
        }),
      })
    );
    const adapter = createTestAdapter();

    const started = await adapter.postMessage(
      `notion:${PAGE_ID}:block:${PAGE_BLOCK_ID}`,
      "hello"
    );
    expect(requestsOf(fetchMock)).toEqual([
      `GET /blocks/${PAGE_BLOCK_ID}`,
      "POST /comments",
    ]);
    expect(postBodyOf(fetchMock).parent).toEqual({ block_id: PAGE_BLOCK_ID });
    expect(started.threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);

    fetchMock.mockClear();
    await adapter.postMessage(started.threadId, "follow-up");
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).discussion_id).toBe(DISCUSSION_ID);
  });

  it("records a block start's page in shared state", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        blocks: { [PAGE_BLOCK_ID]: { pageId: PAGE_ID } },
        posted: fixtureComment({
          parent: { type: "block_id", block_id: PAGE_BLOCK_ID },
        }),
      })
    );
    const state = createMockState();
    const adapter = createTestAdapter();
    await adapter.initialize(createMockChatInstance({ state }) as never);

    await adapter.postMessage(
      `notion:${PAGE_ID}:block:${PAGE_BLOCK_ID}`,
      "hello"
    );
    expect(await state.get(`notion:block-page:${PAGE_BLOCK_ID}`)).toBe(PAGE_ID);
    expect(await state.get(`notion:discussion-page:${DISCUSSION_ID}`)).toBe(
      PAGE_ID
    );
  });

  it("walks a nested block's ancestry fresh before starting its discussion", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        blocks: {
          [PAGE_BLOCK_ID]: { parentBlockId: FOREIGN_BLOCK_ID },
          [FOREIGN_BLOCK_ID]: { pageId: PAGE_ID },
        },
        posted: fixtureComment({
          parent: { type: "block_id", block_id: PAGE_BLOCK_ID },
        }),
      })
    );
    const adapter = createTestAdapter();
    // A stale cached ancestry must not decide ownership.
    (
      adapter as unknown as { blockPageCache: Map<string, string> }
    ).blockPageCache.set(FOREIGN_BLOCK_ID, FOREIGN_PAGE_ID);

    await adapter.postMessage(
      `notion:${PAGE_ID}:block:${PAGE_BLOCK_ID}`,
      "hello"
    );
    expect(requestsOf(fetchMock)).toEqual([
      `GET /blocks/${PAGE_BLOCK_ID}`,
      `GET /blocks/${FOREIGN_BLOCK_ID}`,
      "POST /comments",
    ]);
    expect(postBodyOf(fetchMock).parent).toEqual({ block_id: PAGE_BLOCK_ID });
  });

  it("rejects a nested block whose ancestor is on another page", async () => {
    fetchMock.mockImplementation(
      routeNotion({
        blocks: {
          [PAGE_BLOCK_ID]: { parentBlockId: FOREIGN_BLOCK_ID },
          [FOREIGN_BLOCK_ID]: { pageId: FOREIGN_PAGE_ID },
        },
      })
    );
    const result = createTestAdapter().postMessage(
      `notion:${PAGE_ID}:block:${PAGE_BLOCK_ID}`,
      "hijack"
    );
    await expect(result).rejects.toThrow(ValidationError);
    await expect(result).rejects.toThrow(NOT_ON_PAGE_ERROR);
    expect(writesOf(fetchMock)).toEqual([]);
  });

  it("posts a page-level comment through the scoped tool with one request", async () => {
    fetchMock.mockImplementation(routeNotion());
    await withScopedTools(async (tools) => {
      await tools.postMessage?.execute?.(
        { threadId: `notion:${PAGE_ID}`, message: "hello" },
        { toolCallId: "page", messages: [] }
      );
    });
    expect(requestsOf(fetchMock)).toEqual(["POST /comments"]);
    expect(postBodyOf(fetchMock).parent).toEqual({ page_id: PAGE_ID });
  });

  it("returns the posted comment when recording its discussion fails", async () => {
    fetchMock.mockImplementation(routeNotion());
    const state = createMockState();
    vi.mocked(state.set).mockRejectedValue(new Error("state unavailable"));
    const logger = createMockLogger();
    const adapter = createTestAdapter({ logger });
    await adapter.initialize(createMockChatInstance({ state }) as never);
    fetchMock.mockClear();

    const result = await adapter.postMessage(`notion:${PAGE_ID}`, "hello");

    expect(result.threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);
    expect(writesOf(fetchMock)).toEqual(["POST /comments"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to record Notion discussion page",
      expect.objectContaining({ discussionId: DISCUSSION_ID })
    );
  });
});

describe("chunkMarkdown", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkMarkdown("hello world", 1900)).toEqual(["hello world"]);
  });

  it("returns nothing for empty input", () => {
    expect(chunkMarkdown("", 1900)).toEqual([]);
  });

  it("splits on paragraph boundaries without dropping content", () => {
    const para = "a".repeat(80);
    const text = Array.from({ length: 5 }, () => para).join("\n\n");
    const chunks = chunkMarkdown(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    expect(chunks.join("").split("\n").join("")).toBe(
      text.split("\n").join("")
    );
  });

  it("hard-splits a single line longer than the limit", () => {
    const chunks = chunkMarkdown("z".repeat(500), 200);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    expect(chunks.join("")).toBe("z".repeat(500));
  });
});

describe("Post+Edit streaming", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throttles edits and always flushes final state", async () => {
    vi.useFakeTimers();
    let commentBody = "…";
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/comments/") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        commentBody = body.markdown;
        return Response.json(
          fixtureComment({
            rich_text: [
              {
                type: "text",
                plain_text: commentBody,
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default",
                },
                text: { content: commentBody },
              },
            ],
          })
        );
      }
      if (String(url).endsWith("/comments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        commentBody = body.markdown;
        return Response.json(fixtureComment({ id: COMMENT_ID }));
      }
      if (String(url).includes("/comments?") && init?.method === "GET") {
        return Response.json({
          object: "list",
          results: [fixtureComment()],
          has_more: false,
        });
      }
      return new Response("nope", { status: 404 });
    });

    const adapter = createTestAdapter({ streamingEditIntervalMs: 1500 });

    async function* chunks() {
      yield "Hello";
      yield " world";
      await vi.advanceTimersByTimeAsync(1600);
      yield "!";
    }

    const resultPromise = adapter.stream(
      `notion:${PAGE_ID}:${DISCUSSION_ID}`,
      chunks()
    );
    // Allow scheduled timers from the stream loop to run
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result?.id).toBe(COMMENT_ID);
    const patchCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH"
    );
    const postCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/blocks/") ||
          (String(url).includes(`/comments/${COMMENT_ID}`) &&
            (init as RequestInit | undefined)?.method !== "PATCH")
      )
    ).toEqual([]);
    const lastPatch = JSON.parse(
      String((patchCalls.at(-1)?.[1] as RequestInit).body)
    );
    expect(lastPatch.markdown).toContain("Hello world!");
    vi.useRealTimers();
  });
});

describe("fetchMessages", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters to discussion_id (forward) and returns nextCursor", async () => {
    const otherDiscussion = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    fetchMock.mockResolvedValue(
      Response.json({
        object: "list",
        results: [
          fixtureComment({ id: "c1", discussion_id: DISCUSSION_ID }),
          fixtureComment({
            id: "c2",
            discussion_id: otherDiscussion,
            rich_text: [
              {
                type: "text",
                plain_text: "other thread",
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default",
                },
                text: { content: "other thread" },
              },
            ],
          }),
          fixtureComment({ id: "c3", discussion_id: DISCUSSION_ID }),
        ],
        next_cursor: "cursor-2",
        has_more: true,
      })
    );

    const adapter = createTestAdapter();
    const result = await adapter.fetchMessages(
      `notion:${PAGE_ID}:${DISCUSSION_ID}`,
      { limit: 50, direction: "forward" }
    );
    expect(result.messages.map((m) => m.id)).toEqual(["c1", "c3"]);
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("backward direction returns newest comments when multiple on one page", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        object: "list",
        results: [
          fixtureComment({ id: "c-old", discussion_id: DISCUSSION_ID }),
          fixtureComment({ id: "c-mid", discussion_id: DISCUSSION_ID }),
          fixtureComment({ id: "c-new", discussion_id: DISCUSSION_ID }),
        ],
        next_cursor: null,
        has_more: false,
      })
    );

    const adapter = createTestAdapter();
    const result = await adapter.fetchMessages(
      `notion:${PAGE_ID}:${DISCUSSION_ID}`,
      { limit: 2, direction: "backward" }
    );
    expect(result.messages.map((m) => m.id)).toEqual(["c-mid", "c-new"]);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe("block → page resolution", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses webhook data.page_id without block walk", async () => {
    const blockId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const comment = fixtureComment({
      parent: { type: "block_id", block_id: blockId },
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);
    await adapter.handleWebhook(
      signedRequest(
        fixtureCommentCreatedEvent({
          data: {
            page_id: PAGE_ID,
            parent: { id: blockId, type: "block" },
          },
        })
      )
    );
    const [, threadId] = chat.processMessage.mock.calls[0] as [unknown, string];
    expect(threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/blocks/"))
    ).toBe(false);
  });

  it("walks block → page when event has no page_id", async () => {
    const blockId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const comment = fixtureComment({
      parent: { type: "block_id", block_id: blockId },
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        return Response.json(comment);
      }
      if (String(url).includes(`/blocks/${blockId}`)) {
        return Response.json({
          id: blockId,
          parent: { type: "page_id", page_id: PAGE_ID },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);
    await adapter.handleWebhook(
      signedRequest(
        fixtureCommentCreatedEvent({
          data: {
            parent: { id: blockId, type: "block" },
          },
        })
      )
    );
    const [, threadId] = chat.processMessage.mock.calls[0] as [unknown, string];
    expect(threadId).toBe(`notion:${PAGE_ID}:${DISCUSSION_ID}`);
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes(`/blocks/${blockId}`)
      )
    ).toBe(true);
  });
});

describe("fetchSubject", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns page subject from GET /pages/{pageId}", async () => {
    const adapter = createTestAdapter();
    const page = {
      object: "page",
      id: PAGE_ID,
      url: `https://www.notion.so/${PAGE_ID.replace(/-/g, "")}`,
      archived: false,
      created_by: { id: PERSON_USER_ID, name: "Alice" },
      properties: {
        title: {
          id: "title",
          type: "title",
          title: [{ plain_text: "Product Spec" }],
        },
      },
    };
    fetchMock.mockResolvedValue(Response.json(page));

    const result = await adapter.fetchSubject({
      comment: fixtureComment(),
      pageId: PAGE_ID,
    });

    expect(result).not.toBeNull();
    expect(result?.type).toBe("page");
    expect(result?.id).toBe(PAGE_ID);
    expect(result?.title).toBe("Product Spec");
    expect(result?.url).toBe(page.url);
    expect(result?.author).toEqual({ id: PERSON_USER_ID, name: "Alice" });
    expect(result?.status).toBeUndefined();
    expect(result?.raw).toEqual(page);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/pages/${PAGE_ID}`);
  });

  it("extracts title from a named database title property", async () => {
    const adapter = createTestAdapter();
    fetchMock.mockResolvedValue(
      Response.json({
        object: "page",
        id: PAGE_ID,
        url: "https://www.notion.so/page",
        properties: {
          Name: {
            id: "title",
            type: "title",
            title: [{ plain_text: "Launch checklist" }],
          },
        },
      })
    );

    const result = await adapter.fetchSubject({
      comment: fixtureComment(),
      pageId: PAGE_ID,
    });

    expect(result?.title).toBe("Launch checklist");
  });

  it("sets status archived when page is archived or in trash", async () => {
    const adapter = createTestAdapter();
    fetchMock.mockResolvedValue(
      Response.json({
        object: "page",
        id: PAGE_ID,
        url: "https://www.notion.so/page",
        archived: true,
        properties: {
          title: { type: "title", title: [{ plain_text: "Old" }] },
        },
      })
    );

    const result = await adapter.fetchSubject({
      comment: fixtureComment(),
      pageId: PAGE_ID,
    });

    expect(result?.status).toBe("archived");
  });

  it("returns null when the pages API fails", async () => {
    const adapter = createTestAdapter({ logger: createMockLogger() });
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));

    const result = await adapter.fetchSubject({
      comment: fixtureComment(),
      pageId: PAGE_ID,
    });

    expect(result).toBeNull();
  });

  it("returns null when pageId is missing", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.fetchSubject({
      comment: fixtureComment(),
      pageId: "",
    });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("inbound markdown parsing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function span(
    plainText: string,
    overrides: Partial<NotionRichText> = {}
  ): NotionRichText {
    return {
      type: "text",
      plain_text: plainText,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
      },
      text: { content: plainText },
      ...overrides,
    };
  }

  async function dispatchComment(
    richText: NotionRichText[]
  ): Promise<{ status: number; message: Message | undefined }> {
    const comment = fixtureComment({ rich_text: richText });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/users/me")) {
        return Response.json({
          object: "user",
          id: BOT_USER_ID,
          name: "Docs Bot",
          avatar_url: null,
          type: "bot",
          bot: {},
        });
      }
      if (String(url).includes(`/comments/${COMMENT_ID}`)) {
        return Response.json(comment);
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createTestAdapter({ mentionMode: "all-comments" });
    const chat = createMockChatInstance();
    await adapter.initialize(chat as never);

    const res = await adapter.handleWebhook(
      signedRequest(fixtureCommentCreatedEvent())
    );
    const factory = vi.mocked(chat.processMessage).mock.calls[0]?.[2] as
      | (() => Promise<Message>)
      | undefined;
    return { status: res.status, message: await factory?.() };
  }

  it("parses rich-text annotations into a structured AST", async () => {
    const { status, message } = await dispatchComment([
      span("Ship it", {
        annotations: {
          bold: true,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      }),
      span(" after "),
      span("review", { href: "https://notion.so/review" }),
    ]);

    expect(status).toBe(200);
    expect(message?.text).toBe("Ship it after review");
    expect(message?.formatted).toEqual(
      parseMarkdown("**Ship it** after [review](https://notion.so/review)")
    );
  });

  it.each([
    ["unmatched emphasis markers", "*a".repeat(8192)],
    ["deeply nested blockquotes", ">".repeat(6000)],
    ["a footnote opening 40 nested lists", `[^a]: ${"- ".repeat(40)}a`],
    ["65 www. autolinks in one word", "www.example.com/".repeat(65)],
  ])("keeps a comment with %s as one text node", async (_name, body) => {
    const { status, message } = await dispatchComment([span(body)]);

    expect(status).toBe(200);
    expect(message?.text).toBe(body);
    expect(message?.formatted).toStrictEqual({
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: body }] },
      ],
    });
    expect(() => JSON.stringify(message?.formatted)).not.toThrow();
  });
});
