/**
 * Scenario 6 — Fetch history (one-shot, then exit).
 *
 *   Lists up to 20 messages and threads from a chat you specify.
 *
 * Usage:
 *   LARK_TEST_CHAT_ID=oc_xxxxxx \
 *     pnpm --filter @chat-adapter/lark smoke:history
 *
 *   To find a chat_id, run `smoke:echo` first — it prints the list of
 *   chats the bot is a member of.
 */
import { buildChat } from "./_shared";

const chatId = process.env.LARK_TEST_CHAT_ID;
if (!chatId) {
  console.error(
    "Set LARK_TEST_CHAT_ID to a chat the bot is in (e.g., from the smoke:echo startup log)"
  );
  process.exit(1);
}

const { adapter, chat, logger } = await buildChat("smoke:history");

logger.info("connecting...");
await chat.initialize();

const threadId = `lark:${chatId}:`;

// ─── fetchMessages ────────────────────────────────────────────────────────
logger.info(`fetchMessages(${threadId}, limit=20)`);
const page = await adapter.fetchMessages(threadId, { limit: 20 });
logger.info(
  `got ${page.messages.length} messages (nextCursor=${page.nextCursor})`
);
for (const m of page.messages) {
  logger.info(
    `  [${new Date(m.metadata.dateSent).toISOString()}] ${m.author.userId}: ${m.text.slice(0, 80)}`
  );
}

// ─── listThreads ──────────────────────────────────────────────────────────
logger.info(`listThreads(${chatId})`);
const threadList = await adapter.listThreads(chatId, { limit: 20 });
logger.info(`got ${threadList.threads.length} threads`);
for (const t of threadList.threads) {
  logger.info(
    `  ${t.id} | replies=${t.replyCount} | lastReply=${t.lastReplyAt?.toISOString() ?? "-"} | root=${t.rootMessage.text.slice(0, 60)}`
  );
}

// ─── fetchMessage (the most-recent one) ───────────────────────────────────
const mostRecent = page.messages.at(-1);
if (mostRecent) {
  logger.info(`fetchMessage(${mostRecent.id})`);
  const single = await adapter.fetchMessage(threadId, mostRecent.id);
  logger.info(`  single fetch: ${single?.text.slice(0, 80) ?? "(null)"}`);
}

logger.info("done");
await adapter.disconnect();
process.exit(0);
