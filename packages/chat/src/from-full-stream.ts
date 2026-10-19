import type { StreamChunk } from "./types";

const STREAM_CHUNK_TYPES = new Set([
  "markdown_text",
  "task_update",
  "plan_update",
  "reasoning",
]);

/**
 * Normalizes an async iterable stream for use with `thread.post()`.
 *
 * Handles these stream types automatically:
 * - **Text streams** (`AsyncIterable<string>`, e.g. AI SDK `textStream`) —
 *   passed through as-is.
 * - **AI SDK full streams** (`AsyncIterable<object>`, e.g. `result.fullStream`) —
 *   extracts `text-delta` events and injects `"\n\n"` separators after each
 *   `finish-step` so that multi-step agent output reads naturally.
 * - **TanStack AI / AG-UI streams** (`AsyncIterable<StreamChunk>` from
 *   `chat()`) — extracts `TEXT_MESSAGE_CONTENT` deltas and injects `"\n\n"`
 *   separators after each `TEXT_MESSAGE_END`, since every model turn in the
 *   tool loop is its own text message.
 * - **StreamChunk objects** (`task_update`, `plan_update`, `markdown_text`,
 *   `reasoning`) —
 *   passed through as-is for adapters with native structured chunk support.
 *
 * This is used internally by `thread.post()`, so you can pass any of these
 * streams directly:
 * ```ts
 * await thread.post(result.fullStream); // AI SDK, auto-detected
 * await thread.post(result.textStream); // AI SDK text only
 * await thread.post(chat({ adapter, messages })); // TanStack AI
 * ```
 */
export async function* fromFullStream(
  stream: AsyncIterable<unknown>
): AsyncIterable<string | StreamChunk> {
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
    const typed = event as {
      delta?: unknown;
      text?: unknown;
      textDelta?: unknown;
      type: string;
    };

    // AI SDK v4 full streams emit `{ type: "reasoning", textDelta }`, which
    // shares its type with a reasoning StreamChunk but has no `text`. Skip
    // it like the other reasoning events below.
    if (typed.type === "reasoning" && typeof typed.text !== "string") {
      continue;
    }

    // Pass through StreamChunk objects (task_update, plan_update,
    // markdown_text, reasoning)
    if (STREAM_CHUNK_TYPES.has(typed.type)) {
      yield event as StreamChunk;
      continue;
    }

    // AI SDK v5 uses `textDelta`, v6 uses `text`; AG-UI (TanStack AI) uses `delta`
    const textContent = typed.text ?? typed.delta ?? typed.textDelta;
    const isTextDelta =
      typed.type === "text-delta" || typed.type === "TEXT_MESSAGE_CONTENT";
    if (isTextDelta && typeof textContent === "string") {
      if (needsSeparator && hasEmittedText) {
        yield "\n\n";
      }
      needsSeparator = false;
      hasEmittedText = true;
      yield textContent;
    } else if (
      typed.type === "finish-step" ||
      typed.type === "TEXT_MESSAGE_END"
    ) {
      needsSeparator = true;
    }
  }
}
