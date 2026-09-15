import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGmailDraft,
  createGmailTokenProvider,
  GmailApiError,
  type GmailApiOptions,
  getGmailMessage,
  getGmailProfile,
  listGmailHistory,
  listGmailLabels,
  listGmailMessages,
  sendGmailMessage,
  stopGmailMailbox,
  watchGmailMailbox,
} from "./api";
import { parseGmailMessage } from "./format";
import type { GmailContinuation } from "./schema";

const continuation: GmailContinuation = {
  mailbox: "agent@example.com",
  messageId: "original",
  threadId: "thread",
  subject: "review",
  inReplyTo: "<original@example.com>",
  references: ["<original@example.com>"],
  to: [{ address: "sender@example.com" }],
};

function configuration(fetch: typeof globalThis.fetch): GmailApiOptions {
  return { mailbox: "agent@example.com", token: "test-token", fetch };
}

describe("Gmail API primitives", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves caller-owned credentials for each call without a Chat instance", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ emailAddress: "agent@example.com", historyId: "100" })
        )
      );
    const token = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const options = { ...configuration(fetch), token };
    await getGmailProfile(options);
    await getGmailProfile(options);
    expect(fetch.mock.calls.map((call) => call[1]?.headers)).toEqual([
      { authorization: "Bearer first", "content-type": "application/json" },
      { authorization: "Bearer second", "content-type": "application/json" },
    ]);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/agent%40example.com/profile"
    );
    expect(fetch.mock.calls[0][1]?.redirect).toBe("error");
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves opaque page tokens and history IDs without hidden state", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        historyId: "9007199254740995",
        nextPageToken: "next+/=",
      })
    );
    const result = await listGmailHistory(
      { startHistoryId: "9007199254740993", pageToken: "page+/=" },
      configuration(fetch)
    );
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("startHistoryId")).toBe("9007199254740993");
    expect(url.searchParams.get("pageToken")).toBe("page+/=");
    expect(result.historyId).toBe("9007199254740995");
    expect(result.nextPageToken).toBe("next+/=");
  });

  it("returns every history change without loading messages or advancing a cursor", async () => {
    const message = { id: "message", threadId: "thread", labelIds: ["INBOX"] };
    const change = {
      id: "101",
      messages: [message],
      messagesAdded: [{ message }],
      messagesDeleted: [{ message }],
      labelsAdded: [{ message, labelIds: ["INBOX"] }],
      labelsRemoved: [{ message, labelIds: ["UNREAD"] }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        history: [change],
        historyId: "102",
        nextPageToken: "next",
      })
    );
    const result = await listGmailHistory(
      {
        startHistoryId: "100",
        historyTypes: ["messageDeleted", "labelRemoved"],
        maxResults: 1,
      },
      configuration(fetch)
    );
    expect(result.history).toEqual([change]);
    expect(result.nextPageToken).toBe("next");
    const query = new URL(String(fetch.mock.calls[0][0])).searchParams;
    expect(query.getAll("historyTypes")).toEqual([
      "messageDeleted",
      "labelRemoved",
    ]);
    expect(query.get("maxResults")).toBe("1");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("lists mailbox pointers with native search and explicit pagination", async () => {
    const result = {
      messages: [{ id: "message", threadId: "thread" }],
      nextPageToken: "next+/=",
      resultSizeEstimate: 2,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(result));
    await expect(
      listGmailMessages(
        {
          q: "from:sender@example.com in:anywhere",
          includeSpamTrash: true,
          maxResults: 1,
          pageToken: "page+/=",
        },
        configuration(fetch)
      )
    ).resolves.toEqual(result);
    const query = new URL(String(fetch.mock.calls[0][0])).searchParams;
    expect(query.has("labelIds")).toBe(false);
    expect(query.get("q")).toBe("from:sender@example.com in:anywhere");
    expect(query.get("includeSpamTrash")).toBe("true");
    expect(query.get("maxResults")).toBe("1");
    expect(query.get("pageToken")).toBe("page+/=");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    0,
    -1,
    501,
    1.5,
    Number.NaN,
  ])("rejects invalid page size %s before accessing credentials", (maxResults) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const token = vi.fn();
    const options = { ...configuration(fetch), token };
    expect(() => listGmailMessages({ maxResults }, options)).toThrow();
    expect(() =>
      listGmailHistory({ startHistoryId: "100", maxResults }, options)
    ).toThrow();
    expect(token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a caller-owned whole-mailbox watch without label policy", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ historyId: "100", expiration: "1789086553000" })
      );
    await watchGmailMailbox(
      { topicName: "projects/project/topics/mail" },
      configuration(fetch)
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      topicName: "projects/project/topics/mail",
    });
  });

  it.each([
    "../profile",
    "https://attacker.example/message",
    "abc?format=full",
    "a/b",
  ])("rejects unsafe message ID %s before resolving credentials or fetching", (id) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const token = vi.fn();
    expect(() =>
      getGmailMessage(id, { ...configuration(fetch), token })
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });

  it("returns native send IDs and preserves the selected email's reply headers", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: "sent", threadId: "thread" }));
    const result = await sendGmailMessage(
      { continuation, text: "reviewed" },
      configuration(fetch)
    );
    expect(result).toEqual({ id: "sent", threadId: "thread" });
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as {
      raw: string;
      threadId: string;
    };
    const parsed = await parseGmailMessage({
      ...result,
      raw: body.raw,
      internalDate: "1788481753000",
      labelIds: ["SENT"],
    });
    expect(body.threadId).toBe(continuation.threadId);
    expect(parsed.email.subject).toBe(continuation.subject);
    expect(parsed.email.inReplyTo).toBe(continuation.inReplyTo);
    expect(parsed.email.references).toBe(continuation.references.join(" "));
    expect(parsed.email.to?.map((value) => value.address)).toEqual([
      "sender@example.com",
    ]);
    expect(parsed.email.cc).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("creates a draft without sending or importing approval/session state", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        id: "draft",
        message: { id: "message", threadId: "thread" },
      })
    );
    const result = await createGmailDraft(
      { continuation, text: "pending approval" },
      configuration(fetch)
    );
    expect(result.id).toBe("draft");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/agent%40example.com/drafts"
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a reply continuation from a different mailbox before sending", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(() =>
      sendGmailMessage(
        { continuation, text: "reply" },
        { ...configuration(fetch), mailbox: "another@example.com" }
      )
    ).toThrow("another mailbox");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the documented watch filter without losing the expiration", async () => {
    const result = { historyId: "123", expiration: "1789086553000" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(result));
    await expect(
      watchGmailMailbox(
        { topicName: "projects/project/topics/mail", labelId: "Label_123" },
        configuration(fetch)
      )
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      topicName: "projects/project/topics/mail",
      labelIds: ["Label_123"],
      labelFilterBehavior: "include",
    });
  });

  it("lists native label IDs and display names without changing mailbox labels", async () => {
    const labels = [
      { id: "INBOX", name: "INBOX", type: "system" },
      {
        id: "Label_123",
        name: "agent/review",
        type: "user",
        labelListVisibility: "labelShow",
      },
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ labels }));
    await expect(listGmailLabels(configuration(fetch))).resolves.toEqual({
      labels,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://gmail.googleapis.com/gmail/v1/users/agent%40example.com/labels",
      expect.objectContaining({ method: "GET", body: undefined })
    );
  });

  it.each([
    200, 204,
  ])("stops mailbox notifications with an empty POST (HTTP %s)", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        status === 204 ? new Response(null, { status }) : Response.json({})
      );
    await expect(
      stopGmailMailbox(configuration(fetch))
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://gmail.googleapis.com/gmail/v1/users/agent%40example.com/stop",
      expect.objectContaining({
        method: "POST",
        body: undefined,
        redirect: "error",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("does not report a rejected stop request as successful", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { errors: [{ reason: "authError" }] } },
          { status: 401 }
        )
      );
    await expect(stopGmailMailbox(configuration(fetch))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("shares in-flight refresh and renews expiring OAuth access tokens", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "first", expires_in: 3600 })
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: "second", expires_in: 3600 })
      );
    const token = createGmailTokenProvider({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetch,
    });
    const first = token();
    const simultaneous = token();
    expect(first).toBe(simultaneous);
    await expect(first).resolves.toBe("first");
    await expect(token()).resolves.toBe("first");
    expect(fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(3540_000);
    await expect(token()).resolves.toBe("second");
    expect(fetch.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(String(fetch.mock.calls[0][1]?.body)).toBe(
      "client_id=client&client_secret=secret&refresh_token=refresh&grant_type=refresh_token"
    );
  });

  it.each([
    "invalid_grant",
    "invalid_client",
    "deleted_client",
  ])("preserves OAuth %s without exposing credential details or caching failures", async (reason) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: reason, error_description: "private credential details" },
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: "recovered", expires_in: 3600 })
      );
    const token = createGmailTokenProvider({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetch,
    });
    const result = token();
    await expect(result).rejects.toMatchObject({ status: 400, reason });
    await expect(result).rejects.not.toThrow("private credential details");
    await expect(token()).resolves.toBe("recovered");
  });

  it("returns a standalone HTTP error without leaking the response body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("private response", {
        status: 429,
        headers: { "retry-after": "15" },
      })
    );
    const operation = getGmailProfile(configuration(fetch));
    await expect(operation).rejects.toBeInstanceOf(GmailApiError);
    await expect(operation).rejects.toMatchObject({
      status: 429,
      retryAfter: 15,
    });
    await expect(operation).rejects.not.toThrow("private response");
  });

  it("preserves Gmail quota reasons on HTTP 403 without exposing server messages", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            errors: [
              { reason: "userRateLimitExceeded", message: "private details" },
            ],
          },
        },
        { status: 403 }
      )
    );
    const result = getGmailProfile(configuration(fetch));
    await expect(result).rejects.toMatchObject({
      status: 403,
      reason: "userRateLimitExceeded",
    });
    await expect(result).rejects.not.toThrow("private details");
  });
});
