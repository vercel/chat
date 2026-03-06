# @chat-adapter/whatsapp

[![npm version](https://img.shields.io/npm/v/@chat-adapter/whatsapp)](https://www.npmjs.com/package/@chat-adapter/whatsapp)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/whatsapp)](https://www.npmjs.com/package/@chat-adapter/whatsapp)

WhatsApp adapter for [Chat SDK](https://chat-sdk.dev/docs), using the [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).

## Installation

```bash
npm install chat @chat-adapter/whatsapp
```

## Usage

```typescript
import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    whatsapp: createWhatsAppAdapter(),
  },
});
```

When using `createWhatsAppAdapter()` without arguments, credentials are auto-detected from environment variables.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Yes | Meta access token (permanent or system user token) |
| `WHATSAPP_APP_SECRET` | Yes | App secret for X-Hub-Signature-256 verification |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Bot's phone number ID from Meta dashboard |
| `WHATSAPP_VERIFY_TOKEN` | Yes | User-defined secret for webhook verification handshake |

## Webhook setup

WhatsApp uses two webhook mechanisms:

1. **Verification handshake** (GET) — Meta sends a `hub.verify_token` challenge that must match your `WHATSAPP_VERIFY_TOKEN`.
2. **Event delivery** (POST) — incoming messages, reactions, and interactive responses, verified via `X-Hub-Signature-256`.

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.adapters.whatsapp.handleWebhook(request);
}

export async function POST(request: Request) {
  return bot.adapters.whatsapp.handleWebhook(request);
}
```

## Interactive messages

Card elements are automatically converted to WhatsApp interactive messages:

- **3 or fewer buttons** — rendered as WhatsApp reply buttons
- **More than 3 buttons** — falls back to formatted text

## Limitations

- **No message editing** — `editMessage()` sends a new message as fallback
- **No message deletion** — `deleteMessage()` is a no-op
- **No message history API** — `fetchMessages()` returns empty results

## Thread ID format

```
whatsapp:{phoneNumberId}:{userWaId}
```

Example: `whatsapp:1234567890:15551234567`

## Documentation

Full setup instructions at [chat-sdk.dev/docs/adapters/whatsapp](https://chat-sdk.dev/docs/adapters/whatsapp).

## License

MIT
