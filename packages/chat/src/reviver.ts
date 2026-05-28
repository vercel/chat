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
import { Message, type SerializedMessage } from "./message";
import { type SerializedThread, ThreadImpl } from "./thread";

export function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "_type" in value) {
    const typed = value as { _type: string };
    if (typed._type === "chat:Thread") {
      return ThreadImpl.fromJSON(value as SerializedThread);
    }
    if (typed._type === "chat:Channel") {
      return ChannelImpl.fromJSON(value as SerializedChannel);
    }
    if (typed._type === "chat:Message") {
      return Message.fromJSON(value as SerializedMessage);
    }
  }
  return value;
}

/**
 * Strict variant of {@link reviver}. Throws when a value looks like a
 * Thread / Channel / Message (i.e. it carries the SDK's required keys)
 * but is missing the `_type` discriminator the standard reviver needs.
 *
 * Use when you construct Thread/Message references by hand and pass
 * them through `JSON.parse(..., reviver)` — the standard reviver
 * silently returns the literal in that case, and downstream
 * `thread.post()` then throws "thread.post is not a function" deep
 * inside delivery code. `strictReviver()` surfaces the mistake at
 * the parse boundary instead.
 *
 * @example
 * ```typescript
 * const data = JSON.parse(payload, strictReviver());
 * // throws: "[chat-sdk] reviver: object with Thread-shaped keys
 * //          (id, channelId, isDM) is missing `_type: 'chat:Thread'`."
 * ```
 */
export function strictReviver(): (key: string, value: unknown) => unknown {
  return (key, value) => {
    if (value && typeof value === "object" && !("_type" in value)) {
      const o = value as Record<string, unknown>;
      // Thread-shaped: has SerializedThread's required keys.
      if (
        typeof o.id === "string" &&
        typeof o.channelId === "string" &&
        typeof o.isDM === "boolean"
      ) {
        throw new Error(
          "[chat-sdk] reviver: object with Thread-shaped keys (id, channelId, isDM) is missing `_type: 'chat:Thread'`. " +
            `Add the discriminator or construct via ThreadImpl.fromJSON / new ThreadImpl({...}). Key: ${JSON.stringify(key)}`
        );
      }
      // Message-shaped.
      if (
        typeof o.id === "string" &&
        typeof o.threadId === "string" &&
        ("text" in o || "parts" in o)
      ) {
        throw new Error(
          "[chat-sdk] reviver: object with Message-shaped keys (id, threadId, text/parts) is missing `_type: 'chat:Message'`. " +
            `Add the discriminator or construct via Message.fromJSON. Key: ${JSON.stringify(key)}`
        );
      }
    }
    return reviver(key, value);
  };
}
