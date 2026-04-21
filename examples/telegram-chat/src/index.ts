/**
 * telegram-chat — reference bot for the Chat SDK's Telegram adapter.
 *
 * Boots a polling-mode Telegram adapter against the real Bot API using a
 * BotFather token, then delegates all wiring to startBot() in ./bot.
 */

import { startBot } from "./bot";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error(
    "TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and export it."
  );
  process.exit(1);
}

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "telegramchatdemobot";

console.log("[boot] initializing chat…");
await startBot({ botToken: TELEGRAM_BOT_TOKEN, userName: BOT_USERNAME });
console.log(
  `[boot] polling for messages. DM @${BOT_USERNAME} any text to open the menu.`
);

process.on("SIGINT", () => {
  console.log("\n[boot] shutting down…");
  process.exit(0);
});
