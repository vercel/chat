[![XChat adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/xchat/og)](https://chat-sdk.dev/adapters/official/xchat)

# @chat-adapter/xchat

> npm package: [`@chat-adapter/xchat`](https://www.npmjs.com/package/@chat-adapter/xchat)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

XChat (encrypted messaging) adapter for [Chat SDK](https://chat-sdk.dev), built on the [X API v2](https://docs.x.com/x-api/introduction) chat endpoints, the [X Activity API](https://docs.x.com/x-api/activity/introduction) for event delivery, and [`@xdevplatform/chat-xdk`](https://github.com/xdevplatform/chat-xdk) for encryption.

Every XChat conversation is encrypted. The adapter handles the full crypto lifecycle transparently: conversation-key extraction and caching, message decryption and signature verification, and encryption + signing on send.

Documentation: [chat-sdk.dev/adapters/official/xchat](https://chat-sdk.dev/adapters/official/xchat) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/xchat
```

## Scaffold with the CLI

To scaffold a new Chat SDK bot and add this adapter:

```bash
npx create-chat-sdk@latest my-bot
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createXChatAdapter } from "@chat-adapter/xchat";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    xchat: createXChatAdapter(),
  },
  state: createMemoryState(),
});

// DMs always
bot.onDirectMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});

