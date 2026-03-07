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
  /** Number of code fence toggles from completed lines (odd = inside). */
  private fenceToggles = 0;
  /** Incomplete trailing line buffer for incremental fence tracking. */
  private incompleteLine = "";

  /** Append a chunk from the LLM stream. */
  push(chunk: string): void {
    this.accumulated += chunk;
    this.dirty = true;

    // Incrementally track code fence state from completed lines
    this.incompleteLine += chunk;
    const parts = this.incompleteLine.split("\n");
    this.incompleteLine = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        this.fenceToggles++;
      }
    }
  }

  /** O(1) check if accumulated text is inside an unclosed code fence. */
  private isAccumulatedInsideFence(): boolean {
    let inside = this.fenceToggles % 2 === 1;
    const trimmed = this.incompleteLine.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inside = !inside;
    }
    return inside;
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
    if (this.isAccumulatedInsideFence()) {
      this.cachedRender = remend(this.accumulated);
      return this.cachedRender;
    }

    const committable = getCommittablePrefix(this.accumulated);
    this.cachedRender = remend(committable);
    return this.cachedRender;
  }

  /**
   * Get text safe for append-only streaming (e.g. Slack native streaming).
   *
   * - Holds back unconfirmed table headers until separator arrives.
   * - Wraps confirmed tables in code fences so pipes render as literal
   *   text (not broken mrkdwn). The code fence is left OPEN while
   *   the table is still streaming, keeping output monotonic for deltas.
   * - Holds back unclosed inline markers (**, *, ~~, `, [).
   * - The final editMessage replaces everything with properly formatted text.
   */
  getCommittableText(): string {
    if (this.finished) {
      return wrapTablesForAppend(this.accumulated, true);
    }

    // Strip incomplete last line (no trailing newline) to prevent committing
    // content that might change semantics when completed — e.g. "| A" could
    // become "| A | B |" which is a table row that should be held back.
    let text = this.accumulated;
    if (text.length > 0 && !text.endsWith("\n")) {
      const lastNewline = text.lastIndexOf("\n");
      const withoutIncompleteLine =
        lastNewline >= 0 ? text.slice(0, lastNewline + 1) : "";

      // If stripping puts us inside a code fence, keep the incomplete line
      // (it's likely the closing fence being typed — content is literal).
      if (isInsideCodeFence(withoutIncompleteLine)) {
        // Still wrap preceding tables for consistent coordinate space.
        return wrapTablesForAppend(text);
      }

      text = withoutIncompleteLine;
    }

    // Inside a user code fence: skip table holding and inline marker buffering
    // (pipes and markers are literal inside fences), but still wrap preceding
    // confirmed tables for consistent coordinate space.
    if (isInsideCodeFence(text)) {
      return wrapTablesForAppend(text);
    }

    const committed = getCommittablePrefix(text);
    const wrapped = wrapTablesForAppend(committed);

    // If text ends inside an open table code fence,
    // skip inline marker buffering — markers in code blocks are literal
    if (isInsideCodeFence(wrapped)) {
      return wrapped;
    }

    return findCleanPrefix(wrapped);
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

/**
 * Characters that can open an inline markdown construct.
 * Used to find the cut point when text has unclosed markers.
 */
const INLINE_MARKER_CHARS = new Set(["*", "~", "`", "["]);

/**
 * Check if text is "clean" — remend doesn't add any closing markers.
 * Uses length comparison because remend may trim trailing whitespace
 * from otherwise clean text (which is harmless for streaming).
 */
function isClean(text: string): boolean {
  return remend(text).length <= text.length;
}

/**
 * Returns the longest prefix of `text` where all inline markers are balanced
 * (i.e. remend would not add closing markers). Scans backward from the end
 * for potential opening markers, grouping consecutive same characters to
 * handle multi-char markers like ** and ~~.
 *
 * Typically resolves in 1-3 remend calls since unclosed markers are
 * almost always near the end of the text.
 */
function findCleanPrefix(text: string): string {
  if (text.length === 0 || isClean(text)) {
    return text;
  }

  for (let i = text.length - 1; i >= 0; i--) {
    if (INLINE_MARKER_CHARS.has(text[i])) {
      // Group consecutive same characters (e.g., ** or ~~)
      while (i > 0 && text[i - 1] === text[i]) {
        i--;
      }
      const candidate = text.slice(0, i);
      if (isClean(candidate)) {
        return candidate;
      }
    }
  }

  return "";
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

/**
 * Wraps confirmed GFM table blocks in code fences for append-only streaming.
 *
 * Append-only APIs (e.g. Slack streaming) can't render GFM tables natively.
 * Wrapping in a code fence makes pipes display as readable literal text.
 *
 * The code fence is left OPEN if the table is ongoing (no closing ```)
 * so that output remains monotonic — each new row just extends the block.
 * The fence is closed when a non-table line follows.
 */
function wrapTablesForAppend(text: string, closeFences = false): string {
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.split("\n");

  // Remove trailing empty string from split (artifact of trailing newline)
  if (hadTrailingNewline && lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  const result: string[] = [];
  let inTable = false;
  let inUserCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Track existing code fences in the source markdown.
    // Don't detect tables inside user code fences.
    if (!inTable && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
      inUserCodeFence = !inUserCodeFence;
      result.push(lines[i]);
      continue;
    }

    if (inUserCodeFence) {
      result.push(lines[i]);
      continue;
    }

    const isTableLine =
      trimmed !== "" &&
      (TABLE_ROW_RE.test(trimmed) || TABLE_SEPARATOR_RE.test(trimmed));

    if (isTableLine && !inTable) {
      // Only wrap if this block has a separator (confirmed table)
      let hasSeparator = false;
      for (let j = i; j < lines.length; j++) {
        const t = lines[j].trim();
        if (TABLE_SEPARATOR_RE.test(t)) {
          hasSeparator = true;
          break;
        }
        if (t === "" || !TABLE_ROW_RE.test(t)) {
          break;
        }
      }
      if (hasSeparator) {
        result.push("```");
        inTable = true;
      }
    } else if (!isTableLine && inTable) {
      result.push("```");
      inTable = false;
    }

    result.push(lines[i]);
  }

  // Close the fence if requested (e.g. after stream finishes)
  if (inTable && closeFences) {
    result.push("```");
  }
  // Otherwise if inTable is true, the code fence is intentionally left OPEN
  // for monotonic appending — it'll be closed when the table ends.

  let output = result.join("\n");
  if (hadTrailingNewline) {
    output += "\n";
  }
  return output;
}
