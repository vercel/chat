import { ValidationError } from "@chat-adapter/shared";
import { address, identifier, mailbox } from "./schema";
import type { GmailThreadId } from "./types";

export function encodeGmailThread(value: GmailThreadId): string {
  if (value.recipient !== undefined) {
    const recipient = address.shape.address.parse(value.recipient);
    return `${gmailChannel(value.mailbox)}:dm:${Buffer.from(recipient).toString("base64url")}`;
  }
  return `${gmailChannel(value.mailbox)}:${identifier.parse(value.threadId)}`;
}

export function gmailChannel(value: string): string {
  return `gmail:${Buffer.from(mailbox.parse(value)).toString("base64url")}`;
}

export function decodeGmailThread(
  value: string,
  expected: string
): GmailThreadId {
  const prefix = `${gmailChannel(expected)}:`;
  if (!value.startsWith(prefix)) {
    throw new ValidationError(
      "gmail",
      "Thread belongs to another Gmail mailbox"
    );
  }
  const suffix = value.slice(prefix.length);
  if (suffix.startsWith("dm:")) {
    const recipient = address.shape.address.parse(
      Buffer.from(suffix.slice(3), "base64url").toString()
    );
    if (encodeGmailThread({ mailbox: expected, recipient }) !== value) {
      throw new ValidationError("gmail", "Invalid Gmail recipient route");
    }
    return { mailbox: expected, recipient };
  }
  return {
    mailbox: expected,
    threadId: identifier.parse(suffix),
  };
}

export function encodeGmailMessage(value: string, email: string): string {
  return `${gmailChannel(email)}:${identifier.parse(value)}`;
}

export function decodeGmailMessage(value: string, email: string): string {
  const thread = decodeGmailThread(value, email);
  if (thread.threadId === undefined) {
    throw new ValidationError(
      "gmail",
      "Expected a Gmail message ID, not a recipient route"
    );
  }
  return thread.threadId;
}
