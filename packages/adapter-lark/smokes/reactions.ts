/**
 * Scenario 4 — Add / remove emoji reactions.
 *
 *   @mention bot →
 *     1. Post a message "react test"
 *     2. Immediately add a 👍 reaction to it
 *     3. Wait 5s, remove the 👍
 *
 *   Also listens for reactions users add to any message and logs them:
 *     chat.onReaction(...)
 *
 * What to watch for:
 *   - The message shows a 👍 reaction badge for 5s then it goes away
 *   - When you add any emoji to any message, terminal logs `[smoke:reactions] got reaction {...}`
 *
 * Run: pnpm --filter @chat-adapter/lark smoke:reactions
 */
import { buildChat } from "./_shared";

const { chat, logger } = await buildChat("smoke:reactions");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

chat.onReaction(async (event) => {
  logger.info("got reaction", {
    emoji: event.emoji.name,
    rawEmoji: event.rawEmoji,
    added: event.added,
    user: event.user.userId,
    threadId: event.threadId,
  });
});

async function demo(
  thread: Parameters<Parameters<typeof chat.onNewMention>[0]>[0]
) {
  logger.info("posting react-test message");
  const sent = await thread.post("react test");

  logger.info("adding thumbs_up reaction");
  await sent.addReaction("thumbs_up");

  await sleep(5000);
  logger.info("removing thumbs_up reaction");
  try {
    await sent.removeReaction("thumbs_up");
  } catch (err) {
    logger.warn("removeReaction failed", err);
  }
  logger.info("done — now you can add any emoji yourself to see the event");
}

chat.onNewMention(async (thread) => demo(thread));
chat.onDirectMessage(async (thread) => demo(thread));

logger.info("connecting...");
await chat.initialize();
logger.info(
  "ready — @bot or DM to trigger; also watches for any reactions users add"
);
