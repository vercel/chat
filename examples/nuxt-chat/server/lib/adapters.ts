import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createWebAdapter, type WebAdapter } from "@chat-adapter/web";
import { ConsoleLogger } from "chat";

const logger = new ConsoleLogger("info");

export interface Adapters {
  slack?: SlackAdapter;
  web: WebAdapter;
}

export function buildAdapters(): Adapters {
  const adapters: Adapters = {
    web: createWebAdapter({
      userName: "Chat SDK Bot",
      logger: logger.child("web"),
      getUser: () => ({ id: "demo", name: "Demo User" }),
    }),
  };

  if (process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter({
      userName: "Chat SDK Bot",
      logger: logger.child("slack"),
      botToken: process.env.SLACK_BOT_TOKEN,
    });
  }

  return adapters;
}
