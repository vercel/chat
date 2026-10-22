/**
 * Classification of whether a Slack message invokes a bot. Shared by
 * `SlackAdapter` and the `@chat-adapter/slack/webhook` subpath, so it imports
 * no runtime packages.
 */
import { maskCodeSpans } from "@chat-adapter/shared/mentions";
import {
  attachmentContent,
  authorAttachments,
  collectMentionIds,
  isRecord,
  type SlackAttachmentContent,
  type SlackAttachmentPart,
  type SlackEvent,
  type SlackMessageBlock,
} from "./event";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?${}()|[\]\\]/g, "\\$&");
}

/**
 * Slack's user-mention syntax for `userId`: `<@U…>` or `<@U…|name>`. Used for
 * mrkdwn content, where a mention is a token in the text. Slack escapes `<` in
 * message text, so a label stops at the next `<`; excluding it keeps the scan
 * linear on text with many unclosed tokens.
 */
function mentionTokenPattern(userId: string): RegExp {
  return new RegExp(`<@!?${escapeRegExp(userId)}(?:\\|[^<>]*)?>`, "i");
}

/** The user ids referenced by `<@U…>` tokens in `text`. */
function userMentionIds(text: string): Set<string> {
  const userIds = new Set<string>();
  collectMentionIds(text, userIds, new Set());
  return userIds;
}

/**
 * Which users to look for: `matchesId` tests a structured `user` element,
 * `matchesText` tests a string for a mention token.
 */
interface SlackMentionMatcher {
  matchesId(userId: string): boolean;
  matchesText(text: string): boolean;
}

/**
 * Matches one user. Ids compare case-insensitively, the way the token
 * pattern matches.
 */
function mentionMatcher(userId: string): SlackMentionMatcher {
  const token = mentionTokenPattern(userId);
  const upper = userId.toUpperCase();
  return {
    matchesId: (id) => id.toUpperCase() === upper,
    matchesText: (text) => token.test(text),
  };
}

/** Matches any user. */
const ANY_USER_MATCHER: SlackMentionMatcher = {
  matchesId: () => true,
  matchesText: (text) => userMentionIds(text).size > 0,
};

/**
 * How a piece of content refers to the matched users: as a mention Slack
 * renders, as a literal token (inside code or display text), or not at all.
 * `literal` explains an `app_mention` event without making it an invocation;
 * `none` leaves the event unexplained.
 */
type SlackMentionEvidence = "literal" | "mention" | "none";

/** `mention` if any piece is one, else `literal` if any piece is one. */
function combineEvidence(
  evidence: Iterable<SlackMentionEvidence>
): SlackMentionEvidence {
  let result: SlackMentionEvidence = "none";
  for (const item of evidence) {
    if (item === "mention") {
      return "mention";
    }
    if (item === "literal") {
      result = "literal";
    }
  }
  return result;
}

/** Classify a mrkdwn string, where code is carried as backticks. */
function classifyMrkdwnMention(
  text: string,
  matcher: SlackMentionMatcher
): SlackMentionEvidence {
  if (!matcher.matchesText(text)) {
    return "none";
  }
  return matcher.matchesText(maskCodeSpans(text)) ? "mention" : "literal";
}

/**
 * Classify one legacy attachment part. Literal parts render only Slack
 * control sequences, so a `<@U…>` token there is a mention; mrkdwn parts
 * carry code as backticks.
 */
function classifyAttachmentPart(
  part: SlackAttachmentPart,
  matcher: SlackMentionMatcher
): SlackMentionEvidence {
  if ("mrkdwn" in part) {
    return classifyMrkdwnMention(part.mrkdwn, matcher);
  }
  return matcher.matchesText(part.literal) ? "mention" : "none";
}

/**
 * Classify how blocks refer to the matched users.
 *
 * Slack renders a mention from a `user` element, and from a `<@U…>` token in a
 * text object explicitly typed `mrkdwn`. A rich-text `text` element, a link
 * label, and a `raw_text` table cell are display text: a token there stays
 * literal. Inline code (`style.code`) and preformatted elements render
 * literally too, whatever they hold.
 *
 * `blocktext` renders table cells from the same element types; the two must
 * agree on which ones carry a mention, or `message.text` shows a mention the
 * message is not classified as.
 */
function classifyBlocksMention(
  blocks: SlackMessageBlock[],
  matcher: SlackMentionMatcher
): SlackMentionEvidence {
  let literal = false;

  const visit = (value: unknown, inCode: boolean): boolean => {
    if (Array.isArray(value)) {
      return value.some((item) => visit(item, inCode));
    }
    if (!isRecord(value)) {
      return false;
    }

    const isCode =
      inCode ||
      value.type === "rich_text_preformatted" ||
      (isRecord(value.style) && value.style.code === true);

    if (
      value.type === "user" &&
      typeof value.user_id === "string" &&
      matcher.matchesId(value.user_id)
    ) {
      if (!isCode) {
        return true;
      }
      literal = true;
    } else if (
      typeof value.text === "string" &&
      matcher.matchesText(value.text)
    ) {
      if (
        !isCode &&
        value.type === "mrkdwn" &&
        matcher.matchesText(maskCodeSpans(value.text))
      ) {
        return true;
      }
      literal = true;
    }

    return (
      visit(value.elements, isCode) ||
      visit(value.rows, isCode) ||
      visit(value.fields, isCode) ||
      visit(value.text, isCode)
    );
  };

  if (blocks.some((block) => visit(block, false))) {
    return "mention";
  }
  return literal ? "literal" : "none";
}

