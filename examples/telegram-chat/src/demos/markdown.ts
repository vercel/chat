/**
 * MarkdownV2 rendering demos.
 *
 * Each demo posts a single message exercising one aspect of the renderer:
 * plain text, inline emphasis, code blocks, links, lists/tables, the full
 * 20-character escape matrix, a realistic LLM response, and a streaming
 * edit loop. If any demo fails with "can't parse entities", the renderer
 * has a bug.
 */

import type { Thread } from "chat";

const LLM_CORPUS = [
  "# Trip Summary: Morocco",
  "",
  "Here's your **personalized** 7-day itinerary. Price: $2,450/person (all-inclusive)!",
  "",
  "## Day 1 — Arrival",
  "",
  "- Airport pickup at 14:30",
  "- Check-in at *Riad El Fenn* (4-star)",
  "- Dinner: [La Mamounia](https://www.mamounia.com/restaurants)",
  "",
  "> Tip: bring cash — souks don't always take cards.",
  "",
  "```bash",
  "curl 'https://api.rates.io/MAD' | jq '.rate'",
  "```",
  "",
  "| Day | Activity | Cost |",
  "|-----|----------|------|",
  "| 1 | Arrival | $200 |",
  "| 2 | Atlas | $350 |",
  "",
  "~~Previous: $2,800~~. New total: **$2,450**.",
].join("\n");

const STREAMING_CHUNKS = [
  "# Streaming demo",
  "\n\nWatch this message update in real time. Each chunk appends content and triggers an editMessage call.",
  "\n\n**Progress:** `[█░░░░]`",
  "\n\n**Progress:** `[███░░]`",
  "\n\n**Progress:** `[█████]` — done!",
  "\n\n- Rendering works per chunk",
  "\n- Special chars escape correctly",
  "\n- Final message has no raw asterisks",
];

const STREAM_CHUNK_DELAY_MS = 600;

// Truncation demos: each produces a rendered message over Telegram's 4096-char
// limit, exercising a different code path in trimToMarkdownV2SafeBoundary.
// If any of these renders with the asterisks literal, an orphan `\`, or
// Telegram returns `can't parse entities`, the truncator has regressed.
const LONG_PLAIN_LENGTH = 5000;
const LONG_BODY_BEFORE_ENTITY = 4000;
const LONG_BODY_INSIDE_ENTITY = 1000;

function longPlainMarkdown(): string {
  // No special chars — rendered output is the same length as input. Truncation
  // must append escaped `\.\.\.` and hold under the 4096 char limit.
  return "a".repeat(LONG_PLAIN_LENGTH);
}

function longWithUnclosedBold(): string {
  // `**bold**` opens before the limit and closes after it. Naive truncation
  // keeps the opening `*` without its closer → unclosed bold entity → 400.
  return `${"a".repeat(LONG_BODY_BEFORE_ENTITY)}**${"b".repeat(LONG_BODY_INSIDE_ENTITY)}**`;
}

function longWithUnclosedCode(): string {
  // Same shape, inline code. Unclosed backtick entity → 400.
  return `${"a".repeat(LONG_BODY_BEFORE_ENTITY)}\`${"b".repeat(LONG_BODY_INSIDE_ENTITY)}\``;
}

type AnyThread = Thread<unknown>;

export const MARKDOWN_DEMOS: {
  id: string;
  label: string;
  run: (thread: AnyThread) => Promise<void>;
}[] = [
  {
    id: "md.plain",
    label: "Plain text",
    run: async (thread) => {
      await thread.post("Hello, this is plain text. No formatting.");
    },
  },
  {
    id: "md.emphasis",
    label: "Inline emphasis",
    run: async (thread) => {
      await thread.post({
        markdown: "**bold** and *italic* and ~~strike~~ and `inline code`",
      });
    },
  },
  {
    id: "md.code",
    label: "Code block",
    run: async (thread) => {
      await thread.post({
        markdown: [
          "```bash",
          "# pipes, dots, bangs, parens must render literally",
          "curl 'https://api.example.com/v1/rates' | jq '.rate' > out.txt",
          "```",
        ].join("\n"),
      });
    },
  },
  {
    id: "md.links",
    label: "Links",
    run: async (thread) => {
      await thread.post({
        markdown:
          "Visit [Vercel](https://vercel.com) and also [this (weird!) label](https://example.com/path?x=1)",
      });
    },
  },
  {
    id: "md.list-table",
    label: "List + table",
    run: async (thread) => {
      await thread.post({
        markdown: [
          "- **first** item",
          "- second *item*",
          "- third `item`",
          "",
          "| Name | Age | City |",
          "|------|-----|------|",
          "| Alice | 30 | Lisbon |",
          "| Bob | 25 | Porto |",
        ].join("\n"),
      });
    },
  },
  {
    id: "md.torture",
    label: "Torture string",
    run: async (thread) => {
      await thread.post({
        markdown:
          "Escape matrix: _ * [ ] ( ) ~ ` > # + - = | { } . ! \\ all at once",
      });
    },
  },
  {
    id: "md.llm",
    label: "LLM-style response",
    run: async (thread) => {
      await thread.post({ markdown: LLM_CORPUS });
    },
  },
  {
    id: "md.streaming",
    label: "Streaming demo",
    run: async (thread) => {
      async function* iter(): AsyncIterable<string> {
        for (const chunk of STREAMING_CHUNKS) {
          yield chunk;
          await new Promise((resolve) =>
            setTimeout(resolve, STREAM_CHUNK_DELAY_MS)
          );
        }
      }
      await thread.post(iter());
    },
  },
  {
    id: "md.long-plain",
    label: "Long (5000 plain)",
    run: async (thread) => {
      await thread.post({ markdown: longPlainMarkdown() });
    },
  },
  {
    id: "md.long-bold",
    label: "Long (bold crosses 4096)",
    run: async (thread) => {
      await thread.post({ markdown: longWithUnclosedBold() });
    },
  },
  {
    id: "md.long-code",
    label: "Long (code crosses 4096)",
    run: async (thread) => {
      await thread.post({ markdown: longWithUnclosedCode() });
    },
  },
];
