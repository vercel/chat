# @chat-adapter/zalo

[![npm version](https://img.shields.io/npm/v/@chat-adapter/zalo)](https://www.npmjs.com/package/@chat-adapter/zalo)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/zalo)](https://www.npmjs.com/package/@chat-adapter/zalo)

Zalo Bot adapter for [Chat SDK](https://chat-sdk.dev), using the [Zalo Bot Platform API](https://bot.zapps.me/docs).

## Installation

```bash
pnpm add @chat-adapter/zalo
```

## Usage

```typescript
import { Chat } from "chat";
import { createZaloAdapter } from "@chat-adapter/zalo";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    zalo: createZaloAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

When using `createZaloAdapter()` without arguments, credentials are auto-detected from environment variables.

## Zalo Bot setup

### 1. Create a Zalo Bot

1. Go to [bot.zapps.me](https://bot.zapps.me) and sign in with your Zalo account
2. Create a new bot and note your **Bot Token** (format: `12345689:abc-xyz`)
3. Go to **Webhooks** settings and set your webhook URL

### 2. Configure webhooks

1. In the Zalo Bot dashboard, navigate to **Webhooks**
2. Set **Webhook URL** to `https://your-domain.com/api/webhooks/zalo`
3. Set a **Secret Token** of your choice (8–256 characters) — this becomes `ZALO_WEBHOOK_SECRET`
4. Subscribe to the message events you need (`message.text.received`, `message.image.received`, etc.)

### 3. Get credentials

From your Zalo Bot dashboard, copy:

- **Bot Token** as `ZALO_BOT_TOKEN`
- The **Secret Token** you set in the webhook config as `ZALO_WEBHOOK_SECRET`

## Configuration

All options are auto-detected from environment variables when not provided.

| Option          | Required | Description                                                                       |
| --------------- | -------- | --------------------------------------------------------------------------------- |
| `botToken`      | No\*     | Zalo bot token. Auto-detected from `ZALO_BOT_TOKEN`                               |
| `webhookSecret` | No\*     | Secret token for webhook verification. Auto-detected from `ZALO_WEBHOOK_SECRET`   |
| `userName`      | No       | Bot display name. Auto-detected from `ZALO_BOT_USERNAME` (defaults to `zalo-bot`) |
| `logger`        | No       | Logger instance (defaults to `ConsoleLogger("info")`)                             |

\*Required at runtime — either via config or environment variable.

## Environment variables

```bash
ZALO_BOT_TOKEN=12345689:abc-xyz      # Bot token from Zalo Bot dashboard
ZALO_WEBHOOK_SECRET=your-secret      # Secret token for X-Bot-Api-Secret-Token verification
ZALO_BOT_USERNAME=mybot              # Optional, defaults to "zalo-bot"
```

## Webhook setup

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function POST(request: Request) {
  return bot.webhooks.zalo(request);
}
```

Zalo delivers all events via POST requests with an `X-Bot-Api-Secret-Token` header. The adapter verifies this header using timing-safe comparison before processing any payload.

## Features

### Messaging

| Feature        | Supported                         |
| -------------- | --------------------------------- |
| Post message   | Yes                               |
| Edit message   | No (Zalo limitation)              |
| Delete message | No (Zalo limitation)              |
| Streaming      | Buffered (accumulates then sends) |
| Auto-chunking  | Yes (splits at 2000 chars)        |

### Rich content

| Feature             | Supported          |
| ------------------- | ------------------ |
| Interactive buttons | No (text fallback) |
| Cards               | Text fallback      |
| Tables              | ASCII              |

### Conversations

| Feature          | Supported              |
| ---------------- | ---------------------- |
| Reactions        | No (Zalo limitation)   |
| Typing indicator | Yes (`sendChatAction`) |
| DMs              | Yes                    |
| Group chats      | Yes                    |
| Open DM          | Yes                    |

### Incoming message types

| Type              | Supported                     |
| ----------------- | ----------------------------- |
| Text              | Yes                           |
| Images            | Yes (with optional caption)   |
| Stickers          | Yes (rendered as `[Sticker]`) |
| Unsupported types | Ignored gracefully            |

### Message history

| Feature           | Supported                |
| ----------------- | ------------------------ |
| Fetch messages    | No (Zalo API limitation) |
| Fetch thread info | Yes                      |

## Cards

Zalo has no interactive message API. All card elements are rendered as plain text:

```
CARD TITLE

Body text here...

• Button 1 label
• Button 2 label: https://example.com

---
```

## Thread ID format

```
zalo:{chatId}
```

Example: `zalo:1234567890`

The `chatId` is the conversation ID from the Zalo webhook payload. For group chats it is the group ID; for private chats it is the user ID.

## Notes

- Zalo does not expose message history APIs to bots. `fetchMessages` returns an empty array.
- All formatting (bold, italic, code blocks) is stripped to plain text — Zalo renders no markdown.
- The bot token is embedded in the API URL path and is never logged.
- `isDM()` always returns `true` — Zalo thread IDs do not encode chat type.

## Troubleshooting

### Webhook verification failing

- Confirm `ZALO_WEBHOOK_SECRET` matches the value you entered in the Zalo Bot dashboard
- The adapter compares the `X-Bot-Api-Secret-Token` header using a timing-safe byte comparison — ensure the secret contains only ASCII characters and has no trailing whitespace

### Messages not arriving

- Verify your webhook URL is reachable and returns `200 OK`
- Check that the event types you need are subscribed in the Zalo Bot dashboard

### "Zalo API error" on send

- Confirm `ZALO_BOT_TOKEN` is correct — it should be in `12345689:abc-xyz` format
- The adapter calls `getMe` during `initialize()` to validate the token; check logs for initialization errors

## License

MIT
