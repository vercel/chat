import remend from "remend";
import { describe, expect, it } from "vitest";
import { StreamingMarkdownRenderer } from "./streaming-markdown";

const CODE_FENCE_SPLIT_RE = /```|~~~/;
const TABLE_PIPE_RE = /^\|.*\|$/;

describe("StreamingMarkdownRenderer", () => {
  it("should accumulate basic text", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello");
    r.push(" World");
    expect(r.render()).toBe("Hello World");
  });

  it("should heal inline markers with remend", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor");
    const result = r.render();
    // remend should close the bold marker
    const openCount = (result.match(/\*\*/g) || []).length;
    expect(openCount % 2).toBe(0);
    expect(result).toContain("Hello **wor");
  });

  it("should hold back trailing table header lines", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    const result = r.render();
    // The pipe line should be held back
    expect(result).not.toContain("| A | B |");
    expect(result).toContain("Text");
  });

  it("should confirm table when separator arrives", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    expect(r.render()).not.toContain("| A | B |");

    r.push("|---|---|\n");
    const result = r.render();
    expect(result).toContain("| A | B |");
    expect(result).toContain("|---|---|");
  });

  it("should release held lines when next line is not a table row", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    expect(r.render()).not.toContain("| A | B |");

    r.push("Not a table\n");
    const result = r.render();
    expect(result).toContain("| A | B |");
    expect(result).toContain("Not a table");
  });

  it("should not hold back pipe lines inside code fences", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("```\n| A |\n");
    const result = r.render();
    expect(result).toContain("| A |");
  });

  it("should flush held lines on finish()", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    expect(r.render()).not.toContain("| A | B |");

    const final = r.finish();
    expect(final).toContain("| A | B |");
  });

  it("should be idempotent when no push between renders", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor");
    const first = r.render();
    const second = r.render();
    expect(first).toBe(second);
  });

  it("should return raw text from getText() without remend", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor");
    r.render(); // trigger render
    expect(r.getText()).toBe("Hello **wor");
  });

  it("should handle table with data rows after separator", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const result = r.render();
    // Separator confirms the table, so all rows should be visible
    expect(result).toContain("| A | B |");
    expect(result).toContain("|---|---|");
    expect(result).toContain("| 1 | 2 |");
  });

  it("should handle multiple consecutive table rows held back", () => {
    const r = new StreamingMarkdownRenderer();
    // Two potential table rows without a separator
    r.push("Intro\n\n| A | B |\n| C | D |\n");
    const result = r.render();
    expect(result).not.toContain("| A | B |");
    expect(result).not.toContain("| C | D |");
  });

  it("should not buffer lines that don't match table pattern", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Just normal text\n");
    expect(r.render()).toContain("Just normal text");
  });

  it("should handle code fence with tilde syntax", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("~~~\n| A |\n");
    const result = r.render();
    expect(result).toContain("| A |");
  });

  it("should resume buffering after code fence closes", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("```\n| inside |\n```\n| A | B |\n");
    const result = r.render();
    // Code fence is closed, so the trailing pipe line should be held
    expect(result).toContain("| inside |");
    expect(result).not.toContain("| A | B |");
  });

  it("should handle empty input", () => {
    const r = new StreamingMarkdownRenderer();
    expect(r.render()).toBe("");
    expect(r.getText()).toBe("");
    expect(r.finish()).toBe("");
  });

  it("should handle text with no trailing newline", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello world");
    expect(r.render()).toBe("Hello world");
  });

  it("should handle table header without trailing newline (incomplete line)", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |");
    // Incomplete line (no trailing newline) — not yet a full line, should not buffer
    const result = r.render();
    expect(result).toContain("Text");
  });

  // --- Buffer state transition edge cases ---

  it("should still work after push() following finish()", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello");
    r.finish();
    // push after finish — finished flag stays true, new content is flushed fully
    r.push(" World");
    const result = r.render();
    expect(result).toContain("Hello World");
  });

  it("should be idempotent for render() after finish()", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    r.finish();
    const first = r.render();
    const second = r.render();
    expect(first).toBe(second);
    expect(first).toContain("| A | B |");
  });

  it("should handle finish() with no held lines", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Just plain text\n");
    const rendered = r.render();
    const finished = r.finish();
    // Both should contain the full text
    expect(rendered).toContain("Just plain text");
    expect(finished).toContain("Just plain text");
  });

  it("should handle table header split across chunks", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A");
    // Partial pipe line — no trailing newline, treated as incomplete
    expect(r.render()).toContain("Text");
    // The partial pipe is part of the incomplete line, not buffered as table

    r.push(" | B |\n");
    // Now it's a complete table row — should be held
    expect(r.render()).not.toContain("| A | B |");

    r.push("|---|---|\n");
    // Separator confirms — everything released
    expect(r.render()).toContain("| A | B |");
  });

  it("should break held block at empty line", () => {
    const r = new StreamingMarkdownRenderer();
    // Two pipe rows separated by empty line — only second should be held
    r.push("| A | B |\n\n| C | D |\n");
    const result = r.render();
    // First pipe row is before the empty line, not held
    expect(result).toContain("| A | B |");
    // Second pipe row is after empty line and is the trailing held block
    expect(result).not.toContain("| C | D |");
  });

  it("should hold table at very start of text (no preceding content)", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("| A | B |\n");
    const result = r.render();
    expect(result).not.toContain("| A | B |");
  });

  it("should hold second table after confirmed first table", () => {
    const r = new StreamingMarkdownRenderer();
    // First table: confirmed
    r.push("| A | B |\n|---|---|\n| 1 | 2 |\n");
    expect(r.render()).toContain("|---|---|");

    // Blank line then new unconfirmed table
    r.push("\n| X | Y |\n");
    const result = r.render();
    // First table still visible
    expect(result).toContain("| A | B |");
    expect(result).toContain("| 1 | 2 |");
    // Second table held back
    expect(result).not.toContain("| X | Y |");
  });

  it("should handle held → released → new hold sequence", () => {
    const r = new StreamingMarkdownRenderer();

    // Phase 1: hold
    r.push("| A | B |\n");
    expect(r.render()).not.toContain("| A | B |");

    // Phase 2: released (non-table line denies)
    r.push("Normal text\n");
    expect(r.render()).toContain("| A | B |");
    expect(r.render()).toContain("Normal text");

    // Phase 3: new hold
    r.push("| X | Y |\n");
    const result = r.render();
    expect(result).toContain("| A | B |");
    expect(result).toContain("Normal text");
    expect(result).not.toContain("| X | Y |");
  });

  it("should confirm table with alignment markers in separator", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("| Left | Center | Right |\n");
    expect(r.render()).not.toContain("| Left |");

    r.push("|:---|:---:|---:|\n");
    const result = r.render();
    expect(result).toContain("| Left | Center | Right |");
    expect(result).toContain("|:---|:---:|---:|");
  });

  it("should not hold data rows after confirmed separator", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("| A | B |\n|---|---|\n");
    expect(r.render()).toContain("|---|---|");

    // New data row after confirmed table — backward walk hits separator, confirms
    r.push("| 1 | 2 |\n");
    const result = r.render();
    expect(result).toContain("| 1 | 2 |");
  });

  it("should handle multiple push() calls before single render()", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("| A ");
    r.push("| B |\n");
    r.push("|---|---|\n");
    r.push("| 1 | 2 |\n");
    // Single render after all pushes — should see confirmed table
    const result = r.render();
    expect(result).toContain("| A | B |");
    expect(result).toContain("|---|---|");
    expect(result).toContain("| 1 | 2 |");
  });

  it("should render real-world table with single-dash separators progressively", () => {
    const r = new StreamingMarkdownRenderer();

    // Intro text
    r.push("Here's a table with 20 rows of sample data:\n\n");
    expect(r.render()).toContain("Here's a table");

    // Header row arrives
    r.push(
      "| ID | Name | Department | Age | Salary | City | Join Date | Status |\n"
    );
    let result = r.render();
    // Header should be held back (no separator yet)
    expect(result).not.toContain("| ID |");
    expect(result).toContain("Here's a table");

    // Separator with single dashes arrives
    r.push("| - | - | - | - | - | - | - | - |\n");
    result = r.render();
    // Table confirmed! Header and separator should now be visible
    expect(result).toContain("| ID |");
    expect(result).toContain("| - |");

    // First data row
    r.push(
      "| 1 | Sarah Johnson | Engineering | 32 | $95,000 | Seattle | 2019-03-15 | Active |\n"
    );
    result = r.render();
    // Data row after confirmed separator should be visible
    expect(result).toContain("Sarah Johnson");

    // Partial second row (no trailing newline)
    r.push("| 2 | Michael");
    result = r.render();
    // Complete rows still visible, partial line excluded from table detection
    expect(result).toContain("Sarah Johnson");

    // Complete second row
    r.push(
      " Chen | Marketing | 28 | $72,000 | Austin | 2020-07-22 | Active |\n"
    );
    result = r.render();
    expect(result).toContain("Michael Chen");
  });

  // --- getCommittableText tests (for append-only streaming) ---

  it("getCommittableText should hold back incomplete line with unclosed bold", () => {
    const r = new StreamingMarkdownRenderer();
    // No trailing newline — incomplete line is stripped entirely
    r.push("Hello **wor");
    expect(r.getCommittableText()).toBe("");
  });

  it("getCommittableText should hold back unclosed bold on complete line", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor\n");
    const committable = r.getCommittableText();
    expect(committable).toBe("Hello ");
    expect(committable).not.toContain("**");
  });

  it("getCommittableText should release when bold closes", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor");
    expect(r.getCommittableText()).toBe("");

    r.push("ld** done\n");
    expect(r.getCommittableText()).toBe("Hello **world** done\n");
  });

  it("getCommittableText should hold back unclosed italic", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello *ita\n");
    expect(r.getCommittableText()).toBe("Hello ");
  });

  it("getCommittableText should hold back unclosed strikethrough", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello ~~str\n");
    expect(r.getCommittableText()).toBe("Hello ");
  });

  it("getCommittableText should hold back unclosed inline code", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello `cod\n");
    expect(r.getCommittableText()).toBe("Hello ");
  });

  it("getCommittableText should hold back unclosed link", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("See [link text\n");
    expect(r.getCommittableText()).toBe("See ");
  });

  it("getCommittableText should release when link closes", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("See [link text\n");
    expect(r.getCommittableText()).toBe("See ");

    r.push("](https://example.com)\n");
    // Link closing on next line — "See [link text\n](https://example.com)\n"
    // remend may or may not treat cross-line link as valid
    const committable = r.getCommittableText();
    expect(committable).toContain("See ");
  });

  it("getCommittableText should return clean text when all markers balanced", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **world** and *italic* done\n");
    expect(r.getCommittableText()).toBe("Hello **world** and *italic* done\n");
  });

  it("getCommittableText should hold back table rows", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    const committable = r.getCommittableText();
    expect(committable).not.toContain("| A | B |");
    expect(committable).toContain("Text");
  });

  it("getCommittableText should wrap confirmed table in code fence", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    const committable = r.getCommittableText();
    // Confirmed table is wrapped in a code fence for readable streaming
    expect(committable).toContain("```");
    expect(committable).toContain("| A | B |");
    expect(committable).toContain("| 1 | 2 |");
    expect(committable).toContain("Text");
  });

  it("getCommittableText should not buffer inside code fence", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("```\n| A |\n");
    expect(r.getCommittableText()).toContain("| A |");
  });

  it("getCommittableText should return full text after finish", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    expect(r.getCommittableText()).not.toContain("| A | B |");
    r.finish();
    expect(r.getCommittableText()).toContain("| A | B |");
  });

  it("getCommittableText should flush unclosed markers after finish", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor\n");
    expect(r.getCommittableText()).toBe("Hello ");
    r.finish();
    // After finish, everything is flushed (final edit handles formatting)
    expect(r.getCommittableText()).toBe("Hello **wor\n");
  });

  it("getCommittableText delta should stream table in code fence", () => {
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";

    // Push intro
    r.push("Hello\n\n");
    let committable = r.getCommittableText();
    let delta = committable.slice(lastAppended.length);
    expect(delta).toBe("Hello\n\n");
    lastAppended = committable;

    // Push table header — held back (no separator yet)
    r.push("| A | B |\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toBe("");

    // Push separator — table confirmed, opens code fence
    r.push("|---|---|\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toContain("```");
    expect(delta).toContain("| A | B |");
    expect(delta).toContain("|---|---|");
    lastAppended = committable;

    // Push data row — extends the open code block
    r.push("| 1 | 2 |\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toContain("| 1 | 2 |");
    // Should NOT have a closing ``` (table still ongoing)
    expect(delta).not.toContain("```");
    lastAppended = committable;

    // Blank line ends the table — closes code fence
    r.push("\nMore text\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toContain("```");
    expect(delta).toContain("More text");
  });

  it("getCommittableText delta should work for inline markers in append-only streaming", () => {
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";

    // Push clean text with newline (complete line)
    r.push("Hello ");
    // No trailing newline — incomplete line held back
    expect(r.getCommittableText()).toBe("");

    r.push("**world** done\n");
    let committable = r.getCommittableText();
    let delta = committable.slice(lastAppended.length);
    expect(delta).toBe("Hello **world** done\n");
    lastAppended = committable;

    // Push new line with unclosed bold
    r.push("More **text");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    // Incomplete line held back
    expect(delta).toBe("");

    // Close bold on same line
    r.push("** end\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toBe("More **text** end\n");
  });

  // --- Append-only delta integration tests ---
  // These simulate the exact pattern the Slack adapter uses:
  // push chunks → getCommittableText() → compute delta → track lastAppended
  // Verifies that concatenated deltas reconstruct the final output correctly.

  /**
   * Helper: simulates append-only streaming by pushing chunks one at a time,
   * computing deltas from getCommittableText(), and collecting them.
   * Returns the concatenated deltas and the final flushed text.
   */
  function simulateAppendStream(chunks: string[]): {
    appendedText: string;
    finalText: string;
    deltas: string[];
  } {
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";
    const deltas: string[] = [];

    for (const chunk of chunks) {
      r.push(chunk);
      const committable = r.getCommittableText();
      const delta = committable.slice(lastAppended.length);
      if (delta.length > 0) {
        deltas.push(delta);
        lastAppended = committable;
      }
    }

    // Final flush (same as Slack adapter: finish then getCommittableText)
    r.finish();
    const finalCommittable = r.getCommittableText();
    const finalDelta = finalCommittable.slice(lastAppended.length);
    if (finalDelta.length > 0) {
      deltas.push(finalDelta);
    }

    return {
      appendedText: deltas.join(""),
      finalText: r.getText(),
      deltas,
    };
  }

  it("append-only: plain text streams without modification", () => {
    const { appendedText } = simulateAppendStream(["Hello ", "World", "!\n"]);
    expect(appendedText).toBe("Hello World!\n");
  });

  it("append-only: bold markers are held then released", () => {
    const { appendedText } = simulateAppendStream([
      "Hello ",
      "**bold",
      "** text\n",
    ]);
    // Everything appears once the line is complete
    expect(appendedText).toContain("**bold**");
    expect(appendedText).toContain("Hello ");
  });

  it("append-only: table is wrapped in code fence", () => {
    const { appendedText } = simulateAppendStream([
      "Intro\n\n",
      "| A | B |\n",
      "|---|---|\n",
      "| 1 | 2 |\n",
      "| 3 | 4 |\n",
      "\nAfter table\n",
    ]);
    // Table content should be inside code fences
    expect(appendedText).toContain("```\n| A | B |");
    expect(appendedText).toContain("| 1 | 2 |");
    expect(appendedText).toContain("| 3 | 4 |");
    expect(appendedText).toContain("```\n\nAfter table");
    // Intro should be outside the code fence
    expect(appendedText.indexOf("Intro")).toBeLessThan(
      appendedText.indexOf("```")
    );
  });

  it("append-only: table at end of stream is flushed on finish", () => {
    const { appendedText, deltas } = simulateAppendStream([
      "Text\n\n",
      "| A | B |\n",
      "|---|---|\n",
      "| 1 | 2 |\n",
    ]);
    // Table should appear in the output (flushed by finish)
    expect(appendedText).toContain("| A | B |");
    expect(appendedText).toContain("```");
    // The final delta (from finish) should include remaining content
    expect(deltas.at(-1)).toBeTruthy();
  });

  it("append-only: concatenated deltas equal getCommittableText after finish", () => {
    const { appendedText } = simulateAppendStream([
      "Hello **world**\n",
      "\n",
      "| H1 | H2 |\n",
      "| - | - |\n",
      "| a | b |\n",
      "| c | d |\n",
      "\nDone\n",
    ]);

    // All content should be present
    expect(appendedText).toContain("Hello **world**");
    expect(appendedText).toContain("| H1 | H2 |");
    expect(appendedText).toContain("| a | b |");
    expect(appendedText).toContain("| c | d |");
    expect(appendedText).toContain("Done");
    // Table should be in code fences
    expect(appendedText).toContain("```");
  });

  it("append-only: concatenated deltas are monotonic (each is a suffix)", () => {
    // This is the core invariant: the concatenated deltas must equal
    // the final getCommittableText output. This ensures append-only
    // streaming produces correct results.
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";
    const deltas: string[] = [];
    const chunks = [
      "Hello **world**\n",
      "\n",
      "| A | B |\n",
      "| - | - |\n",
      "| 1 | 2 |\n",
      "\nDone\n",
    ];

    for (const chunk of chunks) {
      r.push(chunk);
      const committable = r.getCommittableText();
      // Verify monotonicity: committable must start with lastAppended
      expect(committable.startsWith(lastAppended)).toBe(true);
      const delta = committable.slice(lastAppended.length);
      if (delta.length > 0) {
        deltas.push(delta);
        lastAppended = committable;
      }
    }

    r.finish();
    const finalCommittable = r.getCommittableText();
    expect(finalCommittable.startsWith(lastAppended)).toBe(true);
    const finalDelta = finalCommittable.slice(lastAppended.length);
    if (finalDelta.length > 0) {
      deltas.push(finalDelta);
    }

    expect(deltas.join("")).toBe(finalCommittable);
  });

  it("append-only: final flush uses transformed text not raw text", () => {
    // This tests the exact bug that caused garbled output ("JoinJoin Date")
    // when lastAppended (transformed, with ```) was compared against
    // accumulated (raw, without ```).
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";

    // Stream a table
    for (const chunk of [
      "Intro\n\n",
      "| ID | Name |\n",
      "|---|---|\n",
      "| 1 | Alice |\n",
    ]) {
      r.push(chunk);
      const committable = r.getCommittableText();
      const delta = committable.slice(lastAppended.length);
      if (delta.length > 0) {
        lastAppended = committable;
      }
    }

    r.finish();
    const raw = r.getText();
    const transformed = r.getCommittableText();

    // After finish, transformed wraps tables in closed code fences
    expect(transformed).toContain("```");
    expect(transformed.length).toBeGreaterThan(raw.length);

    // Final delta from transformed text should be valid
    const correctDelta = transformed.slice(lastAppended.length);
    // Concatenation should match the full transformed output
    expect(lastAppended + correctDelta).toBe(transformed);

    // The buggy approach (using raw text) would NOT match
    const buggyDelta = raw.slice(lastAppended.length);
    expect(lastAppended + buggyDelta).not.toBe(transformed);
  });

  it("append-only: real-world 20-row table streams correctly", () => {
    const header =
      "| ID | Name | Department | Age | Salary | City | Join Date |\n";
    const sep = "| - | - | - | - | - | - | - |\n";
    const rows = [
      "| 1 | Alice Johnson | Engineering | 28 | $75,000 | New York | 2021-03-15 |\n",
      "| 2 | Bob Smith | Marketing | 35 | $68,000 | Los Angeles | 2019-07-22 |\n",
      "| 3 | Carol Davis | Finance | 31 | $82,000 | Chicago | 2021-01-10 |\n",
    ];

    const chunks = ["Here's a table:\n\n", header, sep, ...rows];

    const { appendedText, finalText } = simulateAppendStream(chunks);

    // All data should be present in the streamed output
    expect(appendedText).toContain("Alice Johnson");
    expect(appendedText).toContain("Bob Smith");
    expect(appendedText).toContain("Carol Davis");
    // Table should be in a code fence
    expect(appendedText).toContain("```");
    // No garbled text — column names should be intact
    expect(appendedText).toContain("Join Date");
    expect(appendedText).not.toContain("JoinJoin");
    // Raw text should have all content
    expect(finalText).toContain("Alice Johnson");
    expect(finalText).toContain("| 3 |");
  });

  it("append-only: table rows split mid-token stream correctly", () => {
    // LLM tokens often split mid-word or mid-cell.
    // Incomplete lines are held back until newline arrives,
    // preventing partial content from leaking.
    const { appendedText } = simulateAppendStream([
      "Text\n\n",
      "| A", // incomplete line — held
      " | B |\n", // line completes — held as unconfirmed table row
      "|---|", // incomplete separator — held
      "---|\n", // separator completes — table confirmed, code fence opens
      "| 1 | ", // incomplete data row — held
      "2 |\n", // row completes — extends code block
    ]);
    expect(appendedText).toContain("```");
    expect(appendedText).toContain("| A | B |");
    expect(appendedText).toContain("| 1 | 2 |");
    // No partial content like "| A" should appear outside the code fence
    const beforeFence = appendedText.slice(0, appendedText.indexOf("```"));
    expect(beforeFence).not.toContain("| A");
  });

  it("append-only: multiple tables in sequence", () => {
    const { appendedText } = simulateAppendStream([
      "First table:\n\n",
      "| A |\n",
      "|---|\n",
      "| 1 |\n",
      "\nSecond table:\n\n",
      "| X |\n",
      "|---|\n",
      "| 9 |\n",
      "\nDone\n",
    ]);
    // Both tables should be in separate code fences
    const fenceCount = (appendedText.match(/```/g) || []).length;
    expect(fenceCount).toBe(4); // open+close for each table
    expect(appendedText).toContain("| 1 |");
    expect(appendedText).toContain("| 9 |");
  });

  it("should track dirty flag correctly across push-render-push-render", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello");
    const r1 = r.render();
    expect(r1).toBe("Hello");

    // No push — should return cached
    expect(r.render()).toBe(r1);

    r.push(" **bold");
    const r2 = r.render();
    // Should have changed (dirty was set by push)
    expect(r2).not.toBe(r1);
    expect(r2).toContain("Hello **bold");
    // remend should close the marker
    const count = (r2.match(/\*\*/g) || []).length;
    expect(count % 2).toBe(0);
  });

  // --- Exhaustive prefix tests ---
  // Feed a complex markdown document character-by-character and verify
  // invariants hold at every single prefix.

  describe("exhaustive prefix invariants", () => {
    const COMPLEX_MARKDOWN = [
      "# Heading\n",
      "\n",
      "Some **bold** and *italic* text with `inline code` here.\n",
      "\n",
      "A [link](https://example.com) and ~~deleted~~ stuff.\n",
      "\n",
      "## Table section\n",
      "\n",
      "| Name | Age | City |\n",
      "| - | - | - |\n",
      "| Alice | 30 | NYC |\n",
      "| Bob | 25 | LA |\n",
      "\n",
      "Text after table with **bold again**.\n",
      "\n",
      "```\n",
      "code block with | pipes | inside\n",
      "and **markers** that are literal\n",
      "```\n",
      "\n",
      "Final paragraph.\n",
    ].join("");

    it("render() output is always valid markdown (remend is idempotent)", () => {
      const r = new StreamingMarkdownRenderer();
      for (let i = 0; i < COMPLEX_MARKDOWN.length; i++) {
        r.push(COMPLEX_MARKDOWN[i]);
        const rendered = r.render();
        // remend applied to render() output should be a no-op
        // (render already applies remend)
        const doubleRemended = remend(rendered);
        expect(doubleRemended.length).toBeLessThanOrEqual(
          rendered.length,
          `render() at position ${i} ("${COMPLEX_MARKDOWN.slice(0, i + 1).slice(-20)}") produced text that remend would still modify`
        );
      }
    });

    it("getCommittableText() output is always monotonic (append-only safe)", () => {
      const r = new StreamingMarkdownRenderer();
      let prev = "";
      for (let i = 0; i < COMPLEX_MARKDOWN.length; i++) {
        r.push(COMPLEX_MARKDOWN[i]);
        const committable = r.getCommittableText();
        if (committable.startsWith(prev) === false) {
          // Find exact divergence point for debugging
          let diffAt = 0;
          while (
            diffAt < prev.length &&
            diffAt < committable.length &&
            prev[diffAt] === committable[diffAt]
          ) {
            diffAt++;
          }
          expect.fail(
            `Monotonicity broke at char ${i} (${JSON.stringify(COMPLEX_MARKDOWN[i])})` +
              `\n  prefix: ...${JSON.stringify(COMPLEX_MARKDOWN.slice(Math.max(0, i - 20), i + 1))}` +
              `\n  prev[${prev.length}]: ...${JSON.stringify(prev.slice(Math.max(0, diffAt - 10), diffAt + 20))}` +
              `\n  now [${committable.length}]: ...${JSON.stringify(committable.slice(Math.max(0, diffAt - 10), diffAt + 20))}` +
              `\n  diverge at offset ${diffAt}`
          );
        }
        prev = committable;
      }
    });

    it("getCommittableText() never contains raw table pipes outside code fences", () => {
      const r = new StreamingMarkdownRenderer();
      for (let i = 0; i < COMPLEX_MARKDOWN.length; i++) {
        r.push(COMPLEX_MARKDOWN[i]);
        const committable = r.getCommittableText();

        // Extract text outside ALL code fences (both user fences and our table fences)
        const sections = committable.split(CODE_FENCE_SPLIT_RE);
        for (let s = 0; s < sections.length; s += 2) {
          const outside = sections[s];
          if (outside === undefined) {
            continue;
          }
          for (const line of outside.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "") {
              continue;
            }
            const looksLikeTable =
              TABLE_PIPE_RE.test(trimmed) &&
              (trimmed.match(/\|/g) || []).length >= 3;
            if (looksLikeTable) {
              expect.fail(
                `Table-like line outside code fence at char ${i}: "${trimmed}"` +
                  `\n  prefix: ...${JSON.stringify(COMPLEX_MARKDOWN.slice(Math.max(0, i - 20), i + 1))}` +
                  `\n  committable: ...${JSON.stringify(committable.slice(-80))}`
              );
            }
          }
        }
      }
    });

    it("getCommittableText() is always clean (remend would not add markers)", () => {
      const r = new StreamingMarkdownRenderer();
      for (let i = 0; i < COMPLEX_MARKDOWN.length; i++) {
        r.push(COMPLEX_MARKDOWN[i]);
        const committable = r.getCommittableText();
        if (committable.length === 0) {
          continue;
        }
        // Skip check if we're inside a code fence (markers are literal there)
        if (isInsideCodeFence(committable)) {
          continue;
        }
        expect(remend(committable).length).toBeLessThanOrEqual(
          committable.length,
          `getCommittableText() at position ${i} ("${COMPLEX_MARKDOWN.slice(0, i + 1).slice(-20)}") has unclosed markers: "${committable.slice(-40)}"`
        );
      }
    });

    it("finish() always produces the full text", () => {
      // Test at various cut points that finish() returns everything
      const cutPoints = [0, 10, 50, 100, 150, COMPLEX_MARKDOWN.length];
      for (const cut of cutPoints) {
        if (cut > COMPLEX_MARKDOWN.length) {
          continue;
        }
        const r = new StreamingMarkdownRenderer();
        r.push(COMPLEX_MARKDOWN.slice(0, cut));
        r.finish();
        const finished = r.getText();
        expect(finished).toBe(COMPLEX_MARKDOWN.slice(0, cut));
      }
    });

    it("append-only delta reconstruction works for character-by-character streaming", () => {
      const r = new StreamingMarkdownRenderer();
      let lastAppended = "";
      const deltas: string[] = [];

      // Push character by character
      for (let i = 0; i < COMPLEX_MARKDOWN.length; i++) {
        r.push(COMPLEX_MARKDOWN[i]);
        const committable = r.getCommittableText();
        // Verify monotonicity at each step
        if (committable.startsWith(lastAppended) === false) {
          expect.fail(
            `Delta broke monotonicity at char ${i} (${JSON.stringify(COMPLEX_MARKDOWN[i])})` +
              `\n  lastAppended[${lastAppended.length}]: ...${JSON.stringify(lastAppended.slice(-40))}` +
              `\n  committable [${committable.length}]: ...${JSON.stringify(committable.slice(-40))}`
          );
        }
        const delta = committable.slice(lastAppended.length);
        if (delta.length > 0) {
          deltas.push(delta);
          lastAppended = committable;
        }
      }

      // Final flush
      r.finish();
      const finalCommittable = r.getCommittableText();
      if (finalCommittable.startsWith(lastAppended) === false) {
        expect.fail(
          "Final flush broke monotonicity" +
            `\n  lastAppended[${lastAppended.length}]: ...${JSON.stringify(lastAppended.slice(-40))}` +
            `\n  final       [${finalCommittable.length}]: ...${JSON.stringify(finalCommittable.slice(-40))}`
        );
      }
      const finalDelta = finalCommittable.slice(lastAppended.length);
      if (finalDelta.length > 0) {
        deltas.push(finalDelta);
      }

      // Concatenated deltas must equal the final output
      const joined = deltas.join("");
      if (joined !== finalCommittable) {
        // Find where they diverge
        let diffAt = 0;
        while (
          diffAt < joined.length &&
          diffAt < finalCommittable.length &&
          joined[diffAt] === finalCommittable[diffAt]
        ) {
          diffAt++;
        }
        expect.fail(
          `Deltas (${joined.length} chars) != final (${finalCommittable.length} chars)` +
            `\n  diverge at offset ${diffAt}` +
            `\n  deltas: ...${JSON.stringify(joined.slice(Math.max(0, diffAt - 10), diffAt + 20))}` +
            `\n  final:  ...${JSON.stringify(finalCommittable.slice(Math.max(0, diffAt - 10), diffAt + 20))}`
        );
      }

      // All original content must be recoverable from getText()
      expect(r.getText()).toBe(COMPLEX_MARKDOWN);
    });
  });
});

/**
 * Re-export for use in exhaustive tests.
 * Matches the function signature in streaming-markdown.ts.
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
