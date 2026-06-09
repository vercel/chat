import type { TranscriptEntry } from "../types";
import type { PromptEntry } from "./types";

/**
 * Convert an array of {@link TranscriptEntry} (a.k.a. `UserHistoryEntry`)
 * values into the normalized {@link PromptEntry} shape expected by LLM SDKs
 * (e.g. the AI SDK's `CoreMessage`).
 *
 * Only entries with non-empty text are included. Entry order is preserved
 * (chronological, oldest first — the natural order returned by
 * `history.user.list()`).
 *
 * @example
 * ```typescript
 * const entries = await chat.history.user.list({ userKey });
 * const messages = toPromptEntries(entries);
 * const { text } = await generateText({ model, messages });
 * ```
 */
export function toPromptEntries(entries: TranscriptEntry[]): PromptEntry[] {
  const result: PromptEntry[] = [];
  for (const entry of entries) {
    if (!entry.text) {
      continue;
    }
    result.push({ role: entry.role, content: entry.text });
  }
  return result;
}
