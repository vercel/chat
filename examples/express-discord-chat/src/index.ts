import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import express from "express";

const PORT = Number(process.env.PORT ?? 3001);

const discord = createDiscordAdapter({
  userName: process.env.BOT_USERNAME ?? "express-chat-sdk-bot",
});

const chat = new Chat({
  userName: process.env.BOT_USERNAME ?? "express-chat-sdk-bot",
  adapters: { discord },
  state: createMemoryState(),
});

chat.onSlashCommand("/hello", async (event) => {
  await event.channel.post(
    `Hello ${event.user.fullName}! This came from Express + Chat SDK.`
  );
});

chat.onSlashCommand("/status", async (event) => {
  await event.channel.post(
    `Bot is running. Adapter: ${event.adapter.name}. Channel: ${event.channel.id}`
  );
});

chat.onNewMention(async (thread, message) => {
  await thread.post(`Thanks for the mention, ${message.author.fullName}.`);
});

const app = express();

// Note: do NOT register a global `express.json()` middleware. It would parse
// the Discord webhook body first, leaving `req.body` as a JS object instead of
// raw bytes and breaking Ed25519 signature verification. Each route below opts
// in to the body parser it needs.

app.post(
  "/api/webhooks/discord",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else if (typeof value === "string") {
        headers.set(key, value);
      }
    }

    const request = new Request(
      `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      {
        method: "POST",
        headers,
        body: req.body as Buffer,
      }
    );

    const response = await chat.webhooks.discord(request);

    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }

    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  }
);

app.post("/api/messages/dm", express.json(), async (req, res) => {
  const userId = String(req.body?.userId ?? "");
  const text = String(req.body?.text ?? "");

  if (!(userId && text)) {
    res.status(400).json({ error: "userId and text are required" });
    return;
  }

  const dmThread = await chat.openDM(userId);
  await dmThread.post(text);

  res.json({ sent: true, userId });
});

await chat.initialize();

app.listen(PORT, () => {
  console.log(`Express Chat SDK example running on http://localhost:${PORT}`);
});
