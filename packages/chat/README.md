# chat

[![npm version](https://img.shields.io/npm/v/chat)](https://www.npmjs.com/package/chat)
[![npm downloads](https://img.shields.io/npm/dm/chat)](https://www.npmjs.com/package/chat)

Core SDK for building multi-platform chat bots. Provides the `Chat` class, event handlers, JSX card runtime, emoji helpers, and type-safe message formatting.

## Installation

```bash
npm install chat
```

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL! }),
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

## AI coding agent support

If you use an AI coding agent like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you can teach it about Chat SDK:

```bash
npx skills add vercel/chat
```

## Documentation

Full documentation is available at [chat-sdk.dev/docs](https://chat-sdk.dev/docs).

- [Usage](https://chat-sdk.dev/docs/usage) — event handlers, threads, messages, channels
- [Chat API](https://chat-sdk.dev/docs/api/chat) — full `Chat` class reference
- [Cards](https://chat-sdk.dev/docs/cards) — JSX-based interactive cards
- [Streaming](https://chat-sdk.dev/docs/streaming) — AI SDK integration
- [Emoji](https://chat-sdk.dev/docs/emoji) — cross-platform emoji helpers

## License

MIT
