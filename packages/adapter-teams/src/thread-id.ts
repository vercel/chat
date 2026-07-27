import { ValidationError } from "@chat-adapter/shared";
import type { TeamsThreadId } from "./types";

export function parseConversationType(
  value: unknown
): TeamsThreadId["conversationType"] {
  if (value === "channel" || value === "groupChat" || value === "personal") {
    return value;
  }
  return undefined;
}

export function encodeThreadId(platformData: TeamsThreadId): string {
  const encodedConversationId = Buffer.from(
    platformData.conversationId
  ).toString("base64url");
  const encodedServiceUrl = Buffer.from(platformData.serviceUrl).toString(
    "base64url"
  );
  const conversationType = platformData.conversationType;
  const legacyIsDM = !platformData.conversationId.startsWith("19:");
  const explicitIsDM = conversationType === "personal";
  const needsConversationType =
    conversationType !== undefined && explicitIsDM !== legacyIsDM;

  return needsConversationType
    ? `teams:${encodedConversationId}:${encodedServiceUrl}:${conversationType}`
    : `teams:${encodedConversationId}:${encodedServiceUrl}`;
}

export function decodeThreadId(threadId: string): TeamsThreadId {
  const parts = threadId.split(":");
  const hasValidPartCount = parts.length === 3 || parts.length === 4;
  if (!hasValidPartCount || parts[0] !== "teams") {
    throw new ValidationError("teams", `Invalid Teams thread ID: ${threadId}`);
  }
  const conversationId = Buffer.from(parts[1] as string, "base64url").toString(
    "utf-8"
  );
  const serviceUrl = Buffer.from(parts[2] as string, "base64url").toString(
    "utf-8"
  );
  const rawConversationType = parts[3];
  if (!rawConversationType) {
    return { conversationId, serviceUrl };
  }
  const conversationType = parseConversationType(rawConversationType);
  if (!conversationType) {
    throw new ValidationError(
      "teams",
      `Invalid Teams conversation type: ${rawConversationType}`
    );
  }
  return { conversationId, conversationType, serviceUrl };
}

export function isDM(threadId: string): boolean {
  const { conversationId, conversationType } = decodeThreadId(threadId);
  if (conversationType) {
    return conversationType === "personal";
  }
  return !conversationId.startsWith("19:");
}
