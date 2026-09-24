/**
 * Standalone JSON reviver for Chat SDK objects.
 *
 * Restores serialized Thread, Channel, and Message instances during
 * JSON.parse() without requiring a Chat instance. This is useful in
 * environments like Vercel Workflow functions where importing the full
 * Chat instance (with its adapter dependencies) is not possible.
 *
 * Thread instances created this way use lazy adapter resolution —
 * the adapter is looked up from the Chat singleton when first accessed,
 * so `chat.registerSingleton()` must be called before using thread
 * methods like `post()` (typically inside a "use step" function).
 */

import { ChannelImpl, type SerializedChannel } from "./channel";
import type { ChatSingleton } from "./chat-singleton";
import { Message, type SerializedMessage } from "./message";
import { type SerializedThread, ThreadImpl } from "./thread";

export function reviver(_key: string, value: unknown): unknown {
  return revive(value);
}

export function createReviver(
  chat: ChatSingleton
): (key: string, value: unknown) => unknown {
  return (_key, value) => revive(value, chat);
}

function revive(value: unknown, chat?: ChatSingleton): unknown {
  if (value && typeof value === "object" && "_type" in value) {
    const typed = value as { _type: string };
    if (typed._type === "chat:Thread") {
      return ThreadImpl.fromJSON(value as SerializedThread, undefined, chat);
    }
    if (typed._type === "chat:Channel") {
      return ChannelImpl.fromJSON(value as SerializedChannel, undefined, chat);
    }
    if (typed._type === "chat:Message") {
      return Message.fromJSON(value as SerializedMessage);
    }
  }
  return value;
}
