import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { agent } from "./agent";

export const bot = new Chat({
  userName: process.env.BOT_USERNAME ?? "agent",
  // Reads SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET from the environment.
  // agentView matches the agent_view feature in slack-manifest.yml.
  adapters: { slack: createSlackAdapter({ agentView: true }) },
  // Reads REDIS_URL. Redis keeps each thread's agent session across deploys.
  state: createRedisState(),
  // Run turns on a thread one at a time. Messages sent while the agent is
  // busy are delivered together with the next turn.
  concurrency: "queue",
});

bot.onNewMention(async (thread, message, context) => {
  await thread.subscribe();
  await agent.reply(thread, message, context);
});

bot.onSubscribedMessage((thread, message, context) =>
  agent.reply(thread, message, context)
);

bot.onDirectMessage((thread, message, _channel, context) =>
  agent.reply(thread, message, context)
);

// Approve/Deny buttons on tool approval cards.
bot.onAction([...agent.actionIds], (event) => agent.handleAction(event));
