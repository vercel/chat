# @chat-adapter/github

[![npm version](https://img.shields.io/npm/v/@chat-adapter/github)](https://www.npmjs.com/package/@chat-adapter/github)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/github)](https://www.npmjs.com/package/@chat-adapter/github)

GitHub adapter for [Chat SDK](https://chat-sdk.dev/docs). Enables bots to respond to @mentions in GitHub PR and issue comment threads.

## Installation

```bash
npm install chat @chat-adapter/github
```

## Usage

```typescript
import { Chat } from "chat";
import { createGitHubAdapter } from "@chat-adapter/github";

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    github: createGitHubAdapter({
      token: process.env.GITHUB_TOKEN!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
      userName: "my-bot",
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from GitHub!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/github](https://chat-sdk.dev/docs/adapters/github).

## License

MIT
