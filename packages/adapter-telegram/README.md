# @chat-adapter/telegram

[![npm version](https://img.shields.io/npm/v/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)

Telegram adapter for [Chat SDK](https://chat-sdk.dev). Configure for bot webhooks and messaging.

## Installation

```bash
pnpm add @chat-adapter/telegram
```

## Usage

The adapter auto-detects `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME`, and `TELEGRAM_API_BASE_URL` from environment variables:

```typescript
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    telegram: createTelegramAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

## Webhook route

```typescript
import { bot } from "@/lib/bot";


export async function POST(request: Request): Promise<Response> {
  return bot.webhooks.telegram(request);
}
```

Configure this URL as your bot webhook in BotFather / Telegram API:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/webhooks/telegram",
    "secret_token": "your-secret-token"
  }'
```

## Polling (local development)

When developing locally you typically can't expose a public URL for Telegram to deliver webhooks to. Polling mode uses `getUpdates` to fetch messages directly from Telegram instead — no public endpoint needed.

The `longPolling` option is entirely optional. Sensible defaults are applied when omitted.

```typescript
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";

const telegram = createTelegramAdapter({
  mode: "polling",
  // Optional — fine-tune polling behavior:
  // longPolling: { timeout: 30, dropPendingUpdates: false },
});

const bot = new Chat({
  userName: "mybot",
  adapters: { telegram },
  state: createMemoryState(),
});

// Optional manual lifecycle control:
// await telegram.resetWebhook();
// await telegram.startPolling();
// await telegram.stopPolling();
```

### Auto mode

With `mode: "auto"` (the default), the adapter picks the right strategy for you. When deployed to a serverless environment like Vercel it uses webhooks; everywhere else (e.g. local dev) it falls back to polling automatically.

```typescript
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";

const telegram = createTelegramAdapter({
  mode: "auto", // default
});

export const bot = new Chat({
  userName: "mybot",
  adapters: { telegram },
  state: createMemoryState(),
});

// Call initialize() so polling can start in long-running local processes:
void bot.initialize();

console.log(telegram.runtimeMode); // "webhook" | "polling"
```

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | No* | Telegram bot token. Auto-detected from `TELEGRAM_BOT_TOKEN` |
| `secretToken` | No | Optional webhook secret token. Auto-detected from `TELEGRAM_WEBHOOK_SECRET_TOKEN` |
| `mode` | No | Adapter mode: `auto` (default), `webhook`, or `polling` |
| `longPolling` | No | Optional long polling config for `getUpdates` (`timeout`, `limit`, `allowedUpdates`, `deleteWebhook`, `dropPendingUpdates`, `retryDelayMs`) |
| `userName` | No | Bot username used for mention detection. Auto-detected from `TELEGRAM_BOT_USERNAME` or `getMe` |
| `apiBaseUrl` | No | Telegram API base URL. Auto-detected from `TELEGRAM_API_BASE_URL` |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*`botToken` is required — either via config or env vars.

## Environment variables

```bash
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
TELEGRAM_WEBHOOK_SECRET_TOKEN=your-webhook-secret
TELEGRAM_BOT_USERNAME=mybot
# Optional (self-hosted API gateway)
TELEGRAM_API_BASE_URL=https://api.telegram.org
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| File uploads | Single file (`sendDocument`) |
| Streaming | Post+Edit fallback |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Markdown + inline keyboard buttons |
| Buttons | Inline keyboard callbacks |
| Link buttons | Inline keyboard URLs |
| Select menus | No |
| Tables | ASCII |
| Fields | Yes |
| Images in cards | No |
| Modals | No |

### Conversations

| Feature | Supported |
|---------|-----------|
| Slash commands | No |
| Mentions | Yes |
| Add reactions | Yes |
| Remove reactions | Yes |
| Typing indicator | Yes |
| DMs | Yes |
| Ephemeral messages | No |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Cached |
| Fetch single message | Cached |
| Fetch thread info | Yes |
| Fetch channel messages | Cached |
| List threads | No |
| Fetch channel info | Yes |
| Post channel message | Yes |

## Notes

- Telegram does not expose full historical message APIs to bots. `fetchMessages` / `fetchChannelMessages` return adapter-cached messages from the current process.
- `listThreads` is not available for Telegram chats.
- Polling and webhooks are mutually exclusive in Telegram.
- `mode: "polling"` deletes webhook by default before calling `getUpdates`.
- `mode: "auto"` checks `getWebhookInfo`: if a webhook URL exists it uses webhook mode; if it is empty it falls back to polling on non-serverless runtimes without deleting webhook.
- If `getWebhookInfo` fails in `mode: "auto"`, the adapter stays in webhook mode (safe fallback).
- `Button` and `LinkButton` in card `Actions` render as inline keyboard buttons.
- Telegram callback data is limited to 64 bytes. Keep button `id`/`value` payloads short.
- Other rich card elements (images/select menus/radios) render as fallback text only.

## License

MIT
