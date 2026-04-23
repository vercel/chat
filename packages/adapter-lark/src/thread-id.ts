import { ValidationError } from "@chat-adapter/shared";

/** Platform-specific thread ID data for Lark. */
export interface LarkThreadId {
  /** Lark chat ID (oc_*) or user open ID (ou_*) for DM placeholder. */
  chatId: string;
  /** Root message ID of the thread. Empty string for openDM placeholder. */
  rootId: string;
}

const LARK_PREFIX = "lark";

/**
 * Encode Lark thread data into the unified `lark:{chatId}:{rootId}` format.
 *
 * rootId may be empty to represent an openDM placeholder (no message has
 * been posted yet, so no real root exists).
 */
export function encodeThreadId(data: LarkThreadId): string {
  return `${LARK_PREFIX}:${data.chatId}:${data.rootId}`;
}

/**
 * Decode a `lark:{chatId}:{rootId}` string back into its parts.
 *
 * Throws ValidationError if the string does not match the expected shape.
 */
export function decodeThreadId(threadId: string): LarkThreadId {
  const parts = threadId.split(":");
  if (parts.length !== 3 || parts[0] !== LARK_PREFIX || !parts[1]) {
    throw new ValidationError(
      "lark",
      `Invalid Lark thread ID: ${threadId}. Expected format: lark:{chatId}:{rootId}`
    );
  }
  return { chatId: parts[1], rootId: parts[2] };
}

/**
 * Derive the rootId component of a threadId from a Lark message's IDs.
 *
 * Priority: `root_id` (reply chain root) > `message_id` (new top-level
 * message acts as its own root).
 *
 * We intentionally do NOT use `thread_id`: it is a topic-container ID
 * (format `omt_*`), not a message ID (`om_*`). Lark's send API expects a
 * real message ID in `replyTo`, so using `thread_id` there produces a
 * `format_error: Invalid ids`. Topic messages still have `root_id` and
 * `message_id`, so this policy keeps them routable while staying
 * compatible with the send API.
 */
export function deriveRootId(ids: {
  threadId?: string;
  rootId?: string;
  messageId: string;
}): string {
  return ids.rootId || ids.messageId;
}

/** Return the chatId portion of a Lark thread ID. */
export function channelIdFromThreadId(threadId: string): string {
  return decodeThreadId(threadId).chatId;
}
