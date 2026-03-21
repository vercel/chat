# @chat-adapter/linq

[![npm version](https://img.shields.io/npm/v/@chat-adapter/linq)](https://www.npmjs.com/package/@chat-adapter/linq)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/linq)](https://www.npmjs.com/package/@chat-adapter/linq)

Linq adapter for [Chat SDK](https://chat-sdk.dev), supporting iMessage, SMS, and RCS messaging via the Linq Partner API.

## Installation

```bash
pnpm add @chat-adapter/linq
```

The adapter includes the official [`@linqapp/sdk`](https://www.npmjs.com/package/@linqapp/sdk) as a dependency. You can also use the SDK directly for features the adapter doesn't cover (contact cards, voicememos, phone number management, etc.).

## Usage

The adapter auto-detects `LINQ_API_TOKEN`, `LINQ_SIGNING_SECRET`, and `LINQ_PHONE_NUMBER` from environment variables:

```typescript
import { Chat } from "chat";
import { createLinqAdapter } from "@chat-adapter/linq";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    linq: createLinqAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

## Webhook route

```typescript
// app/api/webhooks/linq/route.ts
import { bot } from "@/lib/bot";

export async function POST(request: Request): Promise<Response> {
  return bot.webhooks.linq(request);
}
```

Configure this URL as your webhook endpoint in the Linq partner dashboard.

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `apiToken` | No* | Linq API token. Auto-detected from `LINQ_API_TOKEN` |
| `signingSecret` | No | Webhook signing secret for signature verification. Auto-detected from `LINQ_SIGNING_SECRET` |
| `phoneNumber` | No | Bot phone number, required for `openDM` and `listThreads`. Auto-detected from `LINQ_PHONE_NUMBER` |
| `preferredService` | No | Preferred messaging service: `"iMessage"`, `"SMS"`, or `"RCS"`. Defaults to auto fallback (iMessage → RCS → SMS) |
| `userName` | No | Bot display name (defaults to `"bot"`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*`apiToken` is required — either via config or `LINQ_API_TOKEN` env var.

## Environment variables

```bash
LINQ_API_TOKEN=...
LINQ_SIGNING_SECRET=...      # Optional, for webhook signature verification
LINQ_PHONE_NUMBER=...        # Required for openDM and listThreads
```

## Webhook verification

When `signingSecret` is configured, the adapter verifies incoming webhooks using HMAC-SHA256 signatures. It checks the `x-webhook-signature` and `x-webhook-timestamp` headers and rejects requests with timestamps older than 5 minutes.

## Features

| Feature | Supported |
|---------|-----------|
| Mentions | Yes (all inbound messages treated as mentions) |
| Reactions (add/remove) | Yes |
| Cards | Text fallback |
| Modals | No |
| Slash commands | No |
| Streaming | Post+Edit fallback |
| DMs | Yes |
| Ephemeral messages | No |
| File uploads | Yes |
| Typing indicator | Yes |
| Message history | Yes |
| Fetch single message | Yes |
| List threads | Yes (requires `phoneNumber`) |

## Reactions

Linq supports a fixed set of reaction types that map to standard emoji names:

| Linq reaction | Emoji name |
|---------------|------------|
| `love` | `heart` |
| `like` | `thumbsup` |
| `dislike` | `thumbsdown` |
| `laugh` | `laughing` |
| `emphasize` | `exclamation` |
| `question` | `question` |

Reactions not in this list are sent as custom emoji.

## Thread ID format

Linq thread IDs follow the pattern `linq:{chatId}`.

## Notes

- Linq is an SMS/iMessage/RCS gateway — messages are plain text. Markdown formatting (bold, italic, links) is stripped to plain text automatically.
- Tables render as ASCII art in code blocks.
- All inbound messages are treated as mentions since Linq chats are direct conversations.
- `openDM` and `listThreads` require the `phoneNumber` config option.
- The adapter uses the Linq Partner API v3.
