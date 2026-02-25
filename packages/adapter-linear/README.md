# @chat-adapter/linear

[![npm version](https://img.shields.io/npm/v/@chat-adapter/linear)](https://www.npmjs.com/package/@chat-adapter/linear)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/linear)](https://www.npmjs.com/package/@chat-adapter/linear)

Linear adapter for [Chat SDK](https://chat-sdk.dev/docs). Enables bots to respond to @mentions in Linear issue comment threads.

## Installation

```bash
npm install chat @chat-adapter/linear
```

## Usage

```typescript
import { Chat } from "chat";
import { createLinearAdapter } from "@chat-adapter/linear";

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    linear: createLinearAdapter({
      apiKey: process.env.LINEAR_API_KEY!,
      webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
      userName: "my-bot",
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Linear!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/linear](https://chat-sdk.dev/docs/adapters/linear).

## License

MIT
