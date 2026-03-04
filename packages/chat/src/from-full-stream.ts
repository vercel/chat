/**
 * Normalizes an async iterable stream for use with `thread.post()`.
 *
 * Handles two stream types automatically:
 * - **Text streams** (`AsyncIterable<string>`, e.g. AI SDK `textStream`) —
 *   passed through as-is.
 * - **Full streams** (`AsyncIterable<object>`, e.g. AI SDK `fullStream`) —
 *   extracts `text-delta` events and injects `"\n\n"` separators between
 *   steps so that multi-step agent output reads naturally.
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
): AsyncIterable<string> {
  let needsSeparator = false;
  let hasEmittedText = false;

  for await (const event of stream) {
    // Plain string chunk (e.g. from AI SDK textStream)
    if (typeof event === "string") {
      yield event;
      continue;
    }

    // Skip non-objects
    if (event === null || typeof event !== "object" || !("type" in event)) {
      continue;
    }
    const typed = event as { type: string; textDelta?: unknown };

    if (typed.type === "text-delta" && typeof typed.textDelta === "string") {
      if (needsSeparator && hasEmittedText) {
        yield "\n\n";
      }
      needsSeparator = false;
      hasEmittedText = true;
      yield typed.textDelta;
    } else if (typed.type === "step-finish") {
      needsSeparator = true;
    }
  }
}
