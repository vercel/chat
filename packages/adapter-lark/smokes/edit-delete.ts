/**
 * Scenario 3 — Post / edit / delete.
 *
 *   @mention bot →
 *     1. Post "hello v1"
 *     2. Wait 3s, edit to "hello v2 (edited)"
 *     3. Wait 3s, delete the message
 *
 * What to watch for:
 *   - The message visibly updates in-place (Lark shows "(edited)")
 *   - Then disappears from the chat
 *
 * Run: pnpm --filter @chat-adapter/lark smoke:edit
 */
import { buildChat } from "./_shared";

const { chat, logger } = await buildChat("smoke:edit");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function demo(
  thread: Awaited<ReturnType<typeof chat.onNewMention>> extends never
    ? never
    : Parameters<Parameters<typeof chat.onNewMention>[0]>[0]
) {
  logger.info("posting v1");
  const sent = await thread.post("hello v1");
  logger.info("posted", { id: sent.id });

  await sleep(3000);
  logger.info("editing...");
  await sent.edit("hello v2 (edited)");

  await sleep(3000);
  logger.info("deleting...");
  await sent.delete();
  logger.info("done");
}

chat.onNewMention(async (thread) => demo(thread));
chat.onDirectMessage(async (thread) => demo(thread));

logger.info("connecting...");
await chat.initialize();
logger.info("ready — @bot or DM to trigger the post/edit/delete demo");
