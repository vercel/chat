import { createHmac } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  selfMessageContract,
  threadIdContract,
} from "@chat-adapter/tests";
import { type ChatInstance, getEmoji } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitLabAdapter,
  GitLabAdapter,
  type GitLabAdapterConfig,
  type GitLabEmojiWebhookPayload,
  type GitLabNote,
  type GitLabNoteWebhookPayload,
} from "./index";

const API_URL = "https://gitlab.example.com/api/v4";
const TOKEN = "glpat-test-token";
const WEBHOOK_SECRET = "test-webhook-secret";
const SIGNING_KEY = Buffer.alloc(32, 7);
const SIGNING_TOKEN = `whsec_${SIGNING_KEY.toString("base64")}`;
const PROJECT_ID = 42;
const BOT_USER_ID = 999;
const DISCUSSION_ID = "c3d97fd471f210a5dc8b97a409e3bea95ee06c14";
const INVALID_THREAD_ID = /Invalid GitLab thread ID/;
const INVALID_CHANNEL_ID = /Invalid GitLab channel ID/;
const WEBHOOK_REQUIRED = /Webhook verification is required/;
const AUTH_REQUIRED = /Authentication is required/;
const BLANK_NOTE_REASON = /\(400\): Note can't be blank$/;
const FIELD_ERRORS_REASON = /\(422\): note is too long, contains spam$/;
const ERROR_FIELD_REASON = /\(400\): body is missing$/;

const ENV_KEYS = [
  "GITLAB_TOKEN",
  "GITLAB_API_URL",
  "GITLAB_WEBHOOK_SECRET",
  "GITLAB_WEBHOOK_SIGNING_TOKEN",
  "GITLAB_BOT_USERNAME",
  "GITLAB_BOT_USER_ID",
] as const;

const humanUser = {
  id: 1,
  name: "Ada Lovelace",
  username: "ada",
  avatar_url: "https://gitlab.example.com/avatar.png",
  email: "[REDACTED]",
};

const botUser = {
  id: BOT_USER_ID,
  name: "Review Bot",
  username: "project_42_bot_abc123",
  avatar_url: null,
};

interface MockRoute {
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
  path: string | RegExp;
  status?: number;
}

interface RecordedCall {
  body: unknown;
  headers: Headers;
  method: string;
  url: URL;
}

let calls: RecordedCall[] = [];

function mockFetch(routes: MockRoute[]): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = init?.method ?? "GET";
      let body: unknown = init?.body;
      if (typeof body === "string") {
        body = JSON.parse(body);
      }
      calls.push({ url, method, body, headers: new Headers(init?.headers) });
      const path = url.pathname.replace("/api/v4", "");
      const route = routes.find(
        (r) =>
          (r.method ?? "GET") === method &&
          (typeof r.path === "string" ? r.path === path : r.path.test(path))
      );
      if (!route) {
        return Promise.resolve(
          new Response(`no route for ${method} ${path}`, { status: 500 })
        );
      }
      const status = route.status ?? 200;
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(route.body ?? {}), {
          status,
          headers: { "content-type": "application/json", ...route.headers },
        })
      );
    })
  );
}

function createAdapter(
  overrides: Partial<GitLabAdapterConfig> = {}
): GitLabAdapter {
  return createGitLabAdapter({
    token: TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    apiUrl: API_URL,
    botUserId: BOT_USER_ID,
    userName: "project_42_bot_abc123",
    logger: createMockLogger(),
    ...overrides,
  });
}

async function setup(
  overrides: Partial<GitLabAdapterConfig> = {}
): Promise<{ adapter: GitLabAdapter; chat: ChatInstance }> {
  const adapter = createAdapter(overrides);
  const chat = createMockChatInstance();
  await adapter.initialize(chat);
  return { adapter, chat };
}

function restNote(overrides: Partial<GitLabNote> = {}): GitLabNote {
  return {
    id: 500,
    body: "Thanks!",
    author: botUser,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    system: false,
    type: null,
    ...overrides,
  };
}

function noteEvent(
  overrides: {
    attributes?: Partial<GitLabNoteWebhookPayload["object_attributes"]>;
    payload?: Partial<GitLabNoteWebhookPayload>;
  } = {}
): GitLabNoteWebhookPayload {
  return {
    object_kind: "note",
    event_type: "note",
    user: humanUser,
    project_id: PROJECT_ID,
    project: {
      id: PROJECT_ID,
      name: "app",
      path_with_namespace: "acme/app",
      web_url: "https://gitlab.example.com/acme/app",
    },
    object_attributes: {
      id: 1244,
      note: "@project_42_bot_abc123 please review",
      noteable_type: "MergeRequest",
      author_id: 1,
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: "2026-10-01T09:00:00.000Z",
      project_id: PROJECT_ID,
      system: false,
      internal: false,
      type: null,
      discussion_id: DISCUSSION_ID,
      action: "create",
      ...overrides.attributes,
    },
    merge_request: { id: 7, iid: 3, title: "Add feature" },
    ...overrides.payload,
  };
}

