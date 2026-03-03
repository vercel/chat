/**
 * 05 — Group messaging
 *
 * Posts a message to a Signal group and fetches group metadata.
 *
 * Usage:
 *   SIGNAL_GROUP_ID="group.abc123==" npx tsx 05-group.ts
 *
 * To find your group IDs:
 *   curl http://localhost:8080/v1/groups/YOUR_PHONE_NUMBER
 */
import { createSignalAdapter } from "@chat-adapter/signal";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { GROUP_ID, PHONE_NUMBER, SERVICE_URL } from "./env";

if (!GROUP_ID) {
  console.error("❌ SIGNAL_GROUP_ID is required for this example");
  console.error('   Example: SIGNAL_GROUP_ID="group.abc123==" npx tsx 05-group.ts');
  console.error(`   List groups: curl ${SERVICE_URL}/v1/groups/${encodeURIComponent(PHONE_NUMBER!)}`);
  process.exit(1);
}

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

  // Fetch group info
  console.log(`📋 Fetching group info for: ${GROUP_ID}`);
  try {
    const info = await signal.fetchChannelInfo(GROUP_ID!);
    console.log(`   Name: ${info.name}`);
    console.log(`   Members: ${info.memberCount ?? "unknown"}`);
    console.log(`   Is DM: ${info.isDM}`);
  } catch (err) {
    console.warn(`   ⚠️  Could not fetch group info: ${(err as Error).message}`);
  }

  // Post to group
  const threadId = signal.encodeThreadId({ chatId: GROUP_ID! });
  console.log(`\n📨 Posting to group thread: ${threadId}`);
  const sent = await signal.postMessage(threadId, "Hello group! 👋 This is a test from the Signal adapter.");
  console.log(`   Message ID: ${sent.id}`);

  // Fetch messages from cache
  const result = await signal.fetchMessages(threadId, { limit: 5 });
  console.log(`\n📚 Cached messages in thread: ${result.messages.length}`);
  for (const msg of result.messages) {
    console.log(`   [${msg.author.userName}] ${msg.text}`);
  }

  console.log("\n✅ Done!");
  await bot.shutdown();
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
