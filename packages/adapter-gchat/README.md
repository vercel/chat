# @chat-adapter/gchat

[![npm version](https://img.shields.io/npm/v/@chat-adapter/gchat)](https://www.npmjs.com/package/@chat-adapter/gchat)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/gchat)](https://www.npmjs.com/package/@chat-adapter/gchat)

Google Chat adapter for [Chat SDK](https://chat-sdk.dev/docs). Supports service account authentication with optional Pub/Sub for receiving all messages.

## Installation

```bash
npm install chat @chat-adapter/gchat
```

## Usage

```typescript
import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    gchat: createGoogleChatAdapter({
      credentials: JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS!),
    }),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Google Chat!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/gchat](https://chat-sdk.dev/docs/adapters/gchat).

## License

MIT
