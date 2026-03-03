/**
 * 06 — WebSocket receive loop
 *
 * Connects to signal-cli-rest-api via WebSocket (json-rpc mode)
 * and prints incoming messages, reactions, and edits.
 *
 * Send messages from another Signal client to see them arrive.
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
  });

  const bot = new Chat({
    userName: "test-bot",
    adapters: { signal },
    state: createMemoryState(),
    logger: "info",
  });

  // Log every incoming message
  bot.onNewMention(async (_thread, message) => {
    console.log(`\n📩 [mention] ${message.author.userName}: ${message.text}`);
  });

  bot.onNewMessage(/./, async (thread, message) => {
    const label = message.metadata.edited ? "edited" : thread.isDM ? "DM" : "group";
    console.log(message)
    console.log(`\n📩 [${label}] ${message.author.userName}: ${message.text}`);
    if (message.attachments.length > 0) {
      for (const att of message.attachments) {
        console.log(`   📎 ${att.type}: ${att.name ?? att.mimeType ?? "unknown"} (${att.size ?? "?"} bytes)`);
      }
    }
  });

  bot.onReaction(async (event) => {
    console.log(
      `\n${event.added ? "➕" : "➖"} Reaction: ${event.rawEmoji} by ${event.user.userName} on message ${event.messageId}`
    );
  });

  await bot.initialize();

  console.log("🔄 Listening via WebSocket (Ctrl+C to stop)...\n");
  const ws = connectSignalWebSocket(signal, SERVICE_URL, PHONE_NUMBER!);

  // Wait for Ctrl+C
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\n🛑 Stopping...");
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
