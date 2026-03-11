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

/**
 * Check if a thread is a direct message conversation.
 * Checks for the :dm marker in the thread ID which is set when
 * processing DM messages or opening DMs.
 */
export function isDMThread(threadId: string): boolean {
  return threadId.endsWith(":dm");
}