function webhookRequest(
  payload: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request("https://bot.example.com/api/webhooks/gitlab", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-event": "Note Hook",
      "x-gitlab-token": WEBHOOK_SECRET,
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function signedRequest(
  payload: unknown,
  options: { timestamp?: number; key?: Buffer; event?: string } = {}
): Request {
  const body = JSON.stringify(payload);
  const id = "f5e5f430-f57b-4e6e-9fac-d9128cd7232f";
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", options.key ?? SIGNING_KEY)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("https://bot.example.com/api/webhooks/gitlab", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-event": options.event ?? "Note Hook",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body,
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  mockFetch([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

threadIdContract({
  name: "gitlab",
  encode: (d) => createAdapter().encodeThreadId(d),
  decode: (id) => createAdapter().decodeThreadId(id),
  cases: [
    {
      decoded: { projectId: 42, noteableType: "merge_request", noteableIid: 3 },
      encoded: "gitlab:42:mr:3",
    },
    {
      decoded: { projectId: 42, noteableType: "issue", noteableIid: 17 },
      encoded: "gitlab:42:issue:17",
    },
    {
      decoded: {
        projectId: 42,
        noteableType: "merge_request",
        noteableIid: 3,
        discussionId: DISCUSSION_ID,
      },
      encoded: `gitlab:42:mr:3:${DISCUSSION_ID}`,
    },
    {
      decoded: {
        projectId: 42,
        noteableType: "issue",
        noteableIid: 17,
        discussionId: DISCUSSION_ID,
      },
      encoded: `gitlab:42:issue:17:${DISCUSSION_ID}`,
    },
  ],
});

selfMessageContract({
  name: "gitlab",
  setup: () => setup(),
  makeOtherMessageRequest: () => webhookRequest(noteEvent()),
  makeSelfMessageRequest: () =>
    webhookRequest(
      noteEvent({ payload: { user: { ...botUser, avatar_url: null } } })
    ),
});

describe("constructor", () => {
  it("strips trailing slashes from the API URL", async () => {
    mockFetch([{ path: "/projects/42", body: { id: 42 } }]);
    const adapter = createAdapter({ apiUrl: `${API_URL}///` });
    await adapter.request("GET", "/projects/42");
    expect(calls[0].url.toString()).toBe(`${API_URL}/projects/42`);
  });

  it("reads configuration from environment variables", () => {
    vi.stubEnv("GITLAB_TOKEN", TOKEN);
    vi.stubEnv("GITLAB_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("GITLAB_BOT_USERNAME", "my-bot");
    vi.stubEnv("GITLAB_BOT_USER_ID", "123");
    const adapter = createGitLabAdapter({ logger: createMockLogger() });
    expect(adapter.name).toBe("gitlab");
    expect(adapter.userName).toBe("my-bot");
    expect(adapter.botUserId).toBe("123");
  });

  it("requires a token", () => {
    expect(() => new GitLabAdapter({ webhookSecret: WEBHOOK_SECRET })).toThrow(
      AUTH_REQUIRED
    );
  });

  it("requires a webhook verification method", () => {
    expect(() => new GitLabAdapter({ token: TOKEN })).toThrow(WEBHOOK_REQUIRED);
  });

  it("accepts a signing token or a custom verifier instead of a secret", () => {
    expect(
      () =>
        new GitLabAdapter({ token: TOKEN, webhookSigningToken: SIGNING_TOKEN })
    ).not.toThrow();
    expect(
      () => new GitLabAdapter({ token: TOKEN, webhookVerifier: () => true })
    ).not.toThrow();
  });

  it("rejects an empty signing token", () => {
    expect(
      () => new GitLabAdapter({ token: TOKEN, webhookSigningToken: "whsec_" })
    ).toThrow(ValidationError);
  });

  it("accepts a signing token without the whsec_ prefix", () => {
    expect(
      () =>
        new GitLabAdapter({
          token: TOKEN,
          webhookSigningToken: SIGNING_KEY.toString("base64"),
        })
    ).not.toThrow();
  });

  it.each([
    ["invalid characters", "whsec_abc!def"],
    ["the wrong length", `whsec_${Buffer.alloc(16, 7).toString("base64")}`],
  ])("rejects a signing token with %s", (_label, webhookSigningToken) => {
    expect(
      () => new GitLabAdapter({ token: TOKEN, webhookSigningToken })
    ).toThrow(ValidationError);
  });

  it("defaults the username to gitlab-bot", () => {
    const adapter = createAdapter({ userName: undefined });
    expect(adapter.userName).toBe("gitlab-bot");
  });
});

describe("initialize", () => {
  it("detects the bot user ID and username with GET /user", async () => {
    mockFetch([{ path: "/user", body: botUser }]);
    const { adapter } = await setup({
      botUserId: undefined,
      userName: undefined,
    });
    expect(adapter.botUserId).toBe(String(BOT_USER_ID));
    expect(adapter.userName).toBe("project_42_bot_abc123");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("keeps an explicitly configured username", async () => {
    mockFetch([{ path: "/user", body: botUser }]);
    const { adapter } = await setup({
      botUserId: undefined,
      userName: "custom-name",
    });
    expect(adapter.userName).toBe("custom-name");
    expect(adapter.botUserId).toBe(String(BOT_USER_ID));
  });

  it("skips detection when both identity values are configured", async () => {
    await setup();
    expect(calls).toHaveLength(0);
  });

  it("bounds the GET /user lookup with a timeout signal", async () => {
    mockFetch([{ path: "/user", body: botUser }]);
    await setup({ botUserId: undefined });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not throw when detection fails", async () => {
    mockFetch([{ path: "/user", status: 401 }]);
    const { adapter } = await setup({ botUserId: undefined });
    expect(adapter.botUserId).toBeUndefined();
  });
});

describe("webhook verification", () => {
  it("accepts a matching X-Gitlab-Token", async () => {
    const { adapter } = await setup();
    const response = await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(response.status).toBe(200);
  });

  it("rejects a wrong X-Gitlab-Token", async () => {
    const { adapter, chat } = await setup();
    const response = await adapter.handleWebhook(
      webhookRequest(noteEvent(), { "x-gitlab-token": "wrong" })
    );
    expect(response.status).toBe(401);
    expect(chat).not.toHaveDispatched("processMessage");
  });

  it("rejects a missing X-Gitlab-Token", async () => {
    const { adapter } = await setup();
    const request = webhookRequest(noteEvent());
    request.headers.delete("x-gitlab-token");
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("accepts a valid webhook-signature", async () => {
    const { adapter, chat } = await setup({
      webhookSecret: undefined,
      webhookSigningToken: SIGNING_TOKEN,
    });
    const response = await adapter.handleWebhook(signedRequest(noteEvent()));
    expect(response.status).toBe(200);
    expect(chat).toHaveDispatched("processMessage");
  });

  it("rejects a signature made with another key", async () => {
    const { adapter } = await setup({
      webhookSecret: undefined,
      webhookSigningToken: SIGNING_TOKEN,
    });
    const response = await adapter.handleWebhook(
      signedRequest(noteEvent(), { key: Buffer.from("other-key") })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a stale signature timestamp", async () => {
    const { adapter } = await setup({
      webhookSecret: undefined,
      webhookSigningToken: SIGNING_TOKEN,
    });
    const response = await adapter.handleWebhook(
      signedRequest(noteEvent(), {
        timestamp: Math.floor(Date.now() / 1000) - 10 * 60,
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const { adapter } = await setup({
      webhookSecret: undefined,
      webhookSigningToken: SIGNING_TOKEN,
    });
    const signed = signedRequest(noteEvent());
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(
        noteEvent({ attributes: { note: "something else" } })
      ),
    });
    const response = await adapter.handleWebhook(tampered);
    expect(response.status).toBe(401);
  });

  it("rejects unsigned requests when only a signing token is set", async () => {
    const { adapter } = await setup({
      webhookSecret: undefined,
      webhookSigningToken: SIGNING_TOKEN,
    });
    const response = await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(response.status).toBe(401);
  });

  it("falls back to the secret token when no signature is sent", async () => {
    const { adapter } = await setup({ webhookSigningToken: SIGNING_TOKEN });
    const response = await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(response.status).toBe(200);
  });

  it("uses a custom verifier in place of tokens", async () => {
    const verifier = vi.fn().mockResolvedValue(false);
    const { adapter } = await setup({ webhookVerifier: verifier });
    const response = await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(response.status).toBe(401);
    expect(verifier).toHaveBeenCalledOnce();
  });

  it("treats a throwing verifier as a rejection", async () => {
    const { adapter } = await setup({
      webhookVerifier: () => {
        throw new Error("bad token");
      },
    });
    const response = await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const { adapter } = await setup();
    const response = await adapter.handleWebhook(webhookRequest("{not json"));
    expect(response.status).toBe(400);
  });

  it("returns 200 for a JSON null body without dispatching", async () => {
    const { adapter, chat } = await setup();
    const response = await adapter.handleWebhook(webhookRequest("null"));
    expect(response.status).toBe(200);
    expect(chat).not.toHaveDispatched("processMessage");
    expect(chat.processReaction).not.toHaveBeenCalled();
  });

  it("returns 200 for a Note Hook without object_attributes", async () => {
    const { adapter, chat } = await setup();
    const response = await adapter.handleWebhook(
      webhookRequest({ object_kind: "note", project_id: PROJECT_ID })
    );
    expect(response.status).toBe(200);
    expect(chat).not.toHaveDispatched("processMessage");
  });
});

describe("comment events", () => {
  it("routes a top-level merge request comment to its discussion thread", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(webhookRequest(noteEvent()));

    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(threadId).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
    expect(message).toMatchObject({
      id: "1244",
      threadId: `gitlab:42:mr:3:${DISCUSSION_ID}`,
      text: "@project_42_bot_abc123 please review",
      author: {
        userId: "1",
        userName: "ada",
        fullName: "Ada Lovelace",
        isBot: false,
        isMe: false,
      },
    });
  });

  it("routes a threaded comment to its discussion thread", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(noteEvent({ attributes: { type: "DiscussionNote" } }))
    );
    const [, threadId] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(threadId).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
  });

  it("routes a diff comment to its discussion thread", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(noteEvent({ attributes: { type: "DiffNote" } }))
    );
    const [, threadId] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(threadId).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
  });

  it("routes an issue comment to its discussion thread", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        noteEvent({
          attributes: { noteable_type: "Issue" },
          payload: {
            merge_request: undefined,
            issue: { id: 92, iid: 17, title: "Bug" },
          },
        })
      )
    );
    const [, threadId] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(threadId).toBe(`gitlab:42:issue:17:${DISCUSSION_ID}`);
  });

  it("routes a reply to the same thread as the top-level comment it answers", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(webhookRequest(noteEvent()));
    await adapter.handleWebhook(
      webhookRequest(
        noteEvent({
          attributes: {
            id: 1245,
            note: "a reply",
            type: "DiscussionNote",
            created_at: "2026-10-01T09:05:00.000Z",
            updated_at: "2026-10-01T09:05:00.000Z",
          },
        })
      )
    );
    expect(chat.processMessage).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(chat.processMessage).mock.calls;
    expect(first[1]).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
    expect(second[1]).toBe(first[1]);
  });

  it("never marks a comment as edited", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        noteEvent({ attributes: { updated_at: "2026-10-02T09:00:00.000Z" } })
      )
    );
    const [, , message] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(message).toMatchObject({ metadata: { edited: false } });
    expect(
      (message as { metadata: { editedAt?: Date } }).metadata.editedAt
    ).toBeUndefined();
  });

  it.each([
    ["a plain mention", "@project_42_bot_abc123 please review", true],
    ["a mention in inline code", "run `@project_42_bot_abc123 review`", false],
    [
      "a mention in a code block",
      "```\n@project_42_bot_abc123 review\n```",
      false,
    ],
    ["a mention in a block quote", "> @project_42_bot_abc123 review", false],
    ["an email address", "mail jane@project_42_bot_abc123.com", false],
    [
      "a mention after a hard line break",
      "Thanks  \n@project_42_bot_abc123",
      true,
    ],
    ["a mention after inline HTML", "x<br>@project_42_bot_abc123", true],
  ])("sets isMention for %s", async (_label, note, expected) => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(noteEvent({ attributes: { note } }))
    );
    const [, , message] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(message.isMention).toBe(expected);
  });

  it("parses legacy webhook timestamps", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        noteEvent({
          attributes: {
            created_at: "2015-05-17 18:21:36 UTC",
            updated_at: "2015-05-17 18:21:36 UTC",
          },
        })
      )
    );
    const [, , message] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(
      (
        message as { metadata: { dateSent: Date } }
      ).metadata.dateSent.toISOString()
    ).toBe("2015-05-17T18:21:36.000Z");
  });

  it.each([
    ["edited comments", { attributes: { action: "update" as const } }],
    ["system notes", { attributes: { system: true } }],
    ["internal notes", { attributes: { internal: true } }],
    [
      "confidential issue comments",
      { payload: { event_type: "confidential_note" } },
    ],
    ["commit comments", { attributes: { noteable_type: "Commit" } }],
    ["snippet comments", { attributes: { noteable_type: "Snippet" } }],
  ])("ignores %s", async (_label, overrides) => {
    const { adapter, chat } = await setup();
    const response = await adapter.handleWebhook(
      webhookRequest(noteEvent(overrides))
    );
    expect(response.status).toBe(200);
    expect(chat).not.toHaveDispatched("processMessage");
  });

  it("ignores the Confidential Note Hook event", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(noteEvent(), {
        "x-gitlab-event": "Confidential Note Hook",
      })
    );
    expect(chat).not.toHaveDispatched("processMessage");
  });

  it("ignores other event types", async () => {
    const { adapter, chat } = await setup();
    const response = await adapter.handleWebhook(
      webhookRequest({ object_kind: "push" }, { "x-gitlab-event": "Push Hook" })
    );
    expect(response.status).toBe(200);
    expect(chat).not.toHaveDispatched("processMessage");
  });

  it("flags project bot users as bots", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        noteEvent({
          payload: {
            user: { id: 5, name: "Other bot", username: "group_9_bot_xyz" },
          },
        })
      )
    );
    const [, , message] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(message).toMatchObject({ author: { isBot: true, isMe: false } });
  });
});

