import { describe, expect, it, vi } from "vitest";
import {
  getTeamsChannel,
  getTeamsChannelMessage,
  listTeamsChannelMessages,
  listTeamsChatMessages,
  listTeamsMessageReplies,
  paginateTeamsGraph,
} from "./index";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const credentials = {
  appId: "app-id",
  appPassword: "secret",
  tenantId: "tenant-id",
};

describe("Teams graph primitives", () => {
  it("lists chat messages with Graph token scope", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(
        jsonResponse({
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
          value: [
            {
              body: {
                content: "<p>Hello <b>world</b></p>",
                contentType: "html",
              },
              createdDateTime: "2026-01-01T00:00:00Z",
              from: { user: { displayName: "Ada", id: "user" } },
              id: "message-id",
            },
          ],
        })
      );

    const result = await listTeamsChatMessages({
      chatId: "19:chat",
      credentials,
      fetch: request,
      limit: 5,
    });

    const tokenBody = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(tokenBody.get("scope")).toBe("https://graph.microsoft.com/.default");
    expect(String(request.mock.calls[1]?.[0])).toBe(
      "https://graph.microsoft.com/v1.0/chats/19%3Achat/messages?$top=5"
    );
    expect(result).toMatchObject({
      cursor: "https://graph.microsoft.com/v1.0/next",
      items: [{ id: "message-id", text: "Hello world" }],
    });
  });

  it("lists channel messages and replies", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "graph-token" }));
    request
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));

    await listTeamsChannelMessages({
      channelId: "channel",
      credentials,
      fetch: request,
      teamId: "team",
    });
    await listTeamsMessageReplies({
      channelId: "channel",
      credentials,
      fetch: request,
      messageId: "root",
      teamId: "team",
    });

    expect(String(request.mock.calls[1]?.[0])).toBe(
      "https://graph.microsoft.com/v1.0/teams/team/channels/channel/messages"
    );
    expect(String(request.mock.calls[3]?.[0])).toBe(
      "https://graph.microsoft.com/v1.0/teams/team/channels/channel/messages/root/replies"
    );
  });

  it("gets a channel message and channel info", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ body: { content: "hello" }, id: "m" })
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(jsonResponse({ displayName: "General", id: "c" }));

    await expect(
      getTeamsChannelMessage({
        channelId: "c",
        credentials,
        fetch: request,
        messageId: "m",
        teamId: "t",
      })
    ).resolves.toMatchObject({ id: "m", text: "hello" });
    await expect(
      getTeamsChannel({
        channelId: "c",
        credentials,
        fetch: request,
        teamId: "t",
      })
    ).resolves.toMatchObject({ displayName: "General", id: "c" });
  });

  it("paginates next links", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));

    await paginateTeamsGraph("https://graph.microsoft.com/v1.0/next", {
      credentials,
      fetch: request,
    });

    expect(String(request.mock.calls[1]?.[0])).toBe(
      "https://graph.microsoft.com/v1.0/next"
    );
  });

  it("throws TeamsApiError when Graph responds with an error", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "forbidden" }, { status: 403 })
      );

    await expect(
      listTeamsChatMessages({ chatId: "c", credentials, fetch: request })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns sparse messages with empty text and minimal fields", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: "m" }] }));

    const result = await listTeamsChatMessages({
      chatId: "c",
      credentials,
      fetch: request,
    });

    expect(result.items[0]).toEqual({ id: "m", raw: { id: "m" }, text: "" });
    expect(result.cursor).toBeUndefined();
  });

  it("falls back to channelId and omits displayName when Graph returns neither", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token" }))
      .mockResolvedValueOnce(jsonResponse({}));

    await expect(
      getTeamsChannel({
        channelId: "c-id",
        credentials,
        fetch: request,
        teamId: "t",
      })
    ).resolves.toEqual({ id: "c-id", raw: {} });
  });
});
