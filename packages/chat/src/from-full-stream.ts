import type { StreamChunk } from "./types";

const STREAM_CHUNK_TYPES = new Set([
  "markdown_text",
  "task_update",
  "plan_update",
]);

/**
 * Normalizes an async iterable stream for use with `thread.post()`.
 *
 * Handles three stream types automatically:
 * - **Text streams** (`AsyncIterable<string>`, e.g. AI SDK `textStream`) —
 *   passed through as-is.
 * - **Full streams** (`AsyncIterable<object>`, e.g. AI SDK `fullStream`) —
 *   extracts `text-delta` events and injects `"\n\n"` separators between
 *   steps so that multi-step agent output reads naturally.
 * - **StreamChunk objects** (`task_update`, `plan_update`, `markdown_text`) —
 *   passed through as-is for adapters with native structured chunk support.
 *
 * This is used internally by `thread.post()`, so you can pass either stream
 * directly:
 * ```ts
 * await thread.post(result.fullStream); // auto-detected
 * await thread.post(result.textStream); // still works
 * ```
 */
export async function* fromFullStream(
  stream: AsyncIterable<unknown>
): AsyncIterable<string | StreamChunk> {
  let needsSeparator = false;
  let hasEmittedText = false;
  let eventCount = 0;
  let yieldedCount = 0;
  let skippedTypes: string[] = [];

  try {
    for await (const event of stream) {
      eventCount++;

      // Plain string chunk (e.g. from AI SDK textStream)
      if (typeof event === "string") {
        yieldedCount++;
        yield event;
        continue;
      }

      // Skip non-objects
      if (event === null || typeof event !== "object" || !("type" in event)) {
        const desc =
          event === null
            ? "null"
            : `${typeof event}${typeof event === "object" ? `(keys:${Object.keys(event as object).join(",")})` : ""}`;
        skippedTypes.push(desc);
        continue;
      }
      const typed = event as { textDelta?: unknown; type: string };

      // Pass through StreamChunk objects (task_update, plan_update, markdown_text)
      if (STREAM_CHUNK_TYPES.has(typed.type)) {
        yieldedCount++;
        yield event as StreamChunk;
        continue;
      }

      if (typed.type === "text-delta" && typeof typed.textDelta === "string") {
        if (needsSeparator && hasEmittedText) {
          yield "\n\n";
        }
        needsSeparator = false;
        hasEmittedText = true;
        yieldedCount++;
        yield typed.textDelta;
      } else if (typed.type === "step-finish") {
        needsSeparator = true;
      } else {
        skippedTypes.push(typed.type);
      }
    }
  } catch (error) {
    console.error("[fromFullStream] Stream error after", eventCount, "events:", error);
    throw error;
  } finally {
    if (eventCount === 0 || yieldedCount === 0) {
      console.warn(
        `[fromFullStream] Stream ended: ${eventCount} events received, ${yieldedCount} yielded.` +
          (skippedTypes.length > 0
            ? ` Skipped types: ${skippedTypes.join(", ")}`
            : "")
      );
    }
  }
}
