import {
  convertEmojiPlaceholders,
  type Nodes,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  toPlainText,
} from "chat";
import { afterAll, describe, expect, it } from "vitest";
import { TelegramFormatConverter } from "./markdown";
import { splitMarkdownAst, splitText } from "./split";

const converter = new TelegramFormatConverter();
const TABLE_HEADER_LINE = /^Name\s+\|\s+Value$/;
const NOTE_THEN_BOLD = /^Note:\n\n\*word0 /;
const LEADING_QUOTE = /^>/m;

function textOf(node: Nodes): string {
  if ("value" in node) {
    return node.value;
  }
  return "children" in node ? node.children.map(textOf).join("") : "";
}

function fitsRendered(limit: number): (root: Root) => boolean {
  return (root) => converter.fromAst(root).length <= limit;
}

function fitsRich(limit: number): (root: Root) => boolean {
  return (root) => Array.from(stringifyMarkdown(root)).length <= limit;
}

/** Each part's blocks as text, separated by ` | `. */
function blockTexts(parts: Root[]): string[] {
  return parts.map((part) => part.children.map(textOf).join(" | "));
}

function rootOf(...children: Nodes[]): Root {
  return { type: "root", children } as Root;
}

function typesOf(part: Root): string[] {
  return part.children.map((child) => child.type);
}

function tableRows(parts: Root[]): string[][][] {
  return parts.map((part) =>
    part.children.flatMap((child) =>
      child.type === "table"
        ? child.children.map((row) => row.children.map((cell) => textOf(cell)))
        : []
    )
  );
}

const words = (count: number, prefix = "word") =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("splitText", () => {
  it("returns one part when the text fits", () => {
    expect(splitText("short", (value) => value.length <= 10)).toEqual([
      "short",
    ]);
  });

  it("breaks at paragraph, then line, then word boundaries", () => {
    const fits = (value: string) => value.length <= 12;

    expect(splitText("aaaa bbbb\n\ncccc", fits)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitText("aaaa bbbb\ncccc", fits)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitText("aaaa bbbb cccc", fits)).toEqual(["aaaa bbbb", "cccc"]);
  });

  it("hard-breaks text without a usable boundary", () => {
    expect(splitText("a".repeat(25), (value) => value.length <= 10)).toEqual([
      "a".repeat(10),
      "a".repeat(10),
      "a".repeat(5),
    ]);
  });

  it("does not break at a separator that would leave a short part", () => {
    // The newline sits below half of the 10 characters that fit.
    expect(
      splitText(`a\n${"b".repeat(18)}`, (value) => value.length <= 10)
    ).toEqual([`a\n${"b".repeat(8)}`, "b".repeat(10)]);
  });

  it("does not split a surrogate pair", () => {
    const parts = splitText("aa😀😀", (value) => value.length <= 3);
    expect(parts).toEqual(["aa", "😀", "😀"]);
  });

  it("does not hard-break inside an emoji placeholder", () => {
    const value = "aaaaaaaa{{emoji:thumbs_up}}bbbb";
    const fits = (text: string) =>
      convertEmojiPlaceholders(text, "gchat").length <= 10;

    // The placeholder starts at index 8, so the longest fitting prefix
    // without a placeholder ("aaaaaaaa{{") ends inside it.
    expect(fits(value)).toBe(false);
    expect(fits(value.slice(0, 10))).toBe(true);
    expect(fits(value.slice(0, 11))).toBe(false);
    expect(value.indexOf("{{emoji:")).toBe(8);

    const parts = splitText(value, fits);

    expect(parts).toEqual(["aaaaaaaa", "{{emoji:thumbs_up}}bbbb"]);
    for (const part of parts) {
      expect(fits(part)).toBe(true);
    }
  });
});

