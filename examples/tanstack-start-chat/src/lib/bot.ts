import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { createWebAdapter } from "@chat-adapter/web";
import { chat } from "@tanstack/ai";
import { vercelGatewayText } from "@tanstack/ai-vercel-gateway";
import { Chat, type Message, type Thread } from "chat";
import { toTanStackMessages } from "chat/ai/tanstack";
import { getCurrentTime } from "./tools";

const state = process.env.REDIS_URL
  ? createRedisState({
      url: process.env.REDIS_URL,
      keyPrefix: "chat-sdk-tanstack-start",
    })
  : createMemoryState();

const userName = process.env.BOT_USERNAME || "mybot";

export const bot = new Chat({
  userName,
  adapters: {
    // Reads SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET from the environment
    ...(process.env.SLACK_SIGNING_SECRET
      ? { slack: createSlackAdapter() }
      : {}),
    // Speaks AG-UI so TanStack AI's useChat can connect at /api/webhooks/web.
    // The demo uses a fixed user; replace getUser with your real auth.
    web: createWebAdapter({
      userName,
      protocol: "ag-ui",
      getUser: () => ({ id: "demo", name: "Demo User" }),
    }),
  },
  state,
  logger: "info",
});

async function respond(thread: Thread): Promise<void> {
  // thread.messages is newest first and falls back to Chat SDK's history
  // cache for adapters without a history API, such as the web adapter.
  const history: Message[] = [];
  for await (const message of thread.messages) {
    history.unshift(message);
    if (history.length === 20) {
      break;
    }
  }

  const stream = chat({
    adapter: vercelGatewayText("anthropic/claude-sonnet-5"),
    systemPrompts: [
      "You are a friendly assistant built with Chat SDK and TanStack AI. Keep replies short.",
    ],
    messages: await toTanStackMessages(history, {
      includeNames: true,
    }),
    tools: [getCurrentTime],
  });

  await thread.post(stream);
}

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await respond(thread);
});

bot.onSubscribedMessage(async (thread) => {
  await respond(thread);
});

bot.onDirectMessage(async (thread) => {
  await respond(thread);
});
