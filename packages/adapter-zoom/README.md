# @chat-adapter/zoom

[![npm version](https://img.shields.io/npm/v/@chat-adapter/zoom)](https://www.npmjs.com/package/@chat-adapter/zoom)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/zoom)](https://www.npmjs.com/package/@chat-adapter/zoom)

Zoom Team Chat adapter for [Chat SDK](https://chat-sdk.dev)

## Installation

```bash
pnpm add @chat-adapter/zoom
```

## Usage

```typescript
import { Chat } from "chat";
import { createZoomAdapter } from "@chat-adapter/zoom";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    zoom: createZoomAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from Zoom!");
});
```

When using `createZoomAdapter()` without arguments, credentials are auto-detected from environment variables.

## Zoom Marketplace app setup

1. Go to [marketplace.zoom.us](https://marketplace.zoom.us) → Build App → Account-level app (Server-to-Server OAuth + Chatbot)
2. Under **App Credentials**, copy **Client ID**, **Client Secret**, and note your **Account ID**
3. Under **Bot Endpoint URL**, set to `https://your-domain.com/api/webhooks/zoom` and copy the **Robot JID**
4. Under **Feature** → **Event Subscriptions**, add endpoint `https://your-domain.com/api/webhooks/zoom` and subscribe to events: `bot_notification`, `team_chat.app_mention`
5. Under **Feature** → **Event Subscriptions**, copy the **Secret Token** (this becomes `ZOOM_WEBHOOK_SECRET_TOKEN`)
6. Add required OAuth scopes (see Scopes section below) and activate the app

## Required scopes

| Scope | Purpose |
|-------|---------|
| `imchat:bot` | Send bot messages to channels and DMs |
| `team_chat:read:app_mention:admin` | Receive app_mention events |
| `team_chat:write:message:admin` | Send, edit, and delete messages |

## Webhook setup

```typescript
// app/api/webhooks/zoom/route.ts
import { bot } from "@/lib/bot";
import { after } from "next/server";

export async function POST(request: Request) {
  return bot.adapters.zoom.handleWebhook(request, { waitUntil: after });
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZOOM_CLIENT_ID` | Yes | OAuth app Client ID |
| `ZOOM_CLIENT_SECRET` | Yes | OAuth app Client Secret |
| `ZOOM_ACCOUNT_ID` | Yes | Zoom account ID (account-level app) |
| `ZOOM_ROBOT_JID` | Yes | Bot's JID from Marketplace app settings |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | Yes | Webhook Secret Token from Event Subscriptions |
| `ZOOM_BOT_USERNAME` | No | Bot username for self-message detection (defaults to `zoom-bot`) |

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `clientId` | No* | OAuth app Client ID. Auto-detected from `ZOOM_CLIENT_ID` |
| `clientSecret` | No* | OAuth app Client Secret. Auto-detected from `ZOOM_CLIENT_SECRET` |
| `accountId` | No* | Zoom account ID. Auto-detected from `ZOOM_ACCOUNT_ID` |
| `robotJid` | No* | Bot's JID. Auto-detected from `ZOOM_ROBOT_JID` |
| `webhookSecretToken` | No* | Webhook secret token. Auto-detected from `ZOOM_WEBHOOK_SECRET_TOKEN` |
| `userName` | No | Bot username. Auto-detected from `ZOOM_BOT_USERNAME` (defaults to `zoom-bot`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Required at runtime — either via config or environment variable.

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes |
| Edit message | Yes |
| Delete message | Yes |
| Reply in thread | Yes |
| Streaming | Buffered (accumulates then sends) |

### Conversations

| Feature | Supported |
|---------|-----------|
| DMs | Yes (via bot_notification) |
| Channel mentions | Yes (via team_chat.app_mention) |
| DM thread replies | No (Zoom platform limitation — see Known Limitations) |
| Reactions | No (not implemented in v1) |
| Typing indicator | No (not implemented in v1) |

## Thread ID format

```
zoom:{channelId}:{messageId}
```

Examples:
- Channel message: `zoom:abc123@conference.xmpp.zoom.us:msg-id-456`
- DM: `zoom:{userJid}:{userJid}` (sender-based, since Zoom DM thread IDs are not exposed)

## Known limitations

**DM thread replies (THRD-03):** Zoom does not fire `chat_message.replied` for 1:1 DM thread replies. The adapter cannot subscribe to or receive threaded replies in DMs. Channel thread replies via `bot_notification` with a reply context work normally.

**Unicode HMAC verification bug (ZOOM-506645):** Zoom's servers may normalize Unicode characters (emoji, accented characters) differently before computing the HMAC. Payloads containing non-ASCII characters may fail signature verification. The adapter logs the raw body hex on verification failure to aid diagnosis. If this affects you, contact Zoom Support referencing ZOOM-506645.

## License

MIT
