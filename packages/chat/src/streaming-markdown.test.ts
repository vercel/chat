import { describe, expect, it } from "vitest";
import { StreamingMarkdownRenderer } from "./streaming-markdown";

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

  it("getCommittableText should hold back unclosed bold", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor");
    const committable = r.getCommittableText();
    expect(committable).toBe("Hello ");
    expect(committable).not.toContain("**");
  });

  it("getCommittableText should release when bold closes", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **wor");
    expect(r.getCommittableText()).toBe("Hello ");

    r.push("ld**");
    expect(r.getCommittableText()).toBe("Hello **world**");
  });

  it("getCommittableText should hold back unclosed italic", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello *ita");
    expect(r.getCommittableText()).toBe("Hello ");
  });

  it("getCommittableText should hold back unclosed strikethrough", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello ~~str");
    expect(r.getCommittableText()).toBe("Hello ");
  });

  it("getCommittableText should hold back unclosed inline code", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello `cod");
    expect(r.getCommittableText()).toBe("Hello ");
  });

  it("getCommittableText should hold back unclosed link", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("See [link text");
    expect(r.getCommittableText()).toBe("See ");
  });

  it("getCommittableText should release when link closes", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("See [link text");
    expect(r.getCommittableText()).toBe("See ");

    r.push("](https://example.com)");
    expect(r.getCommittableText()).toBe("See [link text](https://example.com)");
  });

  it("getCommittableText should return clean text when all markers balanced", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Hello **world** and *italic* done");
    expect(r.getCommittableText()).toBe("Hello **world** and *italic* done");
  });

  it("getCommittableText should hold back table rows", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n");
    const committable = r.getCommittableText();
    expect(committable).not.toContain("| A | B |");
    expect(committable).toContain("Text");
  });

  it("getCommittableText should release on separator", () => {
    const r = new StreamingMarkdownRenderer();
    r.push("Text\n\n| A | B |\n|---|---|\n");
    const committable = r.getCommittableText();
    expect(committable).toContain("| A | B |");
    expect(committable).toContain("|---|---|");
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
    r.push("Hello **wor");
    expect(r.getCommittableText()).toBe("Hello ");
    r.finish();
    expect(r.getCommittableText()).toBe("Hello **wor");
  });

  it("getCommittableText delta should work for tables in append-only streaming", () => {
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";

    // Push intro
    r.push("Hello\n\n");
    let committable = r.getCommittableText();
    let delta = committable.slice(lastAppended.length);
    expect(delta).toBe("Hello\n\n");
    lastAppended = committable;

    // Push table header — held back, no new delta
    r.push("| A | B |\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toBe("");

    // Push separator — confirms table, delta includes header + separator
    r.push("|---|---|\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toContain("| A | B |");
    expect(delta).toContain("|---|---|");
    lastAppended = committable;

    // Push data row — visible immediately
    r.push("| 1 | 2 |\n");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toContain("| 1 | 2 |");
  });

  it("getCommittableText delta should work for inline markers in append-only streaming", () => {
    const r = new StreamingMarkdownRenderer();
    let lastAppended = "";

    // Push clean text
    r.push("Hello ");
    let committable = r.getCommittableText();
    let delta = committable.slice(lastAppended.length);
    expect(delta).toBe("Hello ");
    lastAppended = committable;

    // Push unclosed bold — held back, no delta
    r.push("**wor");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toBe("");

    // Close bold — delta includes full bold span
    r.push("ld**");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toBe("**world**");
    lastAppended = committable;

    // More clean text
    r.push(" done");
    committable = r.getCommittableText();
    delta = committable.slice(lastAppended.length);
    expect(delta).toBe(" done");
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
});
