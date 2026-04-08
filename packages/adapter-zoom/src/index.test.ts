import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createZoomAdapter } from "./index.js";

const TEST_SECRET = "test-webhook-secret";
const TEST_CREDENTIALS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  robotJid: "test-robot-jid",
  accountId: "test-account-id",
  webhookSecretToken: TEST_SECRET,
};

function makeSignature(body: string, timestamp: string): string {
  const message = `v0:${timestamp}:${body}`;
  const hash = createHmac("sha256", TEST_SECRET).update(message).digest("hex");
  return `v0=${hash}`;
}

function makeZoomRequest(
  body: string,
  overrides?: {
    signature?: string;
    timestamp?: string;
  }
): Request {
  const timestamp =
    overrides?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = overrides?.signature ?? makeSignature(body, timestamp);
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-signature": signature,
      "x-zm-request-timestamp": timestamp,
    },
    body,
  });
}

describe("ZoomAdapter — Webhook Verification (WBHK-01, WBHK-02, WBHK-03)", () => {
  it("WBHK-01: endpoint.url_validation returns { plainToken, encryptedToken } with HTTP 200", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const plainToken = "abc123";
    const body = JSON.stringify({
      event: "endpoint.url_validation",
      payload: { plainToken },
    });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    const expectedEncryptedToken = createHmac("sha256", TEST_SECRET)
      .update(plainToken)
      .digest("hex");
    expect(json).toEqual({
      plainToken,
      encryptedToken: expectedEncryptedToken,
    });
  });

  it("WBHK-02: tampered x-zm-signature returns HTTP 401", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const request = makeZoomRequest(body, { signature: "v0=deadbeef" });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("WBHK-02: missing x-zm-signature returns HTTP 401", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zm-request-timestamp": timestamp,
      },
      body,
    });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("WBHK-02: stale timestamp (>5 minutes) returns HTTP 401", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 360);
    const request = makeZoomRequest(body, { timestamp: staleTimestamp });

    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("WBHK-03: valid signature with correct raw body passes verification", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const body = JSON.stringify({ event: "bot_notification", payload: {} });
    const request = makeZoomRequest(body);

    const response = await adapter.handleWebhook(request);

    // Verification passed — status should NOT be 401.
    // processEvent is a stub in Phase 1, so 200 ("ok") or any non-401 is acceptable.
    expect(response.status).not.toBe(401);
  });
});

describe("ZoomAdapter — S2S OAuth Token (AUTH-01, AUTH-02, AUTH-04)", () => {
  function mockTokenFetch(token = "access-token-1", expiresIn = 3600) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: token,
          token_type: "bearer",
          expires_in: expiresIn,
        }),
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("AUTH-01: getAccessToken calls https://zoom.us/oauth/token?grant_type=client_credentials", async () => {
    const fetchMock = mockTokenFetch();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    await adapter.getAccessToken();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://zoom.us/oauth/token?grant_type=client_credentials",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("AUTH-02: token is reused within 1-hour TTL", async () => {
    const fetchMock = mockTokenFetch();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    await adapter.getAccessToken();
    await adapter.getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AUTH-02: new token is fetched after TTL expires", async () => {
    vi.useFakeTimers();
    const fetchMock = mockTokenFetch();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    await adapter.getAccessToken();
    vi.advanceTimersByTime(3700 * 1000); // past 1-hour TTL
    await adapter.getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("AUTH-04: token fetch uses grant_type=client_credentials (not account_credentials)", async () => {
    const fetchMock = mockTokenFetch();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    await adapter.getAccessToken();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("grant_type=client_credentials");
    expect(url).not.toContain("account_credentials");
  });
});

