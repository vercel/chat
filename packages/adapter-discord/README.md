# @chat-adapter/discord

[![npm version](https://img.shields.io/npm/v/@chat-adapter/discord)](https://www.npmjs.com/package/@chat-adapter/discord)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/discord)](https://www.npmjs.com/package/@chat-adapter/discord)

Discord adapter for [Chat SDK](https://chat-sdk.dev/docs). Supports HTTP Interactions and Gateway WebSocket for receiving messages.

## Installation

```bash
npm install chat @chat-adapter/discord
```

## Usage

```typescript
import { Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    discord: createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN!,
      publicKey: process.env.DISCORD_PUBLIC_KEY!,
      applicationId: process.env.DISCORD_APPLICATION_ID!,
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Discord!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/discord](https://chat-sdk.dev/docs/adapters/discord).

## License

MIT
