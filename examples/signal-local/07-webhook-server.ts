/**
 * 07 — Webhook server (alternative to WebSocket)
 *
 * Starts an HTTP server on port 3000 that receives Signal webhooks.
 * Use this if you prefer webhook mode over WebSocket.
 *
 * Configure signal-cli-rest-api with:
 *   RECEIVE_WEBHOOK_URL=http://host.docker.internal:3000/webhook
 *
 * (Use host.docker.internal if signal-cli-rest-api runs in Docker)
 */
import { createServer } from "node:http";
import { createSignalAdapter } from "@chat-adapter/signal";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { PHONE_NUMBER, SERVICE_URL } from "./env";

const PORT = Number(process.env.PORT ?? 3000);

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

  // Log incoming messages
  bot.onNewMessage(/./, async (thread, message) => {
    console.log(
      `📩 [${thread.isDM ? "DM" : "group"}] ${message.author.userName}: ${message.text}`
    );
  });

  bot.onReaction(async (event) => {
    console.log(
      `${event.added ? "➕" : "➖"} Reaction: ${event.rawEmoji} by ${event.user.userName}`
    );
  });

  await bot.initialize();

  // Create HTTP server
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString();

      // Convert to a Web Request for the adapter
      const webRequest = new Request(`http://localhost:${PORT}/webhook`, {
        method: "POST",
        headers: Object.fromEntries(
          Object.entries(req.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        ),
        body,
      });

      const response = await signal.handleWebhook(webRequest);
      res.writeHead(response.status);
      res.end(await response.text());
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    console.log(`\n🌐 Webhook server listening on http://localhost:${PORT}/webhook`);
    console.log("   Configure signal-cli-rest-api with:");
    console.log(`   RECEIVE_WEBHOOK_URL=http://host.docker.internal:${PORT}/webhook`);
    console.log("\n   Ctrl+C to stop.\n");
  });

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\n🛑 Stopping...");
      server.close();
      resolve();
    });
  });

  await bot.shutdown();
  console.log("✅ Stopped.");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
