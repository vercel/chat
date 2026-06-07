import { describe, expect, it, vi } from "vitest";
import {
  createGoogleChatMessage,
  deleteGoogleChatReaction,
  findGoogleChatDirectMessage,
  GoogleChatApiError,
  listGoogleChatMessages,
} from ".";

describe("Google Chat API primitives", () => {
  it("creates messages with bearer auth and query params", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ name: "spaces/AAAA/messages/1" })
    );

    await expect(
      createGoogleChatMessage(
        { text: "hello" },
        {
          accessToken: "token",
          fetch: fetchMock as typeof fetch,
          messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
          parent: "spaces/AAAA",
        }
      )
    ).resolves.toMatchObject({ name: "spaces/AAAA/messages/1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/spaces/AAAA/messages");
    expect(String(url)).toContain(
      "messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
    );
    expect(init.headers.Authorization).toBe("Bearer token");
    expect(init.method).toBe("POST");
  });

  it("builds list message requests", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ messages: [], nextPageToken: "next" })
    );

    await listGoogleChatMessages({
      accessToken: async () => "token",
      fetch: fetchMock as typeof fetch,
      filter: 'thread.name = "spaces/AAAA/threads/t1"',
      pageSize: 10,
      parent: "spaces/AAAA",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("pageSize=10");
    expect(String(url)).toContain("filter=thread.name");
  });

  it("supports direct-message and delete endpoints", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    await findGoogleChatDirectMessage({
      accessToken: "token",
      fetch: fetchMock as typeof fetch,
      name: "users/1",
    });
    await deleteGoogleChatReaction("spaces/AAAA/messages/1/reactions/1", {
      accessToken: "token",
      fetch: fetchMock as typeof fetch,
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/spaces:findDirectMessage?name=users%2F1"
    );
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("throws structured API errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "bad" }), {
          status: 400,
          statusText: "Bad Request",
        })
    );

    await expect(
      listGoogleChatMessages({
        accessToken: "token",
        fetch: fetchMock as typeof fetch,
        parent: "spaces/AAAA",
      })
    ).rejects.toBeInstanceOf(GoogleChatApiError);
  });
});
