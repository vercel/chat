import { readFile } from "node:fs/promises";
import { mockLogger } from "@chat-adapter/tests";
import { describe, expect, it } from "vitest";
import {
  createSlackAdapter,
  type SlackEvent,
  type SlackMessageBlock,
} from "./index";
import { isBotMention, parseSlackWebhookBody } from "./webhook";

const BODY_PATTERN = /body: '((?:[^'\\]|\\.)*)'/g;
const BOT_USER_ID = "U00FAKEBOT01";

/**
 * The `body` strings logged in sample-messages.md, as raw webhook bodies.
 * Each sample is a `body: '…'` line holding a single-quoted JS string of JSON,
 * so the literal is converted to a JSON string before parsing. The test below
 * asserts the exact list of `app_mention` samples, so a format change that
 * stops these matching fails it rather than passing with nothing checked.
 */
async function sampleBodies(): Promise<string[]> {
  const markdown = await readFile(
    new URL("../sample-messages.md", import.meta.url),
    { encoding: "utf8" }
  );
  return Array.from(markdown.matchAll(BODY_PATTERN), ([, literal]) =>
    JSON.parse(`"${literal.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`)
  );
}

function createAdapter(botUserId: string) {
  return createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-signing-secret",
    logger: mockLogger,
    botUserId,
  });
}

const richText = (...elements: SlackMessageBlock[]): SlackMessageBlock[] => [
  {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements }],
  },
];
const user = (userId: string): SlackMessageBlock => ({
  type: "user",
  user_id: userId,
});
const plain = (text: string): SlackMessageBlock => ({ type: "text", text });
const code = (text: string): SlackMessageBlock => ({
  type: "text",
  text,
  style: { code: true },
});

describe("isBotMention", () => {
  it("classifies captured app_mention payloads like message.isMention", async () => {
    const adapter = createAdapter(BOT_USER_ID);
    const results: { text: string; isMention: boolean }[] = [];

    for (const body of await sampleBodies()) {
      const payload = parseSlackWebhookBody(body, {
        contentType: "application/json",
      });
      if (payload.kind !== "app_mention") {
        continue;
      }
      const isMention = isBotMention(payload.raw, BOT_USER_ID);
      expect(isMention).toBe(
        adapter.parseMessage(payload.raw as unknown as SlackEvent).isMention
      );
      results.push({ text: payload.text, isMention });
    }

    expect(results).toStrictEqual([
      { text: `<@${BOT_USER_ID}> 1`, isMention: true },
      {
        text: `mrkdwn probe: the app imports \`<@${BOT_USER_ID}>/passport\` and A &amp; B &lt;c&gt;`,
        isMention: false,
      },
      { text: `see \`<@${BOT_USER_ID}>\` for setup`, isMention: false },
      { text: "New request", isMention: true },
    ]);
  });

  const cases: [string, Partial<SlackEvent>, boolean][] = [
    [
      "a mention outside code",
      { text: "<@U_BOT> help", blocks: richText(user("U_BOT")) },
      true,
    ],
    [
      "a mention beside the bot in code",
      {
        text: "<@U_BOT> run `<@U_BOT>`",
        blocks: richText(user("U_BOT"), plain(" run "), code("@bot")),
      },
      true,
    ],
    [
      "a mention only in a section block",
      {
        text: "New request",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "<@U_BOT> check the deploy" },
          },
        ],
      },
      true,
    ],
    [
      "a token only inside code whose blocks drop the bot id",
      {
        text: "see `<@U_BOT> skip tests`",
        blocks: richText(code("@bot skip tests")),
      },
      false,
    ],
    [
      "a code-styled bot reference in the blocks",
      {
        text: "the app imports `<@U_BOT>/passport`",
        blocks: richText(code("<@U_BOT>/passport")),
      },
      false,
    ],
    [
      "a token inside code in section mrkdwn",
      {
        text: "see `<@U_BOT>`",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "see `<@U_BOT>`" } },
        ],
      },
      false,
    ],
    [
      "a token inside code without blocks",
      { text: "run `<@U_BOT>` to invoke the bot" },
      false,
    ],
    ["a labeled token", { text: "<@U_BOT|bot> help" }, true],
    ["a lowercase token", { text: "<@u_bot> help" }, true],
    [
      "a lowercase user element",
      { text: "<@u_bot> help", blocks: richText(user("u_bot")) },
      true,
    ],
    [
      "a mrkdwn attachment mention",
      {
        text: "fyi",
        attachments: [{ text: "<@U_BOT> look", mrkdwn_in: ["text"] }],
      },
      true,
    ],
    [
      "a token inside code in a mrkdwn attachment",
      {
        text: "fyi",
        attachments: [{ text: "see `<@U_BOT>`", mrkdwn_in: ["text"] }],
      },
      false,
    ],
    [
      "a token in plain attachment text",
      { text: "fyi", attachments: [{ text: "<@U_BOT> look" }] },
      true,
    ],
    [
      "a mention in attachment blocks",
      { text: "fyi", attachments: [{ blocks: richText(user("U_BOT")) }] },
      true,
    ],
    [
      "a code reference in attachment blocks",
      { text: "fyi", attachments: [{ blocks: richText(code("<@U_BOT>")) }] },
      false,
    ],
    [
      "a message unfurl that mentions the bot",
      {
        text: "see link",
        attachments: [
          { is_msg_unfurl: true, text: "<@U_BOT> old", mrkdwn_in: ["text"] },
        ],
      },
      false,
    ],
    [
      "a link unfurl that mentions the bot",
      {
        text: "see link",
        attachments: [
          { from_url: "https://example.com", text: "<@U_BOT> old" },
        ],
      },
      false,
    ],
    // The bot can appear under an id the caller does not know, such as an
    // Enterprise Grid `W…` id, so an app_mention that renders another user's
    // mention is trusted.
    [
      "an app_mention that renders only another user's mention",
      { text: "<@U_OTHER> hi", blocks: richText(user("U_OTHER")) },
      true,
    ],
    [
      "an app_mention with another user only inside code",
      { text: "see `<@U_OTHER>`", blocks: richText(code("<@U_OTHER>")) },
      false,
    ],
  ];

  it.each(
    cases
  )("classifies %s like message.isMention", (_name, fields, expected) => {
    const event: SlackEvent = {
      type: "app_mention",
      user: "U_SENDER",
      channel: "C456",
      ts: "1234567890.303030",
      ...fields,
    };

    expect(isBotMention(event, "U_BOT")).toBe(expected);
    expect(createAdapter("U_BOT").parseMessage(event).isMention).toBe(expected);
  });

  it.each([
    ["a code-only token", "see `<@U_BOT>`", richText(code("@bot")), false],
    ["a real mention", "<@U_BOT> hi", richText(user("U_BOT")), true],
  ])("classifies a message event with %s", (_name, text, blocks, expected) => {
    const event: SlackEvent = {
      type: "message",
      user: "U_SENDER",
      channel: "C456",
      ts: "1234567890.303031",
      text,
      blocks,
    };

    expect(isBotMention(event, "U_BOT")).toBe(expected);
    expect(createAdapter("U_BOT").parseMessage(event).isMention).toBe(expected);
  });

  it.each([
    "",
    "U^BOT",
    "U BOT",
    // Untyped callers, such as an unset environment variable.
    undefined as unknown as string,
    null as unknown as string,
  ])("rejects the bot user ID %j", (botUserId) => {
    expect(() =>
      isBotMention({ type: "app_mention", text: "<@U_OTHER> hi" }, botUserId)
    ).toThrow(TypeError);
  });
});
