import { ValidationError } from "@chat-adapter/shared";
import type { TeamsThreadId } from "./types";

export function encodeThreadId(platformData: TeamsThreadId): string {
  const encodedConversationId = Buffer.from(
    platformData.conversationId
  ).toString("base64url");
  const encodedServiceUrl = Buffer.from(platformData.serviceUrl).toString(
    "base64url"
  );
  return `teams:${encodedConversationId}:${encodedServiceUrl}`;
}

export function decodeThreadId(threadId: string): TeamsThreadId {
  const parts = threadId.split(":");
  if (parts.length !== 3 || parts[0] !== "teams") {
    throw new ValidationError("teams", `Invalid Teams thread ID: ${threadId}`);
  }
  const conversationId = Buffer.from(parts[1] as string, "base64url").toString(
    "utf-8"
  );
  const serviceUrl = Buffer.from(parts[2] as string, "base64url").toString(
    "utf-8"
  );
  return { conversationId, serviceUrl };
}

export function isDM(threadId: string): boolean {
  const { conversationId } = decodeThreadId(threadId);
  return !conversationId.startsWith("19:");
}