describe("self-detection without a known bot user ID", () => {
  it("drops comments when GET /user fails and no username is configured", async () => {
    mockFetch([{ path: "/user", status: 500 }]);
    const logger = createMockLogger();
    const { adapter, chat } = await setup({
      botUserId: undefined,
      userName: undefined,
      logger,
    });
    const response = await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(response.status).toBe(200);
    expect(chat).not.toHaveDispatched("processMessage");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("bot user is unknown"),
      expect.anything()
    );
  });

  it("falls back to the configured username", async () => {
    mockFetch([{ path: "/user", status: 500 }]);
    const { adapter, chat } = await setup({ botUserId: undefined });
    expect(adapter.botUserId).toBeUndefined();

    await adapter.handleWebhook(
      webhookRequest(
        noteEvent({
          payload: {
            user: {
              ...botUser,
              id: 12_345,
              username: "Project_42_Bot_ABC123",
            },
          },
        })
      )
    );
    expect(chat).not.toHaveDispatched("processMessage");

    await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, , message] = vi.mocked(chat.processMessage).mock.calls[0];
    expect(message).toMatchObject({ author: { userName: "ada", isMe: false } });
  });

  it("marks the bot's own notes as isMe by username", async () => {
    mockFetch([
      { path: "/user", status: 500 },
      {
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes/500`,
        body: restNote({ author: { ...botUser, id: 12_345 } }),
      },
    ]);
    const { adapter } = await setup({ botUserId: undefined });
    const message = await adapter.fetchMessage("gitlab:42:mr:3", "500");
    expect(message?.author.isMe).toBe(true);
  });

  it("retries GET /user on a later webhook after the cooldown", async () => {
    mockFetch([{ path: "/user", status: 500 }]);
    const { adapter, chat } = await setup({
      botUserId: undefined,
      userName: undefined,
    });

    // Within the cooldown: no retry, so the comment is dropped.
    mockFetch([{ path: "/user", body: botUser }]);
    await adapter.handleWebhook(webhookRequest(noteEvent()));
    expect(calls).toHaveLength(0);
    expect(chat).not.toHaveDispatched("processMessage");

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 31_000);
      await adapter.handleWebhook(webhookRequest(noteEvent()));
    } finally {
      vi.useRealTimers();
    }
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/v4/user"]);
    expect(adapter.botUserId).toBe(String(BOT_USER_ID));
    expect(chat.processMessage).toHaveBeenCalledOnce();
  });

  it("lets concurrent webhooks share one GET /user retry", async () => {
    mockFetch([{ path: "/user", status: 500 }]);
    const { adapter, chat } = await setup({
      botUserId: undefined,
      userName: undefined,
    });

    mockFetch([{ path: "/user", body: botUser }]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 31_000);
      await Promise.all([
        adapter.handleWebhook(webhookRequest(noteEvent())),
        adapter.handleWebhook(webhookRequest(noteEvent())),
      ]);
    } finally {
      vi.useRealTimers();
    }
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/v4/user"]);
    expect(chat.processMessage).toHaveBeenCalledTimes(2);
  });
});

describe("emoji events", () => {
  function emojiEvent(
    overrides: Partial<GitLabEmojiWebhookPayload> = {}
  ): GitLabEmojiWebhookPayload {
    return {
      object_kind: "emoji",
      event_type: "award",
      user: humanUser,
      project_id: PROJECT_ID,
      project: {
        id: PROJECT_ID,
        name: "app",
        path_with_namespace: "acme/app",
        web_url: "https://gitlab.example.com/acme/app",
      },
      object_attributes: {
        id: 1,
        user_id: 1,
        name: "thumbsup",
        awardable_type: "Note",
        awardable_id: 500,
        action: "award",
      },
      note: {
        id: 500,
        author_id: BOT_USER_ID,
        note: "Done",
        noteable_type: "MergeRequest",
        discussion_id: DISCUSSION_ID,
        type: "DiscussionNote",
        created_at: "2026-10-01T10:00:00.000Z",
        updated_at: "2026-10-01T10:00:00.000Z",
      },
      merge_request: { id: 7, iid: 3 },
      ...overrides,
    };
  }

  it("dispatches an added reaction on a comment", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(emojiEvent(), { "x-gitlab-event": "Emoji Hook" })
    );
    expect(chat.processReaction).toHaveBeenCalledOnce();
    const [event] = vi.mocked(chat.processReaction).mock.calls[0];
    expect(event).toMatchObject({
      added: true,
      messageId: "500",
      rawEmoji: "thumbsup",
      threadId: `gitlab:42:mr:3:${DISCUSSION_ID}`,
      user: { userId: "1", userName: "ada" },
    });
    expect(event.emoji.name).toBe("thumbs_up");
  });

  it.each([
    ["pencil", "memo"],
    ["hugging", "hug"],
    ["thumbsup", "thumbs_up"],
  ])("normalizes the GitLab award %s to %s", async (gitlabName, normalized) => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        emojiEvent({
          object_attributes: {
            ...emojiEvent().object_attributes,
            name: gitlabName,
          },
        }),
        { "x-gitlab-event": "Emoji Hook" }
      )
    );
    const [event] = vi.mocked(chat.processReaction).mock.calls[0];
    expect(event.emoji).toBe(getEmoji(normalized));
    expect(event.rawEmoji).toBe(gitlabName);
  });

  it("uses the note's discussion thread for reactions on top-level comments", async () => {
    const { adapter, chat } = await setup();
    const base = emojiEvent();
    await adapter.handleWebhook(
      webhookRequest(
        emojiEvent({ note: base.note && { ...base.note, type: null } }),
        { "x-gitlab-event": "Emoji Hook" }
      )
    );
    const [event] = vi.mocked(chat.processReaction).mock.calls[0];
    expect(event.threadId).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
  });

  it("dispatches a removed reaction", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        emojiEvent({
          object_attributes: {
            ...emojiEvent().object_attributes,
            action: "revoke",
          },
        }),
        { "x-gitlab-event": "Emoji Hook" }
      )
    );
    const [event] = vi.mocked(chat.processReaction).mock.calls[0];
    expect(event.added).toBe(false);
  });

  it("ignores reactions on the merge request itself", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(
        emojiEvent({
          note: undefined,
          object_attributes: {
            ...emojiEvent().object_attributes,
            awardable_type: "MergeRequest",
          },
        }),
        { "x-gitlab-event": "Emoji Hook" }
      )
    );
    expect(chat.processReaction).not.toHaveBeenCalled();
  });

  it("drops reactions when the bot user is unknown and no username is configured", async () => {
    mockFetch([{ path: "/user", status: 500 }]);
    const { adapter, chat } = await setup({
      botUserId: undefined,
      userName: undefined,
    });
    const response = await adapter.handleWebhook(
      webhookRequest(emojiEvent(), { "x-gitlab-event": "Emoji Hook" })
    );
    expect(response.status).toBe(200);
    expect(chat.processReaction).not.toHaveBeenCalled();
  });

  it("ignores the bot's own reactions", async () => {
    const { adapter, chat } = await setup();
    await adapter.handleWebhook(
      webhookRequest(emojiEvent({ user: botUser }), {
        "x-gitlab-event": "Emoji Hook",
      })
    );
    expect(chat.processReaction).not.toHaveBeenCalled();
  });

  it("ignores reactions on internal notes and confidential issues", async () => {
    const { adapter, chat } = await setup();
    const base = emojiEvent();
    await adapter.handleWebhook(
      webhookRequest(
        emojiEvent({ note: base.note && { ...base.note, internal: true } }),
        { "x-gitlab-event": "Emoji Hook" }
      )
    );
    await adapter.handleWebhook(
      webhookRequest(
        emojiEvent({
          merge_request: undefined,
          note: base.note && { ...base.note, noteable_type: "Issue" },
          issue: { id: 92, iid: 17, confidential: true },
        }),
        { "x-gitlab-event": "Emoji Hook" }
      )
    );
    expect(chat.processReaction).not.toHaveBeenCalled();
  });
});

describe("postMessage", () => {
  it("posts a new comment on a merge request thread", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.postMessage(
      "gitlab:42:mr:3",
      "Hello **world**"
    );

    expect(calls[0].body).toEqual({ body: "Hello **world**" });
    expect(result).toMatchObject({
      id: "500",
      threadId: "gitlab:42:mr:3",
      raw: { projectId: 42, noteableType: "merge_request", noteableIid: 3 },
    });
  });

  it("replies inside a discussion thread", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/issues/17/discussions/${DISCUSSION_ID}/notes`,
        status: 201,
        body: restNote({ type: "DiscussionNote" }),
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.postMessage(
      `gitlab:42:issue:17:${DISCUSSION_ID}`,
      { markdown: "Reply" }
    );
    expect(calls[0].body).toEqual({ body: "Reply" });
    expect(result.raw.discussionId).toBe(DISCUSSION_ID);
  });

  it("posts to the discussion notes endpoint for a merge request discussion thread", async () => {
    const path = `/projects/${PROJECT_ID}/merge_requests/3/discussions/${DISCUSSION_ID}/notes`;
    mockFetch([
      {
        method: "POST",
        path,
        status: 201,
        body: restNote({ type: "DiscussionNote" }),
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.postMessage(
      `gitlab:42:mr:3:${DISCUSSION_ID}`,
      "On it"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe(`/api/v4${path}`);
    expect(result.threadId).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
  });

  it("posts markdown with GitLab references unchanged", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    await adapter.postMessage("gitlab:42:mr:3", {
      markdown: "Fixes ~bug, see !12 and snake_case",
    });
    expect(calls[0].body).toEqual({
      body: "Fixes ~bug, see !12 and snake_case",
    });
  });

  it("renders cards as markdown and converts emoji placeholders", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    await adapter.postMessage("gitlab:42:mr:3", {
      card: {
        type: "card",
        title: "Review {{emoji:rocket}}",
        children: [{ type: "text", content: "Looks good" }],
      },
    });
    expect(calls[0].body).toEqual({ body: "**Review 🚀**\n\nLooks good" });
  });

  it("uploads files and appends their markdown", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/uploads`,
        status: 201,
        body: { markdown: "![report](/uploads/abc/report.png)" },
      },
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    await adapter.postMessage("gitlab:42:mr:3", {
      markdown: "See attached",
      files: [
        {
          data: Buffer.from("png-bytes"),
          filename: "report.png",
          mimeType: "image/png",
        },
      ],
    });
    expect(calls[0].body).toBeInstanceOf(FormData);
    const file = (calls[0].body as FormData).get("file") as File;
    expect(file.name).toBe("report.png");
    expect(calls[1].body).toEqual({
      body: "See attached\n\n![report](/uploads/abc/report.png)",
    });
  });

  it("keeps file references in order when uploads finish out of order", async () => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = new URL(input.toString());
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
        calls.push({ url, method, body, headers: new Headers(init?.headers) });
        if (url.pathname.endsWith("/uploads")) {
          const file = (body as FormData).get("file") as File;
          // The first file finishes last.
          if (file.name === "first.txt") {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return new Response(
            JSON.stringify({
              markdown: `[${file.name}](/uploads/${file.name})`,
            }),
            { status: 201, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify(restNote()), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      })
    );
    const { adapter } = await setup();
    await adapter.postMessage("gitlab:42:mr:3", {
      markdown: "Files",
      files: [
        { data: Buffer.from("1"), filename: "first.txt" },
        { data: Buffer.from("2"), filename: "second.txt" },
      ],
    });
    const notePost = calls.find((c) => c.url.pathname.endsWith("/notes"));
    expect(notePost?.body).toEqual({
      body: "Files\n\n[first.txt](/uploads/first.txt)\n\n[second.txt](/uploads/second.txt)",
    });
  });

  it("learns the bot user ID from its first posted comment", async () => {
    mockFetch([
      { path: "/user", status: 500 },
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup({ botUserId: undefined });
    expect(adapter.botUserId).toBeUndefined();
    await adapter.postMessage("gitlab:42:mr:3", "hi");
    expect(adapter.botUserId).toBe(String(BOT_USER_ID));
  });

  it("maps API errors to adapter errors", async () => {
    const { adapter } = await setup();
    const path = `/projects/${PROJECT_ID}/merge_requests/3/notes`;

    mockFetch([{ method: "POST", path, status: 401 }]);
    await expect(adapter.postMessage("gitlab:42:mr:3", "x")).rejects.toThrow(
      AuthenticationError
    );

    mockFetch([{ method: "POST", path, status: 403 }]);
    await expect(adapter.postMessage("gitlab:42:mr:3", "x")).rejects.toThrow(
      PermissionError
    );

    mockFetch([
      { method: "POST", path, status: 429, headers: { "retry-after": "30" } },
    ]);
    await expect(
      adapter.postMessage("gitlab:42:mr:3", "x")
    ).rejects.toMatchObject({ retryAfter: 30 });
    await expect(adapter.postMessage("gitlab:42:mr:3", "x")).rejects.toThrow(
      AdapterRateLimitError
    );

    mockFetch([{ method: "POST", path, status: 500 }]);
    await expect(adapter.postMessage("gitlab:42:mr:3", "x")).rejects.toThrow(
      NetworkError
    );
  });

  it.each([
    [
      "a message string",
      400,
      { message: "Note can't be blank" },
      BLANK_NOTE_REASON,
    ],
    [
      "field errors",
      422,
      { message: { note: ["is too long", "contains spam"] } },
      FIELD_ERRORS_REASON,
    ],
    ["an error string", 400, { error: "body is missing" }, ERROR_FIELD_REASON],
  ])("maps a %s validation response to ValidationError", async (_label, status, body, reason) => {
    const path = `/projects/${PROJECT_ID}/merge_requests/3/notes`;
    mockFetch([{ method: "POST", path, status, body }]);
    const { adapter } = await setup();
    const error = await adapter
      .postMessage("gitlab:42:mr:3", "x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(reason);
  });
});

describe("editMessage and deleteMessage", () => {
  it("edits a comment through the notes API", async () => {
    mockFetch([
      {
        method: "PUT",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes/500`,
        body: restNote({ body: "Updated" }),
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.editMessage(
      `gitlab:42:mr:3:${DISCUSSION_ID}`,
      "500",
      "Updated"
    );
    expect(calls[0].body).toEqual({ body: "Updated" });
    expect(result.id).toBe("500");
  });

  it("deletes a comment", async () => {
    mockFetch([
      {
        method: "DELETE",
        path: `/projects/${PROJECT_ID}/issues/17/notes/500`,
        status: 204,
      },
    ]);
    const { adapter } = await setup();
    await adapter.deleteMessage("gitlab:42:issue:17", "500");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("stream", () => {
  it("buffers chunks and posts one comment", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    async function* chunks() {
      yield "Hello ";
      yield { type: "markdown_text" as const, text: "world" };
    }
    await adapter.stream("gitlab:42:mr:3", chunks());
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ body: "Hello world" });
  });

  it("posts streamed markdown unchanged", async () => {
    mockFetch([
      {
        method: "POST",
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes`,
        status: 201,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    async function* chunks() {
      yield "Fixes ~bug, ";
      yield "see !12";
    }
    await adapter.stream("gitlab:42:mr:3", chunks());
    expect(calls[0].body).toEqual({ body: "Fixes ~bug, see !12" });
  });

  it("throws ValidationError for an empty stream without calling the API", async () => {
    const { adapter } = await setup();
    async function* chunks() {
      yield "  ";
      yield { type: "markdown_text" as const, text: "\n" };
    }
    await expect(adapter.stream("gitlab:42:mr:3", chunks())).rejects.toThrow(
      ValidationError
    );
    expect(calls).toHaveLength(0);
  });
});

describe("reactions", () => {
  const awardPath = `/projects/${PROJECT_ID}/merge_requests/3/notes/500/award_emoji`;

  it("adds a reaction with the GitLab emoji name", async () => {
    mockFetch([{ method: "POST", path: awardPath, status: 201, body: {} }]);
    const { adapter } = await setup();
    await adapter.addReaction("gitlab:42:mr:3", "500", "thumbs_up");
    expect(calls[0].body).toEqual({ name: "thumbsup" });
  });

  it("maps Slack-style alias strings to GitLab canonical names", async () => {
    mockFetch([{ method: "POST", path: awardPath, status: 201, body: {} }]);
    const { adapter } = await setup();
    await adapter.addReaction("gitlab:42:mr:3", "500", "thinking_face");
    await adapter.addReaction("gitlab:42:mr:3", "500", "+1");
    await adapter.addReaction("gitlab:42:mr:3", "500", "cry");
    await adapter.addReaction("gitlab:42:mr:3", "500", "rocket");
    expect(calls.map((c) => c.body)).toEqual([
      { name: "thinking" },
      { name: "thumbsup" },
      { name: "sob" },
      { name: "rocket" },
    ]);
  });

  it("treats a reaction the bot already gave as success", async () => {
    mockFetch([
      { method: "POST", path: awardPath, status: 404, body: {} },
      {
        path: awardPath,
        body: [{ id: 3, name: "thumbsup", user: botUser }],
      },
    ]);
    const { adapter } = await setup();
    await expect(
      adapter.addReaction("gitlab:42:mr:3", "500", "thumbs_up")
    ).resolves.toBeUndefined();
  });

  it("rethrows a 404 for an emoji the bot hasn't given", async () => {
    mockFetch([
      { method: "POST", path: awardPath, status: 404, body: {} },
      { path: awardPath, body: [] },
    ]);
    const { adapter } = await setup();
    await expect(
      adapter.addReaction("gitlab:42:mr:3", "500", "not_an_emoji")
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("falls back to the shared shortcode for other emoji", async () => {
    mockFetch([{ method: "POST", path: awardPath, status: 201, body: {} }]);
    const { adapter } = await setup();
    await adapter.addReaction("gitlab:42:mr:3", "500", "party");
    expect(calls[0].body).toEqual({ name: "tada" });
  });

  it.each([
    ["hug", "hugging"],
    ["memo", "pencil"],
    ["facepalm", "face_palm"],
    ["email", "e-mail"],
    ["medal", "first_place"],
    ["green_circle", "green_circle"],
    ["yellow_circle", "yellow_circle"],
    ["rain", "cloud_rain"],
    ["thumbs_up", "thumbsup"],
  ])("maps %s to the GitLab award name %s", async (emoji, gitlabName) => {
    mockFetch([{ method: "POST", path: awardPath, status: 201, body: {} }]);
    const { adapter } = await setup();
    await adapter.addReaction("gitlab:42:mr:3", "500", emoji);
    expect(calls[0].body).toEqual({ name: gitlabName });
  });

  it("removes a reaction stored under GitLab's canonical name", async () => {
    mockFetch([
      {
        path: awardPath,
        body: [{ id: 4, name: "hugging", user: botUser }],
      },
      { method: "DELETE", path: `${awardPath}/4`, status: 204 },
    ]);
    const { adapter } = await setup();
    await adapter.removeReaction("gitlab:42:mr:3", "500", "hug");
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET /api/v4${awardPath}`,
      `DELETE /api/v4${awardPath}/4`,
    ]);
  });

  it("follows x-next-page when looking for the bot's award", async () => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL | string, init?: RequestInit) => {
        const url = new URL(input.toString());
        const method = init?.method ?? "GET";
        calls.push({
          url,
          method,
          body: undefined,
          headers: new Headers(init?.headers),
        });
        if (method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        const page = url.searchParams.get("page");
        const awards =
          page === "1"
            ? [
                { id: 1, name: "thumbsup", user: humanUser },
                { id: 2, name: "eyes", user: botUser },
              ]
            : [{ id: 3, name: "thumbsup", user: botUser }];
        return Promise.resolve(
          new Response(JSON.stringify(awards), {
            headers: { "x-next-page": page === "1" ? "2" : "" },
          })
        );
      })
    );
    const { adapter } = await setup();
    await adapter.removeReaction("gitlab:42:mr:3", "500", "thumbs_up");
    expect(
      calls.map(
        (c) =>
          `${c.method} ${c.url.pathname} ${c.url.searchParams.get("page") ?? ""}`
      )
    ).toEqual([
      `GET /api/v4${awardPath} 1`,
      `GET /api/v4${awardPath} 2`,
      `DELETE /api/v4${awardPath}/3 `,
    ]);
  });

  it("throws when the bot user ID is still unknown", async () => {
    mockFetch([{ path: "/user", status: 500 }]);
    const { adapter } = await setup({ botUserId: undefined });
    await expect(
      adapter.removeReaction("gitlab:42:mr:3", "500", "thumbs_up")
    ).rejects.toThrow(ValidationError);
    // The retry is inside the cooldown that started at initialize, so only
    // the initial lookup hits the API.
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "GET /api/v4/user",
    ]);
  });

  it("removes only the bot's matching reaction", async () => {
    mockFetch([
      {
        path: awardPath,
        body: [
          { id: 1, name: "thumbsup", user: humanUser },
          { id: 2, name: "eyes", user: botUser },
          { id: 3, name: "thumbsup", user: botUser },
        ],
      },
      { method: "DELETE", path: `${awardPath}/3`, status: 204 },
    ]);
    const { adapter } = await setup();
    await adapter.removeReaction("gitlab:42:mr:3", "500", "thumbs_up");
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET /api/v4${awardPath}`,
      `DELETE /api/v4${awardPath}/3`,
    ]);
  });

  it("does nothing when the bot has not reacted", async () => {
    mockFetch([{ path: awardPath, body: [] }]);
    const { adapter } = await setup();
    await adapter.removeReaction("gitlab:42:mr:3", "500", "thumbs_up");
    expect(calls).toHaveLength(1);
  });
});

describe("fetchMessages", () => {
  const discussionsPath = `/projects/${PROJECT_ID}/merge_requests/3/discussions`;
  const notesPath = `/projects/${PROJECT_ID}/merge_requests/3/notes`;
  const issueNotesPath = `/projects/${PROJECT_ID}/issues/17/notes`;

  it("returns a page of comments for a merge request thread, oldest first", async () => {
    mockFetch([
      {
        path: notesPath,
        // GitLab returns newest first for sort=desc.
        body: [
          restNote({
            id: 4,
            body: "reply",
            type: "DiscussionNote",
            created_at: "2026-10-01T12:00:00.000Z",
          }),
          restNote({
            id: 3,
            body: "changed the title",
            system: true,
            created_at: "2026-10-01T11:30:00.000Z",
          }),
          restNote({
            id: 2,
            body: "second",
            created_at: "2026-10-01T11:00:00.000Z",
          }),
          restNote({
            id: 1,
            body: "first",
            type: "DiffNote",
            created_at: "2026-10-01T09:00:00.000Z",
          }),
        ],
        headers: { "x-next-page": "2" },
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.fetchMessages("gitlab:42:mr:3", { limit: 4 });

    expect(result.messages.map((m) => m.text)).toEqual([
      "first",
      "second",
      "reply",
    ]);
    expect(result.messages[0].threadId).toBe("gitlab:42:mr:3");
    expect(result.nextCursor).toBe("2");
    expect(calls).toHaveLength(1);
    const params = calls[0].url.searchParams;
    expect(params.get("order_by")).toBe("created_at");
    expect(params.get("sort")).toBe("desc");
    expect(params.get("per_page")).toBe("4");
    expect(params.has("page")).toBe(false);
  });

  it("pages forward with the cursor and stops on the last page", async () => {
    mockFetch([
      {
        path: issueNotesPath,
        body: [
          restNote({
            id: 1,
            body: "first",
            created_at: "2026-10-01T09:00:00.000Z",
          }),
          restNote({
            id: 2,
            body: "second",
            created_at: "2026-10-01T11:00:00.000Z",
          }),
        ],
        headers: { "x-next-page": "" },
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.fetchMessages("gitlab:42:issue:17", {
      cursor: "3",
      direction: "forward",
      limit: 500,
    });

    expect(result.messages.map((m) => m.text)).toEqual(["first", "second"]);
    expect(result.nextCursor).toBeUndefined();
    const params = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toBe(`/api/v4${issueNotesPath}`);
    expect(params.get("sort")).toBe("asc");
    expect(params.get("per_page")).toBe("100");
    expect(params.get("page")).toBe("3");
  });

  it("returns a discussion's comments for a discussion thread", async () => {
    mockFetch([
      {
        path: `${discussionsPath}/${DISCUSSION_ID}`,
        body: {
          id: DISCUSSION_ID,
          individual_note: false,
          notes: [
            restNote({ id: 1, body: "root", type: "DiffNote" }),
            restNote({
              id: 2,
              body: "reply",
              type: "DiffNote",
              created_at: "2026-10-01T12:00:00.000Z",
            }),
          ],
        },
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.fetchMessages(
      `gitlab:42:mr:3:${DISCUSSION_ID}`
    );
    expect(result.messages.map((m) => m.text)).toEqual(["root", "reply"]);
    expect(result.messages[1].threadId).toBe(`gitlab:42:mr:3:${DISCUSSION_ID}`);
  });

  it("applies limit and direction", async () => {
    const notes = [1, 2, 3].map((id) =>
      restNote({
        id,
        body: `n${id}`,
        created_at: `2026-10-0${id}T00:00:00.000Z`,
      })
    );
    mockFetch([
      {
        path: `${discussionsPath}/${DISCUSSION_ID}`,
        body: { id: DISCUSSION_ID, individual_note: false, notes },
      },
    ]);
    const { adapter } = await setup();
    const threadId = `gitlab:42:mr:3:${DISCUSSION_ID}`;
    const backward = await adapter.fetchMessages(threadId, { limit: 2 });
    expect(backward.messages.map((m) => m.text)).toEqual(["n2", "n3"]);
    const forward = await adapter.fetchMessages(threadId, {
      limit: 2,
      direction: "forward",
    });
    expect(forward.messages.map((m) => m.text)).toEqual(["n1", "n2"]);
  });
});

describe("fetchMessage", () => {
  it("returns a single comment", async () => {
    mockFetch([
      {
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes/500`,
        body: restNote(),
      },
    ]);
    const { adapter } = await setup();
    const message = await adapter.fetchMessage("gitlab:42:mr:3", "500");
    expect(message?.id).toBe("500");
    expect(message?.author.isMe).toBe(true);
  });

  it("returns null for a missing comment", async () => {
    mockFetch([
      {
        path: `/projects/${PROJECT_ID}/merge_requests/3/notes/500`,
        status: 404,
      },
    ]);
    const { adapter } = await setup();
    expect(await adapter.fetchMessage("gitlab:42:mr:3", "500")).toBeNull();
  });

  it("returns null for a listThreads root message ID without an API call", async () => {
    mockFetch([]);
    const { adapter } = await setup();
    expect(await adapter.fetchMessage("gitlab:42:mr:3", "mr-3")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rejects note operations on a non-note ID", async () => {
    mockFetch([]);
    const { adapter } = await setup();
    await expect(
      adapter.addReaction("gitlab:42:mr:3", "mr-3", "thumbs_up")
    ).rejects.toThrow(ValidationError);
    await expect(
      adapter.editMessage("gitlab:42:mr:3", "mr-3", "x")
    ).rejects.toThrow(ValidationError);
    await expect(
      adapter.deleteMessage("gitlab:42:mr:3", "mr-3")
    ).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(0);
  });
});

