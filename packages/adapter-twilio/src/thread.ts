import { ValidationError } from "@chat-adapter/shared";
import type { TwilioThreadId } from "./types";

export function encodeTwilioThreadId(platformData: TwilioThreadId): string {
  return `twilio:${encodeURIComponent(platformData.sender)}:${encodeURIComponent(
    platformData.recipient
  )}`;
}

export function decodeTwilioThreadId(threadId: string): TwilioThreadId {
  const [adapter, sender, recipient] = threadId.split(":");
  if (adapter !== "twilio" || !sender || !recipient) {
    throw new ValidationError(
      "twilio",
      `Invalid Twilio thread ID: ${threadId}`
    );
  }
  return {
    recipient: decodeURIComponent(recipient),
    sender: decodeURIComponent(sender),
  };
}

export function twilioChannelId(threadId: string): string {
  const thread = decodeTwilioThreadId(threadId);
  return `twilio:${encodeURIComponent(thread.sender)}`;
}
