# @chat-adapter/telegram

[![npm version](https://img.shields.io/npm/v/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)

Telegram adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
npm install chat @chat-adapter/telegram
```

## Usage

```typescript
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    telegram: createTelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
    }),
  },
});
```

Features include mentions, reactions, typing indicators, file uploads, and card fallback rendering with inline keyboard buttons for card actions.

## Polling mode

When developing locally, you typically can't expose a public URL for Telegram to send webhooks to. Polling mode uses `getUpdates` to fetch messages directly from Telegram instead — no public endpoint needed.

The `longPolling` option is entirely optional. Sensible defaults are applied when omitted.

```typescript
import { createMemoryState } from "@chat-adapter/state-memory";

const telegram = createTelegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  mode: "polling",
  // Optional — fine-tune polling behavior:
  // longPolling: { timeout: 30, dropPendingUpdates: false },
});

const bot = new Chat({
  userName: "mybot",
  adapters: { telegram },
  state: createMemoryState(),
});

// Optional manual control
await telegram.resetWebhook();
await telegram.startPolling();
await telegram.stopPolling();
```

### Auto mode

With `mode: "auto"` (the default), the adapter picks the right strategy for you. In a serverless environment like Vercel it uses webhooks; everywhere else (e.g. local dev) it falls back to polling.

```typescript
const telegram = createTelegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  mode: "auto", // default
});

const bot = new Chat({
  userName: "mybot",
  adapters: { telegram },
  state: createMemoryState(),
});

// Call initialize() so polling can start in long-running local processes:
void bot.initialize();

console.log(telegram.runtimeMode); // "webhook" | "polling"
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/telegram](https://chat-sdk.dev/docs/adapters/telegram).

## License

MIT
