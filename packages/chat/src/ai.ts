import type { Message } from "./message";

/**
 * A message formatted for AI SDK consumption.
 */
export interface AiMessage {
  content: string;
  role: "user" | "assistant";
}

/**
 * Options for converting messages to AI SDK format.
 */
export interface ToAiMessagesOptions {
  /** When true, prefixes user messages with "[username]: " for multi-user context */
  includeNames?: boolean;
}

/**
 * Convert chat SDK messages to AI SDK conversation format.
 *
 * - Filters out messages with empty/whitespace-only text
 * - Maps `author.isMe === true` to `"assistant"`, otherwise `"user"`
 * - Uses `message.text` for content
 *
 * Works with `FetchResult.messages`, `thread.recentMessages`, or collected iterables.
 *
 * @example
 * ```typescript
 * const result = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
 * const history = toAiMessages(result.messages);
 * const response = await agent.stream({ prompt: history });
 * ```
 */
export function toAiMessages(
  messages: Message[],
  options?: ToAiMessagesOptions
): AiMessage[] {
  const includeNames = options?.includeNames ?? false;

  // Sort chronologically (oldest first) so AI sees conversation in order
  const sorted = [...messages].sort(
    (a, b) =>
      (a.metadata.dateSent?.getTime() ?? 0) -
      (b.metadata.dateSent?.getTime() ?? 0)
  );

  return sorted
    .filter((msg) => msg.text.trim())
    .map((msg) => {
      const role: "user" | "assistant" = msg.author.isMe ? "assistant" : "user";
      let content =
        includeNames && role === "user"
          ? `[${msg.author.userName}]: ${msg.text}`
          : msg.text;

      // Append link metadata when available
      if (msg.links.length > 0) {
        const linkParts = msg.links
          .map((link) => {
            const parts = link.fetchMessage
              ? [`[Embedded message: ${link.url}]`]
              : [link.url];
            if (link.title) {
              parts.push(`Title: ${link.title}`);
            }
            if (link.description) {
              parts.push(`Description: ${link.description}`);
            }
            if (link.siteName) {
              parts.push(`Site: ${link.siteName}`);
            }
            return parts.join("\n");
          })
          .join("\n\n");
        content += `\n\nLinks:\n${linkParts}`;
      }

      return { role, content };
    });
}
