/**
 * 01 — Health check & account verification
 *
 * Verifies connectivity to signal-cli-rest-api and that
 * the configured phone number is registered.
 */
import { createSignalAdapter } from "@chat-adapter/signal";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { PHONE_NUMBER, SERVICE_URL } from "./env";

async function main() {
  console.log(`📡 Connecting to signal-cli-rest-api at ${SERVICE_URL}`);
  console.log(`📱 Using phone number: ${PHONE_NUMBER}`);

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

  console.log("\n✅ Health check passed!");
  console.log(`   Bot user ID: ${signal.botUserId}`);
  console.log(`   Bot username: ${signal.userName}`);

  await bot.shutdown();
}

main().catch((err) => {
  console.error("\n❌ Health check failed:", err.message);
  process.exit(1);
});
