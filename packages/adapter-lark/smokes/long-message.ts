/**
 * Scenario 5 — Long message with code blocks (chunking + code-fence safety).
 *
 *   @mention bot → bot posts a ~9000-character markdown message with
 *   multiple code blocks and headings.
 *
 * What to watch for:
 *   - SDK's splitter has a ~3500-char soft threshold; content above that
 *     must split into 2+ Lark messages.
 *   - Code blocks must not break across chunks (SDK re-opens ``` fences).
 *
 * Run: pnpm --filter @chat-adapter/lark smoke:long
 */
import { buildChat } from "./_shared";

const { chat, logger } = await buildChat("smoke:long");

function buildLongMarkdown(): string {
  const parts: string[] = [];
  parts.push("# Long message chunking test\n\n");
  // 20 sections × ~450 chars ≈ 9000 chars — well above the 3500-char
  // splitter threshold so splitting is guaranteed.
  for (let i = 1; i <= 20; i++) {
    parts.push(`## Section ${i}\n\n`);
    parts.push(
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Padding text to push the message near the splitter threshold."
    );
    parts.push(
      " Repeating once more: padding text to push the message near the splitter threshold, nothing special happening here."
    );
    parts.push(
      " Third repeat: more padding text used solely to exercise the chunking logic.\n\n"
    );
    parts.push("```typescript\n");
    parts.push(`// Code block ${i} — must stay intact across chunks\n`);
    parts.push("const arr = [1, 2, 3, 4, 5];\n");
    parts.push(
      "const doubled = arr.map(n => n * 2).filter(n => n > 4).reduce((s, n) => s + n, 0);\n"
    );
    parts.push(`console.log('sum for section ${i}:', doubled);\n`);
    parts.push("```\n\n");
  }
  return parts.join("");
}

chat.onNewMention(async (thread) => {
  const md = buildLongMarkdown();
  logger.info("posting long markdown", { chars: md.length });
  await thread.post(md);
  logger.info("done");
});
chat.onDirectMessage(async (thread) => {
  const md = buildLongMarkdown();
  logger.info("posting long markdown", { chars: md.length });
  await thread.post(md);
});

logger.info("connecting...");
await chat.initialize();
logger.info("ready — @bot or DM to trigger a long chunked post");
