import {
  POSTABLE_OBJECT,
  type PostableObject,
  type PostableObjectContext,
} from "./postable-object";
import type { Adapter, StreamChunk, StreamEvent } from "./types";

export interface StreamingPlanOptions {
  /**
   * Block Kit elements to attach when the stream stops (Slack only).
   * Useful for adding feedback buttons after a streamed response.
   */
  endWith?: unknown[];
  /**
   * Controls how task_update chunks are displayed (Slack only).
   * - `"plan"` - all tasks grouped into a single plan block
   * - `"timeline"` - individual task cards shown inline with text (default)
   */
  groupTasks?: "plan" | "timeline";
  /**
   * Minimum interval between updates in ms (default: 500).
   * Used for fallback mode (post+edit on adapters without native streaming).
   */
  updateIntervalMs?: number;
}

export interface StreamingPlanData {
  options: StreamingPlanOptions;
  stream: AsyncIterable<string | StreamChunk | StreamEvent>;
}

/**
 * A StreamingPlan wraps an async iterable with platform-specific streaming options.
 *
 * Use this when you need to pass options like task grouping or stop blocks
 * to the streaming API. For simple streaming without options, pass the
 * async iterable directly to `thread.post()`.
 *
 * @example
 * ```typescript
 * const stream = new StreamingPlan(result.fullStream, {
 *   groupTasks: "plan",
 *   endWith: [feedbackBlock],
 * });
 * await thread.post(stream);
 * ```
 */
export class StreamingPlan implements PostableObject<StreamingPlanData> {
  readonly $$typeof = POSTABLE_OBJECT;
  readonly kind = "stream";

  private readonly _stream: AsyncIterable<string | StreamChunk | StreamEvent>;
  private readonly _options: StreamingPlanOptions;

  constructor(
    stream: AsyncIterable<string | StreamChunk | StreamEvent>,
    options: StreamingPlanOptions = {}
  ) {
    this._stream = stream;
    this._options = options;
  }

  get stream(): AsyncIterable<string | StreamChunk | StreamEvent> {
    return this._stream;
  }

  get options(): StreamingPlanOptions {
    return this._options;
  }

  getFallbackText(): string {
    return "";
  }

  getPostData(): StreamingPlanData {
    return {
      stream: this._stream,
      options: this._options,
    };
  }

  isSupported(_adapter: Adapter): boolean {
    return true;
  }

  onPosted(_context: PostableObjectContext): void {
    // Streams are one-shot, no lifecycle binding needed
  }
}
