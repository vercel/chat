/** @jsxImportSource chat */

import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { Actions, Button, Card, CardText, Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { agent } from "./agent";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createTelegramAdapter } from "@chat-adapter/telegram";

export const bot = new Chat({
  userName: "Chat SDK Bot",
  adapters: {
    slack: createSlackAdapter(),
    discord: createDiscordAdapter(),
    telegram: createTelegramAdapter(),
    whatsapp: createWhatsAppAdapter(),
  },
  state: createRedisState(),
});

bot.onNewMention(async (thread, message) => {
  await thread.startTyping();
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.fullStream);
});

bot.onDirectMessage(async (thread, message) => {
  await thread.startTyping();
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.fullStream);
});
