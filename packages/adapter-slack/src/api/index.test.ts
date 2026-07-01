import { describe, expect, it, vi } from "vitest";
import {
  callSlackApi,
  deleteSlackMessage,
  encodeSlackApiBody,
  fetchSlackFile,
  fetchSlackThreadReplies,
  openSlackView,
  postSlackEphemeral,
  postSlackMessage,
  SlackApiError,
  sendSlackResponseUrl,
  updateSlackMessage,
  uploadSlackFiles,
} from "./index";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function textRequestBody(
  _input: RequestInfo | URL,
  init?: RequestInit
): string {
  return String(init?.body ?? "");
}

describe("Slack api primitives", () => {
  it("form-encodes Slack API bodies with JSON object values", () => {
    const encoded = encodeSlackApiBody({
      blocks: [{ type: "section" }],
      channel: "C123",
      reply_broadcast: false,
      text: "hello",
      thread_ts: undefined,
    });

    expect(encoded.contentType).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(encoded.body).get("blocks")).toBe(
      '[{"type":"section"}]'
    );
    expect(new URLSearchParams(encoded.body).get("reply_broadcast")).toBe(
      "false"
    );
    expect(new URLSearchParams(encoded.body).has("thread_ts")).toBe(false);
  });

  it("calls Slack Web API with bearer token auth", async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));

    await callSlackApi(
      "chat.postMessage",
      { channel: "C123", text: "hello" },
      { fetch: request, token: async () => "xoxb-token" }
    );

    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/chat.postMessage"
    );
    expect(request.mock.calls[0][1].headers.authorization).toBe(
      "Bearer xoxb-token"
    );
    expect(
      new URLSearchParams(textRequestBody(...request.mock.calls[0])).get("text")
    ).toBe("hello");
  });

  it("supports custom API origins for tests and proxies", async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));

    await callSlackApi(
      "chat.postMessage",
      {},
      {
        apiUrl: "https://proxy.example/slack/",
        fetch: request,
        token: "xoxb-token",
      }
    );

    expect(String(request.mock.calls[0][0])).toBe(
      "https://proxy.example/slack/chat.postMessage"
    );
  });

  it("throws for non-2xx Slack API HTTP responses", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "ratelimited", ok: false }, { status: 429 })
      );

    await expect(
      callSlackApi("chat.postMessage", {}, { fetch: request, token: "xoxb" })
    ).rejects.toMatchObject({
      method: "chat.postMessage",
      name: "SlackApiError",
      status: 429,
    });
  });

  it("posts messages and returns the Slack timestamp", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ channel: "C123", ok: true, ts: "1.23" })
      );

    const result = await postSlackMessage({
      channel: "C123",
      fetch: request,
      markdownText: "**hello**",
      token: "xoxb",
      unfurlLinks: false,
      unfurlMedia: false,
    });

    const params = new URLSearchParams(
      textRequestBody(...request.mock.calls[0])
    );
    expect(params.get("markdown_text")).toBe("**hello**");
    expect(params.get("text")).toBeNull();
    expect(params.get("blocks")).toBeNull();
    expect(params.get("unfurl_links")).toBe("false");
    expect(result).toEqual({
      channel: "C123",
      id: "1.23",
      raw: { channel: "C123", ok: true, ts: "1.23" },
    });
  });

  it("rejects markdown_text conflicts locally", async () => {
    await expect(
      postSlackMessage({
        channel: "C123",
        fetch: vi.fn(),
        markdownText: "**hello**",
        text: "hello",
        token: "xoxb",
      })
    ).rejects.toThrow(TypeError);
  });

  it("posts ephemeral messages", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ channel: "C123", message_ts: "1.24", ok: true })
      );

    const result = await postSlackEphemeral({
      channel: "C123",
      fetch: request,
      text: "hello",
      token: "xoxb",
      user: "U123",
    });

    const params = new URLSearchParams(
      textRequestBody(...request.mock.calls[0])
    );
    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/chat.postEphemeral"
    );
    expect(params.get("user")).toBe("U123");
    expect(result.id).toBe("1.24");
  });

  it("updates messages", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ channel: "C123", ok: true, ts: "1.25" })
      );

    const result = await updateSlackMessage({
      blocks: [{ type: "section" }],
      channel: "C123",
      fetch: request,
      text: "fallback",
      token: "xoxb",
      ts: "1.23",
    });

    const params = new URLSearchParams(
      textRequestBody(...request.mock.calls[0])
    );
    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/chat.update"
    );
    expect(params.get("ts")).toBe("1.23");
    expect(params.get("blocks")).toBe('[{"type":"section"}]');
    expect(result.id).toBe("1.25");
  });

  it("deletes messages", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, ts: "1.23" }));

    await deleteSlackMessage({
      channel: "C123",
      fetch: request,
      token: "xoxb",
      ts: "1.23",
    });

    const params = new URLSearchParams(
      textRequestBody(...request.mock.calls[0])
    );
    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/chat.delete"
    );
    expect(params.get("channel")).toBe("C123");
    expect(params.get("ts")).toBe("1.23");
  });

  it("throws SlackApiError for ok false helper responses", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "channel_not_found", ok: false })
      );

    await expect(
      postSlackMessage({
        channel: "C123",
        fetch: request,
        text: "hello",
        token: "xoxb",
      })
    ).rejects.toBeInstanceOf(SlackApiError);
  });

  it("sends response_url JSON payloads", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await sendSlackResponseUrl(
      "https://hooks.slack.com/actions/T/1/abc",
      {
        replaceOriginal: true,
        text: "updated",
      },
      { fetch: request }
    );

    expect(request.mock.calls[0][0]).toBe(
      "https://hooks.slack.com/actions/T/1/abc"
    );
    expect(JSON.parse(String(request.mock.calls[0][1].body))).toEqual({
      replace_original: true,
      text: "updated",
    });
  });

  it("uploads files with Slack external upload flow", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          file_id: "F123",
          ok: true,
          upload_url: "https://files.slack.com/upload/v1/abc",
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ files: [{ id: "F123" }], ok: true })
      );

    const result = await uploadSlackFiles(
      [{ data: new Uint8Array([1, 2, 3]), filename: "report.txt" }],
      {
        channelId: "C123",
        fetch: request,
        initialComment: "here",
        threadTs: "1.23",
        token: "xoxb",
      }
    );

    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/files.getUploadURLExternal"
    );
    expect(
      new URLSearchParams(textRequestBody(...request.mock.calls[0])).get(
        "length"
      )
    ).toBe("3");
    expect(request.mock.calls[1][0]).toBe(
      "https://files.slack.com/upload/v1/abc"
    );
    expect(request.mock.calls[1][1].headers.authorization).toBe("Bearer xoxb");
    expect(String(request.mock.calls[2][0])).toBe(
      "https://slack.com/api/files.completeUploadExternal"
    );
    expect(result.fileIds).toEqual(["F123"]);
  });

  it("fetches private Slack file URLs with bearer auth", async () => {
    const response = new Response("file", { status: 200 });
    const request = vi.fn().mockResolvedValue(response);

    const result = await fetchSlackFile({
      fetch: request,
      token: "xoxb",
      url: "https://files.slack.com/files-pri/T/F/report.txt",
    });

    expect(result).toBe(response);
    expect(request.mock.calls[0][1].headers.authorization).toBe("Bearer xoxb");
  });

  it("fetches thread replies with cursor metadata", async () => {
    const request = vi.fn().mockResolvedValue(
      jsonResponse({
        messages: [{ text: "root", ts: "1.23" }],
        ok: true,
        response_metadata: { next_cursor: "next" },
      })
    );

    const result = await fetchSlackThreadReplies({
      channel: "C123",
      fetch: request,
      limit: 50,
      token: "xoxb",
      ts: "1.23",
    });

    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/conversations.replies"
    );
    expect(
      new URLSearchParams(textRequestBody(...request.mock.calls[0])).get("ts")
    ).toBe("1.23");
    expect(result).toEqual({
      messages: [{ text: "root", ts: "1.23" }],
      nextCursor: "next",
      raw: {
        messages: [{ text: "root", ts: "1.23" }],
        ok: true,
        response_metadata: { next_cursor: "next" },
      },
    });
  });

  it("opens Slack views with trigger ids", async () => {
    const request = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        view: { id: "V123", type: "modal" },
      })
    );

    const result = await openSlackView({
      fetch: request,
      token: "xoxb",
      triggerId: "trigger",
      view: { type: "modal" },
    });

    expect(String(request.mock.calls[0][0])).toBe(
      "https://slack.com/api/views.open"
    );
    expect(
      JSON.parse(
        String(
          new URLSearchParams(textRequestBody(...request.mock.calls[0])).get(
            "view"
          )
        )
      )
    ).toEqual({ type: "modal" });
    expect(result.view).toEqual({ id: "V123", type: "modal" });
  });
});