describe("splitMarkdownAst", () => {
  it("returns the root unchanged when it fits", () => {
    const root = parseMarkdown("hello");
    const parts = splitMarkdownAst(root, fitsRendered(100));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(root);
  });

  it("keeps definitions in place when the root fits", () => {
    const root = parseMarkdown(
      "> [quote]: https://example.com/quote\n\nRead [the docs][docs].\n\n[docs]: https://example.com/docs\n\n[unused]: https://example.com/unused"
    );
    const parts = splitMarkdownAst(root, fitsRich(1000));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(root);
  });

  it("sends a value whole when not one character fits inside its markup", () => {
    const url = `https://example.com/${"x".repeat(200)}`;
    const root = parseMarkdown(`[click here](${url})`);
    const fits = fitsRendered(100);
    expect(fits(parseMarkdown(`[c](${url})`))).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts).toHaveLength(1);
    expect(stringifyMarkdown(parts[0] as Root)).toBe(`[click here](${url})\n`);
  });

  it("packs top-level blocks into full parts without losing content", () => {
    const markdown = Array.from(
      { length: 40 },
      (_, index) => `## Section ${index + 1}\n\n- value_${index}.`
    ).join("\n\n");
    const fits = fitsRendered(200);
    const root = parseMarkdown(markdown);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(fits(part)).toBe(true);
    }
    // Each part is full: the next block would not have fit in it.
    for (const [index, part] of parts.slice(0, -1).entries()) {
      const next = parts[index + 1]?.children[0] as Nodes;
      expect(fits(rootOf(...part.children, next))).toBe(false);
    }
    expect(
      parts.map((part) => stringifyMarkdown(part).trim()).join("\n\n")
    ).toBe(stringifyMarkdown(root).trim());
  });

  it("reopens formatting when a long bold run is split", () => {
    const runWords = words(60);
    const root = parseMarkdown(`**${runWords.join(" ")}**`);
    const fits = fitsRendered(100);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.length).toBeGreaterThan(1);
    const rendered = parts.map((part) => converter.fromAst(part));
    for (const text of rendered) {
      expect(text.length).toBeLessThanOrEqual(100);
      expect(text.startsWith("*")).toBe(true);
      expect(text.endsWith("*")).toBe(true);
    }
    expect(rendered.map((text) => text.slice(1, -1)).join(" ")).toBe(
      runWords.join(" ")
    );
  });

  it("splits a long code block into complete code blocks at line breaks", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index}`);
    const root = parseMarkdown(`\`\`\`ts\n${lines.join("\n")}\n\`\`\``);
    const fits = fitsRendered(120);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.length).toBeGreaterThan(1);
    const values: string[] = [];
    for (const part of parts) {
      expect(typesOf(part)).toEqual(["code"]);
      const [code] = part.children;
      if (code?.type === "code") {
        expect(code.lang).toBe("ts");
        values.push(code.value);
      }
      expect(fits(part)).toBe(true);
    }
    expect(values.join("\n")).toBe(lines.join("\n"));
  });

  it("breaks code at newlines even when a line is longer than half a part", () => {
    // 8 characters of fence overhead leave 32 for the value. The only newline
    // within reach sits below half of that, where text would break at a space.
    const value = "short\nalpha beta gamma delta epsilon\nzeta eta";
    const root = rootOf({ type: "code", lang: null, value } as Nodes);
    const fits = fitsRendered(40);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.map((part) => textOf(part))).toEqual([
      "short",
      "alpha beta gamma delta epsilon",
      "zeta eta",
    ]);
    for (const part of parts) {
      expect(typesOf(part)).toEqual(["code"]);
      expect(fits(part)).toBe(true);
    }
  });

  it("hard-breaks a code line longer than a part instead of breaking at spaces", () => {
    const value = "one two three four five six seven eight";
    const root = rootOf({ type: "code", lang: null, value } as Nodes);
    const fits = fitsRendered(40);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.map((part) => textOf(part))).toEqual([
      "one two three four five six seve",
      "n eight",
    ]);
  });

  it("continues ordered list numbering across parts", () => {
    const markdown = Array.from(
      { length: 30 },
      (_, index) => `${index + 1}. item number ${index + 1}`
    ).join("\n");
    const fits = fitsRendered(150);
    const root = parseMarkdown(markdown);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.length).toBeGreaterThan(1);
    const lines = parts.flatMap((part) => converter.fromAst(part).split("\n"));
    expect(lines).toEqual(
      Array.from(
        { length: 30 },
        (_, index) => `${index + 1}\\. item number ${index + 1}`
      )
    );
  });

  describe("an oversized block after shorter blocks", () => {
    it("shares a part with a short paragraph before a long bold run", () => {
      const runWords = words(30);
      const bold = parseMarkdown(`**${runWords.join(" ")}**`);
      const root = parseMarkdown(`Note:\n\n**${runWords.join(" ")}**`);
      const fits = fitsRendered(100);
      expect(fits(bold)).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts.length).toBeGreaterThan(1);
      const [first, ...rest] = parts;
      expect(first && typesOf(first)).toEqual(["paragraph", "paragraph"]);
      expect(textOf(first?.children[0] as Nodes)).toBe("Note:");
      // The bold run starts in the first part instead of a part of its own.
      expect(converter.fromAst(first as Root)).toMatch(NOTE_THEN_BOLD);
      for (const part of rest) {
        expect(typesOf(part)).toEqual(["paragraph"]);
      }
      for (const part of parts) {
        expect(fits(part)).toBe(true);
      }
      const runs = parts.map((part) => textOf(part.children.at(-1) as Nodes));
      expect(runs.join(" ")).toBe(runWords.join(" "));
    });

    it("shares a part with a heading before a long code block", () => {
      const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`);
      const root = parseMarkdown(
        `## Title\n\n\`\`\`\n${lines.join("\n")}\n\`\`\``
      );
      const fits = fitsRendered(80);
      expect(fits(rootOf(root.children[1] as Nodes))).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts.length).toBeGreaterThan(2);
      expect(typesOf(parts[0] as Root)).toEqual(["heading", "code"]);
      for (const part of parts.slice(1)) {
        expect(typesOf(part)).toEqual(["code"]);
      }
      for (const part of parts) {
        expect(fits(part)).toBe(true);
      }
      const values = parts.map((part) => textOf(part.children.at(-1) as Nodes));
      expect(values.join("\n")).toBe(lines.join("\n"));
    });

    it("carries the shared first part down to nested blocks", () => {
      const quoteWords = words(30);
      const root = parseMarkdown(`# Title\n\n> ${quoteWords.join(" ")}`);
      const fits = fitsRendered(100);
      expect(fits(rootOf(root.children[1] as Nodes))).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts.length).toBeGreaterThan(2);
      expect(typesOf(parts[0] as Root)).toEqual(["heading", "blockquote"]);
      for (const part of parts.slice(1)) {
        expect(typesOf(part)).toEqual(["blockquote"]);
      }
      for (const part of parts) {
        expect(fits(part)).toBe(true);
      }
      const quoted = parts.map((part) => textOf(part.children.at(-1) as Nodes));
      expect(quoted.join(" ")).toBe(quoteWords.join(" "));
    });

    it("keeps ordered list numbering when an item shares a part", () => {
      const itemWords = words(20);
      const root = parseMarkdown(
        `1. one\n2. two\n3. ${itemWords.join(" ")}\n4. four`
      );
      const fits = fitsRendered(80);
      const list = root.children[0];
      expect(list?.type).toBe("list");
      if (list?.type !== "list") {
        return;
      }
      expect(
        fits(
          rootOf({ ...list, start: 3, children: [list.children[2]] } as Nodes)
        )
      ).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      // The third item starts beside the first two, and its continuation
      // keeps the number 3 (markdown can't continue an item without one).
      expect(parts.map((part) => converter.fromAst(part))).toEqual([
        `1\\. one\n2\\. two\n3\\. ${itemWords.slice(0, 10).join(" ")}`,
        `3\\. ${itemWords.slice(10).join(" ")}`,
        "4\\. four",
      ]);
      expect(
        parts.map((part) =>
          part.children[0]?.type === "list" ? part.children[0].start : null
        )
      ).toEqual([1, 3, 4]);
      for (const part of parts) {
        expect(fits(part)).toBe(true);
      }
    });

    it("repeats the table header when a table shares a part", () => {
      const rows = Array.from(
        { length: 12 },
        (_, index) => `| r${index} | v${index} |`
      );
      const root = parseMarkdown(
        `Intro.\n\n| Name | Value |\n|---|---|\n${rows.join("\n")}`
      );
      const fits = fitsRendered(120);
      expect(fits(rootOf(root.children[1] as Nodes))).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts.length).toBeGreaterThan(1);
      expect(typesOf(parts[0] as Root)).toEqual(["paragraph", "table"]);
      const seen: string[] = [];
      for (const [index, table] of tableRows(parts).entries()) {
        expect(fits(parts[index] as Root)).toBe(true);
        expect(table[0]).toEqual(["Name", "Value"]);
        seen.push(...table.slice(1).map((row) => row.join("|")));
      }
      expect(seen).toEqual(
        Array.from({ length: 12 }, (_, index) => `r${index}|v${index}`)
      );
    });

    it("does not leave a table header alone beside the batch", () => {
      const intro = "i".repeat(80);
      const rows = Array.from(
        { length: 12 },
        (_, index) => `| r${index} | v${index} |`
      );
      const root = parseMarkdown(
        `${intro}\n\n| Name | Value |\n|---|---|\n${rows.join("\n")}`
      );
      const [paragraph, table] = root.children as [Nodes, Nodes];
      const fits = fitsRendered(120);
      expect(table.type).toBe("table");
      if (table.type !== "table") {
        return;
      }
      // Only the header row fits beside the paragraph.
      expect(fits(rootOf(table))).toBe(false);
      const withRows = (count: number) =>
        rootOf(paragraph, {
          ...table,
          children: table.children.slice(0, count),
        } as Nodes);
      expect(fits(withRows(1))).toBe(true);
      expect(fits(withRows(2))).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts[0]?.children).toEqual([paragraph]);
      const seen: string[] = [];
      for (const [index, cells] of tableRows(parts.slice(1)).entries()) {
        expect(fits(parts[index + 1] as Root)).toBe(true);
        expect(cells[0]).toEqual(["Name", "Value"]);
        expect(cells.length).toBeGreaterThan(1);
        seen.push(...cells.slice(1).map((row) => row.join("|")));
      }
      expect(seen).toEqual(
        Array.from({ length: 12 }, (_, index) => `r${index}|v${index}`)
      );
    });

    it("sends the batch alone when an atomic node cannot share its part", () => {
      const url = `https://example.com/${"x".repeat(200)}`;
      const root = parseMarkdown(`Short intro.\n\n![alt](${url})`);

      const parts = splitMarkdownAst(root, fitsRendered(100));

      expect(parts.map((part) => part.children)).toEqual([
        [root.children[0]],
        [root.children[1]],
      ]);
    });

    it("sends the batch alone when no code fits beside it", () => {
      const intro = "i".repeat(34);
      const lines = Array.from({ length: 10 }, (_, index) => `line ${index}`);
      const root = parseMarkdown(
        `${intro}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\``
      );
      const fits = fitsRendered(40);
      // The paragraph, the blank line, and an empty fence already exceed 40.
      expect(
        fits(
          rootOf(
            root.children[0] as Nodes,
            { ...(root.children[1] as Nodes), value: "l" } as Nodes
          )
        )
      ).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts.length).toBeGreaterThan(2);
      expect(parts[0]?.children).toEqual([root.children[0]]);
      for (const part of parts.slice(1)) {
        expect(typesOf(part)).toEqual(["code"]);
        expect(fits(part)).toBe(true);
      }
      const values = parts.slice(1).map((part) => textOf(part));
      expect(values.join("\n")).toBe(lines.join("\n"));
    });

    it("does not split a block that fits in a part of its own", () => {
      const intro = "i".repeat(60);
      const first = "a".repeat(60);
      const second = "b".repeat(60);
      const root = parseMarkdown(`${intro}\n\n- ${first}\n- ${second}`);

      const parts = splitMarkdownAst(root, fitsRendered(100));

      expect(parts.map((part) => converter.fromAst(part))).toEqual([
        intro,
        `\\- ${first}`,
        `\\- ${second}`,
      ]);
    });
  });

  describe("reference definitions", () => {
    const filler = (letter: string, size = 30) =>
      `${letter.repeat(size)} ${letter.repeat(size)}`;

    it("carries each definition into every part that references it", () => {
      const markdown = [
        "Read [the docs][docs] first.",
        filler("b", 40),
        "> Quoted.\n>\n> [quote]: https://example.com/quote",
        "Again [the docs][docs] and [a quote][quote].",
        "[docs]: https://example.com/docs",
        "[unused]: https://example.com/unused",
      ].join("\n\n");
      const root = parseMarkdown(markdown);
      const fits = fitsRich(130);
      expect(fits(root)).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      const rendered = parts.map((part) => stringifyMarkdown(part));
      expect(rendered).toEqual([
        "Read [the docs][docs] first.\n\n[docs]: https://example.com/docs\n",
        `${filler("b", 40)}\n\n> Quoted.\n`,
        "Again [the docs][docs] and [a quote][quote].\n\n[quote]: https://example.com/quote\n\n[docs]: https://example.com/docs\n",
      ]);
      for (const part of parts) {
        expect(fits(part)).toBe(true);
      }
    });

    it("carries footnote definitions and the definitions they reference", () => {
      const markdown = [
        "A claim[^1] here.",
        filler("b"),
        "[^1]: From [the docs][docs].",
        "[docs]: https://example.com/docs",
      ].join("\n\n");
      const root = parseMarkdown(markdown);
      const fits = fitsRich(100);
      expect(fits(root)).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      expect(parts.map((part) => typesOf(part))).toEqual([
        ["paragraph", "footnoteDefinition", "definition"],
        ["paragraph"],
      ]);
      expect(stringifyMarkdown(parts[0] as Root)).toBe(
        "A claim[^1] here.\n\n[^1]: From [the docs][docs].\n\n[docs]: https://example.com/docs\n"
      );
      expect(stringifyMarkdown(parts[1] as Root)).toBe(`${filler("b")}\n`);
    });

    it("carries the first definition of a repeated identifier", () => {
      const markdown = [
        "Read [the docs][docs] first.",
        filler("b"),
        "[docs]: https://example.com/first",
        "[docs]: https://example.com/second",
      ].join("\n\n");

      const parts = splitMarkdownAst(parseMarkdown(markdown), fitsRich(70));

      expect(parts.map((part) => stringifyMarkdown(part))).toEqual([
        "Read [the docs][docs] first.\n\n[docs]: https://example.com/first\n",
        `${filler("b")}\n`,
      ]);
    });

    it("adds no visible MarkdownV2 output for carried definitions", () => {
      const markdown = [
        "Read [the docs][docs] first.",
        filler("b"),
        "[docs]: https://example.com/docs",
      ].join("\n\n");

      const parts = splitMarkdownAst(parseMarkdown(markdown), fitsRendered(70));

      expect(parts.map((part) => typesOf(part))).toEqual([
        ["paragraph", "definition"],
        ["paragraph"],
      ]);
      expect(converter.fromAst(parts[0] as Root)).toBe(
        "Read the docs first\\."
      );
    });
  });

  describe("tables", () => {
    const bodyRows = Array.from(
      { length: 30 },
      (_, index) => `| r${index} | v${index} |`
    );
    const tableMarkdown = `| Name | Value |\n|---|---|\n${bodyRows.join("\n")}`;

    it("repeats the header row in every part", () => {
      const parts = splitMarkdownAst(
        parseMarkdown(tableMarkdown),
        fitsRendered(200)
      );

      expect(parts.length).toBeGreaterThan(1);
      const seenRows: string[] = [];
      for (const part of parts) {
        expect(converter.fromAst(part).length).toBeLessThanOrEqual(200);
        expect(typesOf(part)).toEqual(["table"]);
      }
      for (const cells of tableRows(parts)) {
        expect(cells[0]).toEqual(["Name", "Value"]);
        for (const row of cells.slice(1)) {
          seenRows.push(row.join("|"));
        }
      }
      // Every body row is sent exactly once, in order.
      expect(seenRows).toEqual(
        Array.from({ length: 30 }, (_, index) => `r${index}|v${index}`)
      );
    });

    it("renders the header first in every MarkdownV2 part", () => {
      const parts = splitMarkdownAst(
        parseMarkdown(tableMarkdown),
        fitsRendered(200)
      );

      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        const lines = converter.fromAst(part).split("\n");
        expect(lines[0]).toBe("```");
        expect(lines[1]?.trim()).toMatch(TABLE_HEADER_LINE);
      }
    });

    it("does not repeat a header that cannot fit next to a body row", () => {
      const wideHeader = "h".repeat(50);
      const wideCell = "b".repeat(40);
      const headerRow = `| ${wideHeader} | x |\n|---|---|`;
      const markdown = `${headerRow}\n| a | ${wideCell} |\n| c | ${wideCell} |`;
      const fits = fitsRendered(200);
      // The header fits on its own but not with a body row, so repeating it
      // would force every row apart.
      expect(fits(parseMarkdown(headerRow))).toBe(true);
      expect(fits(parseMarkdown(`${headerRow}\n| a | ${wideCell} |`))).toBe(
        false
      );

      const parts = splitMarkdownAst(parseMarkdown(markdown), fits);

      const rendered = parts.map((part) => converter.fromAst(part));
      for (const text of rendered) {
        expect(text.length).toBeLessThanOrEqual(200);
      }
      expect(rendered.filter((text) => text.includes(wideHeader))).toHaveLength(
        1
      );
      // Rows stay whole: no cell is cut across parts.
      expect(tableRows(parts).flat()).toEqual([
        [wideHeader, "x"],
        ["a", wideCell],
        ["c", wideCell],
      ]);
    });

    it("keeps every cell of a split row in its column", () => {
      const cellWords = words(12, "w");
      const markdown = `| A | B | C |\n|---|---|---|\n| p | q | r |\n| x | ${cellWords.join(" ")} | z |`;
      const root = parseMarkdown(markdown);
      const fits = fitsRich(70);
      expect(
        fits(
          parseMarkdown(
            `| A | B | C |\n|---|---|---|\n| x | ${cellWords.join(" ")} | z |`
          )
        )
      ).toBe(false);

      const parts = splitMarkdownAst(root, fits);

      const tables = tableRows(parts);
      expect(tables.length).toBeGreaterThan(1);
      for (const [index, table] of tables.entries()) {
        expect(fits(parts[index] as Root)).toBe(true);
        expect(table[0]).toEqual(["A", "B", "C"]);
        for (const row of table) {
          expect(row).toHaveLength(3);
        }
      }
      const split = tables.flatMap((table) => table.slice(1)).slice(1);
      expect(tables[0]?.[1]).toEqual(["p", "q", "r"]);
      expect(split.map((row) => row[0])).toEqual([
        "x",
        ...split.slice(1).map(() => ""),
      ]);
      expect(split.map((row) => row[2])).toEqual([
        ...split.slice(1).map(() => ""),
        "z",
      ]);
      expect(split.map((row) => row[1]).join(" ")).toBe(cellWords.join(" "));
    });
  });

  it("trims the spaces left where a paragraph splits between inline nodes", () => {
    const words = Array.from({ length: 20 }, (_, index) => `word${index}`);
    const bold = Array.from({ length: 20 }, (_, index) => `bold${index}`);
    const root = parseMarkdown(
      `${words.join(" ")} **${bold.join(" ")}** ${words.join(" ")}`
    );
    const fits = fitsRich(150);
    expect(fits(root)).toBe(false);
    // The input really has spaces at the inline boundaries.
    const [paragraph] = root.children;
    expect(
      paragraph && "children" in paragraph
        ? paragraph.children.map((child) => child.type)
        : []
    ).toEqual(["text", "strong", "text"]);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.length).toBeGreaterThan(1);
    // At least one part boundary falls beside the bold run rather than
    // inside a text value, where the break would drop the space anyway.
    const edgeTypes = parts.flatMap((part) => {
      const inline = childrenOf(part.children[0] as Nodes);
      return [inline[0]?.type, inline.at(-1)?.type];
    });
    expect(edgeTypes).toContain("strong");
    for (const part of parts) {
      const markdown = stringifyMarkdown(part);
      expect(markdown).not.toContain("&#x20;");
      expect(fits(part)).toBe(true);
      expect(textOf(part)).toBe(textOf(part).trim());
    }
    // Only the whitespace at part boundaries is dropped.
    expect(parts.map(textOf).join(" ")).toBe(textOf(root));
  });
});

