/**
 * 08 — Echo bot (WebSocket)
 *
 * A simple bot using WebSocket receive that:
 * - Echoes DM messages back
 * - Echoes group messages when @mentioned
 * - Reacts to incoming reactions with 🤝
 * - Handles edits by showing the diff
 *
 * Ctrl+C to stop.
 */
import { createSignalAdapter } from "@chat-adapter/signal";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { PHONE_NUMBER, SERVICE_URL } from "./env";
import { connectSignalWebSocket } from "./ws";

async function main() {
  const signal = createSignalAdapter({
    phoneNumber: PHONE_NUMBER!,
    baseUrl: SERVICE_URL,
    userName: "echobot",
  });

  const bot = new Chat({
    userName: "echobot",
    adapters: { signal },
    state: createMemoryState(),
    logger: "info",
  });

  // Subscribe to threads on first mention
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    console.log(`🔔 Subscribed to thread: ${thread.id}`);

    await thread.startTyping();
    await thread.post(`👋 Hi ${message.author.userName}! I'm now listening here. Send me messages and I'll echo them back.`);
  });

  // Echo messages in subscribed threads (DMs + groups where mentioned)
  bot.onSubscribedMessage(async (thread, message) => {
    // Skip bot's own messages
    if (message.author.isMe) {
      return;
    }

    // For non-DM threads, only respond if mentioned or it's Signal/Telegram
    if (!(thread.isDM || thread.adapter.name === "signal" || message.isMention)) {
      return;
    }

    const prefix = message.metadata.edited ? "✏️ [edited]" : "🔊";

    // Echo with typing indicator
    await thread.startTyping();

    if (message.attachments.length > 0) {
      const attList = message.attachments
        .map((a) => `${a.type}: ${a.name ?? a.mimeType ?? "file"}`)
        .join(", ");
      await thread.post(`${prefix} You said: "${message.text}"\n📎 Attachments: ${attList}`);
    } else {
      await thread.post(`${prefix} You said: "${message.text}"`);
    }

    // Show cached message count
    const cached = await signal.fetchMessages(thread.id, { limit: 100 });
    console.log(`   📚 ${cached.messages.length} messages cached for this thread`);
  });

  // React back to reactions
  bot.onReaction(async (event) => {
    if (!event.added) {
      return;
    }

    console.log(`${event.rawEmoji} from ${event.user.userName}`);

    try {
      await event.adapter.addReaction(event.threadId, event.messageId, "🤝");
    } catch (err) {
      console.warn(`   ⚠️  Could not add reaction: ${(err as Error).message}`);
    }
  });

  // Auto-subscribe and echo on any new message (DMs and groups)
  bot.onNewMessage(/./, async (thread, message) => {
    if (message.author.isMe) {
      return;
    }

    await thread.subscribe();
    const label = thread.isDM ? "DM" : "group";
    await thread.post(`👋 Echo bot here (${label})! You said: "${message.text}"`);
  });

  await bot.initialize();

  console.log("🤖 Echo bot started! Listening via WebSocket...");
  console.log("   Send a message from your Signal app to test.");
  console.log("   Ctrl+C to stop.\n");

  const ws = connectSignalWebSocket(signal, SERVICE_URL, PHONE_NUMBER!);

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\n🛑 Shutting down...");
      resolve();
    });
  });

  ws.close();
  await bot.shutdown();
  console.log("✅ Stopped.");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
