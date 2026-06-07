/** Google Chat-specific thread ID data. */
export interface GoogleChatThreadId {
  /** Whether this is a DM space. */
  isDM?: boolean;
  spaceName: string;
  threadName?: string;
}

export class GoogleChatThreadIdError extends Error {
  constructor(threadId: string) {
    super(`Invalid Google Chat thread ID: ${threadId}`);
    this.name = "GoogleChatThreadIdError";
  }
}

/**
 * Encode platform-specific data into a Chat SDK thread ID.
 * Format: `gchat:{spaceName}:{base64url(threadName)}:{dm}`.
 */
export function encodeThreadId(platformData: GoogleChatThreadId): string {
  const threadPart = platformData.threadName
    ? `:${Buffer.from(platformData.threadName).toString("base64url")}`
    : "";
  const dmPart = platformData.isDM ? ":dm" : "";
  return `gchat:${platformData.spaceName}${threadPart}${dmPart}`;
}

/** Decode a Google Chat thread ID back to platform-specific data. */
export function decodeThreadId(threadId: string): GoogleChatThreadId {
  const isDM = threadId.endsWith(":dm");
  const cleanId = isDM ? threadId.slice(0, -3) : threadId;
  const parts = cleanId.split(":");

  if (parts.length < 2 || parts[0] !== "gchat") {
    throw new GoogleChatThreadIdError(threadId);
  }

  const spaceName = parts[1];
  if (!spaceName) {
    throw new GoogleChatThreadIdError(threadId);
  }

  const threadName = parts[2]
    ? Buffer.from(parts[2], "base64url").toString("utf-8")
    : undefined;

  return { spaceName, threadName, isDM };
}

/** Check whether a Google Chat thread ID marks a direct message conversation. */
export function isDMThread(threadId: string): boolean {
  return threadId.endsWith(":dm");
}
