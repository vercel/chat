import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  parseSlackWebhookBody,
  readSlackWebhook,
  SlackWebhookParseError,
  SlackWebhookVerificationError,
  verifySlackRequest,
  verifySlackSignature,
} from "./index";

const secret = "8f742231b10e8888abcd99yyyzzz85a5";
const timestamp = 1_531_420_618;
const now = () => timestamp * 1000;

function sign(body: string, time = timestamp): string {
  return `v0=${createHmac("sha256", secret)
    .update(`v0:${time}:${body}`)
    .digest("hex")}`;
}

function headers(body: string, time = timestamp): Headers {
  return new Headers({
    "content-type": "application/json",
    "x-slack-request-timestamp": String(time),
    "x-slack-signature": sign(body, time),
  });
}

function request(body: string, init?: { contentType?: string; time?: number }) {
  const time = init?.time ?? timestamp;
  return new Request("https://example.com/slack", {
    body,
    headers: {
      "content-type": init?.contentType ?? "application/json",
      "x-slack-request-timestamp": String(time),
      "x-slack-signature": sign(body, time),
    },
    method: "POST",
  });
}

describe("verifySlackSignature", () => {
  it("accepts a valid Slack signature", async () => {
    const body =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";

    await expect(
      verifySlackSignature(body, headers(body), {
        now,
        signingSecret: secret,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects stale timestamps", async () => {
    const body = "payload";

    await expect(
      verifySlackSignature(body, headers(body, timestamp - 301), {
        now,
        signingSecret: secret,
      })
    ).rejects.toBeInstanceOf(SlackWebhookVerificationError);
  });

  it("rejects invalid signatures", async () => {
    const body = "payload";
    const signedHeaders = headers(body);
    signedHeaders.set("x-slack-signature", "v0=bad");

    await expect(
      verifySlackSignature(body, signedHeaders, {
        now,
        signingSecret: secret,
      })
    ).rejects.toBeInstanceOf(SlackWebhookVerificationError);
  });

  it("rejects well-formed signatures with the wrong digest", async () => {
    const body = "payload";
    const signedHeaders = headers(body);
    signedHeaders.set("x-slack-signature", `v0=${"0".repeat(64)}`);

    await expect(
      verifySlackSignature(body, signedHeaders, {
        now,
        signingSecret: secret,
      })
    ).rejects.toBeInstanceOf(SlackWebhookVerificationError);
  });

  it("accepts plain object headers case-insensitively", async () => {
    const body = "payload";

    await expect(
      verifySlackSignature(
        body,
        {
          "Content-Type": "application/json",
          "X-Slack-Request-Timestamp": String(timestamp),
          "X-Slack-Signature": sign(body),
        },
        { now, signingSecret: secret }
      )
    ).resolves.toBeUndefined();
  });
});

describe("verifySlackRequest", () => {
  it("returns the verified body", async () => {
    const body = JSON.stringify({ type: "event_callback" });

    await expect(
      verifySlackRequest(request(body), { now, signingSecret: secret })
    ).resolves.toBe(body);
  });

  it("uses a custom verifier", async () => {
    const verifier = vi.fn().mockReturnValue(true);
    const body = "payload";

    await expect(
      verifySlackRequest(
        new Request("https://example.com", { body, method: "POST" }),
        {
          webhookVerifier: verifier,
        }
      )
    ).resolves.toBe(body);
    expect(verifier).toHaveBeenCalled();
  });

  it("allows a custom verifier to replace the body", async () => {
    const verifiedBody = JSON.stringify({
      challenge: "challenge-value",
      type: "url_verification",
    });
    const payload = await readSlackWebhook(
      new Request("https://example.com", {
        body: "original",
        method: "POST",
      }),
      { webhookVerifier: () => verifiedBody }
    );

    expect(payload).toEqual({
      challenge: "challenge-value",
      kind: "url_verification",
      raw: { challenge: "challenge-value", type: "url_verification" },
      retry: undefined,
    });
  });
});

describe("parseSlackWebhookBody", () => {
  it("parses url verification payloads", () => {
    const payload = parseSlackWebhookBody(
      JSON.stringify({
        challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
        token: "deprecated",
        type: "url_verification",
      }),
      { contentType: "application/json" }
    );

    expect(payload.kind).toBe("url_verification");
    expect(payload).toMatchObject({
      challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
    });
  });

  it("parses app mentions with provider-native continuation", () => {
    const payload = parseSlackWebhookBody(
      JSON.stringify({
        api_app_id: "A123",
        event: {
          channel: "C123",
          text: "<@U999> hello",
          files: [
            {
              id: "F123",
              mimetype: "image/png",
              name: "chart.png",
              size: 123,
              title: "Chart",
              url_private: "https://files.slack.com/files-pri/chart.png",
              url_private_download:
                "https://files.slack.com/files-pri/chart-download.png",
            },
          ],
          thread_ts: "1710000000.000001",
          ts: "1710000000.000002",
          type: "app_mention",
          user: "U123",
        },
        event_id: "Ev123",
        event_time: 1_710_000_000,
        is_ext_shared_channel: true,
        team_id: "T123",
        type: "event_callback",
      }),
      {
        contentType: "application/json",
        headers: {
          "x-slack-retry-num": "2",
          "x-slack-retry-reason": "http_timeout",
        },
      }
    );

    expect(payload).toMatchObject({
      apiAppId: "A123",
      channelId: "C123",
      continuation: {
        channelId: "C123",
        teamId: "T123",
        threadTs: "1710000000.000001",
      },
      eventId: "Ev123",
      eventTime: 1_710_000_000,
      files: [
        {
          downloadUrl: "https://files.slack.com/files-pri/chart-download.png",
          id: "F123",
          mimeType: "image/png",
          name: "chart.png",
          size: 123,
          title: "Chart",
          type: "image",
          url: "https://files.slack.com/files-pri/chart.png",
        },
      ],
      isExtSharedChannel: true,
      kind: "app_mention",
      retry: { num: 2, reason: "http_timeout" },
      text: "<@U999> hello",
      threadTs: "1710000000.000001",
      ts: "1710000000.000002",
      userId: "U123",
    });
  });

  it("uses ts as threadTs when app mentions are top-level messages", () => {
    const payload = parseSlackWebhookBody(
      JSON.stringify({
        event: {
          channel: "C123",
          text: "hello",
          ts: "1710000000.000002",
          type: "app_mention",
          user: "U123",
        },
        team_id: "T123",
        type: "event_callback",
      }),
      { contentType: "application/json" }
    );

    expect(payload).toMatchObject({
      continuation: { channelId: "C123", threadTs: "1710000000.000002" },
      kind: "app_mention",
      threadTs: "1710000000.000002",
    });
  });

  it("parses direct message events", () => {
    const payload = parseSlackWebhookBody(
      JSON.stringify({
        event: {
          bot_id: "B123",
          channel: "D123",
          channel_type: "im",
          subtype: "bot_message",
          text: "hello",
          ts: "1710000000.000002",
          type: "message",
          user: "U123",
        },
        team_id: "T123",
        type: "event_callback",
      })
    );

    expect(payload).toMatchObject({
      botId: "B123",
      channelId: "D123",
      kind: "direct_message",
      subtype: "bot_message",
    });
  });

  it("parses slash command form posts", () => {
    const body = new URLSearchParams({
      channel_id: "C123",
      channel_name: "general",
      command: "/deploy",
      enterprise_id: "E123",
      is_enterprise_install: "true",
      response_url: "https://hooks.slack.com/commands/T123/1/abc",
      team_id: "T123",
      text: "prod",
      trigger_id: "123.456.abc",
      user_id: "U123",
      user_name: "josh",
    }).toString();

    const payload = parseSlackWebhookBody(body, {
      contentType: "application/x-www-form-urlencoded",
    });

    expect(payload).toEqual({
      channelId: "C123",
      channelName: "general",
      command: "/deploy",
      enterpriseId: "E123",
      isEnterpriseInstall: true,
      kind: "slash_command",
      raw: Object.fromEntries(new URLSearchParams(body)),
      responseUrl: "https://hooks.slack.com/commands/T123/1/abc",
      retry: undefined,
      teamId: "T123",
      text: "prod",
      triggerId: "123.456.abc",
      userId: "U123",
      userName: "josh",
    });
  });

  it("parses block action payloads", () => {
    const raw = {
      actions: [
        {
          action_id: "approve",
          block_id: "actions",
          selected_option: {
            text: { text: "Yes", type: "plain_text" },
            value: "yes",
          },
          text: { text: "Approve", type: "plain_text" },
          type: "button",
          value: "approve-value",
        },
      ],
      channel: { id: "C123", name: "general" },
      container: {
        channel_id: "C123",
        message_ts: "1710000000.000002",
        thread_ts: "1710000000.000001",
        type: "message",
      },
      message: {
        blocks: [
          {
            text: { text: "Approve deployment?", type: "mrkdwn" },
            type: "section",
          },
        ],
        thread_ts: "1710000000.000001",
        ts: "1710000000.000002",
      },
      response_url: "https://hooks.slack.com/actions/T123/1/abc",
      team: { enterprise_id: "E123", id: "T123" },
      trigger_id: "123.456.abc",
      type: "block_actions",
      user: { id: "U123", username: "josh" },
    };
    const body = new URLSearchParams({
      payload: JSON.stringify(raw),
    }).toString();

    const payload = parseSlackWebhookBody(body, {
      contentType: "application/x-www-form-urlencoded",
    });

    expect(payload).toMatchObject({
      actions: [
        {
          actionId: "approve",
          blockId: "actions",
          label: "Yes",
          selectedOptionLabel: "Yes",
          selectedOptionValue: "yes",
          type: "button",
          user: { id: "U123", username: "josh" },
          value: "approve-value",
        },
      ],
      channelId: "C123",
      continuation: {
        channelId: "C123",
        enterpriseId: "E123",
        teamId: "T123",
        threadTs: "1710000000.000001",
      },
      kind: "block_actions",
      messageBlocks: [
        {
          text: { text: "Approve deployment?", type: "mrkdwn" },
          type: "section",
        },
      ],
      messagePromptText: "Approve deployment?",
      messageTs: "1710000000.000002",
      responseUrl: "https://hooks.slack.com/actions/T123/1/abc",
      teamId: "T123",
      threadTs: "1710000000.000001",
      triggerId: "123.456.abc",
      user: { id: "U123", username: "josh" },
      userId: "U123",
    });
  });

  it("parses block suggestion payloads", () => {
    const raw = {
      action_id: "external",
      block_id: "input",
      channel: { id: "C123" },
      enterprise: { id: "E123" },
      team: { id: "T123" },
      type: "block_suggestion",
      user: { id: "U123" },
      value: "hel",
    };
    const payload = parseSlackWebhookBody(
      new URLSearchParams({ payload: JSON.stringify(raw) }).toString(),
      { contentType: "application/x-www-form-urlencoded" }
    );

    expect(payload).toMatchObject({
      actionId: "external",
      blockId: "input",
      channelId: "C123",
      enterpriseId: "E123",
      kind: "block_suggestion",
      teamId: "T123",
      userId: "U123",
      value: "hel",
    });
  });

  it("parses view submissions", () => {
    const raw = {
      team: { id: "T123" },
      type: "view_submission",
      user: { id: "U123" },
      view: {
        callback_id: "feedback",
        id: "V123",
        private_metadata: '{"id":"123"}',
        response_urls: [
          {
            action_id: "target",
            channel_id: "C123",
            response_url: "https://hooks.slack.com/app/1/2/3",
          },
        ],
        state: {
          values: {
            feedback: {
              message: {
                type: "plain_text_input",
                value: "looks good",
              },
            },
          },
        },
      },
    };
    const payload = parseSlackWebhookBody(
      new URLSearchParams({ payload: JSON.stringify(raw) }).toString(),
      { contentType: "application/x-www-form-urlencoded" }
    );

    expect(payload).toMatchObject({
      callbackId: "feedback",
      kind: "view_submission",
      privateMetadata: '{"id":"123"}',
      responseUrls: [
        {
          action_id: "target",
          channel_id: "C123",
          response_url: "https://hooks.slack.com/app/1/2/3",
        },
      ],
      teamId: "T123",
      user: { id: "U123" },
      userId: "U123",
      values: [
        {
          actionId: "message",
          blockId: "feedback",
          type: "plain_text_input",
          value: "looks good",
        },
      ],
      view: { callback_id: "feedback", id: "V123" },
    });
  });

  it("parses view closed payloads", () => {
    const raw = {
      enterprise: { id: "E123" },
      team: null,
      type: "view_closed",
      user: { id: "U123" },
      view: { id: "V123" },
    };
    const payload = parseSlackWebhookBody(
      new URLSearchParams({ payload: JSON.stringify(raw) }).toString(),
      { contentType: "application/x-www-form-urlencoded" }
    );

    expect(payload).toMatchObject({
      enterpriseId: "E123",
      kind: "view_closed",
      userId: "U123",
      view: { id: "V123" },
    });
  });

  it("returns unsupported for valid but unsupported payloads", () => {
    const payload = parseSlackWebhookBody(
      JSON.stringify({
        event: { type: "reaction_added" },
        type: "event_callback",
      })
    );

    expect(payload).toEqual({
      kind: "unsupported",
      raw: {
        event: { type: "reaction_added" },
        type: "event_callback",
      },
      retry: undefined,
      type: "reaction_added",
    });
  });

  it("throws a parse error for invalid json", () => {
    expect(() =>
      parseSlackWebhookBody("{", { contentType: "application/json" })
    ).toThrow(SlackWebhookParseError);
  });
});

describe("readSlackWebhook", () => {
  it("verifies and parses requests", async () => {
    const body = JSON.stringify({
      challenge: "challenge-value",
      type: "url_verification",
    });

    await expect(
      readSlackWebhook(request(body), { now, signingSecret: secret })
    ).resolves.toMatchObject({
      challenge: "challenge-value",
      kind: "url_verification",
    });
  });
});