describe("ZoomAdapter — Factory Validation (AUTH-03)", () => {
  const BASE = {
    clientId: "id",
    clientSecret: "secret",
    robotJid: "jid",
    accountId: "acct",
    webhookSecretToken: "token",
  };

  it("throws ValidationError when clientId is missing", () => {
    expect(() => createZoomAdapter({ ...BASE, clientId: undefined })).toThrow(
      ValidationError
    );
  });

  it("throws ValidationError when clientSecret is missing", () => {
    expect(() =>
      createZoomAdapter({ ...BASE, clientSecret: undefined })
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when robotJid is missing", () => {
    expect(() => createZoomAdapter({ ...BASE, robotJid: undefined })).toThrow(
      ValidationError
    );
  });

  it("throws ValidationError when accountId is missing", () => {
    expect(() => createZoomAdapter({ ...BASE, accountId: undefined })).toThrow(
      ValidationError
    );
  });

  it("throws ValidationError when webhookSecretToken is missing", () => {
    expect(() =>
      createZoomAdapter({ ...BASE, webhookSecretToken: undefined })
    ).toThrow(ValidationError);
  });
});

describe("ZoomAdapter — Thread ID (THRD-01)", () => {
  const adapter = createZoomAdapter(TEST_CREDENTIALS);

  it("THRD-01: encodeThreadId produces zoom:{channelId}:{messageId}", () => {
    expect(
      adapter.encodeThreadId({ channelId: "chan123", messageId: "999" })
    ).toBe("zoom:chan123:999");
    expect(
      adapter.encodeThreadId({
        channelId: "chan@conference.xmpp.zoom.us",
        messageId: "abc-uuid",
      })
    ).toBe("zoom:chan@conference.xmpp.zoom.us:abc-uuid");
  });

  it("THRD-01: decodeThreadId round-trips without loss", () => {
    expect(adapter.decodeThreadId("zoom:chan123:999")).toEqual({
      channelId: "chan123",
      messageId: "999",
    });
    expect(
      adapter.decodeThreadId("zoom:chan@conference.xmpp.zoom.us:abc-uuid")
    ).toEqual({
      channelId: "chan@conference.xmpp.zoom.us",
      messageId: "abc-uuid",
    });
  });

  it("THRD-01: decodeThreadId throws ValidationError on wrong prefix", () => {
    expect(() => adapter.decodeThreadId("slack:C123:ts")).toThrow(
      ValidationError
    );
  });

  it("THRD-01: decodeThreadId throws ValidationError on missing messageId", () => {
    expect(() => adapter.decodeThreadId("zoom:only-one-part")).toThrow(
      ValidationError
    );
  });

  it("THRD-01: decodeThreadId throws ValidationError on empty channel component", () => {
    expect(() => adapter.decodeThreadId("zoom::msgid")).toThrow(
      ValidationError
    );
  });
});

function makeMockChat(): ChatInstance {
  return {
    processMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInstance;
}

describe("ZoomAdapter — bot_notification (WBHK-04)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("WBHK-04: channel message produces correct threadId, text, author", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const chat = makeMockChat();
    await adapter.initialize(chat);

    const eventTs = 1712600000000;
    const toJid = "abc123@conference.xmpp.zoom.us";
    const body = JSON.stringify({
      event: "bot_notification",
      event_ts: eventTs,
      payload: {
        accountId: "acct",
        cmd: "hello world",
        robotJid: "bot@xmpp.zoom.us",
        timestamp: eventTs,
        toJid,
        userId: "user-id-1",
        userJid: "user@xmpp.zoom.us",
        userName: "Alice",
      },
    });
    const request = makeZoomRequest(body);
    await adapter.handleWebhook(request);

    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = (
      chat.processMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(threadId).toBe(`zoom:${toJid}:${eventTs}`);
    expect(message.text).toBe("hello world");
    expect(message.author.userId).toBe("user-id-1");
    expect(message.author.userName).toBe("Alice");
  });

  it("WBHK-04: DM (toJid ends in @xmpp.zoom.us) uses userJid as channelId", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const chat = makeMockChat();
    await adapter.initialize(chat);

    const eventTs = 1712600001000;
    const userJid = "user@xmpp.zoom.us";
    const body = JSON.stringify({
      event: "bot_notification",
      event_ts: eventTs,
      payload: {
        accountId: "acct",
        cmd: "dm message",
        robotJid: "bot@xmpp.zoom.us",
        timestamp: eventTs,
        toJid: userJid, // user JID, not conference JID -> DM
        userId: "user-id-2",
        userJid,
        userName: "Bob",
      },
    });
    const request = makeZoomRequest(body);
    await adapter.handleWebhook(request);

    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId] = (chat.processMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(threadId).toBe(`zoom:${userJid}:${eventTs}`);
  });
});

describe("ZoomAdapter — team_chat.app_mention (WBHK-05)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("WBHK-05: produces correct threadId (channel_id:message_id), text, author", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    const chat = makeMockChat();
    await adapter.initialize(chat);

    const messageId = "5DD614F4-DD19-ABCD-EF12-000000000001";
    const channelId = "channel-id-123";
    const body = JSON.stringify({
      event: "team_chat.app_mention",
      event_ts: 1712600002000,
      payload: {
        account_id: "acct",
        operator: "carol@example.com",
        operator_id: "user-id-3",
        operator_member_id: "member-id-3",
        by_external_user: false,
        object: {
          message_id: messageId,
          type: "to_channel",
          channel_id: channelId,
          channel_name: "general",
          message: "@bot please help",
          date_time: "2024-04-08T12:00:00Z",
          timestamp: 1712577600000,
        },
      },
    });
    const request = makeZoomRequest(body);
    await adapter.handleWebhook(request);

    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = (
      chat.processMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(threadId).toBe(`zoom:${channelId}:${messageId}`);
    expect(message.text).toBe("@bot please help");
    expect(message.author.userId).toBe("user-id-3");
  });
});

