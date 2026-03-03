/**
 * 03 — Reactions
 *
 * Posts a message, adds a reaction, waits, then removes it.
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

  // Post a message to react to
  console.log("1️⃣  Sending message...");
  const sent = await signal.postMessage(threadId, "React to this! 🎯");
  console.log(`   ID: ${sent.id}`);

  await delay(1500);

  // Add thumbs up
  console.log("2️⃣  Adding 👍 reaction...");
  await signal.addReaction(threadId, sent.id, "thumbs_up");
  console.log("   Added.");

  await delay(2000);

  // Replace with fire (Signal allows only one reaction per user per message)
  console.log("3️⃣  Replacing with 🔥 reaction (Signal replaces previous)...");
  await signal.addReaction(threadId, sent.id, "fire");
  console.log("   Replaced 👍 → 🔥.");

  await delay(2000);

  // Remove fire (the current reaction)
  console.log("4️⃣  Removing 🔥 reaction...");
  await signal.removeReaction(threadId, sent.id, "fire");
  console.log("   Removed.");

  console.log("\n✅ Done!");
  await bot.shutdown();
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
