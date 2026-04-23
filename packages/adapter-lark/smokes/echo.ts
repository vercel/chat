/**
 * Scenario 1 — Echo bot.
 *
 *   @mention bot in a group  → onNewMention  → `echo (mention): ...`
 *   DM bot without @         → onDirectMessage → `echo (dm): ...`
 *   follow-up in subscribed  → onSubscribedMessage → `echo (subscribed): ...`
 *
 * Run: pnpm --filter @chat-adapter/lark smoke:echo
 */
import { buildChat } from "./_shared";

const { adapter, chat, logger } = await buildChat("smoke:echo");

chat.onNewMention(async (thread, message) => {
  logger.info("got mention", { text: message.text });
  await thread.subscribe();
  await thread.post(`echo (mention): ${message.text}`);
});

chat.onDirectMessage(async (thread, message) => {
  logger.info("got DM", { text: message.text });
  await thread.subscribe();
  await thread.post(`echo (dm): ${message.text}`);
});

chat.onSubscribedMessage(async (thread, message) => {
  logger.info("got subscribed message", { text: message.text });
  await thread.post(`echo (subscribed): ${message.text}`);
});

logger.info("connecting...");
await chat.initialize();

// Print bot identity and the chats it's in, so you know what to @ or DM
// and which chat_id to pass to smoke:history.
const channel = adapter._getChannel();
logger.info("bot identity", channel?.botIdentity);
if (channel?.rawClient) {
  try {
    const rawClient = channel.rawClient as unknown as {
      im: {
        v1: {
          chat: {
            list: (args: unknown) => Promise<{
              data?: { items?: Array<{ chat_id?: string; name?: string }> };
            }>;
          };
        };
      };
    };
    const res = await rawClient.im.v1.chat.list({ params: { page_size: 20 } });
    const chats = res.data?.items ?? [];
    logger.info(`bot is a member of ${chats.length} chats:`);
    for (const c of chats) {
      logger.info(`  - ${c.chat_id} | ${c.name ?? "(no name)"}`);
    }
  } catch (err) {
    logger.warn("chat.list failed", err);
  }
}

logger.info("ready — @bot in a group or DM the bot (Ctrl-C to exit)");