describe("thread, channel, and subject metadata", () => {
  const mergeRequest = {
    id: 7,
    iid: 3,
    project_id: PROJECT_ID,
    title: "Add feature",
    description: "Implements the feature",
    state: "opened",
    web_url: "https://gitlab.example.com/acme/app/-/merge_requests/3",
    author: humanUser,
    assignees: [botUser],
    labels: ["backend", "review"],
    references: { short: "!3", full: "acme/app!3" },
    created_at: "2026-10-01T08:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
  };

  it("fetches thread info from the merge request", async () => {
    mockFetch([
      { path: `/projects/${PROJECT_ID}/merge_requests/3`, body: mergeRequest },
    ]);
    const { adapter } = await setup();
    const info = await adapter.fetchThread("gitlab:42:mr:3");
    expect(info).toMatchObject({
      id: "gitlab:42:mr:3",
      channelId: "gitlab:42",
      channelName: "acme/app!3",
      isDM: false,
      metadata: { title: "Add feature", state: "opened" },
    });
  });

  it("derives the channel ID from a thread ID", () => {
    expect(
      createAdapter().channelIdFromThreadId(`gitlab:42:mr:3:${DISCUSSION_ID}`)
    ).toBe("gitlab:42");
  });

  it("rejects malformed thread and channel IDs", async () => {
    const adapter = createAdapter();
    expect(() => adapter.decodeThreadId("github:acme/app:1")).toThrow(
      INVALID_THREAD_ID
    );
    expect(() => adapter.decodeThreadId("gitlab:acme:mr:1")).toThrow(
      INVALID_THREAD_ID
    );
    await expect(adapter.fetchChannelInfo("gitlab:acme/app")).rejects.toThrow(
      INVALID_CHANNEL_ID
    );
  });

  it("fetches channel info from the project", async () => {
    mockFetch([
      {
        path: `/projects/${PROJECT_ID}`,
        body: {
          id: PROJECT_ID,
          name: "app",
          path_with_namespace: "acme/app",
          description: "The app",
          visibility: "private",
          default_branch: "main",
          open_issues_count: 4,
          web_url: "https://gitlab.example.com/acme/app",
        },
      },
    ]);
    const { adapter } = await setup();
    const info = await adapter.fetchChannelInfo("gitlab:42");
    expect(info).toMatchObject({
      id: "gitlab:42",
      name: "acme/app",
      metadata: { defaultBranch: "main", visibility: "private" },
    });
  });

  it("lists open merge requests as threads", async () => {
    mockFetch([
      {
        path: `/projects/${PROJECT_ID}/merge_requests`,
        body: [mergeRequest],
        headers: { "x-next-page": "2" },
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.listThreads("gitlab:42", { limit: 1 });
    expect(calls[0].url.searchParams.get("state")).toBe("opened");
    expect(result.threads[0]).toMatchObject({
      id: "gitlab:42:mr:3",
      rootMessage: { id: "mr-3", text: "Implements the feature" },
    });
    expect(result.nextCursor).toBe("2");
  });

  it("caps the page size at 100 and stops on the last page", async () => {
    mockFetch([
      {
        path: `/projects/${PROJECT_ID}/merge_requests`,
        body: [mergeRequest],
        headers: { "x-next-page": "" },
      },
    ]);
    const { adapter } = await setup();
    const result = await adapter.listThreads("gitlab:42", { limit: 200 });
    expect(calls[0].url.searchParams.get("per_page")).toBe("100");
    expect(result.nextCursor).toBeUndefined();
  });

  it("ignores a non-numeric cursor", async () => {
    mockFetch([{ path: `/projects/${PROJECT_ID}/merge_requests`, body: [] }]);
    const { adapter } = await setup();
    await adapter.listThreads("gitlab:42", { cursor: "abc" });
    expect(calls[0].url.searchParams.get("page")).toBe("1");
  });

  it("resolves the message subject", async () => {
    mockFetch([
      { path: `/projects/${PROJECT_ID}/merge_requests/3`, body: mergeRequest },
    ]);
    const { adapter } = await setup();
    const subject = await adapter.fetchSubject({
      note: restNote(),
      projectId: PROJECT_ID,
      noteableType: "merge_request",
      noteableIid: 3,
    });
    expect(subject).toMatchObject({
      type: "merge_request",
      id: "3",
      title: "Add feature",
      status: "opened",
      author: { id: "1", name: "ada" },
      assignee: { id: String(BOT_USER_ID), name: "project_42_bot_abc123" },
      labels: ["backend", "review"],
    });
  });

  it("returns null when the subject lookup fails", async () => {
    mockFetch([{ path: `/projects/${PROJECT_ID}/issues/17`, status: 404 }]);
    const { adapter } = await setup();
    const subject = await adapter.fetchSubject({
      note: restNote(),
      projectId: PROJECT_ID,
      noteableType: "issue",
      noteableIid: 17,
    });
    expect(subject).toBeNull();
  });

  it("looks up users", async () => {
    mockFetch([
      {
        path: "/users/1",
        body: { ...humanUser, public_email: "ada@example.com", bot: false },
      },
    ]);
    const { adapter } = await setup();
    expect(await adapter.getUser("1")).toEqual({
      avatarUrl: humanUser.avatar_url,
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      isBot: false,
      userId: "1",
      userName: "ada",
    });
  });

  it("returns null for an unknown user", async () => {
    mockFetch([{ path: "/users/404", status: 404 }]);
    const { adapter } = await setup();
    expect(await adapter.getUser("404")).toBeNull();
  });
});

describe("request", () => {
  it("calls arbitrary endpoints with query parameters", async () => {
    mockFetch([{ path: `/projects/${PROJECT_ID}/pipelines`, body: [] }]);
    const { adapter } = await setup();
    await adapter.request("GET", `/projects/${PROJECT_ID}/pipelines`, {
      query: { ref: "main", status: undefined },
    });
    expect(calls[0].url.searchParams.get("ref")).toBe("main");
    expect(calls[0].url.searchParams.has("status")).toBe(false);
  });

  it("defaults to gitlab.com", async () => {
    mockFetch([{ path: "/version", body: {} }]);
    const adapter = createAdapter({ apiUrl: undefined });
    await adapter.request("GET", "/version");
    expect(calls[0].url.origin).toBe("https://gitlab.com");
  });
});
