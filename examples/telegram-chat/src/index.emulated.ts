/**
 * Emulated variant of telegram-chat. Boots a local emulate.dev Telegram
 * emulator, mints a bot + user + private chat via its test-control plane,
 * hands the bot off to the shared startBot() wiring with apiBaseUrl pointed
 * at the emulator, then drives a scripted interaction so you can watch the
 * demo react without a real BotFather bot.
 */

import {
  createTelegramTestClient,
  type TestMessage,
} from "@emulators/telegram/test";
import { createEmulator } from "emulate";
import { startBot } from "./bot";

const EMU_PORT = Number(process.env.EMULATE_TELEGRAM_PORT ?? 4007);
const BOT_USERNAME = "telegramchatdemobot";

console.log(`[boot] starting Telegram emulator on :${EMU_PORT}…`);
const emu = await createEmulator({ service: "telegram", port: EMU_PORT });
console.log(`[boot] emulator ready at ${emu.url}`);

const tg = createTelegramTestClient(emu.url);
const bot = await tg.createBot({
  username: BOT_USERNAME,
  first_name: "Telegram Chat Demo",
});
const user = await tg.createUser({
  first_name: "Alice",
  username: "alice_tester",
});
const dm = await tg.createPrivateChat({ botId: bot.bot_id, userId: user.id });
console.log(
  `[boot] bot=${bot.username} (id=${bot.bot_id}) user=${user.id} chat=${dm.id}`
);

console.log("[boot] initializing chat…");
await startBot({
  botToken: bot.token,
  userName: bot.username,
  apiBaseUrl: emu.url,
});
console.log(`[boot] polling updates via ${emu.url}`);

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}
interface InlineReplyMarkup {
  inline_keyboard?: InlineKeyboardButton[][];
}

function dumpMessage(index: number, msg: TestMessage): void {
  const body = msg.text ?? msg.caption ?? "<no text>";
  const preview = body.replace(/\n/g, " ").slice(0, 160);
  console.log(`  [#${index}] msg_id=${msg.message_id} ${preview}`);
  const markup = msg.reply_markup as InlineReplyMarkup | undefined;
  for (const row of markup?.inline_keyboard ?? []) {
    for (const btn of row) {
      const ref = btn.callback_data
        ? `callback_data="${btn.callback_data}"`
        : btn.url
          ? `url="${btn.url}"`
          : "";
      console.log(`       • ${btn.text} ${ref}`);
    }
  }
}

function findButton(
  msg: TestMessage | undefined,
  predicate: (btn: InlineKeyboardButton) => boolean
): InlineKeyboardButton | undefined {
  const markup = msg?.reply_markup as InlineReplyMarkup | undefined;
  for (const row of markup?.inline_keyboard ?? []) {
    for (const btn of row) {
      if (predicate(btn)) {
        return btn;
      }
    }
  }
  return undefined;
}

async function drive(): Promise<void> {
  console.log('\n[drive] user sends "hi bot" to trigger the main menu…');
  await tg.sendUserMessage({ chatId: dm.id, userId: user.id, text: "hi bot" });
  await delay(1500);

  let bots = await tg.getSentMessages({ chatId: dm.id });
  console.log(`[drive] bot has sent ${bots.length} message(s):`);
  bots.forEach((m, i) => dumpMessage(i, m));

  const mainMenu = bots.at(-1);
  const textBtn = findButton(mainMenu, (b) =>
    b.text.toLowerCase().includes("text")
  );
  if (!(textBtn?.callback_data && mainMenu)) {
    console.warn("[drive] could not find a Text & Markdown button; stopping");
    return;
  }

  console.log(`\n[drive] clicking "${textBtn.text}"…`);
  await tg.clickInlineButton({
    chatId: dm.id,
    userId: user.id,
    messageId: mainMenu.message_id,
    callbackData: textBtn.callback_data,
  });
  await delay(1500);

  bots = await tg.getSentMessages({ chatId: dm.id });
  console.log(`[drive] bot has sent ${bots.length} total; latest:`);
  const latest = bots.at(-1);
  if (latest) {
    dumpMessage(bots.length - 1, latest);
  }

  const firstDemoBtn = findButton(
    latest,
    (b) => b.callback_data?.includes('"run:') ?? false
  );
  if (firstDemoBtn?.callback_data && latest) {
    console.log(`\n[drive] running demo via "${firstDemoBtn.text}"…`);
    await tg.clickInlineButton({
      chatId: dm.id,
      userId: user.id,
      messageId: latest.message_id,
      callbackData: firstDemoBtn.callback_data,
    });
    await delay(2000);
    bots = await tg.getSentMessages({ chatId: dm.id });
    console.log(`[drive] final bot-sent count: ${bots.length}`);
    const demoMsg = bots.at(-1);
    if (demoMsg) {
      dumpMessage(bots.length - 1, demoMsg);
    }
  }
}

await drive();

console.log("\n[done] scripted interaction complete.");
console.log(
  "[done] polling is still active — Ctrl-C to stop the emulator and exit."
);

const shutdown = async (): Promise<void> => {
  console.log("\n[boot] shutting down…");
  try {
    await emu.close();
  } catch (err) {
    console.error("[boot] emulator close failed", err);
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
