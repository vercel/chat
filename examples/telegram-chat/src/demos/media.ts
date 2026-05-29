/**
 * Media & Reactions demos.
 *
 * The reactions demo breaks the otherwise-stateless bot: it briefly
 * subscribes the thread to a one-shot "react to the next message" handler
 * that unsubscribes after firing (or after a timeout).
 *
 * File upload demos generate a 1×1 PNG and a minimal PDF in memory and
 * post them as attachments. Telegram's adapter treats them as documents
 * (single-file-per-message constraint).
 */

import type { SubscribedMessageHandler, Thread } from "chat";
import { generateMinimalPdf } from "../lib/pdf";
import { generate1x1Png } from "../lib/png";

type AnyThread = Thread<unknown>;

/**
 * Subset of the Chat surface media demos use. Takes the
 * `onSubscribedMessage` registration function rather than the whole Chat
 * instance to avoid type-parameter leaks.
 */
export interface MediaDemoChat {
  onSubscribedMessage(handler: SubscribedMessageHandler): void;
}

const REACTION_WINDOW_MS = 30_000;
const REACTION_EMOJIS = ["❤", "🔥", "👍"];

export const MEDIA_DEMOS: {
  id: string;
  label: string;
  run: (thread: AnyThread, chat: MediaDemoChat) => Promise<void>;
}[] = [
  {
    id: "media.reactions",
    label: "Reactions demo",
    run: async (thread, chat) => {
      await thread.post(
        `🧪 Send me any message in the next 30 seconds and I'll react to it.`
      );
      await armReactionOneShot(thread, chat);
    },
  },
  {
    id: "media.upload-png",
    label: "Upload PNG",
    run: async (thread) => {
      await thread.post({
        markdown: "📎 Sending a tiny generated PNG…",
        files: [
          {
            filename: "demo.png",
            data: generate1x1Png(),
            mimeType: "image/png",
          },
        ],
      });
    },
  },
  {
    id: "media.upload-pdf",
    label: "Upload PDF",
    run: async (thread) => {
      await thread.post({
        markdown: "📎 Sending a generated single-page PDF…",
        files: [
          {
            filename: "demo.pdf",
            data: generateMinimalPdf("Hello from telegram-chat!"),
            mimeType: "application/pdf",
          },
        ],
      });
    },
  },
];

/**
 * Subscribes the thread briefly and registers a one-shot message handler
 * that reacts to the next incoming message. The handler unsubscribes
 * after firing or after REACTION_WINDOW_MS, whichever comes first.
 */
async function armReactionOneShot(
  thread: AnyThread,
  chat: MediaDemoChat
): Promise<void> {
  await thread.subscribe();

  let fired = false;

  const timeout = setTimeout(async () => {
    if (fired) {
      return;
    }
    fired = true;
    try {
      await thread.unsubscribe();
      await thread.post("⌛ Reaction window closed. Try again from the menu.");
    } catch (err) {
      console.error("[reactions] failed to unsubscribe on timeout", err);
    }
  }, REACTION_WINDOW_MS);

  chat.onSubscribedMessage(async (subscribedThread, message) => {
    if (fired || subscribedThread.id !== thread.id) {
      return;
    }
    fired = true;
    clearTimeout(timeout);
    try {
      for (const emoji of REACTION_EMOJIS) {
        if (subscribedThread.adapter.addReaction) {
          await subscribedThread.adapter.addReaction(
            subscribedThread.id,
            message.id,
            emoji
          );
        }
      }
      await subscribedThread.post("✅ Reactions sent.");
    } catch (err) {
      console.error("[reactions] add failed", err);
      await subscribedThread.post(
        `❌ Reaction — ${(err as Error).message ?? String(err)}`
      );
    } finally {
      await subscribedThread.unsubscribe();
    }
  });
}