/**
 * Classify the message body: its blocks and the `text` field.
 *
 * A `rich_text` block is the client-authored copy of `text`, so with one
 * present the blocks decide, and a token in `text` they do not render refers
 * to the user literally. Other blocks are separate from `text`: blocks that
 * show the user decide, and otherwise `text` is classified as mrkdwn.
 */
function classifyBodyMention(
  blocks: SlackMessageBlock[],
  rawText: string,
  matcher: SlackMentionMatcher
): SlackMentionEvidence {
  if (blocks.length === 0) {
    return classifyMrkdwnMention(rawText, matcher);
  }
  const fromBlocks = classifyBlocksMention(blocks, matcher);
  if (fromBlocks !== "none") {
    return fromBlocks;
  }
  if (blocks.some((block) => block.type === "rich_text")) {
    return matcher.matchesText(rawText) ? "literal" : "none";
  }
  return classifyMrkdwnMention(rawText, matcher);
}

/**
 * Classify one attachment. Structured content is authoritative for its
 * attachment, so with blocks present the legacy parts are not read.
 */
function classifyAttachmentMention(
  attachment: SlackAttachmentContent,
  matcher: SlackMentionMatcher
): SlackMentionEvidence {
  if (attachment.blocks.length > 0) {
    return classifyBlocksMention(attachment.blocks, matcher);
  }
  return combineEvidence(
    attachment.parts.map((part) => classifyAttachmentPart(part, matcher))
  );
}

/**
 * Every user id the blocks reference, as a `user` element or a token in any
 * text, uppercased.
 */
function blockUserIds(blocks: SlackMessageBlock[]): Set<string> {
  const ids = new Set<string>();
  classifyBlocksMention(blocks, {
    matchesId: (id) => {
      ids.add(id.toUpperCase());
      return false;
    },
    matchesText: (text) => {
      for (const id of userMentionIds(text)) {
        ids.add(id);
      }
      return false;
    },
  });
  return ids;
}

/**
 * Whether the rendered message shows a mention of any user. A token in `text`
 * counts only without a `rich_text` block, and only for an id the blocks do
 * not show literally, matching `classifyBodyMention` for that id.
 */
function rendersAnyUserMention(
  blocks: SlackMessageBlock[],
  rawText: string,
  attachments: SlackAttachmentContent[]
): boolean {
  if (classifyBlocksMention(blocks, ANY_USER_MATCHER) === "mention") {
    return true;
  }
  if (!blocks.some((block) => block.type === "rich_text")) {
    // The blocks render no mention, so every id they reference is literal.
    const literalIds = blockUserIds(blocks);
    for (const userId of userMentionIds(maskCodeSpans(rawText))) {
      if (!literalIds.has(userId)) {
        return true;
      }
    }
  }
  return attachments.some(
    (attachment) =>
      classifyAttachmentMention(attachment, ANY_USER_MATCHER) === "mention"
  );
}

/** See `SlackAdapter.detectSelfMention`. */
export function classifySelfMention(
  event: SlackEvent,
  rawText: string,
  attachments: SlackAttachmentContent[],
  botUserId: string | undefined
): boolean | undefined {
  const blocks = event.blocks ?? [];
  if (!botUserId) {
    return event.type === "app_mention"
      ? rendersAnyUserMention(blocks, rawText, attachments)
      : undefined;
  }

  const matcher = mentionMatcher(botUserId);
  const evidence = combineEvidence([
    classifyBodyMention(blocks, rawText, matcher),
    ...attachments.map((attachment) =>
      classifyAttachmentMention(attachment, matcher)
    ),
  ]);
  if (evidence === "mention") {
    return true;
  }

  if (event.type === "app_mention" && evidence === "none") {
    return rendersAnyUserMention(blocks, rawText, attachments);
  }

  // Slack mentions are user-id tokens. With the content inspected, the
  // absence of one is a definitive non-mention, so a display name in plain or
  // code-styled text cannot fall through to the SDK's name matching.
  return false;
}

/**
 * Whether a Slack `message` or `app_mention` event invokes the bot with
 * `botUserId`, classified the same way `SlackAdapter` sets `message.isMention`.
 *
 * Slack fires `app_mention` for the bot's token anywhere in `text`, including
 * inside inline code or a code block, so the event type alone does not show
 * that a user addressed the bot. This reads the rendered content instead: a
 * mention outside code invokes the bot, and a reference only inside code does
 * not. Use it to make the same decision outside the adapter, such as in a
 * webhook router that acknowledges or forwards events before a Chat SDK bot
 * handles them.
 *
 * `event` is the inner Events API `event` object, such as the `raw` field of
 * a payload from `parseSlackWebhookBody`. `botUserId` is the bot's own user
 * ID, which `auth.test` returns as `user_id`.
 *
 * Implements the adapter `isBotMention` contract in the Chat SDK guide to
 * building adapters.
 */
export function isBotMention(
  event: SlackEvent | Record<string, unknown>,
  botUserId: string
): boolean {
  const slackEvent = event as SlackEvent;
  const text = typeof slackEvent.text === "string" ? slackEvent.text : "";
  return (
    classifySelfMention(
      slackEvent,
      text,
      authorAttachments(slackEvent).map(attachmentContent),
      botUserId
    ) === true
  );
}
