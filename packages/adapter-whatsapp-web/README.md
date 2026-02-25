# @chat-adapter/whatsapp-web

WhatsApp Web adapter for [Chat SDK](https://chat-sdk.dev/docs). Uses [whatsapp-web.js](https://wwebjs.dev/) to connect via WhatsApp Web (Puppeteer-based).

## Installation

```bash
npm install chat @chat-adapter/whatsapp-web
```

## Usage

Unlike Slack or Teams, WhatsApp uses a real-time connection instead of webhooks. Call `adapter.start()` after initialization and scan the QR code with your phone.

```typescript
import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp-web";

const adapter = createWhatsAppAdapter({
  userName: "My Bot",
  sessionPath: process.env.WHATSAPP_SESSION_PATH ?? ".wwebjs_auth",
});

const bot = new Chat({
  userName: "My Bot",
  adapters: { whatsapp: adapter },
  state: yourStateAdapter,
});

await bot.initialize();
await adapter.start();

// QR code available via adapter.getQRCode() - display for user to scan
// Once connected, adapter.isConnected() returns true

bot.onNewMessage(/.*/, async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Echo: ${message.text}`);
});
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | `Logger` | `ConsoleLogger("info")` | Logger instance |
| `userName` | `string` | `"bot"` | Bot display name |
| `sessionPath` | `string` | `".wwebjs_auth"` or `WHATSAPP_SESSION_PATH` | Path for session persistence |
| `puppeteerOptions` | `object` | `{}` | Options passed to Puppeteer |

## Thread ID Format

`whatsapp:{chatId}`

- DMs: `whatsapp:1234567890@c.us`
- Groups: `whatsapp:1234567890-1234567890@g.us`

## Features

- **Messages**: Send and receive text, markdown (`*bold*`, `_italic_`, `~strikethrough~`), files
- **Reactions**: Add and remove emoji reactions
- **Typing indicator**: `thread.startTyping()`
- **Message history**: `adapter.fetchMessages()`
- **Cards**: Rendered as text fallback (WhatsApp has no native cards)

## Limitations

- **No message editing**: WhatsApp Web API does not support editing messages
- **No webhooks**: Uses WebSocket-style events; `handleWebhook` returns a status response only
- **Persistent process**: Requires a long-running Node process (not suitable for serverless)
- **Puppeteer/Chrome**: whatsapp-web.js uses headless Chrome

## Testing

```bash
# Unit tests (no WhatsApp connection)
pnpm --filter @chat-adapter/whatsapp-web test
```

A live test script is available at `scripts/test-live.ts` for manual verification. It requires `@chat-adapter/state-memory`, `tsx`, and `qrcode-terminal` as dev dependencies. Have another phone or account send a message to your linked number—messaging yourself does not work, as the SDK skips messages from the bot.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WHATSAPP_SESSION_PATH` | Session storage path (default: `.wwebjs_auth`) |

## License

MIT
