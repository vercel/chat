/**
 * telegram-chat — reference bot for the Chat SDK's Telegram adapter.
 *
 * Boots a polling-mode Telegram adapter, wires mention and action handlers,
 * routes both to the menu state machine in menu.tsx. Stateless beyond the
 * reactions demo, which briefly subscribes and self-unsubscribes.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { type ActionEvent, Chat, type Logger, type Thread } from "chat";
import { APPROVAL_DEMO_ID, buildDecidedCard, CARD_DEMOS } from "./demos/cards";
import { MARKDOWN_DEMOS } from "./demos/markdown";
import { MEDIA_DEMOS, type MediaDemoChat } from "./demos/media";
import { decode } from "./lib/callbacks";
import { postMainMenu, postMenu } from "./menu";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error(
    "TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and export it."
  );
  process.exit(1);
}

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "telegramchatdemobot";

const logger: Logger = {
  debug: (msg, meta) => console.debug(`[debug] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
  child: () => logger,
};

const state = createMemoryState();
const telegram = createTelegramAdapter({
  botToken: TELEGRAM_BOT_TOKEN,
  mode: "polling",
  userName: BOT_USERNAME,
  logger,
});

const chat = new Chat({
  userName: BOT_USERNAME,
  adapters: { telegram },
  state,
  logger,
});

type DemoRunner = (thread: Thread<unknown>) => Promise<void>;

const DEMO_LOOKUP = new Map<string, { label: string; run: DemoRunner }>();

for (const demo of MARKDOWN_DEMOS) {
  DEMO_LOOKUP.set(demo.id, { label: demo.label, run: demo.run });
}
for (const demo of CARD_DEMOS) {
  DEMO_LOOKUP.set(demo.id, { label: demo.label, run: demo.run });
}

const mediaDemoChat: MediaDemoChat = {
  onSubscribedMessage: (handler) => chat.onSubscribedMessage(handler),
};
for (const demo of MEDIA_DEMOS) {
  DEMO_LOOKUP.set(demo.id, {
    label: demo.label,
    run: (thread) => demo.run(thread, mediaDemoChat),
  });
}

// Any DM text opens the main menu. Telegram DMs route every message as a
// mention because the bot is the only other participant in the chat.
chat.onNewMention(async (thread, message) => {
  console.log(`[bot] incoming text: ${message.text}`);
  try {
    await postMainMenu(thread);
  } catch (err) {
    console.error("[bot] failed to post main menu", err);
  }
});

// The reactions demo registers its own short-lived onSubscribedMessage
// handler and unsubscribes as soon as it fires or times out. No global
// subscribed-message handler is needed here.

// All button callbacks route through here.
chat.onAction(async (event) => {
  const raw = event.actionId;
  const parsed = decode(raw);
  if (!parsed) {
    console.warn(`[bot] unknown callback_data: ${raw}`);
    return;
  }

  const thread = event.thread;
  if (!thread) {
    console.warn(`[bot] action ${raw} received with no thread`);
    return;
  }

  if (parsed.kind === "nav") {
    await postMenu(thread, parsed.menu);
    return;
  }

  if (parsed.kind === "run") {
    const demo = DEMO_LOOKUP.get(parsed.demo);
    if (!demo) {
      await thread.post(`❌ Unknown demo: ${parsed.demo}`);
      return;
    }
    try {
      await demo.run(thread);
    } catch (err) {
      console.error(`[bot] demo ${parsed.demo} failed`, err);
      await thread.post(
        `❌ ${demo.label} — ${(err as Error).message ?? String(err)}`
      );
    }
    return;
  }

  if (parsed.kind === "act") {
    await handleAction(parsed.demo, parsed.arg, event);
    return;
  }
});

async function handleAction(
  demo: string,
  arg: string,
  event: ActionEvent
): Promise<void> {
  const thread = event.thread;
  if (!thread) {
    return;
  }

  if (demo === APPROVAL_DEMO_ID && (arg === "approve" || arg === "reject")) {
    try {
      const card = buildDecidedCard(
        arg,
        event.user.userName || event.user.fullName,
        new Date()
      );
      await event.adapter.editMessage(event.threadId, event.messageId, {
        card,
      });
    } catch (err) {
      console.error("[bot] approval edit failed", err);
      await thread.post(
        `❌ Approval update — ${(err as Error).message ?? String(err)}`
      );
    }
    return;
  }

  // Size-probe: Telegram rejects the oversize button at post time, so a
  // click on the acceptable one just reports success.
  if (demo === "card.size") {
    await thread.post(
      arg === "ok"
        ? "✅ Small payload delivered successfully."
        : `ℹ️ Unexpected action: ${arg}`
    );
    return;
  }

  console.warn(`[bot] unhandled action ${demo}:${arg}`);
}

console.log("[boot] initializing chat…");
await chat.initialize();
console.log(
  `[boot] polling for messages. DM @${BOT_USERNAME} any text to open the menu.`
);

process.on("SIGINT", () => {
  console.log("\n[boot] shutting down…");
  process.exit(0);
});
