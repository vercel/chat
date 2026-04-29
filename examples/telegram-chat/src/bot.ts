/**
 * Shared bot wiring: registers the menu + demo handlers on a fresh Chat,
 * initializes it, and returns the Chat instance. Used by both the real-bot
 * entry (src/index.ts) and the emulator entry (src/index.emulated.ts) —
 * everything except where the adapter points is identical.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { type ActionEvent, Chat, type Logger, type Thread } from "chat";
import { APPROVAL_DEMO_ID, buildDecidedCard, CARD_DEMOS } from "./demos/cards";
import { MARKDOWN_DEMOS } from "./demos/markdown";
import { MEDIA_DEMOS, type MediaDemoChat } from "./demos/media";
import { decode } from "./lib/callbacks";
import { postMainMenu, postMenu } from "./menu";

export interface StartBotConfig {
  botToken: string;
  userName: string;
  /** Override the Telegram API host (e.g. the emulate.dev Telegram emulator). */
  apiBaseUrl?: string;
  logger?: Logger;
}

export const defaultLogger: Logger = (() => {
  const l: Logger = {
    debug: (msg, meta) => console.debug(`[debug] ${msg}`, meta ?? ""),
    info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ""),
    warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ""),
    error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
    child: () => l,
  };
  return l;
})();

export async function startBot(config: StartBotConfig): Promise<Chat> {
  const logger = config.logger ?? defaultLogger;

  const state = createMemoryState();
  const telegram = createTelegramAdapter({
    botToken: config.botToken,
    apiBaseUrl: config.apiBaseUrl,
    mode: "polling",
    userName: config.userName,
    logger,
  });

  const chat = new Chat({
    userName: config.userName,
    adapters: { telegram },
    state,
    logger,
  });

  type DemoRunner = (thread: Thread<unknown>) => Promise<void>;
  const demos = new Map<string, { label: string; run: DemoRunner }>();
  for (const demo of MARKDOWN_DEMOS) {
    demos.set(demo.id, { label: demo.label, run: demo.run });
  }
  for (const demo of CARD_DEMOS) {
    demos.set(demo.id, { label: demo.label, run: demo.run });
  }
  const mediaDemoChat: MediaDemoChat = {
    onSubscribedMessage: (handler) => chat.onSubscribedMessage(handler),
  };
  for (const demo of MEDIA_DEMOS) {
    demos.set(demo.id, {
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

  chat.onAction(async (event) => {
    const parsed = decode(event.actionId);
    if (!parsed) {
      console.warn(`[bot] unknown callback_data: ${event.actionId}`);
      return;
    }
    const thread = event.thread;
    if (!thread) {
      console.warn(`[bot] action ${event.actionId} received with no thread`);
      return;
    }

    if (parsed.kind === "nav") {
      await postMenu(thread, parsed.menu);
      return;
    }
    if (parsed.kind === "run") {
      const demo = demos.get(parsed.demo);
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
    }
  });

  await chat.initialize();
  return chat;
}

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
