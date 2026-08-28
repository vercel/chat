[![X adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/x/og)](https://chat-sdk.dev/adapters/official/x)

# @chat-adapter/x

> npm package: [`@chat-adapter/x`](https://www.npmjs.com/package/@chat-adapter/x)

[![Agent Stack](https://img.shields.io/badge/Agent%20Stack-000?style=flat-square&logo=vercel&logoColor=FFF&labelColor=000&color=000)](https://vercel.com/kb/agent-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](../../LICENSE)

X (Twitter) adapter for [Chat SDK](https://chat-sdk.dev), using the [X API v2](https://docs.x.com/x-api/overview) and the [X Activity API](https://docs.x.com/x-api/activity/introduction). Reply to public mentions, hold DM conversations, post from the bot account, and like posts.

Documentation: [chat-sdk.dev/adapters/official/x](https://chat-sdk.dev/adapters/official/x) · Guides: [vercel.com/kb/chat-sdk](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/x
```

## Scaffold with the CLI

To scaffold a new X bot with this adapter preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter x memory
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

## Usage

```typescript
import { Chat } from "chat";
import { createXAdapter } from "@chat-adapter/x";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    x: createXAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post(`Hi @${message.author.userName}!`);
});

bot.onDirectMessage(async (thread, message) => {
  await thread.post("Hello from X!");
});
```

When using `createXAdapter()` without arguments, credentials are auto-detected from environment variables.

## X setup

### 1. Create an X app

1. Go to the [X developer portal](https://developer.x.com) and create a Project and App
2. Under **Keys and tokens**, copy the **API Key Secret** (consumer secret): this becomes `X_CONSUMER_SECRET`
3. Enable **OAuth 2.0** user authentication with the scopes `tweet.read`, `tweet.write`, `users.read`, `dm.read`, `dm.write`, `like.write`, and `offline.access`
4. Complete the OAuth 2.0 flow for the bot account. Either store the access token as `X_USER_ACCESS_TOKEN`, or store `X_CLIENT_ID` plus `X_REFRESH_TOKEN` to let the adapter manage token refresh

### 2. Register a webhook

X delivers events through the [X Activity API](https://docs.x.com/x-api/activity/introduction). Set this up once in the [X developer console](https://console.x.com), which handles the auth for you:

1. Register your webhook URL (`https://your-domain.com/api/webhooks/x`). It must be public HTTPS without a port. X immediately sends a CRC challenge, which the adapter answers automatically
2. Create subscriptions for the events the adapter consumes: `post.mention.create`, `dm.received`, and `dm.sent` (private events, so the bot user must have authorized your app first)

Subscription and webhook management is one-time setup, not adapter runtime. If you script it instead of using the console, the Activity API endpoints are auth-picky and operation-specific and do not fully match the published spec (creating a private-event subscription needed OAuth 1.0a user context in testing, while list and delete used the app-only bearer token), so the console is the simpler path.

### 3. Environment variables

```bash
X_CONSUMER_SECRET=...      # App API key secret, used for webhook CRC and signature verification

# Auth option A: static access token
X_USER_ACCESS_TOKEN=...    # OAuth 2.0 user-context access token for outbound calls

# Auth option B: managed OAuth refresh (recommended for long-running bots)
X_CLIENT_ID=...            # OAuth 2.0 client ID
X_REFRESH_TOKEN=...        # OAuth 2.0 refresh token (requires the offline.access scope)
X_CLIENT_SECRET=...        # Optional, only for confidential clients
X_ENCRYPTION_KEY=...       # Optional, base64 32-byte key to encrypt persisted tokens

X_USER_ID=...              # Bot account user ID. Optional if omitted it is fetched from /2/users/me; the adapter requires a resolvable bot id and fails init otherwise
X_USERNAME=...             # Optional, bot @handle for mention detection (fetched when omitted)
X_API_BASE_URL=...         # Optional, override the X API base URL
```

### Token refresh

X OAuth 2.0 user tokens are short-lived (about two hours). With `X_CLIENT_ID` and `X_REFRESH_TOKEN` set, the adapter refreshes the access token before expiry and persists the rotated refresh token in your state adapter, so the bot survives restarts. Set `X_ENCRYPTION_KEY` to store those tokens AES-256-GCM encrypted.

Alternatively, pass a token provider and plug in your own refresh logic:

```typescript
import { createXAdapter } from "@chat-adapter/x";

const adapter = createXAdapter({
  userAccessToken: async () => refreshTokenFromMyStore(),
});
```

## Webhook setup

X uses two webhook mechanisms, both handled by the adapter:

1. **CRC challenge** (GET): X sends a `crc_token` that the adapter answers with an HMAC-SHA256 response keyed by your consumer secret. X re-validates hourly
2. **Event delivery** (POST): activity events signed via the `x-twitter-webhooks-signature` header, verified against the raw request body

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.x(request);
}

export async function POST(request: Request) {
  return bot.webhooks.x(request);
}
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes (mention replies and DMs) |
| Top-level posts | Yes (`channel.post` on `x:public`) |
| Edit message | Posts only (X edit eligibility rules apply) |
| Delete message | Posts and own DM events |
| Streaming | Buffered (accumulates then posts once) |
| Typing indicator | No |

### Rich content

| Feature | Supported |
|---------|-----------|
| Card format | Plain text fallback |
| Buttons | No (link buttons render as text) |
| Tables | ASCII |
| Modals | No |
| Image uploads | Yes (png, jpeg, webp; up to 4 per post; also DMs) |

Attach images by passing `files` (or `attachments`) on the message; the adapter uploads each through X's chunked media endpoints (`initialize` then `append` then `finalize`) and attaches the returned `media_id`s to the post or DM. A post can carry media with or without text.

```typescript
await thread.post({
  markdown: "France lead the title race",
  files: [{ data: pngBuffer, filename: "odds.png", mimeType: "image/png" }],
});
```

Media upload requires the `media.write` scope on your OAuth 2.0 token, in addition to `tweet.write`. Mint the token with `media.write` included or uploads fail with a 403.

### Conversations

| Feature | Supported |
|---------|-----------|
| Mentions | Yes (`post.mention.create`) |
| DMs | Yes (`dm.received` / `dm.sent`) |
| Reactions | Likes only (`emoji.heart` or `"like"`) |
| User lookup | Yes |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | DMs via API, posts from cache |
| Fetch single message | Posts via API, DMs from cache |

## Thread ID format

```
x:post:{conversationId}   # public post threads (channel: x:public)
x:dm:{participantUserId}  # direct message with a single user
```

Examples: `x:post:1943467279943467279`, `x:dm:783214`. X DM webhooks carry no conversation id, only participant ids, so DMs are threaded by the other participant's user id: `openDM("783214")` returns `x:dm:783214`, and sends route to `POST /2/dm_conversations/with/783214/messages`. Top-level posts go through `channel.post` on the `x:public` channel.

## Automation policy

X enforces [automation rules](https://docs.x.com/developer-terms/policy). Before deploying a bot:

- get explicit consent before sending automated replies or DMs, and honor opt-outs immediately
- disclose the bot identity in the account profile
- never send bulk, duplicate, or aggressive automated content
- use only the official API (no scraping or browser automation)

The adapter is strict by default: it never streams by post-and-edit, rejects unsupported interactions loudly, and only replies where your handlers decide to.

## XChat (encrypted messaging)

XChat is X's encrypted messaging product. It ships from the `@chat-adapter/x/chat`
subpath of this package, so it installs with `@chat-adapter/x` and adds no
dependencies unless you import it.

```typescript
import { createXchatAdapter } from "@chat-adapter/x/chat";
```

The XChat crypto stack (`@xdevplatform/chat-xdk`, `@xdevplatform/xdk`,
`juicebox-sdk`) is declared as optional peer dependencies. Install them
alongside `@chat-adapter/x` when you use this subpath.

### Usage

```typescript
import { Chat } from "chat";
import { createXchatAdapter } from "@chat-adapter/x/chat";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    xchat: createXchatAdapter(),
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

When using `createXchatAdapter()` without arguments, credentials are auto-detected from environment variables. The bot's @handle is resolved from `GET /2/users/me` at startup, so mention detection works without any hardcoding.

### XChat setup

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

### Webhook route

X sends two kinds of requests:

1. **CRC challenge** (GET) — `?crc_token=...` answered with an HMAC-SHA256 of the token, keyed by your app's consumer secret. The adapter answers this, so route GET to it too.
2. **Event delivery** (POST) — chat events, verified by the adapter via the `x-twitter-webhooks-signature` header.

```typescript
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.xchat(request);
}

export async function POST(request: Request) {
  return bot.webhooks.xchat(request);
}
```

Do not sign the token in your own handler. The challenge and the POST signature use the same key, algorithm, and `sha256=` prefix, so a handler that HMACs an arbitrary `crc_token` becomes a signing oracle: a caller can pass a forged event body as the token and replay the response as `x-twitter-webhooks-signature`. The adapter constrains the token before signing it.

### Configuration

All options are auto-detected from environment variables when not provided.

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` / `accessToken` | No* | OAuth2 user access token for the bot account. Auto-detected from `XCHAT_BOT_TOKEN` or `X_ACCESS_TOKEN` |
| `pin` | No | Juicebox PIN; when set, keys unlock automatically during `initialize()`. Auto-detected from `XCHAT_PIN` |
| `consumerSecret` | For webhooks | App consumer secret for webhook signature verification. Auto-detected from `X_CONSUMER_SECRET`. **Required to receive webhooks**: X signs every POST, so without it every POST is rejected with 401. Polling deployments do not need it |
| `disableWebhookVerification` | No | Accept webhook POSTs without verifying their HMAC. Auto-detected from `X_DISABLE_WEBHOOK_VERIFICATION`. Only use it when an upstream layer verifies the signature. Not recommended in production |
| `editSafetyDelayMs` | No | Minimum age (ms) a freshly posted message must reach before its first edit is sent, so receiving clients have stored the original the edit targets. Defaults to `5000`; `0` disables the wait |
| `sendReadReceipts` | No | Send a read receipt for each delivered inbound message before handlers run (default `true`) |
| `userName` | No | Bot @handle for mention detection. Auto-detected from `X_BOT_USERNAME`, otherwise resolved from `GET /2/users/me` |
| `welcomeMessage` | No | Message posted when the bot joins a group. `false` disables; omitted uses a default that explains @mention-to-reply |
| `verifySignatures` | No | Require verifiable signatures on incoming messages (default `true`). `X_VERIFY_SIGNATURES=false` opts out |
| `signingKeyVersion` | No | Signing key version override. Normally fetched during `initialize()`. Auto-detected from `X_SIGNING_KEY_VERSION` |
| `apiBaseUrl` | No | Base URL for media REST calls (defaults to `https://api.x.com`) |
| `apiHeaders` | No | Extra headers on every X API request. Unless it includes a `User-Agent`, the adapter prepends `chat-sdk-xchat/<version>` to the client's default so Chat SDK traffic is identifiable |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Required at runtime — either via config or environment variable.

### Environment variables

```bash
XCHAT_BOT_TOKEN=xcbot_...          # OAuth2 user token for the bot account
XCHAT_PIN=...                      # Juicebox PIN for key unlock
X_CONSUMER_SECRET=...              # App secret (CRC + webhook signature verification)
X_BOT_USERNAME=...                 # Optional @handle override; resolved from /2/users/me otherwise
X_VERIFY_SIGNATURES=true           # Optional; set false to accept unverifiable messages
```

### Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Yes (encrypted + signed) |
| Group replies | Yes (quoted reply to the triggering message) |
| Edit message | Yes (encrypted edit event targeting the original's sequence id; only the bot's own text messages). The first edit of a fresh message is held until the message is `editSafetyDelayMs` old, so receiving clients have stored the original before the edit arrives |
| Delete message | Yes (delete-for-all: a locally signed delete action removes the message for every participant; only the bot's own messages) |
| Streaming | Limited (message edits work, but the first edit is age-gated by `editSafetyDelayMs`, so rapid token-by-token updates are coarse) |
| Read receipts | Yes (advances the conversation read watermark through each delivered inbound message unless `sendReadReceipts: false`; call `thread.markAsRead()` for manual control) |
| TTL propagation | Yes (replies inherit the inbound message's disappearing-message TTL) |

### Rich content

| Feature | Supported |
|---------|-----------|
| Markdown | No client-side rendering — outgoing markdown appears literally as plain text (tables are the exception, see below) |
| URL / @mention entities | Yes (detected in outgoing text, rendered as tappable links and mention pills) |
| Post cards | Yes (first `x.com/.../status/...` URL in outgoing text auto-attaches) |
| Media out | Yes (files encrypt-streamed and uploaded via the 3-step media upload flow) |
| Media in | Yes (attachments exposed with lazy download + decrypt via `fetchData()`) |
| Cards / buttons / modals | No (XChat has no interactive message surface) |
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

### Mention behavior in groups

`chat.onNewMention(handler)` fires for group messages that mention the bot. A group message counts as a mention when:

1. Its rich-text **mention entities** include the bot's @handle or user ID — the authoritative signal, or
2. It is a **swipe-reply** to one of the bot's own messages, or
3. Its plain text contains `@handle` (fallback when no entities are present).

To reply to every group message instead, register a catch-all `chat.onNewMessage(/.+/, handler)`.

### Thread ID format

```
xchat:{conversationId}
```

- 1:1 conversations: `xchat:1234567890-9876543210` (both participant IDs)
- Group conversations: `xchat:g123456789` (opaque `g`-prefixed ID)

REST paths use the other participant's user ID for 1:1 conversations and the `g...` ID for groups; the adapter converts automatically.

### Encryption notes

- Conversation keys arrive via `KeyChange` events and are cached per conversation and key version. When a key is missing at send time, the adapter fetches recent conversation events to extract one.
- Incoming message signatures are verified against participants' signing keys (fetched from `GET /2/users/{id}/public_keys` and cached). With `verifySignatures: true` (the default), unverifiable messages are dropped.
- Media is encrypted separately from message text using streaming encryption; the message carries a `media_hash_key` reference that the recipient uses to download and decrypt the blob.

### Troubleshooting

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

You can also install the [Vercel Plugin](https://vercel.com/docs/agent-resources/vercel-plugin) for a broader agent toolkit: it includes the Chat SDK skill alongside specialist agents, agent slash commands, and more:

```bash
npx plugins add vercel/vercel-plugin
```

The plugin is optional; the skill alone is enough to build with Chat SDK.

For agent-readable documentation, see [chat-sdk.dev/llms.txt](https://chat-sdk.dev/llms.txt) (page index) or [chat-sdk.dev/llms-full.txt](https://chat-sdk.dev/llms-full.txt) (full text).

## License

MIT