const POST_MESSAGE_ERROR_PATTERN = /postMessage.*403|403.*postMessage/;
const EDIT_MESSAGE_ERROR_PATTERN = /editMessage.*404|404.*editMessage/;
const DELETE_MESSAGE_ERROR_PATTERN = /deleteMessage.*403|403.*deleteMessage/;

describe("ZoomAdapter — postMessage (MSG-01, MSG-02)", () => {
  function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("MSG-01-a: postMessage to channel JID calls POST to correct URL with Bearer token and to_jid", async () => {
    const fetchMock = mockFetch(200, { message_id: "msg-uuid-123" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:chan@conference.xmpp.zoom.us:msg-001";
    await adapter.postMessage(threadId, "Hello channel");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.zoom.us/v2/chat/users/test-robot-jid/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify({
          message: "Hello channel",
          to_jid: "chan@conference.xmpp.zoom.us",
        }),
      })
    );
  });

  it("MSG-01-b: postMessage to DM JID calls POST with correct body (no reply_main_message_id)", async () => {
    const fetchMock = mockFetch(200, { message_id: "msg-uuid-123" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:user@xmpp.zoom.us:msg-002";
    await adapter.postMessage(threadId, "Hello DM");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          message: "Hello DM",
          to_jid: "user@xmpp.zoom.us",
        }),
      })
    );
    const callBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(callBody).not.toHaveProperty("reply_main_message_id");
  });

  it("MSG-01-c: postMessage returns RawMessage with id, threadId, and raw", async () => {
    const fetchMock = mockFetch(200, { message_id: "msg-uuid-123" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:chan@conference.xmpp.zoom.us:msg-003";
    const result = await adapter.postMessage(threadId, "Hello");

    expect(result.id).toBe("msg-uuid-123");
    expect(result.threadId).toBe(threadId);
    expect(result.raw).toEqual({ message_id: "msg-uuid-123" });
  });

  it("MSG-02-a: postMessage with replyTo includes reply_main_message_id in body", async () => {
    const fetchMock = mockFetch(200, { message_id: "msg-uuid-456" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:chan@conference.xmpp.zoom.us:msg-004";
    // Combine a valid postable string shape with metadata for replyTo
    const replyMsg = {
      raw: "Reply text",
      metadata: { replyTo: "parent-id" },
    } as unknown as import("./index.js").AdapterPostableMessage;
    await adapter.postMessage(threadId, replyMsg);

    const callBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(callBody.reply_main_message_id).toBe("parent-id");
  });

  it("MSG-02-b: postMessage with replyTo to a DM logs debug warning about THRD-03", async () => {
    const fetchMock = mockFetch(200, { message_id: "msg-uuid-789" });
    vi.stubGlobal("fetch", fetchMock);
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const adapter = createZoomAdapter({
      ...TEST_CREDENTIALS,
      logger: mockLogger,
    });
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:user@xmpp.zoom.us:msg-005";
    // Combine a valid postable string shape with metadata for replyTo
    const replyMsg = {
      raw: "DM reply",
      metadata: { replyTo: "parent-id" },
    } as unknown as import("./index.js").AdapterPostableMessage;
    await adapter.postMessage(threadId, replyMsg);

    const debugCalls = mockLogger.debug.mock.calls as [string, ...unknown[]][];
    const hasThrd03Warning = debugCalls.some(
      ([msg]) => typeof msg === "string" && msg.includes("THRD-03")
    );
    expect(hasThrd03Warning).toBe(true);
  });

  it("zoomFetch-error: non-2xx response throws Error with operation name and status code", async () => {
    const fetchMock = mockFetch(403, { error: "Forbidden" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:chan@conference.xmpp.zoom.us:msg-006";
    await expect(adapter.postMessage(threadId, "Hello")).rejects.toThrow(
      POST_MESSAGE_ERROR_PATTERN
    );
  });
});

describe("ZoomAdapter — editMessage (MSG-03)", () => {
  function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("MSG-03-a: editMessage calls PATCH to correct URL with Bearer token and body", async () => {
    const fetchMock = mockFetch(200, { id: "msg-to-edit" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    await adapter.editMessage(
      "zoom:chan@conference.xmpp.zoom.us:msg-to-edit",
      "msg-to-edit",
      "Updated text" as unknown as import("./index.js").AdapterPostableMessage
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.zoom.us/v2/chat/messages/msg-to-edit",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify({ message: "Updated text" }),
      })
    );
  });

  it("MSG-03-b: editMessage returns RawMessage with id, threadId, and raw", async () => {
    const responseBody = { id: "msg-to-edit", updated: true };
    const fetchMock = mockFetch(200, responseBody);
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    const threadId = "zoom:chan@conference.xmpp.zoom.us:msg-to-edit";
    const result = await adapter.editMessage(
      threadId,
      "msg-to-edit",
      "Updated text" as unknown as import("./index.js").AdapterPostableMessage
    );

    expect(result.id).toBe("msg-to-edit");
    expect(result.threadId).toBe(threadId);
    expect(result.raw).toEqual(responseBody);
  });

  it("MSG-03-error: editMessage throws Error with operation name and status on non-2xx response", async () => {
    const fetchMock = mockFetch(404, { error: "Not Found" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    await expect(
      adapter.editMessage(
        "zoom:chan@conference.xmpp.zoom.us:msg-to-edit",
        "msg-to-edit",
        "Updated text" as unknown as import("./index.js").AdapterPostableMessage
      )
    ).rejects.toThrow(EDIT_MESSAGE_ERROR_PATTERN);
  });
});

describe("ZoomAdapter — deleteMessage (MSG-04)", () => {
  function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("MSG-04-a: deleteMessage calls DELETE to correct URL with Bearer token", async () => {
    const fetchMock = mockFetch(204, {});
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    await adapter.deleteMessage(
      "zoom:chan@conference.xmpp.zoom.us:msg-to-delete",
      "msg-to-delete"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.zoom.us/v2/chat/messages/msg-to-delete",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("MSG-04-b: deleteMessage returns void", async () => {
    vi.stubGlobal("fetch", mockFetch(204, {}));
    vi.spyOn(
      createZoomAdapter(TEST_CREDENTIALS),
      "getAccessToken"
    ).mockResolvedValue("test-token");
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");
    const result = await adapter.deleteMessage(
      "zoom:chan@conference.xmpp.zoom.us:msg-to-delete",
      "msg-to-delete"
    );
    expect(result).toBeUndefined();
  });

  it("MSG-04-error: deleteMessage throws Error with operation name and status on non-2xx response", async () => {
    const fetchMock = mockFetch(403, { error: "Forbidden" });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    vi.spyOn(adapter, "getAccessToken").mockResolvedValue("test-token");

    await expect(
      adapter.deleteMessage(
        "zoom:chan@conference.xmpp.zoom.us:msg-to-delete",
        "msg-to-delete"
      )
    ).rejects.toThrow(DELETE_MESSAGE_ERROR_PATTERN);
  });
});

describe("ZoomAdapter — Unhandled events and uninitialized adapter safety (THRD-02, THRD-03)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("THRD-03: unknown event is logged at debug and does not throw", async () => {
    const adapter = createZoomAdapter({ ...TEST_CREDENTIALS });
    const debugSpy = vi.spyOn(
      (
        adapter as unknown as {
          config: { logger: { debug: (msg: string, ctx: unknown) => void } };
        }
      ).config.logger,
      "debug"
    );
    const chat = makeMockChat();
    await adapter.initialize(chat);

    const body = JSON.stringify({
      event: "team_chat.some_unknown_event",
      event_ts: 1712600003000,
      payload: {},
    });
    const request = makeZoomRequest(body);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(debugSpy).toHaveBeenCalledWith("Unhandled Zoom event", {
      event: "team_chat.some_unknown_event",
    });
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("THRD-02: uninitialized adapter safety — handleWebhook returns 200 without calling processMessage", async () => {
    const adapter = createZoomAdapter(TEST_CREDENTIALS);
    // Do NOT call initialize — chat is null
    const body = JSON.stringify({
      event: "bot_notification",
      event_ts: 1712600004000,
      payload: {
        accountId: "acct",
        cmd: "hello",
        robotJid: "bot@xmpp.zoom.us",
        timestamp: 1712600004000,
        toJid: "chan@conference.xmpp.zoom.us",
        userId: "uid",
        userJid: "u@xmpp.zoom.us",
        userName: "Dave",
      },
    });
    const request = makeZoomRequest(body);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200); // no crash
  });
});
