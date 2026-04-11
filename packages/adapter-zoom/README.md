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

### Prerequisites

- Zoom account with developer access
- A deployed URL or ngrok tunnel for local testing (e.g. `https://your-domain.com`)

### Steps

1. **Create the app**
   - Go to [marketplace.zoom.us](https://marketplace.zoom.us) → **Develop** → **Build App**
   - Select **General App**
   - In **Basic Information**, set management type to **Admin-managed**

2. **Get core credentials** — from **Basic Information** → **App Credentials**
   - Copy **Client ID** → `ZOOM_CLIENT_ID`
   - Copy **Client Secret** → `ZOOM_CLIENT_SECRET`
   - Copy **Account ID** → `ZOOM_ACCOUNT_ID`

3. **Configure the bot endpoint and get Robot JID** — from **Surface** → **Team Chat Subscription**
   - Enable **Team Chat Subscription**
   - Set **Bot Endpoint URL** to `https://your-domain.com/api/webhooks/zoom`
   - Copy the **Bot JID** that appears → `ZOOM_ROBOT_JID`

4. **Get the webhook secret** — from **Features** → **Access** → **Token**
   - Copy the **Secret Token** → `ZOOM_WEBHOOK_SECRET_TOKEN`

5. **Add event subscriptions** — from **Features** → **Access** → **Event Subscription**
   - Enable Event Subscription
   - Set webhook URL to `https://your-domain.com/api/webhooks/zoom`
   - Subscribe to: `bot_notification`, `team_chat.app_mention`

6. **Add scopes** — from **Scopes** (see [Required scopes](#required-scopes) below)

7. **Authorize the app** — from **Local Test** → **Add app now**
   - Complete the OAuth flow to install the bot in your account

### Environment variables checklist

```bash
ZOOM_CLIENT_ID=          # Basic Information → App Credentials
ZOOM_CLIENT_SECRET=      # Basic Information → App Credentials
ZOOM_ACCOUNT_ID=         # Basic Information → App Credentials
ZOOM_ROBOT_JID=          # Surface → Team Chat Subscription → Bot JID
ZOOM_WEBHOOK_SECRET_TOKEN= # Features → Access → Token → Secret Token
```

### Local testing with ngrok

```bash
ngrok http 3000
# Use the https:// forwarding URL as your Bot Endpoint URL and event subscription URL
```

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
- DM: `zoom:{userJid}:{event_ts}` (sender-based channel with event timestamp as message ID)

## Known limitations

**DM thread replies (THRD-03):** Zoom does not fire `chat_message.replied` for 1:1 DM thread replies. The adapter cannot subscribe to or receive threaded replies in DMs. Channel thread replies via `bot_notification` with a reply context work normally.

**Unicode HMAC verification bug (ZOOM-506645):** Zoom's servers may normalize Unicode characters (emoji, accented characters) differently before computing the HMAC. Payloads containing non-ASCII characters may fail signature verification. The adapter logs the raw body hex on verification failure to aid diagnosis. If this affects you, contact Zoom Support referencing ZOOM-506645.

## Troubleshooting

**Webhook signature verification fails**
- Ensure you're reading the raw request body before any JSON parsing
- Emoji or non-ASCII characters in payloads may fail HMAC verification due to a Zoom server-side Unicode normalization issue (ZOOM-506645) — check debug logs for raw body hex

**Bot not receiving events**
- Confirm the Bot Endpoint URL in **Surface → Team Chat Subscription** matches your deployment URL
- Confirm the event subscription URL in **Features → Access → Event Subscription** matches too
- Verify the app is installed via **Local Test → Add app now** (OAuth flow must complete)

**Bot appears in Zoom but doesn't respond**
- Check that `ZOOM_WEBHOOK_SECRET_TOKEN` matches the Secret Token in **Features → Access → Token**
- Ensure the app is marked as **Admin-managed** in Basic Information

**DM thread replies not received**
- This is a confirmed Zoom platform limitation — `chat_message.replied` is not fired for 1:1 DM thread replies. See [Known limitations](#known-limitations).

**`postMessage` returns 401**
- The `/v2/im/chat/messages` endpoint requires a `client_credentials` token. Ensure you're not using `account_credentials` grant type.

## License

MIT
