/**
 * Scenario 2 — Streaming reply (cardkit typewriter).
 *
 *   @mention bot in a group → bot replies with a streaming card that
 *   types out a canned response chunk-by-chunk.
 *
 * What to watch for:
 *   - The reply card in Lark should render the text progressively, not
 *     all at once.
 *   - The "streaming" indicator disappears when the producer returns.
 *
 * Run: pnpm --filter @chat-adapter/lark smoke:stream
 */
import { buildChat } from "./_shared";

const { chat, logger } = await buildChat("smoke:stream");

const CHUNKS = [
  "Thinking",
  "...",
  "\n\n",
  "Got your message: **",
  "hello there~",
  "**",
  "\n\nThis is a **streaming** reply demo ",
  "— Lark renders the text character by character, ",
  "like a typewriter.\n\n",
  "```ts\n",
  "// Code blocks are handled correctly too\n",
  "const x = 42;\n",
  "```\n\n",
  "Done.",
];

async function* canned(): AsyncIterable<string> {
  for (const c of CHUNKS) {
    yield c;
    await new Promise((r) => setTimeout(r, 200));
  }
}

chat.onNewMention(async (thread, message) => {
  logger.info("got mention, starting stream", { text: message.text });
  await thread.post(canned());
  logger.info("stream finished");
});

chat.onDirectMessage(async (thread, message) => {
  logger.info("got DM, starting stream", { text: message.text });
  await thread.post(canned());
});

logger.info("connecting...");
await chat.initialize();
logger.info("ready — @bot and watch the typewriter (Ctrl-C to exit)");
