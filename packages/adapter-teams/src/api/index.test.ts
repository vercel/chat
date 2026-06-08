import { describe, expect, it, vi } from "vitest";
import {
  buildTeamsMessageActivity,
  createTeamsConversation,
  deleteTeamsMessage,
  postTeamsMessage,
  resolveTeamsAccessToken,
  sendTeamsTyping,
  type TeamsApiError,
  updateTeamsMessage,
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

describe("Teams api primitives", () => {
  it("resolves access tokens with client credentials", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "t" }));

    await expect(
      resolveTeamsAccessToken({ credentials, fetch: request })
    ).resolves.toBe("t");

    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token"
    );
    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("client_id")).toBe("app-id");
    expect(body.get("scope")).toBe("https://api.botframework.com/.default");
  });

  it("builds message activities with adaptive cards", () => {
    const activity = buildTeamsMessageActivity({
      adaptiveCard: { type: "AdaptiveCard" },
      markdownText: "**hello**",
    });

    expect(activity).toMatchObject({
      attachments: [
        {
          content: { type: "AdaptiveCard" },
          contentType: "application/vnd.microsoft.card.adaptive",
        },
      ],
      text: "**hello**",
      textFormat: "markdown",
      type: "message",
    });
  });

  it("posts Teams messages through Connector REST", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "activity-id" }));

    const posted = await postTeamsMessage({
      conversationId: "19:abc@thread.tacv2",
      credentials,
      fetch: request,
      markdownText: "hello",
      serviceUrl: "https://smba.example/teams/",
    });

    expect(posted.id).toBe("activity-id");
    expect(String(request.mock.calls[1]?.[0])).toBe(
      "https://smba.example/teams/v3/conversations/19%3Aabc%40thread.tacv2/activities"
    );
    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token",
      "content-type": "application/json",
    });
  });

  it("posts threaded replies when replyToId is provided", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "reply-id" }));

    await postTeamsMessage({
      conversationId: "conversation",
      credentials,
      fetch: request,
      replyToId: "root",
      serviceUrl: "https://smba.example/teams/",
      text: "reply",
    });

    expect(String(request.mock.calls[1]?.[0])).toBe(
      "https://smba.example/teams/v3/conversations/conversation/activities/root"
    );
  });

  it("updates, deletes, types, and creates conversations", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "token" }));
    request
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "conversation-id" }));

    await updateTeamsMessage({
      conversationId: "conversation",
      credentials,
      fetch: request,
      messageId: "activity",
      serviceUrl: "https://smba.example/",
      text: "updated",
    });
    await deleteTeamsMessage({
      conversationId: "conversation",
      credentials,
      fetch: request,
      messageId: "activity",
      serviceUrl: "https://smba.example/",
    });
    await sendTeamsTyping({
      conversationId: "conversation",
      credentials,
      fetch: request,
      serviceUrl: "https://smba.example/",
    });
    await createTeamsConversation({
      credentials,
      fetch: request,
      members: [{ id: "user" }],
      serviceUrl: "https://smba.example/",
      tenantId: "tenant",
    });

    expect(request.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(request.mock.calls[3]?.[1]?.method).toBe("DELETE");
    expect(request.mock.calls[5]?.[1]?.method).toBe("POST");
    expect(request.mock.calls[7]?.[1]?.method).toBe("POST");
  });

  it("throws TeamsApiError for Connector errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "rate limit" }, { status: 429 })
      );

    await expect(
      postTeamsMessage({
        conversationId: "conversation",
        credentials,
        fetch: request,
        serviceUrl: "https://smba.example/",
        text: "hello",
      })
    ).rejects.toMatchObject({
      body: { error: "rate limit" },
      status: 429,
    } satisfies Partial<TeamsApiError>);
  });
});
