/**
 * Thread ID encoding/decoding utilities for Google Chat adapter.
 */

import { ValidationError } from "@chat-adapter/shared";

/** Google Chat-specific thread ID data */
export interface GoogleChatThreadId {
  /** Whether this is a DM space */
  isDM?: boolean;
  spaceName: string;
  threadName?: string;
}

/**
 * Encode platform-specific data into a thread ID string.
 * Format: gchat:{spaceName}:{base64(threadName)}:{dm}
 */
export function encodeThreadId(platformData: GoogleChatThreadId): string {
  const threadPart = platformData.threadName
    ? `:${Buffer.from(platformData.threadName).toString("base64url")}`
    : "";
  // Add :dm suffix for DM threads to enable isDM() detection
  const dmPart = platformData.isDM ? ":dm" : "";
  return `gchat:${platformData.spaceName}${threadPart}${dmPart}`;
}

/**
 * Decode thread ID string back to platform-specific data.
 */
export function decodeThreadId(threadId: string): GoogleChatThreadId {
  // Remove :dm suffix if present
  const isDM = threadId.endsWith(":dm");
  const cleanId = isDM ? threadId.slice(0, -3) : threadId;

  const parts = cleanId.split(":");
  if (parts.length < 2 || parts[0] !== "gchat") {
    throw new ValidationError(
      "gchat",
      `Invalid Google Chat thread ID: ${threadId}`
    );
  }

  const spaceName = parts[1] as string;
  const threadName = parts[2]
    ? Buffer.from(parts[2], "base64url").toString("utf-8")
    : undefined;

  return { spaceName, threadName, isDM };
}

/** Google Chat message resource name data */
export interface GoogleChatMessageName {
  /** Message segment, e.g. `FGEOaAwNIcs.FGEOaAwNIcs` or `client-my-id` */
  messageId: string;
  /** Space resource name, e.g. `spaces/AAQAJ9CXYcg` */
  spaceName: string;
}

// Exactly `spaces/{space}/messages/{message}`. Segments are the characters
// Google uses in resource ids; a dot may only join two non-empty groups, so
// `.` and `..` segments, empty segments, `?`, `#`, `%`, `/`, and whitespace
// are all rejected before the name reaches the API.
const MESSAGE_NAME_PATTERN =
  /^spaces\/([A-Za-z0-9_-]+)\/messages\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/;

/**
 * Parse a Google Chat message resource name.
 *
 * Message ids identify a message on their own, so anything that lets a name
 * resolve somewhere other than it appears to (path traversal, query strings,
 * percent-encoding) must be rejected rather than normalized downstream.
 */
export function parseMessageName(messageId: string): GoogleChatMessageName {
  const match = MESSAGE_NAME_PATTERN.exec(messageId);
  if (!match) {
    throw new ValidationError(
      "gchat",
      `Invalid Google Chat message id: ${JSON.stringify(messageId)} (expected spaces/{space}/messages/{message})`
    );
  }
  return { spaceName: `spaces/${match[1]}`, messageId: match[2] as string };
}

/**
 * Check if a thread is a direct message conversation.
 * Checks for the :dm marker in the thread ID which is set when
 * processing DM messages or opening DMs.
 */
export function isDMThread(threadId: string): boolean {
  return threadId.endsWith(":dm");
}

/** The fields of a Google Chat space that identify a direct message. */
export interface GoogleChatSpaceKind {
  singleUserBotDm?: boolean | null;
  /** Newer API format: "SPACE", "GROUP_CHAT", "DIRECT_MESSAGE" */
  spaceType?: string | null;
  /** Legacy format: "ROOM", "DM" */
  type?: string | null;
}

/**
 * Check if a space object describes a direct message. Payloads carry the
 * legacy `type`, the newer `spaceType`, or both, depending on the source.
 */
export function isDMSpace(
  space: GoogleChatSpaceKind | null | undefined
): boolean {
  return (
    space?.type === "DM" ||
    space?.spaceType === "DIRECT_MESSAGE" ||
    space?.singleUserBotDm === true
  );
}

/**
 * Encode the thread ID an event in a space is dispatched on.
 *
 * A DM is a single conversation, so every event in it maps to the space-only
 * `:dm` ID that openDM() returns, whatever thread the message sits in.
 * Elsewhere the ID carries the message's thread, or the message itself when
 * it has no thread.
 */
export function encodeSpaceEventThreadId(event: {
  isDM: boolean;
  messageName?: string | null;
  spaceName: string;
  threadName?: string | null;
}): string {
  if (event.isDM) {
    return encodeThreadId({ spaceName: event.spaceName, isDM: true });
  }
  return encodeThreadId({
    spaceName: event.spaceName,
    threadName: event.threadName || event.messageName || undefined,
  });
}
