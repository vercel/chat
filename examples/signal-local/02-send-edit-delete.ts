/**
 * 02 — Send, edit, delete messages
 *
 * Posts a message, edits it twice, fetches from cache, then deletes.
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
  console.log(`📨 Thread: ${threadId}\n`);

  // Post
  console.log("1️⃣  Sending message...");
  const sent = await signal.postMessage(threadId, "Hello from the Signal adapter! 🚀");
  console.log(`   ID: ${sent.id}`);

  await delay(2000);

  // Edit
  console.log("2️⃣  Editing message...");
  await signal.editMessage(threadId, sent.id, "Hello from the Signal adapter! ✏️ (edited)");
  console.log("   Edited.");

  await delay(2000);

  // Edit again
  console.log("3️⃣  Editing again...");
  await signal.editMessage(threadId, sent.id, "Hello from the Signal adapter! ✏️✏️ (edited twice)");
  console.log("   Edited again.");

  await delay(1000);

  // Fetch from cache
  console.log("4️⃣  Fetching from cache...");
  const fetched = await signal.fetchMessage(threadId, sent.id);
  console.log(`   Cached text: "${fetched?.text}"`);
  console.log(`   Edited: ${fetched?.metadata.edited}`);

  await delay(2000);

  // Delete
  console.log("5️⃣  Deleting message...");
  await signal.deleteMessage(threadId, sent.id);
  console.log("   Deleted.");

  // Verify deletion from cache
  const afterDelete = await signal.fetchMessage(threadId, sent.id);
  console.log(`   Still in cache: ${afterDelete !== null}`);

  console.log("\n✅ Done!");
  await bot.shutdown();
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
