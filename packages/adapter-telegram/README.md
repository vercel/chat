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

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | No* | Telegram bot token. Auto-detected from `TELEGRAM_BOT_TOKEN` |
| `secretToken` | No | Optional webhook secret token. Auto-detected from `TELEGRAM_WEBHOOK_SECRET_TOKEN` |
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

| Feature | Supported |
|---------|-----------|
| Mentions | Yes |
| Reactions (add/remove) | Yes |
| Cards | Text fallback + inline keyboard buttons/link buttons |
| Modals | No |
| Streaming | Post+Edit fallback |
| DMs | Yes |
| Ephemeral messages | No |
| File uploads | Single file (`sendDocument`) |
| Typing indicator | Yes |
| Message history | Cached messages seen/sent by the adapter |

## Notes

- Telegram does not expose full historical message APIs to bots. `fetchMessages` / `fetchChannelMessages` return adapter-cached messages from the current process.
- `listThreads` is not available for Telegram chats.
- `Button` and `LinkButton` in card `Actions` render as inline keyboard buttons.
- Telegram callback data is limited to 64 bytes. Keep button `id`/`value` payloads short.
- Other rich card elements (images/select menus/radios) render as fallback text only.

## License

MIT
