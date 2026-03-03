import remend from "remend";

/**
 * A streaming markdown renderer that buffers potential table headers
 * until confirmed by a separator line, preventing tables from flashing
 * as raw pipe-delimited text during LLM streaming.
 *
 * Outputs markdown (not platform text). Format conversion still happens
 * in the adapter's editMessage → renderPostable → fromAst pipeline.
 */
export class StreamingMarkdownRenderer {
  private accumulated = "";
  private dirty = true;
  private cachedRender = "";
  private finished = false;

  /** Append a chunk from the LLM stream. */
  push(chunk: string): void {
    this.accumulated += chunk;
    this.dirty = true;
  }

  /**
   * Get renderable markdown for an intermediate edit.
   * - Holds back trailing lines that look like a table header (|...|)
   *   until a separator line (|---|---|) confirms or the next line denies.
   * - Applies remend() to close incomplete inline markers.
   * - Idempotent: returns cached result if no push() since last call.
   */
  render(): string {
    if (!this.dirty) {
      return this.cachedRender;
    }

    this.dirty = false;

    if (this.finished) {
      this.cachedRender = remend(this.accumulated);
      return this.cachedRender;
    }

    // If inside an unclosed code fence, don't buffer (pipes aren't tables)
    if (isInsideCodeFence(this.accumulated)) {
      this.cachedRender = remend(this.accumulated);
      return this.cachedRender;
    }

    const committable = getCommittablePrefix(this.accumulated);
    this.cachedRender = remend(committable);
    return this.cachedRender;
  }

  /** Raw accumulated text (no remend, no buffering). For the final edit. */
  getText(): string {
    return this.accumulated;
  }

  /** Signal stream end. Flushes held-back lines. Returns final render. */
  finish(): string {
    this.finished = true;
    this.dirty = true;
    return this.render();
  }
}

const TABLE_ROW_RE = /^\|.*\|$/;
const TABLE_SEPARATOR_RE = /^\|[\s:]*-{1,}[\s:]*(\|[\s:]*-{1,}[\s:]*)*\|$/;

/**
 * Check if the text ends inside an unclosed code fence.
 * Counts the number of ``` (or ~~~) fence openers/closers.
 */
function isInsideCodeFence(text: string): boolean {
  let inside = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Returns the prefix of `text` that can be safely rendered,
 * holding back trailing lines that look like an unconfirmed table.
 *
 * A table is "confirmed" when a separator line (|---|---|) appears
 * after a header row. Until then, potential table rows at the end
 * of the text are withheld.
 */
function getCommittablePrefix(text: string): string {
  // Split into lines, keeping track of whether the text ends with a newline
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");

  // If the text doesn't end with newline, the last line is still being
  // written to. Remove it from consideration for table detection.
  if (!endsWithNewline && lines.length > 0) {
    lines.pop();
  }

  // Remove trailing empty string from split (if text ends with \n)
  if (endsWithNewline && lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  // Walk backward to find consecutive table-like lines at the end
  let heldCount = 0;
  let separatorFound = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();

    // Empty line breaks a table block
    if (trimmed === "") {
      break;
    }

    if (TABLE_SEPARATOR_RE.test(trimmed)) {
      // Separator found — table is confirmed from here upward
      separatorFound = true;
      break;
    }

    if (TABLE_ROW_RE.test(trimmed)) {
      heldCount++;
    } else {
      // Non-table line breaks the run
      break;
    }
  }

  if (separatorFound || heldCount === 0) {
    // Table confirmed or no table-like lines — commit everything
    return text;
  }

  // Hold back the trailing table-like lines
  const commitLineCount = lines.length - heldCount;
  const committedLines = lines.slice(0, commitLineCount);

  // Reconstruct: committed lines + trailing newline
  let result = committedLines.join("\n");
  // Preserve a trailing newline if there were committed lines
  if (committedLines.length > 0) {
    result += "\n";
  }

  return result;
}