// Group chats when the bot is @mentioned
bot.onNewMention(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

Wire the webhook route (e.g. `app/api/webhooks/xchat/route.ts` in Next.js):

```typescript
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.xchat(request);
}

export async function POST(request: Request) {
  return bot.webhooks.xchat(request);
}
```

When using `createXChatAdapter()` without arguments, credentials are auto-detected from environment variables. The bot's @handle is resolved from `GET /2/users/me` at startup, so mention detection works without any hardcoding.

## X Chat setup

### 1. Register encryption keys

The bot account needs registered public keys and a Juicebox-backed private-key store before it can participate in encrypted conversations:

1. Generate keypairs with `chat-xdk` (`generateKeypairs()`)
2. Register them via `POST /2/users/{id}/public_keys`
3. Store the private keys in Juicebox with a PIN (`chat.setup(pin)`)

The adapter unlocks the keys at startup with the same PIN (`XCHAT_PIN`). Registration is a one-time step per account — see the [chat-xdk documentation](https://github.com/xdevplatform/chat-xdk) for the full flow.

### 2. Create a webhook

Register a webhook URL so the X Activity API can deliver events ([docs](https://docs.x.com/x-api/webhooks/introduction)):

```bash
curl -X POST "https://api.x.com/2/webhooks" \
  -H "Authorization: Bearer $APP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/api/webhooks/xchat"}'
```

X validates the URL with a CRC challenge (see [Webhook route](#webhook-route) below), so the endpoint must be live before you create the webhook.

Webhooks and activity subscriptions can also be created and managed in the [X Developer Portal](https://developer.x.com/en/portal/dashboard) instead of via the API.

### 3. Subscribe to chat events

Create [activity subscriptions](https://docs.x.com/x-api/activity/create-x-activity-subscription) for the bot user with the bot's OAuth2 user token:

```bash
curl -X POST "https://api.x.com/2/activity/subscriptions" \
  -H "Authorization: Bearer $BOT_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "chat.received",
    "filter": {"user_id": "YOUR_BOT_USER_ID"},
    "tag": "bot-chat-received",
    "webhook_id": "YOUR_WEBHOOK_ID"
  }'
```

Subscribe to `chat.conversation_join` as well if you want the bot to post a welcome message when it is added to a group.

## Webhook route

X sends two kinds of requests:

1. **CRC challenge** (GET) — `?crc_token=...` must be answered with an HMAC-SHA256 of the token, keyed by your app's consumer secret. Handle this at the route level; it needs no adapter state.
2. **Event delivery** (POST) — chat events, verified by the adapter via the `x-twitter-webhooks-signature` header.

```typescript
import { createHmac } from "node:crypto";
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const crcToken = url.searchParams.get("crc_token");
  if (!crcToken) {
    return new Response("Missing crc_token", { status: 400 });
  }
  const hash = createHmac("sha256", process.env.X_CONSUMER_SECRET!)
    .update(crcToken)
    .digest("base64");
  return Response.json({ response_token: `sha256=${hash}` });
}

export async function POST(request: Request) {
  return bot.webhooks.xchat(request);
}
```

## Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` / `accessToken` | No* | OAuth2 user access token for the bot account. Auto-detected from `XCHAT_BOT_TOKEN` or `X_ACCESS_TOKEN` |
| `userId` | No* | Bot's numeric X user ID. Auto-detected from `XCHAT_USER_ID` or `X_USER_ID` |
| `pin` | No | Juicebox PIN; when set, keys unlock automatically during `initialize()`. Auto-detected from `XCHAT_PIN` |
| `consumerSecret` | No | App consumer secret for webhook signature verification. Auto-detected from `X_CONSUMER_SECRET`. When unset, incoming webhook POSTs are **not** signature-verified (a warning is logged at startup) |
| `editSafetyDelayMs` | No | Minimum age (ms) a freshly posted message must reach before its first edit is sent, so receiving clients have stored the original the edit targets. Defaults to `5000`; `0` disables the wait |
| `sendReadReceipts` | No | Send a read receipt for each delivered inbound message before handlers run (default `true`) |
| `userName` | No | Bot @handle for mention detection. Auto-detected from `X_BOT_USERNAME`, otherwise resolved from `GET /2/users/me` |
| `welcomeMessage` | No | Message posted when the bot joins a group. `false` disables; omitted uses a default that explains @mention-to-reply |
| `verifySignatures` | No | Require verifiable signatures on incoming messages (default `true`). `X_VERIFY_SIGNATURES=false` opts out |
| `signingKeyVersion` | No | Signing key version override. Normally fetched during `initialize()`. Auto-detected from `X_SIGNING_KEY_VERSION` |
| `apiBaseUrl` | No | Base URL for media REST calls (defaults to `https://api.x.com`) |
| `apiHeaders` | No | Extra headers on every X API request |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Required at runtime — either via config or environment variable.

## Environment variables

```bash
XCHAT_BOT_TOKEN=xcbot_...          # OAuth2 user token for the bot account
XCHAT_USER_ID=1234567890           # Bot's numeric user ID
XCHAT_PIN=...                      # Juicebox PIN for key unlock
X_CONSUMER_SECRET=...              # App secret (CRC + webhook signature verification)
X_BOT_USERNAME=...                 # Optional @handle override; resolved from /2/users/me otherwise
X_VERIFY_SIGNATURES=true           # Optional; set false to accept unverifiable messages
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes (encrypted + signed) |
| Group replies | Yes (quoted reply to the triggering message) |
| Edit message | Yes (encrypted edit event targeting the original's sequence id; only the bot's own text messages). The first edit of a fresh message is held until the message is `editSafetyDelayMs` old, so receiving clients have stored the original before the edit arrives |
| Delete message | Yes (delete-for-all: a locally signed delete action removes the message for every participant; only the bot's own messages) |
| Streaming | Limited (message edits work, but the first edit is age-gated by `editSafetyDelayMs`, so rapid token-by-token updates are coarse) |
| Read receipts | Yes (sent for each delivered inbound message unless `sendReadReceipts: false`; falls back to the latest conversation event) |
| TTL propagation | Yes (replies inherit the inbound message's disappearing-message TTL) |

### Rich content

| Feature | Supported |
|---------|-----------|
| Markdown | No client-side rendering — outgoing markdown appears literally as plain text (tables are the exception, see below) |
| URL / @mention entities | Yes (detected in outgoing text, rendered as tappable links and mention pills) |
| Post cards | Yes (first `x.com/.../status/...` URL in outgoing text auto-attaches) |
| Media out | Yes (files encrypt-streamed and uploaded via the 3-step media upload flow) |
| Media in | Yes (attachments exposed with lazy download + decrypt via `fetchData()`) |
| Cards / buttons / modals | No (X Chat has no interactive message surface) |
| Tables | ASCII code blocks |

### Conversations

| Feature | Supported |
|---------|-----------|
| Mentions | Yes (structured mention entities, swipe-reply-to-bot, plain-text `@handle` fallback) |
| Add / remove reactions | Yes |
| Incoming reactions | Yes (routed to `onReaction`) |
| Typing indicator | Yes (keep-alive re-sent every 3s while a handler runs) |
| DMs | Yes |
| Group chats | Yes (`g`-prefixed conversation IDs) |
| Group join welcome | Yes (configurable via `welcomeMessage`) |
| Open DM | Yes (`openDM(userId)` reuses an existing conversation or runs a fresh key exchange; requires the recipient to have encrypted chat set up) |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Yes (`GET /2/chat/conversations/{id}/events`, batch-decrypted) |
| Fetch thread info | Yes |
| List threads | No |

## Mention behavior in groups

`chat.onNewMention(handler)` fires for group messages that mention the bot. A group message counts as a mention when:

1. Its rich-text **mention entities** include the bot's @handle or user ID — the authoritative signal, or
2. It is a **swipe-reply** to one of the bot's own messages, or
3. Its plain text contains `@handle` (fallback when no entities are present).

To reply to every group message instead, register a catch-all `chat.onNewMessage(/.+/, handler)`.

## Thread ID format

```
xchat:{conversationId}
```

- 1:1 conversations: `xchat:1234567890-9876543210` (both participant IDs)
- Group conversations: `xchat:g123456789` (opaque `g`-prefixed ID)

REST paths use the other participant's user ID for 1:1 conversations and the `g...` ID for groups; the adapter converts automatically.

## Encryption notes

- Conversation keys arrive via `KeyChange` events and are cached per conversation and key version. When a key is missing at send time, the adapter fetches recent conversation events to extract one.
- Incoming message signatures are verified against participants' signing keys (fetched from `GET /2/users/{id}/public_keys` and cached). With `verifySignatures: true` (the default), unverifiable messages are dropped.
- Media is encrypted separately from message text using streaming encryption; the message carries a `media_hash_key` reference that the recipient uses to download and decrypt the blob.

## Troubleshooting

### CRC validation failing

- Confirm `X_CONSUMER_SECRET` matches your app's consumer secret in the developer portal
- The response must be `{"response_token": "sha256=<base64 HMAC>"}` for GET requests

### Events not arriving

- Verify the subscription exists: `GET /2/activity/subscriptions` with the app bearer token
- Confirm the subscription's `webhook_id` points at a webhook whose URL is your live endpoint
- Subscription changes can take a few minutes to provision

### "Invalid signature" on webhook POSTs

- The adapter verifies `x-twitter-webhooks-signature` with HMAC-SHA256 keyed by `X_CONSUMER_SECRET` — make sure it is the same app that owns the webhook

### Messages decrypt but the bot never replies in groups

- Group replies require a mention — check that the sender actually @mentioned the bot's handle (the one from `/2/users/me`), or use `{ allGroupMessages: true }`

### "No conversation key" when posting

- The bot can only send in conversations where a conversation key has been shared with it (i.e., someone messaged the bot first, added it to the group, or the bot opened the conversation itself via `openDM(userId)`). `openDM` requires the recipient to have encrypted chat set up, and the server requires the recipient to trust the bot (e.g. follow it) before the first message is accepted.

## AI Coding Agents

If you use an AI coding agent such as OpenAI Codex, Claude Code, or Cursor, install the Chat SDK skill so it knows the SDK APIs, adapter patterns, and project conventions before writing code.

```bash
npx skills add vercel/chat
```

The skill references bundled documentation in `node_modules/chat/docs`, plus adapter guides and starter templates in the published package.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