// Generated markdown and independent checks for the property tests below.

interface StreamEntry {
  key: string;
  /** The table node the entry sits in, if any. */
  table: Nodes | undefined;
}

// remark-stringify writes this when an empty text node precedes emphasis
// that starts with punctuation.
const BROKEN_REFERENCE = "&#xNAN;";
const PLACEHOLDER = /\{\{emoji:[a-z0-9_]+\}\}/gi;
const WHITESPACE = /\s/;
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;
const ANY_HIGH_SURROGATE = /[\uD800-\uDBFF]/;
const LOW_SURROGATE = /^[\uDC00-\uDFFF]/;
const PROPERTY_WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "theta",
  "kappa",
  "lambda",
  "sigma",
];
const EMOJI_NAMES = ["thumbs_up", "fire", "rocket", "heart", "wave", "party"];
const ASTRAL = ["😀", "🚀", "🎉", "👍🏽"];

/**
 * Park-Miller "minimal standard" generator. Every product stays below 2^53,
 * so it is exact without bitwise operators.
 */
function seededRandom(seed: number): () => number {
  let state = (seed % 2_147_483_646) + 1;
  const next = () => {
    state = (state * 48_271) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
  // Small seeds start with small states, so skip the first few values.
  for (let index = 0; index < 8; index++) {
    next();
  }
  return next;
}

class MarkdownGenerator {
  private readonly random: () => number;
  private tables = 0;
  readonly refs = new Set<number>();
  readonly footnotes = new Set<number>();

  constructor(seed: number) {
    this.random = seededRandom(seed);
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.random() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }

  longWord(): string {
    let word = "";
    const length = this.int(20, 80);
    while (word.length < length) {
      word += this.chance(0.05)
        ? this.pick(ASTRAL)
        : "qwertyuiop"[this.int(0, 9)];
    }
    return word;
  }

  word(short = false): string {
    const roll = short ? 1 : this.random();
    if (roll < 0.06) {
      return `{{emoji:${this.pick(EMOJI_NAMES)}}}`;
    }
    if (roll < 0.11) {
      return this.pick(ASTRAL);
    }
    if (roll < 0.13) {
      return this.longWord();
    }
    return `${this.pick(PROPERTY_WORDS)}${this.int(0, 99)}`;
  }

  words(count: number, lineBreaks = false, short = false): string {
    const out: string[] = [];
    for (let index = 0; index < count; index++) {
      out.push(this.word(short));
    }
    let joined = "";
    for (const [index, word] of out.entries()) {
      if (index > 0) {
        joined += lineBreaks && this.chance(0.05) ? "\n" : " ";
      }
      joined += word;
    }
    return joined;
  }

  inline(count: number, lineBreaks = true): string {
    const tokens: string[] = [];
    while (tokens.length < count) {
      const roll = this.random();
      if (roll < 0.06) {
        tokens.push(
          `**${this.words(this.chance(0.3) ? this.int(10, 30) : this.int(2, 6))}**`
        );
      } else if (roll < 0.1) {
        tokens.push(`*${this.words(this.int(1, 5))}*`);
      } else if (roll < 0.13) {
        tokens.push(`\`${this.pick(PROPERTY_WORDS)} ${this.int(0, 9)}\``);
      } else if (roll < 0.16) {
        tokens.push(
          `[${this.words(this.int(1, 3))}](https://example.com/l${this.int(0, 99)})`
        );
      } else if (roll < 0.2) {
        const ref = this.int(0, 4);
        this.refs.add(ref);
        tokens.push(`[${this.words(this.int(1, 3))}][ref${ref}]`);
      } else if (roll < 0.21) {
        const ref = this.int(0, 4);
        this.refs.add(ref);
        tokens.push(`![${this.pick(PROPERTY_WORDS)}][ref${ref}]`);
      } else if (roll < 0.23) {
        const footnote = this.int(0, 2);
        this.footnotes.add(footnote);
        tokens.push(`[^fn${footnote}]`);
      } else {
        tokens.push(this.word());
      }
    }
    let joined = "";
    for (const [index, token] of tokens.entries()) {
      if (index > 0) {
        joined += lineBreaks && this.chance(0.04) ? "\n" : " ";
      }
      joined += token;
    }
    return joined;
  }

  codeBlock(): string {
    const lines: string[] = [];
    const count = this.int(3, 12);
    for (let index = 0; index < count; index++) {
      const roll = this.random();
      if (roll < 0.12) {
        lines.push("");
      } else if (roll < 0.22) {
        lines.push(this.words(this.int(8, 25)));
      } else if (roll < 0.27) {
        lines.push(this.longWord());
      } else if (roll < 0.32) {
        lines.push(`    ${this.words(this.int(1, 6))}`);
      } else {
        lines.push(this.words(this.int(1, 8)));
      }
    }
    return `\`\`\`${this.pick(["", "ts", "py"])}\n${lines.join("\n")}\n\`\`\``;
  }

  list(depth: number): string {
    const ordered = this.chance(0.5);
    let number = ordered ? this.int(1, 5) : 0;
    const items: string[] = [];
    const count = this.int(2, 6);
    for (let index = 0; index < count; index++) {
      const marker = ordered ? `${number}.` : "-";
      number += 1;
      const indent = " ".repeat(marker.length + 1);
      let item = `${marker} ${this.inline(this.chance(0.15) ? this.int(15, 35) : this.int(2, 12), false)}`;
      if (depth < 2 && this.chance(0.25)) {
        item += `\n${this.list(depth + 1).replaceAll(/^/gm, indent)}`;
      } else if (depth === 0 && this.chance(0.08)) {
        item += `\n\n${this.codeBlock().replaceAll(/^/gm, indent)}`;
      }
      items.push(item);
    }
    return items.join("\n");
  }

  blockquote(): string {
    const lines = this.chance(0.3)
      ? this.list(1).split("\n")
      : [this.inline(this.int(5, 35), false)];
    if (this.chance(0.3)) {
      const ref = this.int(0, 4);
      this.refs.add(ref);
      lines.push("", `[ref${ref}]: https://example.com/quote${ref}`);
    }
    if (this.chance(0.15)) {
      lines.splice(0, 1);
    }
    return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
  }

  table(): string {
    const tag = this.tables++;
    const columns = this.int(2, 4);
    const header = Array.from(
      { length: columns },
      (_, index) => `H${tag}c${index}`
    );
    const rows: string[][] = [];
    const count = this.int(2, 5);
    const huge = this.chance(0.6) ? this.int(0, count - 1) : -1;
    for (let row = 0; row < count; row++) {
      rows.push(
        Array.from({ length: columns }, () =>
          // A reference in the first body row would change whether the
          // header repeats, which the checks size without definitions.
          row > 0 && this.chance(0.1)
            ? this.inline(1, false).replace("[^", "[")
            : this.words(this.int(1, 3))
        )
      );
    }
    if (huge >= 0) {
      (rows[huge] as string[])[this.int(0, columns - 1)] = this.words(
        this.int(12, 30)
      );
    }
    return [
      `| ${header.join(" | ")} |`,
      `|${"---|".repeat(columns)}`,
      ...rows.map((cells) => `| ${cells.join(" | ")} |`),
    ].join("\n");
  }

  block(): string {
    const roll = this.random();
    if (roll < 0.12) {
      return `${"#".repeat(this.int(1, 3))} ${this.inline(this.int(1, 8), false)}`;
    }
    if (roll < 0.42) {
      return this.inline(this.chance(0.2) ? this.int(20, 45) : this.int(5, 20));
    }
    if (roll < 0.56) {
      return this.codeBlock();
    }
    if (roll < 0.72) {
      return this.list(0);
    }
    if (roll < 0.82) {
      return this.blockquote();
    }
    if (roll < 0.95) {
      return this.table();
    }
    return "---";
  }

  document(): string {
    const blocks: string[] = [];
    const count = this.int(2, 5);
    for (let index = 0; index < count; index++) {
      blocks.push(this.block());
    }
    for (const ref of this.refs) {
      const definition = `[ref${ref}]: https://example.com/ref${ref}`;
      if (this.chance(0.2)) {
        blocks.push(`> ${definition}`);
      } else {
        blocks.splice(this.int(0, blocks.length), 0, definition);
      }
      if (this.chance(0.15)) {
        blocks.push(`[ref${ref}]: https://example.com/duplicate${ref}`);
      }
    }
    if (this.chance(0.3)) {
      blocks.push("[unused]: https://example.com/unused");
    }
    for (const footnote of this.footnotes) {
      const ref = this.int(0, 4);
      this.refs.add(ref);
      blocks.push(
        `[^fn${footnote}]: ${this.words(this.int(2, 8), false, true)} [see][ref${ref}]`
      );
    }
    return blocks.join("\n\n");
  }
}

function fitsRegularProduction(limit: number): (root: Root) => boolean {
  return (root) =>
    convertEmojiPlaceholders(converter.fromAst(root), "gchat").length <=
      limit &&
    convertEmojiPlaceholders(toPlainText(root), "gchat").length <= limit;
}

function fitsRichProduction(limit: number): (root: Root) => boolean {
  return (root) =>
    Array.from(convertEmojiPlaceholders(stringifyMarkdown(root), "gchat"))
      .length <= limit;
}

/** Whether `node` renders anything: a non-empty value or an atomic node. */
function hasContent(node: Nodes): boolean {
  if ("value" in node) {
    return node.value.length > 0;
  }
  if (!("children" in node)) {
    return true;
  }
  return childrenOf(node).some(hasContent);
}

function isDefinition(node: Nodes): boolean {
  return node.type === "definition" || node.type === "footnoteDefinition";
}

function childrenOf(node: Nodes): Nodes[] {
  return "children" in node ? (node.children as Nodes[]) : [];
}

function rowText(row: Nodes): string {
  return childrenOf(row)
    .map((cell) => textOf(cell))
    .join("|");
}

/**
 * The label a node adds to the path of every character below it. Two
 * renderings of the same content carry the same labels wherever a part
 * boundary falls.
 */
function labelOf(
  node: Nodes,
  parent: Nodes | undefined,
  index: number
): string {
  switch (node.type) {
    case "heading":
      return `h${node.depth}`;
    case "code":
      return `code(${node.lang ?? ""})`;
    case "link":
      return `link(${node.url})`;
    case "linkReference":
      return `linkRef(${node.identifier})`;
    case "list":
      return node.ordered ? "ol" : "ul";
    case "listItem":
      return parent?.type === "list" && parent.ordered
        ? `li#${(parent.start ?? 1) + index}`
        : "li";
    case "tableCell":
      return `cell#${index}`;
    default:
      return node.type;
  }
}

/**
 * Flatten `node` into one entry per non-whitespace character (or atomic node),
 * keyed by the labels of its ancestors. Definitions are left out, and so are
 * table header rows, which `isHeader` identifies.
 */
function contentStream(
  node: Nodes,
  isHeader: (row: Nodes, table: Nodes) => boolean
): StreamEntry[] {
  const out: StreamEntry[] = [];
  const visit = (
    current: Nodes,
    path: string,
    table: Nodes | undefined
  ): void => {
    if ("value" in current && typeof current.value === "string") {
      for (const char of current.value) {
        if (!WHITESPACE.test(char)) {
          out.push({ key: `${path}:${char}`, table });
        }
      }
      return;
    }
    const children = childrenOf(current);
    if (!("children" in current)) {
      const id = "identifier" in current ? current.identifier : "";
      const url = "url" in current ? current.url : "";
      out.push({ key: `${path}:<${current.type} ${id}${url}>`, table });
      return;
    }
    for (const [index, child] of children.entries()) {
      if (isDefinition(child)) {
        continue;
      }
      if (current.type === "table" && isHeader(child, current)) {
        continue;
      }
      const childTable = child.type === "table" ? child : table;
      visit(child, `${path}/${labelOf(child, current, index)}`, childTable);
    }
  };
  visit(node, "", undefined);
  return out;
}

function collect(node: Nodes, test: (node: Nodes) => boolean): Nodes[] {
  const found: Nodes[] = [];
  const visit = (current: Nodes): void => {
    if (test(current)) {
      found.push(current);
    }
    for (const child of childrenOf(current)) {
      visit(child);
    }
  };
  visit(node);
  return found;
}

/** Leaf values, skipping anything inside a definition. */
function leafValues(node: Nodes): string[] {
  if (isDefinition(node)) {
    return [];
  }
  if ("value" in node && typeof node.value === "string") {
    return [node.value];
  }
  return childrenOf(node).flatMap(leafValues);
}

function identifierOf(node: Nodes): string {
  return "identifier" in node ? String(node.identifier) : "";
}

/** Definitions a part needs: those its references use, transitively. */
function missingDefinitions(part: Root): string[] {
  const problems: string[] = [];
  const links = new Map<string, Nodes>();
  const footnotes = new Map<string, Nodes>();
  for (const definition of collect(part, isDefinition)) {
    const map = definition.type === "definition" ? links : footnotes;
    if (map.has(identifierOf(definition))) {
      problems.push(`duplicate ${definition.type} ${identifierOf(definition)}`);
    }
    map.set(identifierOf(definition), definition);
  }
  for (const reference of collect(
    part,
    (node) =>
      node.type === "linkReference" ||
      node.type === "imageReference" ||
      node.type === "footnoteReference"
  )) {
    const map = reference.type === "footnoteReference" ? footnotes : links;
    if (!map.has(identifierOf(reference))) {
      problems.push(
        `${reference.type} ${identifierOf(reference)} has no definition in its part`
      );
    }
  }
  return problems;
}

function firstDefinitions(root: Root): Map<string, Nodes> {
  const first = new Map<string, Nodes>();
  for (const definition of collect(root, isDefinition)) {
    const key = `${definition.type}:${identifierOf(definition)}`;
    if (!first.has(key)) {
      first.set(key, definition);
    }
  }
  return first;
}

/**
 * Walk the code blocks of the parts against the original code blocks in
 * order. A piece must continue its block exactly, after a dropped newline, and
 * may only end away from a newline when it holds a single line.
 */
function codeProblems(root: Root, parts: Root[]): string[] {
  const isCode = (node: Nodes) => node.type === "code";
  const blocks = collect(root, isCode).map((node) =>
    "value" in node ? node.value : ""
  );
  const pieces = parts.flatMap((part) =>
    collect(part, isCode).map((node) => ("value" in node ? node.value : ""))
  );
  const problems: string[] = [];
  let block = 0;
  let offset = 0;
  for (const piece of pieces) {
    const value = blocks[block];
    if (value === undefined || !value.startsWith(piece, offset)) {
      problems.push(
        `code piece ${JSON.stringify(piece.slice(0, 40))} does not continue block ${block} at ${offset}`
      );
      return problems;
    }
    const end = offset + piece.length;
    if (end === value.length) {
      block += 1;
      offset = 0;
    } else if (value[end] === "\n") {
      offset = end + 1;
    } else {
      if (piece.indexOf("\n", 1) !== -1) {
        problems.push(
          `code piece ending mid-line holds a newline: ${JSON.stringify(piece.slice(-40))}`
        );
      }
      offset = end;
    }
    if (offset === value.length && end !== value.length) {
      // The dropped newline was the last character of the block.
      block += 1;
      offset = 0;
    }
  }
  if (block !== blocks.length) {
    problems.push(
      `code blocks ${block}..${blocks.length - 1} are missing or incomplete`
    );
  }
  return problems;
}

function valueProblems(root: Root, parts: Root[]): string[] {
  const problems: string[] = [];
  const count = (values: string[]) =>
    values.reduce(
      (total, value) => total + (value.match(PLACEHOLDER)?.length ?? 0),
      0
    );
  const expected = count(leafValues(root));
  const actual = count(parts.flatMap(leafValues));
  if (actual !== expected) {
    problems.push(`${expected} emoji placeholders became ${actual}`);
  }
  for (const value of parts.flatMap(leafValues)) {
    const rest = value.replace(PLACEHOLDER, "");
    if (rest.includes("{{") || rest.includes("}}")) {
      problems.push(`cut emoji placeholder in ${JSON.stringify(value)}`);
    }
    if (HIGH_SURROGATE.test(value) || LOW_SURROGATE.test(value)) {
      problems.push(
        `split surrogate pair in ${JSON.stringify(value.slice(0, 20))}…${JSON.stringify(value.slice(-20))}`
      );
    }
  }
  return problems;
}

function tableProblems(
  root: Root,
  parts: Root[],
  partStream: StreamEntry[],
  rootStream: StreamEntry[],
  fits: (root: Root) => boolean
): string[] {
  const problems: string[] = [];
  const originals = collect(root, (node) => node.type === "table");
  const headerOf = new Map(
    originals.map((table) => [table, childrenOf(table)[0] as Nodes])
  );
  const sourceOf = new Map<Nodes, Nodes>();
  for (const [index, entry] of partStream.entries()) {
    const source = rootStream[index]?.table;
    if (!(entry.table && source)) {
      continue;
    }
    const known = sourceOf.get(entry.table);
    if (known && known !== source) {
      problems.push("a part table mixes rows from two tables");
    }
    sourceOf.set(entry.table, source);
  }
  // Whether each later part of a table starts with its header.
  const repeats = new Map<Nodes, boolean[]>();
  for (const table of parts.flatMap((part) =>
    collect(part, (node) => node.type === "table")
  )) {
    const rows = childrenOf(table);
    const source =
      sourceOf.get(table) ??
      originals.find(
        (original) =>
          rowText(headerOf.get(original) as Nodes) === rowText(rows[0] as Nodes)
      );
    if (!source) {
      problems.push("a part table has no source table");
      continue;
    }
    const header = headerOf.get(source) as Nodes;
    const columns = childrenOf(header).length;
    for (const row of rows) {
      if (childrenOf(row).length !== columns) {
        problems.push(
          `row ${JSON.stringify(rowText(row).slice(0, 40))} has ${childrenOf(row).length} cells, header has ${columns}`
        );
      }
    }
    const startsWithHeader = rowText(rows[0] as Nodes) === rowText(header);
    // A header that can't share a part with any whole body row goes out on
    // its own, so rows stay whole. Rows with references are skipped, since
    // the splitter measures them with their definitions appended.
    const sourceRows = childrenOf(source);
    const headerSharesAPart = sourceRows
      .slice(1)
      .filter(
        (row) =>
          collect(row, (node) => node.type.endsWith("Reference")).length === 0
      )
      .some((row) =>
        fits(rootOf({ ...source, children: [header, row] } as Nodes))
      );
    if (!sourceOf.has(table) && headerSharesAPart) {
      problems.push(
        `table ${rowText(header)} sent a part with only its header`
      );
    }
    const later = repeats.get(source);
    if (later) {
      later.push(startsWithHeader);
    } else {
      repeats.set(source, []);
      if (!startsWithHeader) {
        problems.push(`table ${rowText(header)}: first part lacks the header`);
      }
    }
  }
  for (const [source, later] of repeats) {
    const name = rowText(headerOf.get(source) as Nodes);
    const sourceRows = childrenOf(source);
    // A header that fits beside the first body row must be repeated. Past
    // that, it is repeated in every later part or in none.
    const mustRepeat =
      sourceRows.length > 1 &&
      fits(rootOf({ ...source, children: sourceRows.slice(0, 2) } as Nodes));
    if (mustRepeat && later.includes(false)) {
      problems.push(`table ${name}: header missing from a later part`);
    } else if (later.includes(true) && later.includes(false)) {
      problems.push(`table ${name}: header repeated in only some parts`);
    }
  }
  return problems;
}

function withoutDefinitions(part: Root): Nodes[] {
  return part.children.filter((child) => !isDefinition(child));
}

/**
 * Check every intended property of `splitMarkdownAst(root, fits)`, returning
 * a description of each violation.
 */
function splitProblems(
  root: Root,
  fits: (root: Root) => boolean,
  parts: Root[]
): string[] {
  const problems: string[] = [];
  for (const [index, part] of parts.entries()) {
    if (!fits(part)) {
      problems.push(`part ${index} does not fit`);
    }
    for (const empty of collect(
      part,
      (node) =>
        "children" in node &&
        node.type !== "tableCell" &&
        node.type !== "root" &&
        !hasContent(node)
    )) {
      problems.push(`part ${index} holds an empty ${empty.type}`);
    }
    problems.push(
      ...missingDefinitions(part).map((p) => `part ${index}: ${p}`)
    );
    if (stringifyMarkdown(part).includes(BROKEN_REFERENCE)) {
      problems.push(`part ${index} renders ${BROKEN_REFERENCE}`);
    }
  }

  const headers = new Set(
    collect(root, (node) => node.type === "table").map((table) =>
      rowText(childrenOf(table)[0] as Nodes)
    )
  );
  const rootStream = contentStream(
    root,
    (row, table) => childrenOf(table)[0] === row
  );
  const partStream = parts.flatMap((part) =>
    contentStream(
      part,
      (row, table) => childrenOf(table)[0] === row && headers.has(rowText(row))
    )
  );
  const length = Math.max(rootStream.length, partStream.length);
  for (let index = 0; index < length; index++) {
    if (rootStream[index]?.key !== partStream[index]?.key) {
      problems.push(
        `content differs at ${index}: expected ${rootStream[index]?.key} but got ${partStream[index]?.key}`
      );
      return problems;
    }
  }

  const definitions = firstDefinitions(root);
  for (const [index, part] of parts.entries()) {
    for (const definition of collect(part, isDefinition)) {
      const original = definitions.get(
        `${definition.type}:${identifierOf(definition)}`
      );
      if (JSON.stringify(original) !== JSON.stringify(definition)) {
        problems.push(
          `part ${index}: ${definition.type} ${identifierOf(definition)} is not the first one`
        );
      }
    }
  }

  problems.push(...codeProblems(root, parts));
  problems.push(...valueProblems(root, parts));
  problems.push(...tableProblems(root, parts, partStream, rootStream, fits));

  for (let index = 0; index + 1 < parts.length; index++) {
    const a = parts[index] as Root;
    const b = parts[index + 1] as Root;
    const used = new Map<string, Nodes>();
    for (const definition of [
      ...collect(a, isDefinition),
      ...collect(b, isDefinition),
    ]) {
      used.set(`${definition.type}:${identifierOf(definition)}`, definition);
    }
    const first = withoutDefinitions(a);
    const second = withoutDefinitions(b);
    // Table columns are as wide as their widest cell, so two pieces of a
    // table can fit where one table cannot.
    if (first.at(-1)?.type === "table" && second[0]?.type === "table") {
      continue;
    }
    // Sizing counts the spaces at a piece's edges, which are trimmed
    // afterwards, so allow a little slack.
    const slack = {
      type: "paragraph",
      children: [{ type: "text", value: "x".repeat(12) }],
    } as Nodes;
    if (fits(rootOf(...first, ...second, slack, ...used.values()))) {
      problems.push(`parts ${index} and ${index + 1} would fit together`);
    }
  }
  return problems;
}

/** Splitting situations a run should exercise to be meaningful. */
function featuresOf(parts: Root[]): string[] {
  const features: string[] = [];
  for (const [index, part] of parts.entries()) {
    const later = index > 0;
    if (
      later &&
      collect(part, (node) => node.type === "list" && node.ordered === true)
        .length > 0
    ) {
      features.push("ordered list continued");
    }
    if (
      collect(
        part,
        (node) => node.type === "tableCell" && childrenOf(node).length === 0
      ).length > 0
    ) {
      features.push("table row split");
    }
    if (collect(part, isDefinition).length > 0 && index < parts.length - 1) {
      features.push("definition carried");
    }
    if (collect(part, (node) => node.type === "code").length > 0 && later) {
      features.push("code continued");
    }
    const values = leafValues(part);
    const edges = `${values[0]?.slice(0, 30) ?? ""} ${values.at(-1)?.slice(-30) ?? ""}`;
    if (edges.includes("{{emoji:")) {
      features.push("placeholder at a part edge");
    }
    if (ANY_HIGH_SURROGATE.test(edges)) {
      features.push("surrogate pair at a part edge");
    }
  }
  return features;
}

// The generated tests run hundreds of splits each, well under a second
// locally, so their describes raise the timeout for CI coverage runs.
const PROPERTY_SEEDS = Number(process.env.SPLIT_PROPERTY_SEEDS ?? 30);
const PROPERTY_BUDGETS = [160, 240, 480];

describe("splitText properties", { timeout: 20_000 }, () => {
  it("keeps every character outside the dropped separators", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= PROPERTY_SEEDS; seed++) {
      const generator = new MarkdownGenerator(seed);
      const value = generator.inline(generator.int(20, 200));
      const limit = generator.int(20, 120);
      for (const [name, fits] of [
        ["length", (text: string) => text.length <= limit],
        [
          "converted",
          (text: string) =>
            convertEmojiPlaceholders(text, "gchat").length <= limit,
        ],
      ] as const) {
        const parts = splitText(value, fits);
        const label = `seed ${seed} ${name} ${limit}`;
        const strip = (text: string) => text.replaceAll(/\s/g, "");
        if (strip(parts.join("")) !== strip(value)) {
          failures.push(`${label}: content changed`);
        }
        for (const part of parts) {
          if (!fits(part)) {
            failures.push(`${label}: ${JSON.stringify(part)} does not fit`);
          }
          if (part.length === 0) {
            failures.push(`${label}: empty part`);
          }
        }
        failures.push(
          ...valueProblems(
            rootOf({ type: "text", value } as Nodes),
            parts.map((part) => rootOf({ type: "text", value: part } as Nodes))
          ).map((problem) => `${label}: ${problem}`)
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

// One test per seed keeps each test short under CI coverage, which runs
// these several dozen times slower than a local run.
describe("splitMarkdownAst properties", { timeout: 20_000 }, () => {
  const seeds = Array.from({ length: PROPERTY_SEEDS }, (_, index) => index + 1);
  const features = new Set<string>();
  let ran = 0;
  let splits = 0;

  // Checked once every seed has run, so a filtered run doesn't fail it. A
  // generator that stops reaching these cases would let the checks above
  // pass without testing them.
  afterAll(() => {
    if (ran < seeds.length) {
      return;
    }
    const missing = [
      "code continued",
      "definition carried",
      "ordered list continued",
      "placeholder at a part edge",
      "surrogate pair at a part edge",
      "table row split",
    ].filter((feature) => !features.has(feature));
    if (splits <= seeds.length / 2 || missing.length > 0) {
      throw new Error(
        `Generated markdown no longer exercises the checks: ${splits} of ${seeds.length} seeds split, missing [${missing.join(", ")}]`
      );
    }
  });

  it.each(
    seeds
  )("keeps every invariant on generated markdown, seed %i", (seed) => {
    ran += 1;
    const root = converter.toAst(new MarkdownGenerator(seed).document());
    // Rotate through every budget and both kinds of message.
    const budget = PROPERTY_BUDGETS[seed % PROPERTY_BUDGETS.length] as number;
    const [name, fits] =
      seed % 2 === 0
        ? ["regular", fitsRegularProduction(budget)]
        : ["rich", fitsRichProduction(budget)];
    if (fits(root)) {
      return;
    }
    splits += 1;
    const parts = splitMarkdownAst(root, fits);
    for (const feature of featuresOf(parts)) {
      features.add(feature);
    }
    expect(splitProblems(root, fits, parts), `${name} ${budget}`).toEqual([]);
  });
});

describe("splitMarkdownAst beside a nearly full part", () => {
  const fitsMarkdown = (root: Root) => stringifyMarkdown(root).length <= 30;

  it("does not cut an emoji placeholder at the start of a block", () => {
    const intro = "a".repeat(20);
    const block = "{{emoji:fire}} bbb ccc ddd eee fff";
    const root = parseMarkdown(`${intro}\n\n${block}`);
    // Seven characters of room are left beside the intro, fewer than the
    // placeholder needs, and the block does not fit in a part of its own.
    expect(
      fitsMarkdown(parseMarkdown(`${intro}\n\n${block.slice(0, 7)}`))
    ).toBe(true);
    expect(
      fitsMarkdown(parseMarkdown(`${intro}\n\n${block.slice(0, 8)}`))
    ).toBe(false);
    expect(fitsMarkdown(parseMarkdown(block))).toBe(false);

    const parts = splitMarkdownAst(root, fitsMarkdown);

    expect(blockTexts(parts)).toEqual([
      intro,
      "{{emoji:fire}} bbb ccc ddd",
      "eee fff",
    ]);
  });

  it("does not split a surrogate pair with one unit of room left", () => {
    const intro = "a".repeat(26);
    const block = "😀 bbb ccc ddd eee fff ggg hhh iii";
    const root = parseMarkdown(`${intro}\n\n${block}`);
    expect(fitsMarkdown(parseMarkdown(`${intro}\n\nx`))).toBe(true);
    expect(fitsMarkdown(parseMarkdown(`${intro}\n\nxx`))).toBe(false);
    expect(fitsMarkdown(parseMarkdown(block))).toBe(false);

    const parts = splitMarkdownAst(root, fitsMarkdown);

    expect(blockTexts(parts)).toEqual([
      intro,
      "😀 bbb ccc ddd eee fff ggg",
      "hhh iii",
    ]);
  });

  it("does not split a surrogate pair at the start of a code block", () => {
    const intro = rootOf({
      type: "paragraph",
      children: [{ type: "text", value: "a".repeat(20) }],
    } as Nodes).children[0] as Nodes;
    const code = (value: string) =>
      ({ type: "code", lang: null, value }) as Nodes;
    // One unit of code fits beside the intro.
    const limit = stringifyMarkdown(rootOf(intro, code("x"))).length;
    const fits = (part: Root) => stringifyMarkdown(part).length <= limit;
    expect(fits(rootOf(intro, code("xx")))).toBe(false);
    const value = "🎉 bbb\nccc ddd eee fff ggg hhh";
    expect(fits(rootOf(code(value)))).toBe(false);

    const parts = splitMarkdownAst(rootOf(intro, code(value)), fits);

    expect(blockTexts(parts)).toEqual([
      "a".repeat(20),
      "🎉 bbb",
      "ccc ddd eee fff ggg hhh",
    ]);
  });
});

describe("splitMarkdownAst with definitions inside containers", () => {
  it("does not leave an empty blockquote where a definition was", () => {
    const root = parseMarkdown(
      [
        "> [docs]: https://example.com/docs",
        `Read [the docs][docs] now. ${"word ".repeat(30).trim()}`,
        "tail ".repeat(30).trim(),
      ].join("\n\n")
    );
    const fits = fitsRendered(120);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(typesOf(part)).not.toContain("blockquote");
      expect(converter.fromAst(part)).not.toMatch(LEADING_QUOTE);
      expect(stringifyMarkdown(part)).not.toMatch(LEADING_QUOTE);
    }
  });
});

describe("splitMarkdownAst between inline nodes", () => {
  it("does not leave an empty text node before a bold run", () => {
    // The trailing space after the emphasis costs `&#x20;` in rich-message
    // markdown, so it moves to the next part with the bold run and is then
    // trimmed away.
    const root = parseMarkdown("Intro *emphasis* **(b**");
    const fits = fitsRich(20);
    expect(fits(parseMarkdown("Intro *emphasis*"))).toBe(true);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.map((part) => stringifyMarkdown(part))).toEqual([
      "Intro *emphasis*\n",
      "**(b**\n",
    ]);
  });
});

describe("splitMarkdownAst with a space between two runs", () => {
  // Each bold run fills a part on its own, and the space between them costs
  // `&#x20;` beside either one, so it lands in a part by itself and is then
  // trimmed to nothing.
  const first = "**alpha beta gamma**";
  const second = "**delta epsilon zeta**";

  it.each([
    ["paragraph", "", (run: string) => `${run}\n`],
    ["list item", "* ", (run: string) => `* ${run}\n`],
  ] as const)("drops the emptied %s instead of sending it", (_, marker, expected) => {
    const root = parseMarkdown(`${marker}${first} ${second}`);
    const fits = fitsRich(expected(second).length);
    expect(fits(parseMarkdown(`${marker}${first}`))).toBe(true);
    expect(fits(parseMarkdown(`${marker}${second}`))).toBe(true);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    expect(parts.map((part) => stringifyMarkdown(part))).toEqual([
      expected(first),
      expected(second),
    ]);
  });
});

describe("splitMarkdownAst with an oversized first table row", () => {
  const cellWords = words(30, "w");
  const markdown = `| A | B |\n|---|---|\n| x | ${cellWords.join(" ")} |\n| p | q |\n| r | s |`;

  it("repeats the header in every part", () => {
    const root = parseMarkdown(markdown);
    const fits = fitsRich(120);
    expect(fits(root)).toBe(false);

    const parts = splitMarkdownAst(root, fits);

    const tables = tableRows(parts);
    expect(tables.length).toBeGreaterThan(2);
    for (const [index, table] of tables.entries()) {
      expect(fits(parts[index] as Root)).toBe(true);
      expect(table[0]).toEqual(["A", "B"]);
      expect(table.length).toBeGreaterThan(1);
    }
    const body = tables.flatMap((table) => table.slice(1));
    expect(body.map((row) => row[1]).join(" ")).toBe(
      [...cellWords, "q", "s"].join(" ")
    );
    expect(body.map((row) => row[0])).toEqual([
      "x",
      ...body.slice(3).map(() => ""),
      "p",
      "r",
    ]);
  });

  it("does not leave the header alone beside a paragraph", () => {
    const root = parseMarkdown(`Intro paragraph here.\n\n${markdown}`);
    const fits = fitsRich(120);

    const parts = splitMarkdownAst(root, fits);

    for (const table of tableRows(parts)) {
      expect(table[0]).toEqual(["A", "B"]);
      expect(table.length).toBeGreaterThan(1);
    }
  });
});

const EDGE_BLOCKS = [
  "{{emoji:fire}} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
  "**{{emoji:thumbs_up}} alpha beta gamma delta epsilon zeta eta theta iota**",
  "😀😀 alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
  "**🎉 alpha beta gamma delta epsilon zeta eta theta iota kappa**",
  "- {{emoji:party}} alpha beta gamma delta epsilon zeta eta theta iota",
  "```\n🎉 alpha beta gamma\ndelta epsilon zeta eta theta iota kappa\n```",
  "```\n{{emoji:rocket}} alpha beta\ngamma delta epsilon zeta eta theta\n```",
];

describe("splitMarkdownAst at part edges", { timeout: 20_000 }, () => {
  const cases = EDGE_BLOCKS.flatMap((block) =>
    (["regular", "rich"] as const).map((name) => ({ block, name }))
  );

  it.each(
    cases
  )("keeps every invariant whatever room a short block leaves, $name: $block", ({
    block,
    name,
  }) => {
    const fits =
      name === "regular" ? fitsRegularProduction(60) : fitsRichProduction(60);
    // Parse once; each case only changes the intro paragraph's length.
    const blockRoot = converter.toAst(block);
    const failures: string[] = [];
    // Lengths that leave less room than a placeholder needs.
    for (let length = 30; length <= 60; length++) {
      const intro = {
        type: "paragraph",
        children: [{ type: "text", value: "i".repeat(length) }],
      } as Nodes;
      const root = rootOf(intro, ...structuredClone(blockRoot.children));
      expect(fits(root)).toBe(false);
      const parts = splitMarkdownAst(root, fits);
      for (const problem of splitProblems(root, fits, parts)) {
        failures.push(`intro ${length}: ${problem}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
