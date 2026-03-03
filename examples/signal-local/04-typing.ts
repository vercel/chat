/**
 * 04 — Typing indicator
 *
 * Shows a typing indicator, waits, then sends a message.
 */
import { createSignalAdapter } from "@chat-adapter/signal";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { PHONE_NUMBER, RECIPIENT, SERVICE_URL } from "./env";

if (!RECIPIENT) {
  console.error("❌ SIGNAL_RECIPIENT is required for this example");
  process.exit(1);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const signal = createSignalAdapter({
    phoneNumber: PHONE_NUMBER!,
    baseUrl: SERVICE_URL,
  });

  const bot = new Chat({
    userName: "test-bot",
    adapters: { signal },
    state: createMemoryState(),
    logger: "info",
  });

  await bot.initialize();

  const threadId = await signal.openDM(RECIPIENT!);

  console.log("⌨️  Sending typing indicator...");
  await signal.startTyping(threadId);

  console.log("   Waiting 3 seconds...");
  await delay(3000);

  console.log("💬 Sending message...");
  await signal.postMessage(threadId, "I was typing for 3 seconds! ⌨️");

  console.log("\n✅ Done!");
  await bot.shutdown();
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
