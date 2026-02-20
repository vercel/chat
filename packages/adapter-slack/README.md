# @chat-adapter/slack

[![npm version](https://img.shields.io/npm/v/@chat-adapter/slack)](https://www.npmjs.com/package/@chat-adapter/slack)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/slack)](https://www.npmjs.com/package/@chat-adapter/slack)

Slack adapter for [Chat SDK](https://chat-sdk.dev/docs). Supports single-workspace and multi-workspace OAuth deployments.

## Installation

```bash
npm install chat @chat-adapter/slack
```

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Slack!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/slack](https://chat-sdk.dev/docs/adapters/slack).

## License

MIT
